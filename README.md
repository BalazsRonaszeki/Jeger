# JÉGER aláírásgyűjtés

Aláírásgyűjtő oldal Vercelre deployolva: [jeger-peticio.com](https://jeger-peticio.com)

- Frontend: statikus magyar nyelvű HTML űrlap a repo gyökerében (`index.html`, `app.js`, `styles.css`)
- Backend: FastAPI app Vercel Python serverless függvényként az `api/index.py`-ban, Supabase-be ír (tábla + storage bucket)
- `backend/`: csak dokumentáció és a Supabase séma (`supabase_schema.sql`, `privacy.md`), nem fut runtime-ban

## Deploy

A GitHub repóra pusholt commit automatikusan deployol Vercelen (a projekt már össze van kötve).

Kötelező environment változók a Vercel projekt beállításaiban (Project → Settings → Environment Variables):

| Név | Érték |
|---|---|
| `SUPABASE_URL` | Supabase projekt URL |
| `SUPABASE_KEY` | Supabase `service_role` kulcs |
| `ADMIN_PASSWORD` | admin export jelszó |
| `MAX_SUBMISSIONS_PER_MINUTE` | opcionális, default 6 |

Supabase oldalon szükséges: `signatures` tábla (lásd `backend/supabase_schema.sql`) és egy publikus `signatures` storage bucket.

## Lokális fejlesztés (opcionális)

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r api/requirements.txt
uvicorn api.index:app --reload --host 0.0.0.0 --port 8000
```

A frontendhez ekkor a repo gyökerét kell kiszolgálni (pl. `python -m http.server`), vagy egyszerűen `vercel dev`-et használni, ami az `api/` és a statikus fájlokat is egyben szolgálja ki.
