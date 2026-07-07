-- Supabase / PostgreSQL séma a `signatures` táblához
CREATE TABLE IF NOT EXISTS public.signatures (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL,
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
