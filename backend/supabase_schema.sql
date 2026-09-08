-- =====================================================================
-- stopjeger.hu — kozvelemeny-kutatas sema
-- Adatkezelo: Agro-Biotech Kft. (adoszam: 32031973-2-07)
-- Supabase projekt: eu-west-1 (Irorszag)
-- =====================================================================
--
-- Ket, egymassal OSSZE NEM KAPCSOLHATO tabla. A kerdoiv azt igeri, hogy
-- "a valaszokat anonim modon, osszesitve dolgozzuk fel" -- ezert a valaszok
-- es a hirlevel-feliratkozas kozott semmilyen kozos azonosito nincs.
--
-- A survey_responses szandekosan NEM tarol pontos idobelyeget es IP-cimet:
-- egy masodperc pontossagu created_at a subscribers.created_at ertekevel
-- osszevetve visszafejtene, melyik valasz kihez tartozik. Ezert csak
-- beerkezesi DATUM kerul rogzitesre.

create extension if not exists pgcrypto;

-- A regi, alairasgyujteshez keszult tabla nem kell tobbe.
drop table if exists public.signatures;


-- ---------------------------------------------------------------------
-- 1. Kerdoiv-valaszok (anonim)
-- ---------------------------------------------------------------------
create table public.survey_responses (
  id               uuid primary key default gen_random_uuid(),

  respondent_type  text,      -- q1: 'gazdalkodo' | 'maganszemely'
  hail_damage      text,      -- q6: 'igen' | 'nem' (csak gazdalkodoknak)
  county           text,      -- q2: megye

  -- Likert-skalak, 1..4
  effective        smallint,  -- hatekony rendszer fontossaga
  danger           smallint,  -- veszely az okoszisztemara
  transparency     smallint,  -- atlathatoan uzemeltetik-e
  reporting        smallint,  -- legyen-e bejelentesi kotelezettseg
  health           smallint,  -- egeszsegugyi aggodalom

  submitted_on     date not null default current_date,

  constraint survey_scale_range check (
    coalesce(effective, 1)    between 1 and 4 and
    coalesce(danger, 1)       between 1 and 4 and
    coalesce(transparency, 1) between 1 and 4 and
    coalesce(reporting, 1)    between 1 and 4 and
    coalesce(health, 1)       between 1 and 4
  ),
  constraint survey_respondent_type check (
    respondent_type is null or respondent_type in ('gazdalkodo', 'maganszemely')
  )
);

create index survey_responses_submitted_on_idx on public.survey_responses (submitted_on);
create index survey_responses_county_idx       on public.survey_responses (county);


-- ---------------------------------------------------------------------
-- 2. Hirlevel-feliratkozok
-- ---------------------------------------------------------------------
create table public.subscribers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  source           text not null default 'kerdoiv',

  consent          boolean not null default false,
  created_at       timestamptz not null default now(),

  -- kettos opt-in: a megerosito level kikuldese meg nincs bekotve,
  -- addig minden sor confirmed_at IS NULL allapotban all
  confirm_token    uuid unique default gen_random_uuid(),
  token_expires_at timestamptz not null default now() + interval '48 hours',
  confirmed_at     timestamptz,

  unsubscribed_at  timestamptz
);

create unique index subscribers_email_key   on public.subscribers (lower(email));
create index        subscribers_active_idx  on public.subscribers (confirmed_at)
  where confirmed_at is not null and unsubscribed_at is null;


-- ---------------------------------------------------------------------
-- 3. RLS: bekapcsolva, NULLA policy-val.
--    Sem az anon (publishable), sem az authenticated kulcs nem lat semmit.
--    Kizarolag a secret key (a Vercel-oldali API) fer hozza, ami megkeruli.
-- ---------------------------------------------------------------------
alter table public.survey_responses enable row level security;
alter table public.subscribers      enable row level security;

revoke all on public.survey_responses from anon, authenticated;
revoke all on public.subscribers      from anon, authenticated;
