-- Supabase / PostgreSQL séma a `signatures` táblához
CREATE TABLE IF NOT EXISTS public.signatures (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  settlement text,
  street_address text,
  email text NOT NULL,
  is_farmer text,
  hectares text,
  consent boolean NOT NULL DEFAULT false,
  updates_optin boolean NOT NULL DEFAULT false,
  ip text,
  created_at bigint
);

-- Index a későbbi lekérdezésekhez
CREATE INDEX IF NOT EXISTS idx_signatures_created_at ON public.signatures (created_at);

-- Migráció egy már létező táblához (ha korábban a schema.sql korábbi verzióját futtattad le):
-- ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS consent boolean NOT NULL DEFAULT false;
-- ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS updates_optin boolean NOT NULL DEFAULT false;
-- ALTER TABLE public.signatures DROP COLUMN IF EXISTS file_url;

-- Migráció: a korábbi egységes 'address' mező szétbontása 'settlement' (település) és
-- 'street_address' (utca, házszám) mezőkre. A régi 'address' oszlopot NEM töröljük
-- automatikusan, hogy a meglévő adat ne vesszen el — a meglévő sorok street_address
-- mezőjébe átmásoljuk a régi address értéket, a settlement mezőt üresen hagyva
-- (ezt utólag, kézzel érdemes kiegészíteni a Supabase Table Editorban).
-- ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS settlement text;
-- ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS street_address text;
-- UPDATE public.signatures SET street_address = address WHERE street_address IS NULL AND address IS NOT NULL;
