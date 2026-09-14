-- =====================================================================
-- stopjeger.hu — blogszerzok (profilfoto) es a kerdoiv valaszmegoszlasa
-- Migracio: 2026-09-14  (elofeltetel: 2026-09-11_admin_felulet.sql es
--                        2026-09-14_blog.sql)
-- Futtatas: Supabase -> SQL Editor, EGYBEN. Utana futtasd le a fajl
-- vegen levo ELLENORZO lekerdezest, es nezd meg, hogy minden sor 'ok'.
-- =====================================================================
--
-- Tervezesi elvek:
--   * A szerzo neve es fotoja a bejegyzesben pillanatkepkent is tarolodik
--     (author_display, author_photo, ill. publikalaskor pub_author_photo),
--     ugyanugy, mint a bejegyzes tobbi resze.
--   * A valaszmegoszlas KIZAROLAG osszesitett darabszamot ad vissza
--     (kerdes, valasz, darab) -- egyedi valaszsort soha, es a kerdesek
--     kozott sem kapcsol ossze (nincs kereszttabla).

-- ---------------------------------------------------------------------
-- 1. Profilfoto a munkatarsaknak
-- ---------------------------------------------------------------------
alter table public.admin_users
  add column if not exists photo_id uuid references public.blog_images(id) on delete set null;


-- ---------------------------------------------------------------------
-- 2. Szerzo a bejegyzesekben
-- ---------------------------------------------------------------------
alter table public.blog_posts
  add column if not exists author_id        uuid references public.admin_users(id) on delete set null,
  add column if not exists author_photo     uuid references public.blog_images(id) on delete set null,
  add column if not exists pub_author_photo uuid references public.blog_images(id) on delete set null;


-- ---------------------------------------------------------------------
-- 3. Kerdoiv: valaszok megoszlasa kerdesenkent (osszesitve)
-- ---------------------------------------------------------------------
create or replace function public.admin_survey_distribution()
returns table (question text, answer text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select 'respondent_type', coalesce(respondent_type, ''), count(*) from public.survey_responses group by 2
  union all
  -- a jegkarra vonatkozo kerdest csak a gazdalkodok kaptak meg
  select 'hail_damage', coalesce(hail_damage, ''), count(*) from public.survey_responses
   where respondent_type = 'gazdalkodo' group by 2
  union all
  select 'county', coalesce(county, ''), count(*) from public.survey_responses group by 2
  union all
  select 'effective', coalesce(effective::text, ''), count(*) from public.survey_responses group by 2
  union all
  select 'danger', coalesce(danger::text, ''), count(*) from public.survey_responses group by 2
  union all
  select 'transparency', coalesce(transparency::text, ''), count(*) from public.survey_responses group by 2
  union all
  select 'reporting', coalesce(reporting::text, ''), count(*) from public.survey_responses group by 2
  union all
  select 'health', coalesce(health::text, ''), count(*) from public.survey_responses group by 2;
$$;

revoke all on function public.admin_survey_distribution() from public, anon, authenticated;
grant execute on function public.admin_survey_distribution() to service_role;


-- =====================================================================
-- ELLENORZO LEKERDEZES -- a migracio UTAN, kulon futtasd.
-- Minden sornak 'ok'-nak kell lennie.
-- =====================================================================
-- select 'oszlop: ' || t || '.' || c as elem,
--        case when exists (select 1 from information_schema.columns
--                          where table_schema = 'public' and table_name = t and column_name = c)
--             then 'ok' else 'HIANYZIK' end as allapot
-- from (values ('admin_users', 'photo_id'), ('blog_posts', 'author_id'),
--              ('blog_posts', 'author_photo'), ('blog_posts', 'pub_author_photo')) as v(t, c)
-- union all
-- select 'fuggveny: public.admin_survey_distribution()',
--        case when to_regprocedure('public.admin_survey_distribution()') is not null then 'ok' else 'HIANYZIK' end
-- union all
-- select 'jogosultsag: anon nem futtathatja',
--        case when not has_function_privilege('anon', 'public.admin_survey_distribution()', 'execute')
--             then 'ok' else 'ANON FUTTATHATJA' end;
