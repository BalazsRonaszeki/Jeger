# stopjeger.hu

Közvélemény-kutatás és háttéranyag a JÉGER (Országos Jégkármérséklő Rendszer) és egyéb
időjárás-befolyásoló rendszerek szabályozásáról. Élő oldal: [stopjeger.hu](https://stopjeger.hu)

Adatkezelő: **Agro-Biotech Kft.** (adószám: 32031973-2-07)

- **Frontend:** statikus HTML a repo gyökerében
  - `index.html` — a főoldal (háttéranyag: tudomány, technológia, felügyelet, interjúk, forrásjegyzék)
  - `kerdoiv/index.html` — a közvélemény-kutatás űrlapja
  - `adatkezeles.html` — adatkezelési tájékoztató
  - Süti nincs; a látogatottság-mérés a sütimentes Vercel Web Analytics
    (`/_vercel/insights/script.js`), amit a Vercel dashboardon kell bekapcsolni
- **Backend:** FastAPI app Vercel Python serverless függvényként az `api/index.py`-ban, Supabase-be ír
- **`backend/`:** csak dokumentáció és séma, nem fut runtime-ban
  - `supabase_schema.sql` — a `survey_responses` és `subscribers` táblák
  - `adatkezelesi_nyilvantartas.md` — GDPR 30. cikk szerinti belső nyilvántartás (nem publikus)

## Adatmodell

Két, egymással **össze nem kapcsolható** tábla:

| Tábla | Tartalom |
|---|---|
| `survey_responses` | A kérdőív válaszai. Se e-mail, se IP, se pontos időbélyeg — csak beküldési dátum. |
| `subscribers` | A hírlevélre feliratkozók e-mail címe, hozzájárulás ténye, megerősítő token. |

A szétválasztás nem stílus kérdése: a kérdőív azt ígéri a kitöltőnek, hogy a válaszokat névtelenül
dolgozzuk fel. Egy közös azonosító vagy egy másodperc pontosságú időbélyeg ezt az ígéretet megtörné.

## API

| Végpont | Leírás |
|---|---|
| `POST /api/survey` | Kérdőív beküldése. A válaszokat és az esetleges feliratkozást külön sorba írja. |
| `GET /api/count` | A beérkezett válaszok száma. |
| `GET /api/admin/export?dataset=survey\|subscribers` | CSV-export. Jelszó **csak** `X-Admin-Password` fejlécben. |

```bash
curl -H "X-Admin-Password: <jelszo>" \
  "https://stopjeger.hu/api/admin/export?dataset=survey" -o valaszok.csv
```

## Deploy

A GitHub repóra pusholt commit automatikusan deployol Vercelen.

Environment változók (Vercel → Project → Settings → Environment Variables):

| Név | Érték |
|---|---|
| `SUPABASE_URL` | `https://<projekt-ref>.supabase.co` |
| `SUPABASE_KEY` | Supabase **secret key** (`sb_secret_…`) — soha ne a publishable |
| `ADMIN_PASSWORD` | admin export jelszó, hosszú és véletlen |
| `ALLOWED_ORIGINS` | opcionális, default `https://stopjeger.hu,https://www.stopjeger.hu` |
| `MAX_SUBMISSIONS_PER_MINUTE` | opcionális, default 6 |
| `ADMIN_MAX_ATTEMPTS` | opcionális, default 5 |
| `ADMIN_LOCKOUT_SECONDS` | opcionális, default 900 |

## DNS (WebSupport)

A zóna a WebSupportnál marad, **nem** a Vercel névszerverein — az M365 levelezés
(MX, SPF, DKIM, DMARC) ugyanabban a zónában él.

| Név | Típus | Érték |
|---|---|---|
| `stopjeger.hu` | A | `216.198.79.1` |
| `www` | CNAME | `1131f777d922ce36.vercel-dns-017.com.` |

## Nyitott feladatok

- [ ] Kettős opt-in: megerősítő levél kiküldése és a `confirm_token` beváltása (`confirmed_at`)
- [ ] Adatfeldolgozói szerződések (DPA) elfogadása: Supabase, Vercel, Brevo.
      Az adatkezelési tájékoztató 5. pontja azt állítja, hogy ezek érvényben vannak.
- [ ] Hírlevél-kiküldés Brevóval, `List-Unsubscribe` fejléccel és leiratkozó hivatkozással
- [x] Google Analytics kivezetve; helyette sütimentes Vercel Web Analytics, süti-sáv nélkül
- [x] A YouTube-előnézeti képek helyi kiszolgálása (kész: `assets/video-thumbs/yt-*.jpg`)
- [x] Betűtípusok helyi kiszolgálása (`assets/fonts/fonts.css`), Google Fonts-hívás megszűnt

## Lokális fejlesztés

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r api/requirements.txt
vercel dev
```
