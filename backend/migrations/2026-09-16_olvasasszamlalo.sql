-- =====================================================================
-- stopjeger.hu — blog: olvasasszamlalo
-- Migracio: 2026-09-16  (elofeltetel: 2026-09-14_blog.sql)
-- Futtatas: Supabase -> SQL Editor, EGYBEN. Utana futtasd le a fajl
-- vegen levo ELLENORZO lekerdezest, es nezd meg, hogy minden sor 'ok'.
-- =====================================================================
--
-- Tervezesi elvek:
--   * A szamlalo SZEMELYES ADATOT NEM TAROL: se IP, se sutit, se
--     bongeszo-ujjlenyomatot. Csak annyi keletkezik, hogy egy adott
--     bejegyzest egy adott napon hanyszor olvastak el. Ebbol egyetlen
--     latogato sem azonosithato vissza.
--   * A nyilvanos oldalt a CDN 60 masodpercig gyorsitotarazza, ezert a
--     szerveroldali renderelesbol nem lehet szamolni -- a bongeszo kuld
--     egy jelzest, miutan a latogato tenylegesen olvasni kezdte a cikket.
--   * blog_posts.views_total denormalizalt osszeg, hogy a lista egyetlen
--     extra lekerdezes nelkul meg tudja mutatni.
--   * RLS bekapcsolva, NULLA policy-val (mint a tobbi blog-tablanal):
--     kizarolag a szerveroldali secret key fer hozza.

-- ---------------------------------------------------------------------
-- 1. Osszesitett szamlalo a bejegyzesen
-- ---------------------------------------------------------------------
alter table public.blog_posts
  add column if not exists views_total bigint not null default 0;


-- ---------------------------------------------------------------------
-- 2. Napi bontas (a kesobbi grafikonhoz)
-- ---------------------------------------------------------------------
create table if not exists public.blog_post_views (
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  day     date not null,
  n       bigint not null default 0,

  primary key (post_id, day)
);


-- ---------------------------------------------------------------------
-- 3. Novelo fuggveny -- slug alapjan, hogy a nyilvanos oldal ne
--    szivarogtasson belso azonositot, es csak publikalt cikk szamitson.
-- ---------------------------------------------------------------------
create or replace function public.blog_view_bump(p_slug text)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.blog_posts
   where slug = p_slug and status = 'published';

  if v_id is null then
    return;                      -- ismeretlen vagy visszavont cikk: csendben nem szamit
  end if;

  insert into public.blog_post_views (post_id, day, n)
  values (v_id, (now() at time zone 'Europe/Budapest')::date, 1)
  on conflict (post_id, day) do update set n = public.blog_post_views.n + 1;

  update public.blog_posts
     set views_total = coalesce(views_total, 0) + 1
   where id = v_id;
end;
$$;

revoke all on function public.blog_view_bump(text) from public, anon, authenticated;
grant execute on function public.blog_view_bump(text) to service_role;


-- ---------------------------------------------------------------------
-- 4. Jogosultsagok: RLS be, nulla policy
-- ---------------------------------------------------------------------
alter table public.blog_post_views enable row level security;

revoke all on public.blog_post_views from anon, authenticated;


-- =====================================================================
-- ELLENORZO LEKERDEZES -- a migracio UTAN, kulon futtasd.
-- Minden sornak 'ok'-nak kell lennie. (A kezi beillesztes korabban mar
-- csendben elhagyott reszeket -- ezert ellenorizzuk tetelesen.)
-- =====================================================================
-- select 'oszlop: blog_posts.views_total' as elem,
--        case when exists (select 1 from information_schema.columns
--                          where table_schema = 'public' and table_name = 'blog_posts'
--                            and column_name = 'views_total')
--             then 'ok' else 'HIANYZIK' end as allapot
-- union all
-- select 'tabla: blog_post_views',
--        case when to_regclass('public.blog_post_views') is not null then 'ok' else 'HIANYZIK' end
-- union all
-- select 'fuggveny: public.blog_view_bump(text)',
--        case when to_regprocedure('public.blog_view_bump(text)') is not null then 'ok' else 'HIANYZIK' end
-- union all
-- select 'rls: blog_post_views',
--        case when c.relrowsecurity then 'ok' else 'NINCS BEKAPCSOLVA' end
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relname = 'blog_post_views'
-- union all
-- select 'policy-k szama (0 kell): blog_post_views',
--        case when (select count(*) from pg_policies
--                    where schemaname = 'public' and tablename = 'blog_post_views') = 0
--             then 'ok' else 'VAN POLICY' end
-- union all
-- select 'jogosultsag: anon nem futtathatja',
--        case when not has_function_privilege('anon', 'public.blog_view_bump(text)', 'execute')
--             then 'ok' else 'ANON FUTTATHATJA' end;
