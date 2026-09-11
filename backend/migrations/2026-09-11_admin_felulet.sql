-- =====================================================================
-- stopjeger.hu — belso (admin) felulet: felhasznalok, belepes, dashboard
-- Migracio: 2026-09-11
-- Futtatas: Supabase -> SQL Editor, EGYBEN. Utana futtasd le a fajl
-- vegen levo ELLENORZO lekerdezest, es nezd meg, hogy minden sor 'ok'.
-- =====================================================================
--
-- Tervezesi elvek:
--   * Sajat felhasznalokezeles (nem a Supabase Auth): a masodik faktor
--     e-mailben kuldott kod, amit a Supabase Auth nem tamogat.
--   * Jelszo csak scrypt-hash formaban, token es belepesi kod csak
--     hash formaban kerul az adatbazisba.
--   * RLS bekapcsolva, NULLA policy-val -- ugyanugy, mint a kerdoiv
--     tablainal: kizarolag a szerveroldali secret key fer hozza.
--   * A dashboard csak OSSZESITETT szamokat kap (napi darabszam), soha
--     e-mail-cimet vagy egyedi valaszsort.

create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------
-- 1. Felhasznalok
-- ---------------------------------------------------------------------
create table if not exists public.admin_users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  name            text,
  role            text not null default 'editor',   -- 'admin' | 'editor'
  status          text not null default 'invited',  -- 'invited' | 'active' | 'disabled'
  password_hash   text,                             -- scrypt$n$r$p$salt$hash

  created_at      timestamptz not null default now(),
  invited_by      uuid references public.admin_users(id) on delete set null,
  activated_at    timestamptz,
  last_login_at   timestamptz,

  failed_logins   integer not null default 0,
  locked_until    timestamptz,

  constraint admin_users_role   check (role in ('admin', 'editor')),
  constraint admin_users_status check (status in ('invited', 'active', 'disabled'))
);

create unique index if not exists admin_users_email_key on public.admin_users (lower(email));


-- ---------------------------------------------------------------------
-- 2. Meghivo- es jelszo-visszaallito tokenek (csak SHA-256 hash)
-- ---------------------------------------------------------------------
create table if not exists public.admin_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.admin_users(id) on delete cascade,
  purpose     text not null,                 -- 'invite' | 'reset'
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,

  constraint admin_tokens_purpose check (purpose in ('invite', 'reset'))
);

create index if not exists admin_tokens_user_idx on public.admin_tokens (user_id);


-- ---------------------------------------------------------------------
-- 3. Belepesi kodok (masodik faktor, e-mailben) -- csak HMAC hash
-- ---------------------------------------------------------------------
create table if not exists public.admin_login_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.admin_users(id) on delete cascade,
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  used_at     timestamptz
);

create index if not exists admin_login_challenges_user_idx on public.admin_login_challenges (user_id);


-- ---------------------------------------------------------------------
-- 4. Munkamenetek (a sutiben csak egy veletlen token, itt a hash-e)
-- ---------------------------------------------------------------------
create table if not exists public.admin_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.admin_users(id) on delete cascade,
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);

create index if not exists admin_sessions_user_idx on public.admin_sessions (user_id);


-- ---------------------------------------------------------------------
-- 5. Esemenynaplo (IP-cim NELKUL)
-- ---------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  user_id  uuid references public.admin_users(id) on delete set null,
  action   text not null,
  detail   text
);

create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at);


-- ---------------------------------------------------------------------
-- 6. Dashboard-osszesitok. Csak napi darabszamot adnak vissza.
-- ---------------------------------------------------------------------

