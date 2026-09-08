# Adatkezelési tevékenységek nyilvántartása

**A GDPR 30. cikk (1) bekezdése szerinti nyilvántartás**

> **Belső dokumentum — nem publikus.** Ezt a nyilvántartást nem kell közzétenni, de a NAIH
> felhívására be kell mutatni. A GDPR 30. cikk (5) bekezdése szerinti, 250 fő alatti
> mentesség **erre az adatkezelésre nem alkalmazható**, mert az adatkezelés nem alkalmi
> jellegű (folyamatos, rendszeres hírlevél-küldés és kapcsolattartás).

| | |
|---|---|
| **Adatkezelő** | Agro-Biotech Kft. |
| **Székhely** | 8000 Székesfehérvár, Zobori út 66/5. |
| **Adószám** | 32031973-2-07 |
| **Kapcsolattartás adatvédelmi ügyekben** | info@stopjeger.hu |
| **Adatvédelmi tisztviselő** | Nem kijelölt — l. az 5. pont indokolását |
| **A nyilvántartás verziója** | 2.0 |
| **Hatályos** | 2026. szeptember 8. |
| **Következő felülvizsgálat** | 2027. szeptember 8., illetve minden új adatfeldolgozó bevonásakor |

---

## 1. Hírlevél — tájékoztatás a kezdeményezés fejleményeiről

| Szempont | Tartalom |
|---|---|
| **Az adatkezelés célja** | A kezdeményezés fejleményeiről szóló tájékoztató levelek küldése azoknak, akik ezt kérték |
| **Jogalap** | GDPR 6. cikk (1) a) — az érintett hozzájárulása (a kérdőív végén, önálló jelölőnégyzettel, az e-mail-cím megadásával együtt) |
| **Érintettek kategóriái** | Azok a kérdőívkitöltők, akik a tájékoztatást kérték és e-mail-címet adtak meg |
| **Személyes adatok kategóriái** | E-mail-cím; a feliratkozás forrása; a hozzájárulás ténye és időpontja; a megerősítés ténye és időpontja; leiratkozás ténye és időpontja |
| **Címzettek kategóriái** | Adatfeldolgozók: Supabase, Inc. (adatbázis); Vercel Inc. (webkiszolgálás); Sendinblue SAS / Brevo (levélküldés) |
| **Harmadik országba továbbítás** | Vercel Inc. (USA) — a beküldés pillanatában átmeneti áthaladás. Garancia: SCC a Vercel DPA-jában. Tárolás kizárólag az EU-ban (Supabase, eu-west-1, Írország). A levélküldő EU-s adatközpontot használ. |
| **Törlési határidő** | A hozzájárulás visszavonásáig / leiratkozásig; azt követően haladéktalanul |
| **Biztonsági intézkedések** | L. a 6. pontot; a leiratkozás minden levélben egy kattintással elérhető (List-Unsubscribe), valamint az `info@stopjeger.hu` címre írt levéllel is kérhető |

> **Nyitott pont — kettős opt-in.** Az adatbázisséma tartalmazza a megerősítő tokent
> (`subscribers.confirm_token`, 48 órás lejárattal), de a megerősítő levél kiküldése a jelen
> nyilvántartás kiállításakor **még nincs bekötve**, ezért minden sor `confirmed_at IS NULL`
> állapotban áll. **Az első hírlevél kiküldése előtt** a megerősítő folyamatot élesíteni kell, és
> ezt a sort a token tényleges megőrzési idejével frissíteni.
>
> A hozzájárulás a kérdőív jelölőnégyzetén megadva önmagában is érvényes (GDPR 7. cikk); a kettős
> opt-in a bizonyíthatóságot és a kézbesíthetőséget javítja, nem a jogszerűség feltétele.

---

## 2. Kapcsolatfelvétel

