# stopjeger.hu

Közvélemény-kutatás és háttéranyag a JÉGER (Országos Jégkármérséklő Rendszer) és egyéb
időjárás-befolyásoló rendszerek szabályozásáról. Élő oldal: [stopjeger.hu](https://stopjeger.hu)

Adatkezelő: **Agro-Biotech Kft.** (adószám: 32031973-2-07)

- **Frontend:** statikus HTML a repo gyökerében
  - `index.html` — a főoldal (háttéranyag: tudomány, technológia, felügyelet, interjúk, forrásjegyzék)
  - `kerdoiv/index.html` — a közvélemény-kutatás űrlapja
  - `adatkezeles.html` — adatkezelési tájékoztató
  - `impresszum.html` — az üzemeltető adatai és a helyreigazítási kérelmek módja
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
| `GET/POST /api/admin/blog/posts`, `/posts/{id}`, `/posts/{id}/delete` | Blogbejegyzések listája, létrehozása, mentése (verziószámos ütközésvédelem), vázlat törlése. |
| `POST /api/admin/blog/spellcheck`, `/posts/{id}/factcheck` | Helyesírás- és tényellenőrzés (Claude API; a tényellenőrzés a Tudástárral dolgozik). |
| `POST /api/admin/blog/posts/{id}/publish`, `/unpublish`, `POST /api/admin/blog/images` | Publikálás (modellhívás nélkül; a napló rögzíti a tényellenőrzés állapotát), visszavonás, képfeltöltés jogcímmel. |
| `GET /api/admin/blog/authors`, `POST /api/admin/blog/me` | Szerzőválasztó (aktív munkatársak névvel, fotóval); saját név és profilfotó. |
| `GET /api/admin/survey-summary` | A kérdőív válaszainak kérdésenkénti megoszlása (csak összesítve). |
| `POST /api/subscribe` | Önálló hírlevél-feliratkozás a blogról (kettős opt-in). |
| `POST /api/blog/olvasas` | Olvasásszámláló a nyilvános blogról. Süti- és azonosítómentes; mindig `204`, hibát sem jelez. |
| `GET /blog`, `/blog/{slug}`, `/blog/kepek/{id}.jpg`, `/blog/rss.xml`, `/blog/sitemap.xml` | A nyilvános blog (szerveroldalon renderelve, megosztási előnézettel). |

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
| `ANTHROPIC_API_KEY` | **blog:** a helyesírás- és tényellenőrzéshez — nélküle a két gomb 503-at ad; a publikálást nem érinti |
| `BLOG_AI_MODEL` | opcionális, default `claude-opus-5` |
| `BLOG_SPELL_EFFORT`, `BLOG_FACTCHECK_EFFORT` | opcionális, default `medium`, ill. `high` |

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

## Blog (`/admin/blog/` → `stopjeger.hu/blog`)

Kód: `api/_blog.py`, felület: `admin/blog/`, `admin/blog.js`, nyilvános stílus: `assets/blog/`,
tesztek: `python -m unittest backend/tests/test_blog.py -v`.

- **Szerkesztő:** beillesztéskor a felesleges formázás kimarad; **✨ Formázás** (alcímek, listák, magyar
  idézőjel és gondolatjel, szóközök, üres cím/bevezető kitöltése — visszavonható); képfeltöltés
  jogcímmel és a jogdíjas képekre figyelmeztetéssel (a böngésző 1600 px-es JPEG-be kódolja újra, ami
  a helyadatokat is eltávolítja); automatikus mentés.
- **Helyesírás:** mindig csak az utolsó ellenőrzés óta módosított bekezdések (vagy a kijelöltek) mennek
  el; a javaslat kékkel (új) és pirossal áthúzva (régi) jelenik meg, egyenként vagy együtt elfogadható.
  Elfogadatlan javaslattal nem lehet publikálni.
- **Tényellenőrzés:** opcionális, a „Tényellenőrzés” gombbal indul; a nyilvános `/tudastar` oldal
  forrásait kapja referenciaként. Az eredmény a bejegyzés `fact_check` mezőjébe kerül (a tartalom
  hash-ével, így látszik, ha azóta módosult a szöveg).
- **Publikálás:** determinisztikus, modellt nem hív. A megerősítő ablak a mentett tényellenőrzés
  állapotát mutatja (nem futott / módosult azóta / jelzések), de nem blokkol; a napló rögzíti.
  A nyilvános oldal a publikáláskor rögzített változatot mutatja; egy kint lévő cikk
  szerkesztése csak újabb publikálás után látszik. A webcím az első publikálás után rögzül.
- **Megosztás:** Facebook, X, LinkedIn, e-mail és link másolása — sima hivatkozások, külső szkript
  és süti nélkül. A `/blog` oldalak szigorú CSP-vel mennek ki; a CDN 60 mp-ig gyorsítótáraz.
  A bevezető szöveget ott adjuk át előre kitöltve, ahol a hálózat engedi (Facebook `quote`,
  X `text`, e-mail törzse, natív megosztás `text`); a LinkedIn 2021 óta minden előre kitöltött
  szöveget eldob. A megosztási kártyán amúgy is az `og:description` látszik, az a bevezető.
- **Olvasásszámláló:** csak a belső felületen látszik (bejegyzés-lista, „Olvasás” oszlop).
  A böngésző küld egy jelzést a `POST /api/blog/olvasas`-ra, ha a látogató 15 mp-ig a látható
  oldalon maradt, vagy legörgetett a cikk feléig. **Személyes adatot nem tárol:** se süti, se IP,
  se böngészőben tárolt azonosító — csak a bejegyzés napi darabszáma nő. Ezért ugyanaz az olvasó
  újratöltéskor újra beleszámít: ez tudatos csere a követésmentességért. Szerveroldalon nem lehetne
  számolni, mert a CDN 60 mp-ig gyorsítótárazza a lapot.

**Élesítés lépései:**

1. Supabase → SQL Editor: `backend/migrations/2026-09-14_blog.sql` egyben, majd a fájl végén lévő
   **ellenőrző lekérdezés** — minden sornak `ok`-nak kell lennie (a `blog-kepek` tárhely is).
2. Vercel env: `ANTHROPIC_API_KEY`, majd redeploy. (A `vercel.json` a függvény időkorlátját 300 mp-re
   emeli, mert egy hosszabb cikk tényellenőrzése 1-2 percig is tarthat.)
3. Adatfeldolgozói feltételek elfogadása az Anthropicnál (l. az adatkezelési nyilvántartás 4. pontját).
4. Supabase → SQL Editor: `backend/migrations/2026-09-14_szerzok_es_valaszmegoszlas.sql` (profilfotó,
   szerző a bejegyzésekben, a dashboard válaszmegoszlása), majd a fájl végén lévő ellenőrző lekérdezés.
5. Supabase → SQL Editor: `backend/migrations/2026-09-16_olvasasszamlalo.sql` (olvasásszámláló),
   majd a fájl végén lévő ellenőrző lekérdezés. A kód e nélkül is elindul — a lista ilyenkor
   egyszerűen nem kér `views_total`-t —, de a számláló csak a migráció után kezd nőni.

## DNS (WebSupport)

A zóna a WebSupportnál marad, **nem** a Vercel névszerverein — az M365 levelezés
(MX, SPF, DKIM, DMARC) ugyanabban a zónában él.

| Név | Típus | Érték |
|---|---|---|
| `stopjeger.hu` | A | `216.198.79.1` |
| `www` | CNAME | `1131f777d922ce36.vercel-dns-017.com.` |

**Az elsődleges domain a `stopjeger.hu` (www nélkül), a `www` erre irányítson át** — Vercel →
Project → Settings → Domains. Ez nem kozmetika: a `SITE_URL` alapértelmezése, a `canonical`, az
`og:url`, az RSS, a sitemap és a hírlevelek mind az apexet írják. Ha a Vercel a `www`-t teszi
elsődlegessé, a megosztott link körbe-körbe irányít (apex → www → `og:url` vissza az apexre), és a
Facebook link-beolvasója ezt körkörös átirányításként utasíthatja el — a megosztás olyankor egyes
felhasználóknál előnézet nélkül vagy hibával áll meg, másoknál a gyorsítótárból még működik.

## Tartalmi szabályok (jogi felülvizsgálat, 2026-09-17)

Egy ügyvédi felülvizsgálat szerint az oldal fő jogi kockázata a néven nevezett személyekre és
cégekre vonatkozó állításokból ered (Ptk. 2:44–2:48. §, Btk. 226–227. §). Ezért:

- **Minden új, néven nevezett magánfélre (cég, magánüzemeltető) vonatkozó állítás közzététel előtt
  jogi ellenőrzésen megy át.** Ez a blogbejegyzésekre is vonatkozik; a blog tényellenőrzője (`FACT_RULES`, `jogi_kockazat` kategória) ezeket a szempontokat jelzi.
- Magáncégről szóló tényt a forráson keresztül közlünk: „X közérdekű adatigénylésre adott,
  [dátum] szerinti válasza szerint…” — ne az oldal saját kijelentéseként.
- Az értelmezést jelöljük („álláspontunk szerint”, „megítélésünk szerint”).
- Kerüljük a rosszallást sugalló fordulatokat („valójában”, „felbukkant”, „eddig ismeretlen”).
- Megtartandó védelmi elemek: forrásmegjelölés, a 0–3-as bizonyítottsági skála (csak 2–3 közölhető),
  az ellenérvek közlése, a magánszemélyek címeinek kitakarása, az ok-okozatiság állításának mellőzése,
  sütimentes működés, kattintásra betöltődő videók.
- A kapcsolati űrlap szándékosan `mailto:` (nem ír adatbázisba). Ha ez változik, az adatkezelési
  tájékoztató 2.3. pontját és az űrlap alatti tájékoztató sort is át kell írni.

## Nyitott feladatok

- [x] Kettős opt-in: megerősítő levél + `/api/confirm` + `/megerosites.html` (működéshez `BREVO_API_KEY` kell)
- [ ] Brevo domain-hitelesítés a `news.stopjeger.hu` aldomainre (DKIM, SPF, brevo-code)
- [ ] Adatfeldolgozói szerződések (DPA) elfogadása: Supabase, Vercel, Brevo.
      Az adatkezelési tájékoztató 5. pontja azt állítja, hogy ezek érvényben vannak.
- [ ] Hírlevél-kiküldés Brevóval, `List-Unsubscribe` fejléccel és leiratkozó hivatkozással
- [x] Google Analytics kivezetve; helyette sütimentes Vercel Web Analytics, süti-sáv nélkül
- [x] A YouTube-előnézeti képek helyi kiszolgálása (kész: `assets/video-thumbs/yt-*.jpg`)
- [x] Betűtípusok helyi kiszolgálása (`assets/fonts/fonts.css`), Google Fonts-hívás megszűnt
- [x] Impresszum: cégjegyzékszám és ügyvezető (`impresszum.html`)
- [ ] Írásos képmás-felhasználási hozzájárulás a portréval szereplő közreműködőktől (`assets/profiles/`)
- [ ] Az idegen videó-előnézeti képek (`assets/video-thumbs/`) felhasználási jogcíme, vagy cseréjük saját grafikára
- [ ] A fejlécgrafika (`assets/header-art.jpg`) felhasználási jogcímének igazolása és megőrzése
- [ ] Élő süti- és nyomkövető-ellenőrzés a böngésző fejlesztői eszközeivel (jogi felülvizsgálat 3.6.)

## Lokális fejlesztés

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r api/requirements.txt
vercel dev
```
