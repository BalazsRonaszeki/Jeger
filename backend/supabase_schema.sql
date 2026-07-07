-- Supabase / PostgreSQL séma a `signatures` táblához
CREATE TABLE IF NOT EXISTS public.signatures (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL,
  email text NOT NULL,
  is_farmer text,
  hectares text,
  file_url text,
  ip text,
  created_at bigint
);

-- Index a későbbi lekérdezésekhez
CREATE INDEX IF NOT EXISTS idx_signatures_created_at ON public.signatures (created_at);