-- Kerdoiv-kitoltesek naponta. A survey_responses szandekosan csak
-- datumot tarol (submitted_on), igy pontosabb bontas nem is lehetseges.
create or replace function public.admin_survey_daily(p_from date, p_to date)
returns table (day date, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select r.submitted_on as day, count(*)::bigint as n
  from public.survey_responses r
  where r.submitted_on between p_from and p_to
  group by r.submitted_on
  order by r.submitted_on;
$$;

-- Hirlevel: megerositett feliratkozasok (confirmed_at) es az osszes
-- feliratkozasi kiserlet (created_at) naponta, budapesti ido szerint.
create or replace function public.admin_subscribers_daily(p_from date, p_to date)
returns table (day date, confirmed bigint, signups bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with c as (
    select (s.confirmed_at at time zone 'Europe/Budapest')::date as d, count(*)::bigint as n
    from public.subscribers s
    where s.confirmed_at is not null
      and (s.confirmed_at at time zone 'Europe/Budapest')::date between p_from and p_to
    group by 1
  ),
  a as (
    select (s.created_at at time zone 'Europe/Budapest')::date as d, count(*)::bigint as n
    from public.subscribers s
    where (s.created_at at time zone 'Europe/Budapest')::date between p_from and p_to
    group by 1
  )
  select coalesce(c.d, a.d) as day,
         coalesce(c.n, 0)   as confirmed,
         coalesce(a.n, 0)   as signups
  from c full join a on a.d = c.d
  order by 1;
$$;

-- Idoszaktol fuggetlen, aktualis allapot.
create or replace function public.admin_totals()
returns table (survey_total bigint, subscribers_active bigint, subscribers_pending bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*) from public.survey_responses)::bigint,
    (select count(*) from public.subscribers
       where confirmed_at is not null and unsubscribed_at is null)::bigint,
    (select count(*) from public.subscribers
       where confirmed_at is null and unsubscribed_at is null)::bigint;
$$;


-- ---------------------------------------------------------------------
-- 7. Jogosultsagok: RLS be, nulla policy; a fuggvenyek csak service_role-nak
-- ---------------------------------------------------------------------
alter table public.admin_users            enable row level security;
alter table public.admin_tokens           enable row level security;
alter table public.admin_login_challenges enable row level security;
alter table public.admin_sessions         enable row level security;
alter table public.admin_audit_log        enable row level security;

revoke all on public.admin_users            from anon, authenticated;
revoke all on public.admin_tokens           from anon, authenticated;
revoke all on public.admin_login_challenges from anon, authenticated;
revoke all on public.admin_sessions         from anon, authenticated;
revoke all on public.admin_audit_log        from anon, authenticated;

revoke all on function public.admin_survey_daily(date, date)      from public, anon, authenticated;
revoke all on function public.admin_subscribers_daily(date, date) from public, anon, authenticated;
revoke all on function public.admin_totals()                      from public, anon, authenticated;
grant execute on function public.admin_survey_daily(date, date)      to service_role;
grant execute on function public.admin_subscribers_daily(date, date) to service_role;
grant execute on function public.admin_totals()                      to service_role;


-- =====================================================================
-- ELLENORZO LEKERDEZES -- a migracio UTAN, kulon futtasd.
-- Minden sornak 'ok'-nak kell lennie. (A kezi beillesztes korabban mar
-- csendben elhagyott reszeket -- ezert ellenorizzuk tetelesen.)
-- =====================================================================
-- select 'tabla: ' || t as elem,
--        case when to_regclass('public.' || t) is not null then 'ok' else 'HIANYZIK' end as allapot
-- from unnest(array['admin_users','admin_tokens','admin_login_challenges','admin_sessions','admin_audit_log']) t
-- union all
-- select 'rls: ' || c.relname, case when c.relrowsecurity then 'ok' else 'NINCS BEKAPCSOLVA' end
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname like 'admin\_%' and c.relkind = 'r'
-- union all
-- select 'policy-k szama (0 kell): ' || tablename, case when count(*) = 0 then 'ok' else count(*)::text end
-- from pg_policies where schemaname = 'public' and tablename like 'admin\_%' group by tablename
-- union all
-- select 'fuggveny: ' || f, case when to_regprocedure(f) is not null then 'ok' else 'HIANYZIK' end
-- from unnest(array['public.admin_survey_daily(date,date)','public.admin_subscribers_daily(date,date)','public.admin_totals()']) f;
