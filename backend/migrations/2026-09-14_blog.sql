-- =====================================================================
-- stopjeger.hu — blog: bejegyzesek, kepek, kep-tarhely
-- Migracio: 2026-09-14  (elofeltetel: 2026-09-11_admin_felulet.sql)
-- Futtatas: Supabase -> SQL Editor, EGYBEN. Utana futtasd le a fajl
-- vegen levo ELLENORZO lekerdezest, es nezd meg, hogy minden sor 'ok'.
-- =====================================================================
--
-- Tervezesi elvek:
--   * A szerkeszto a MUNKAPELDANYT irja (title, body_html, ...). A nyilvanos
--     oldal a publikalaskor lemasolt pub_* oszlopokbol dolgozik, igy egy kint
--     levo cikk modositasa csak ujabb tenyellenorzes + publikalas utan latszik.
--   * version: optimista zarolas -- ket szerkeszto nem irja felul egymast.
--   * RLS bekapcsolva, NULLA policy-val (mint az admin tablaknal): kizarolag
--     a szerveroldali secret key fer hozza. A kep-tarhely privat; a kepeket
--     a szerver szolgalja ki a stopjeger.hu/blog/kepek/ cimen.

create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------
-- 1. Feltoltott kepek (a jogcimmel egyutt, amit a feltolto megadott)
-- ---------------------------------------------------------------------
create table if not exists public.blog_images (
  id           uuid primary key default gen_random_uuid(),
  object_path  text not null unique,             -- <id>.jpg a blog-kepek tarhelyen
  width        integer,
  height       integer,
  bytes        integer,
  alt          text,
  credit       text,
  rights       text not null,                    -- 'ai' | 'jogdijmentes' | 'sajat'
  uploaded_by  uuid references public.admin_users(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint blog_images_rights check (rights in ('ai', 'jogdijmentes', 'sajat'))
);


-- ---------------------------------------------------------------------
-- 2. Bejegyzesek
-- ---------------------------------------------------------------------
create table if not exists public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null,
  status           text not null default 'draft',   -- 'draft' | 'published'
  version          integer not null default 1,

  -- munkapeldany (ezt szerkesztik)
  title            text not null default '',
  excerpt          text not null default '',
  author_display   text not null default '',
  body_html        text not null default '',
  cover_image      uuid references public.blog_images(id) on delete set null,
  cover_alt        text not null default '',
  cover_credit     text not null default '',

  -- a publikalt valtozat (ezt latja a nyilvanossag)
  pub_title        text,
  pub_excerpt      text,
  pub_author       text,
  pub_body_html    text,
  pub_cover_image  uuid references public.blog_images(id) on delete set null,
  pub_cover_alt    text,
  pub_cover_credit text,
  pub_hash         text,                              -- a publikalt munkapeldany hash-e
  published_at     timestamptz,                       -- elso publikalas
  pub_updated_at   timestamptz,                       -- utolso ujrapublikalas

  -- az utolso tenyellenorzes eredmenye (es ha a jelzeseket figyelmen kivul hagytak: ki, mikor)
  fact_check       jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.admin_users(id) on delete set null,
  updated_by       uuid references public.admin_users(id) on delete set null,
  published_by     uuid references public.admin_users(id) on delete set null,

  constraint blog_posts_status check (status in ('draft', 'published')),
  constraint blog_posts_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create unique index if not exists blog_posts_slug_key on public.blog_posts (slug);
create index if not exists blog_posts_published_idx on public.blog_posts (status, published_at desc);


-- ---------------------------------------------------------------------
-- 3. Kep-tarhely (privat bucket, csak JPEG, max. 5 MB)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-kepek', 'blog-kepek', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 4. Jogosultsagok: RLS be, nulla policy
-- ---------------------------------------------------------------------
alter table public.blog_posts  enable row level security;
alter table public.blog_images enable row level security;

revoke all on public.blog_posts  from anon, authenticated;
revoke all on public.blog_images from anon, authenticated;


-- =====================================================================
-- ELLENORZO LEKERDEZES -- a migracio UTAN, kulon futtasd.
-- Minden sornak 'ok'-nak kell lennie. (A kezi beillesztes korabban mar
-- csendben elhagyott reszeket -- ezert ellenorizzuk tetelesen.)
-- =====================================================================
-- select 'tabla: ' || t as elem,
--        case when to_regclass('public.' || t) is not null then 'ok' else 'HIANYZIK' end as allapot
-- from unnest(array['blog_posts','blog_images']) t
-- union all
-- select 'oszlop: blog_posts.' || c,
--        case when exists (select 1 from information_schema.columns
--                          where table_schema = 'public' and table_name = 'blog_posts' and column_name = c)
--             then 'ok' else 'HIANYZIK' end
-- from unnest(array['slug','status','version','body_html','cover_credit','pub_body_html','pub_hash',
--                   'published_at','pub_updated_at','fact_check','published_by']) c
-- union all
-- select 'index: ' || i, case when to_regclass('public.' || i) is not null then 'ok' else 'HIANYZIK' end
-- from unnest(array['blog_posts_slug_key','blog_posts_published_idx']) i
-- union all
-- select 'rls: ' || c.relname, case when c.relrowsecurity then 'ok' else 'NINCS BEKAPCSOLVA' end
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname in ('blog_posts', 'blog_images')
-- union all
-- select 'policy-k szama (0 kell): ' || t,
--        case when (select count(*) from pg_policies where schemaname = 'public' and tablename = t) = 0
--             then 'ok' else 'VAN POLICY' end
-- from unnest(array['blog_posts','blog_images']) t
-- union all
-- select 'tarhely: blog-kepek',
--        case when exists (select 1 from storage.buckets where id = 'blog-kepek' and public = false)
--             then 'ok' else 'HIANYZIK VAGY NYILVANOS' end;
