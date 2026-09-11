# stopjeger.hu

Közvélemény-kutatás és háttéranyag a JÉGER (Országos Jégkármérséklő Rendszer) és egyéb
időjárás-befolyásoló rendszerek szabályozásáról. Élő oldal: [stopjeger.hu](https://stopjeger.hu)

Adatkezelő: **Agro-Biotech Kft.** (adószám: 32031973-2-07)

- **Frontend:** statikus HTML a repo gyökerében
  - `index.html` — a főoldal (háttéranyag: tudomány, technológia, felügyelet, interjúk, forrásjegyzék)
  - `kerdoiv/index.html` — a közvélemény-kutatás űrlapja
  - `adatkezeles.html` — adatkezelési tájékoztató
  - `megerosites.html` — a hírlevél-megerősítés visszajelző oldala
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
| `GET /api/confirm?token=…` | A megerősítő levél célpontja. Beváltja a tokent, felviszi a címet a Brevo-listára, majd a `/megerosites.html`-re irányít. |
| `GET /api/admin/export?dataset=survey\|subscribers` | CSV-export. Jelszó **csak** `X-Admin-Password` fejlécben. |
| `POST /api/admin/login`, `/login/verify`, `/logout` | Belépés: jelszó, majd e-mailben kapott 6 jegyű kód; HttpOnly munkamenet-süti. |
| `POST /api/admin/password/check`, `/password/set`, `/password/forgot` | Meghívó elfogadása, jelszó-visszaállítás. |
| `GET /api/admin/session`, `GET /api/admin/stats?from=&to=` | Munkamenet-állapot; dashboard (napi összesítők, max. 366 nap). |
| `GET /api/admin/users`, `POST /api/admin/users/invite`, `/users/{id}/disable\|enable\|resend` | Felhasználókezelés (csak admin). |
| `POST /api/admin/bootstrap` | Az **első** admin meghívása `X-Admin-Password` fejléccel; csak amíg nincs admin. |

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
| `BREVO_API_KEY` | Brevo API-kulcs a megerősítő levelekhez |
| `BREVO_LIST_ID` | a lista azonosítója, ahová a **megerősített** címek kerülnek |
| `MAIL_FROM_EMAIL` | default `hirlevel@news.stopjeger.hu` |
| `MAIL_FROM_NAME` | default `JÉGER-kezdeményezés` |
| `MAIL_REPLY_TO` | default `info@stopjeger.hu` |
| `SITE_URL` | a megerősítő hivatkozás alapcíme, default `https://stopjeger.hu` |
| `ADMIN_LOCKOUT_SECONDS` | opcionális, default 900 |
| `ADMIN_AUTH_SECRET` | **belső felület:** hosszú véletlen titok a belépési kódok HMAC-jéhez — nélküle az `/api/admin/*` 503-at ad |
| `ADMIN_MAIL_FROM_EMAIL` | opcionális külön feladó a meghívó- és kódlevelekhez (default: `MAIL_FROM_EMAIL`) |
| `VERCEL_API_TOKEN` | a dashboard látogatószámaihoz: Vercel access token |
| `VERCEL_PROJECT_ID` | a Vercel-projekt azonosítója |
| `VERCEL_TEAM_ID` | csak ha a projekt team alatt van |

## Belső felület (`/admin`)

Meghívásos, jelszó + e-mailes kód (2FA) belépésű felület a munkatársaknak. Kód: `api/_admin.py`
(az aláhúzás miatt a Vercel nem csinál belőle önálló függvényt), felület: `admin/`, tesztek:
`python -m unittest backend/tests/test_admin.py -v`.

| Oldal | |
|---|---|
| `/admin/` | belépés (jelszó → e-mailes kód), elfelejtett jelszó |
| `/admin/jelszo/#meghivo=…` | meghívó elfogadása / jelszó-visszaállítás (a token a `#` után, így nem kerül szervernaplóba) |
| `/admin/vezerlopult/` | kezdőlap-csempék (Dashboard, Blog — fejlesztés alatt, Felhasználók), dashboard, felhasználókezelés |

**Biztonság röviden:** scrypt jelszóhash; tokenek és kódok csak hash-ként az adatbázisban; a belépési kód
10 percig és 5 próbálkozásig él; 5 hibás jelszó után 15 perc zárolás; munkamenet 12 óra (2 óra tétlenség
után lejár); SameSite=Strict süti + saját fejléc és Origin-ellenőrzés a CSRF ellen; szigorú CSP és
`noindex` az `/admin` alatt. A dashboard kizárólag napi darabszámot kap, e-mail-címet soha.

**Ismert korlát:** a második faktor e-mailes kód, ami ugyanabba a postafiókba érkezik, mint a
jelszó-visszaállító levél — a munkatársak postafiókján ezért különösen fontos az MFA.

**Élesítés lépései:**

1. Supabase → SQL Editor: `backend/migrations/2026-09-11_admin_felulet.sql` lefuttatása egyben, majd a fájl
   végén lévő **ellenőrző lekérdezés** — minden sornak `ok`-nak kell lennie.
2. Vercel env: `ADMIN_AUTH_SECRET` (kötelező), `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` (+ `VERCEL_TEAM_ID`), majd redeploy.
3. Brevo: a feladó domain hitelesítése (DKIM/SPF) — enélkül a belépési kódok spambe mehetnek.
4. Az első admin meghívása:

   ```bash
   curl -X POST https://stopjeger.hu/api/admin/bootstrap \
     -H "X-Admin-Password: <ADMIN_PASSWORD>" -H "Content-Type: application/json" \
     -d '{"email": "te@pelda.hu", "name": "Neved"}'
   ```

   A további munkatársakat az admin a felületről hívja meg.

## DNS (WebSupport)

A zóna a WebSupportnál marad, **nem** a Vercel névszerverein — az M365 levelezés
(MX, SPF, DKIM, DMARC) ugyanabban a zónában él.

| Név | Típus | Érték |
|---|---|---|
| `stopjeger.hu` | A | `216.198.79.1` |
| `www` | CNAME | `1131f777d922ce36.vercel-dns-017.com.` |

## Nyitott feladatok

- [x] Kettős opt-in: megerősítő levél + `/api/confirm` + `/megerosites.html` (működéshez `BREVO_API_KEY` kell)
- [ ] Brevo domain-hitelesítés a `news.stopjeger.hu` aldomainre (DKIM, SPF, brevo-code)
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