| Szempont | Tartalom |
|---|---|
| **Az adatkezelés célja** | A weboldalon vagy e-mailben érkező megkeresések megválaszolása |
| **Jogalap** | GDPR 6. cikk (1) f) — az Adatkezelő jogos érdeke a hozzá intézett megkeresések megválaszolásához; érdekmérlegelés elvégezve, az érintett érdekeit nem sérti aránytalanul |
| **Érintettek kategóriái** | A kezdeményezéshez forduló természetes személyek (érdeklődők, gazdálkodók, újságírók, hatósági kapcsolattartók) |
| **Személyes adatok kategóriái** | Név; e-mail-cím; az üzenet tartalma és minden abban önként megadott adat |
| **Címzettek kategóriái** | Adatfeldolgozó: Microsoft Ireland Operations Limited (Exchange Online levelezés) |
| **Harmadik országba továbbítás** | Nincs — a postafiók tárolási helye az EU |
| **Törlési határidő** | Az ügy lezárását követő 1 év, ezt követően törlés |
| **Biztonsági intézkedések** | L. a 6. pontot; többtényezős hitelesítés a postafiókhoz |

---

## 3. Webanalitika

| Szempont | Tartalom |
|---|---|
| **Az adatkezelés célja** | A weboldal látogatottságának és a tartalmak olvasottságának mérése, összesített statisztika készítése |
| **Jogalap** | GDPR 6. cikk (1) a) — hozzájárulás, az Eht. 155. § (4) bekezdésével összhangban. Hozzájárulás hiányában a szolgáltatás **egyáltalán nem töltődik be** |
| **Érintettek kategóriái** | A weboldal látogatói, akik a süti-hozzájárulást megadták |
| **Személyes adatok kategóriái** | Anonimizált IP-cím; eszköz- és böngészőadatok; a megtekintett oldalak és események; a Google Analytics ügyfélazonosítója (`_ga` süti) |
| **Címzettek kategóriái** | Adatfeldolgozó: Google Ireland Limited |
| **Harmadik országba továbbítás** | Sor kerülhet USA-ba történő továbbításra. Garancia: SCC + az EU–USA adatvédelmi keretrendszer (Data Privacy Framework) szerinti tanúsítás |
| **Törlési határidő** | A Google Analytics szolgáltatásban beállított megőrzési idő, legfeljebb 14 hónap |
| **Biztonsági intézkedések** | IP-anonimizálás bekapcsolva; hirdetési és profilalkotási funkciók (Google Signals, hirdetési személyre szabás) kikapcsolva |

> **Állapot (2026. szeptember 8-tól éles):** a GA4 mérőazonosító `G-7MM2ZJ4K1Z`. A mérőkód
> kizárólag a süti-sávon adott kifejezett hozzájárulás után töltődik be; a Consent Mode v2
> alapértelmezése minden tárolási célra `denied`. A `gtag('config', …)` hívás explicit módon
> kikapcsolja a Google Signals és a hirdetési személyre szabás jelzéseit is.
>
> **Ellenőrizendő a GA4 property beállításaiban:** az adatmegőrzési idő 14 hónapra állítva
> (a tájékoztató ezt állítja), a Google Signals kikapcsolva, hirdetési funkciók kikapcsolva.

---

## 4. Nem tartozik a nyilvántartás hatálya alá

### 4.1. Az anonim kérdőív

A `/kerdoiv` oldalon kitöltött kérdőív nem gyűjt nevet, e-mail-címet vagy egyéb azonosítót, és a
válaszok nem köthetők vissza természetes személyhez, ezért nem minősül személyes adat kezelésének
(GDPR 4. cikk 1. pont).

**A feltétel teljesülése ellenőrizve (2026. szeptember 8., a beküldés élesítésekor):**

- A `survey_responses` tábla **nem tartalmaz** IP-cím, e-mail, név vagy munkamenet-azonosító oszlopot.
- Az API (`api/index.py`, `POST /api/survey`) a válaszsorba kizárólag a kérdésekre adott értékeket írja.
- A tábla **nem tárol pontos időbélyeget**, csak beküldési dátumot (`submitted_on date`). Ez tudatos
  döntés: egy másodperc pontosságú `created_at` a `subscribers.created_at` értékével összevetve
  visszafejtené, melyik válasz melyik feliratkozóhoz tartozik.
- A két tábla között **nincs közös azonosító**, idegen kulcs vagy sorszám-megfeleltetés.

**Újra kell értékelni**, ha a kérdőív bármely új mezővel bővül, ha a válaszokhoz időbélyeg vagy
IP-cím kerül, vagy ha a két tábla között bármilyen összekötés létesül.

### 4.2. Adatvédelmi tisztviselő (DPO)

