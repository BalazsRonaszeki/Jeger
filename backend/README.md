# backend/ — dokumentáció

Ez a mappa csak dokumentációt és a Supabase sémát tartalmazza. A futó API kód az `api/index.py`-ban van (Vercel Python serverless function), lásd a repo gyökér `README.md`-jét.

Fájlok:
- `supabase_schema.sql` — a `signatures` tábla sémája, futtatandó a Supabase SQL editorban.
- `privacy.md` — adatkezelési tájékoztató vázlat.
- `.env.example` — helyi fejlesztéshez szükséges környezeti változók mintája (élesben ezek Vercel env varok).