Kijelölése nem kötelező. Az Adatkezelő nem közhatalmi szerv; fő tevékenysége nem az érintettek
rendszeres és szisztematikus, nagymértékű megfigyelése; és nem végez nagy számban különleges adatok
kezelését (GDPR 37. cikk (1) a)–c) pont). **Felülvizsgálandó**, ha a feliratkozói adatbázis mérete
nagyságrendet nő.

### 4.3. Adatvédelmi hatásvizsgálat (DPIA)

Jelenleg nem szükséges, mert az adatkezelés nem jár valószínűsíthetően magas kockázattal (nincs
automatizált döntéshozatal, profilalkotás, szisztematikus megfigyelés vagy nyilvános terület
nagymértékű megfigyelése). Újra kell értékelni, ha profilalkotás vagy szegmentálás kerül a
hírlevél-küldésbe.

---

## 5. Az adatbiztonsági intézkedések általános leírása (GDPR 32. cikk)

**Technikai intézkedések**

- Minden kommunikáció TLS/HTTPS titkosított csatornán zajlik; HTTP → HTTPS átirányítás kényszerítve.
- Az adatbázis nyugalmi állapotban titkosított (Supabase, eu-west-1), AES-256 titkosítással.
- **Helyreállíthatóság (GDPR 32. cikk (1) c)):** a Supabase Pro csomag napi automatikus mentést
  készít, 7 napos visszatekintéssel. A naplók megőrzési ideje 7 nap, ami adatvédelmi incidens
  esetén a 72 órás bejelentési határidőn belüli kivizsgálást lehetővé teszi.
- Mindkét táblán **sorszintű hozzáférés-védelem (RLS) van bekapcsolva, nulla policy-val**: sem a
  publishable, sem az authenticated kulcs nem olvashat és nem írhat. Az adatokhoz kizárólag a
  szerveroldali secret key fér hozzá, amely környezeti változóban él, a forráskódban nem szerepel.
- Az adminisztratív export jelszóval védett; a jelszó **kizárólag `X-Admin-Password` fejlécben**
  fogadható el (query paraméterben nem, mert az bekerülne a kiszolgálói naplókba), az összehasonlítás
  konstans idejű, és IP-nkénti próbálkozás-korlát véd a kipróbálás ellen.
- A levelezéshez többtényezős hitelesítés (MFA) kötelező.
- A kimenő levelezés SPF, DKIM és DMARC hitelesítéssel védett a névvel való visszaélés ellen.
- Beküldési sebességkorlát (rate limit) és honeypot mező a tömeges, automatizált visszaélések ellen.

**Szervezési intézkedések**

- Az adatokhoz kizárólag az arra feljogosított, titoktartásra kötelezett munkatársak férnek hozzá.
- Minden adatfeldolgozóval írásbeli adatfeldolgozói szerződés (DPA) van érvényben.
- Az adathozzáférések a szükséges legszűkebb körre korlátozottak.
- Jelszócsere és hozzáférés-felülvizsgálat az üzemeltetői kör minden változásakor.

**Adatvédelmi incidensek**

Adatvédelmi incidens esetén az Adatkezelő azt a tudomásszerzéstől számított 72 órán belül
bejelenti a NAIH-nak (GDPR 33. cikk), kivéve, ha az incidens valószínűsíthetően nem jár
kockázattal. Az incidensekről — a bejelentésre nem kerülőkről is — belső incidensnyilvántartást
kell vezetni, amely tartalmazza az incidens tényeit, hatásait és a megtett intézkedéseket.

---

## 6. Változáskövetés

| Verzió | Dátum | Változás |
|---|---|---|
| 1.0 | 2026. szeptember 9. | Első kiállítás. Adatkezelő: Agro-Biotech Kft. Felvéve a webanalitikai adatkezelés és a süti-hozzájárulás. |
| 2.0 | 2026. szeptember 8. | **Az aláírásgyűjtés megszűnt**, helyébe anonim közvélemény-kutatás lépett; az 1.0 verzió 1. pontja (aláírásgyűjtés) törölve, a `signatures` tábla megszüntetve. A hírlevél önálló adatkezeléssé vált, forrása a kérdőív. A jelszóval védett háttéroldalak pontja törölve (az oldalak nyilvánossá váltak, az Edge Middleware eltávolítva). A kérdőív anonimitásának feltételei tételesen ellenőrizve. Felvéve a leiratkozás e-mailes útja. |
