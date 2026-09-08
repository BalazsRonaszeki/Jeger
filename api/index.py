import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests
from fastapi import FastAPI, Form, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

SITE_URL        = os.getenv('SITE_URL', 'https://stopjeger.hu').rstrip('/')
BREVO_API_KEY   = os.getenv('BREVO_API_KEY')
BREVO_LIST_ID   = os.getenv('BREVO_LIST_ID')
MAIL_FROM_EMAIL = os.getenv('MAIL_FROM_EMAIL', 'hirlevel@news.stopjeger.hu')
MAIL_FROM_NAME  = os.getenv('MAIL_FROM_NAME', 'JÉGER-kezdeményezés')
MAIL_REPLY_TO   = os.getenv('MAIL_REPLY_TO', 'info@stopjeger.hu')
MAX_PER_MIN = int(os.getenv('MAX_SUBMISSIONS_PER_MINUTE', '6'))
ADMIN_MAX_ATTEMPTS = int(os.getenv('ADMIN_MAX_ATTEMPTS', '5'))
ADMIN_LOCKOUT_SECONDS = int(os.getenv('ADMIN_LOCKOUT_SECONDS', '900'))

ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        'ALLOWED_ORIGINS',
        'https://stopjeger.hu,https://www.stopjeger.hu'
    ).split(',') if o.strip()
]

app = FastAPI(title='stopjeger.hu API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=['GET', 'POST'],
    allow_headers=['*'],
)

# Egyszerű, memóriában tartott rate limiter. Serverless környezetben
# instance-onként külön él — lassító fékező, nem szigorú korlát.
rate_store = {}
admin_failures = {}


def ip_from_request(request: Request):
    xff = request.headers.get('x-forwarded-for')
    if xff:
        return xff.split(',')[0].strip()
    return request.client.host if request.client else 'unknown'


def check_rate(ip: str):
    now = time.time()
    calls = [t for t in rate_store.get(ip, []) if now - t < 60]
    if len(calls) >= MAX_PER_MIN:
        return False
    calls.append(now)
    rate_store[ip] = calls
    return True


def admin_allowed(ip: str):
    now = time.time()
    fails = [t for t in admin_failures.get(ip, []) if now - t < ADMIN_LOCKOUT_SECONDS]
    admin_failures[ip] = fails
    return len(fails) < ADMIN_MAX_ATTEMPTS


def admin_record_failure(ip: str):
    admin_failures.setdefault(ip, []).append(time.time())


try:
    from supabase import create_client
    supabase_client = None
    if SUPABASE_URL and SUPABASE_KEY:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception:
    supabase_client = None


def scale(value):
    """Likert-érték 1..4 között, minden más None."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 4 else None


def choice(value, allowed):
    return value if value in allowed else None


def _parse_ts(value):
    """Supabase ISO időbélyeg -> datetime, hibánál None."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


# --- Brevo ------------------------------------------------------------------
# A megerősítő levél nélkül a feliratkozás egyszeres opt-in marad. A hozzájárulás
# a jelölőnégyzettel önmagában is érvényes, de a megerősítés a bizonyíthatóságot
# és a kézbesíthetőséget is javítja.

def brevo_ready():
    return bool(BREVO_API_KEY)


def send_confirmation_email(address: str, token: str) -> bool:
    if not brevo_ready():
        return False

    link = '%s/api/confirm?token=%s' % (SITE_URL, token)
    html = (
        '<p>Kedves Olvasónk!</p>'
        '<p>Köszönjük, hogy kitöltötte a JÉGER-kérdőívet, és kérte a tájékoztatást '
        'a kezdeményezés fejleményeiről.</p>'
        '<p><b>Egy lépés maradt:</b> erősítse meg a feliratkozását az alábbi hivatkozással.</p>'
        '<p><a href="%s" style="display:inline-block;padding:12px 22px;background:#b3560a;'
        'color:#fff;text-decoration:none;border-radius:8px;font-weight:600">'
        'Feliratkozásom megerősítése</a></p>'
        '<p style="font-size:13px;color:#666">Ha a gomb nem működik, másolja be ezt a címet a '
        'böngészőbe:<br>%s</p>'
        '<p style="font-size:13px;color:#666">A hivatkozás 48 óráig érvényes. Ha nem Ön kérte a '
        'feliratkozást, egyszerűen hagyja figyelmen kívül ezt a levelet — megerősítés nélkül nem '
        'küldünk Önnek semmit, és a címét töröljük.</p>'
        '<p style="font-size:13px;color:#666">Leiratkozni bármikor lehet: írjon az '
        '<a href="mailto:info@stopjeger.hu">info@stopjeger.hu</a> címre.</p>'
    ) % (link, link)

    text = (
        'Kedves Olvasonk!\n\n'
        'Koszonjuk, hogy kitoltotte a JEGER-kerdoivet es kerte a tajekoztatast.\n\n'
        'Egy lepes maradt - erositse meg a feliratkozasat:\n%s\n\n'
        'A hivatkozas 48 oraig ervenyes. Ha nem On kerte, hagyja figyelmen kivul ezt a levelet.\n'
        'Leiratkozas barmikor: info@stopjeger.hu\n'
    ) % link

    try:
        r = requests.post(
            'https://api.brevo.com/v3/smtp/email',
            headers={'api-key': BREVO_API_KEY, 'content-type': 'application/json'},
            json={
                'sender': {'name': MAIL_FROM_NAME, 'email': MAIL_FROM_EMAIL},
                'replyTo': {'email': MAIL_REPLY_TO},
                'to': [{'email': address}],
                'subject': 'Erősítse meg a feliratkozását — JÉGER-kezdeményezés',
                'htmlContent': html,
                'textContent': text,
            },
            timeout=10,
        )
        return r.status_code in (200, 201, 202)
    except Exception:
        return False


def add_contact_to_list(address: str) -> bool:
    """Megerősítés után kerül a cím a Brevo-listára."""
    if not brevo_ready() or not BREVO_LIST_ID:
        return False
    try:
        r = requests.post(
            'https://api.brevo.com/v3/contacts',
            headers={'api-key': BREVO_API_KEY, 'content-type': 'application/json'},
            json={
                'email': address,
                'listIds': [int(BREVO_LIST_ID)],
                'updateEnabled': True,
            },
            timeout=10,
        )
        return r.status_code in (200, 201, 204)
    except Exception:
        return False


def token_for_existing(address: str):
    """Meglévő, még meg nem erősített feliratkozó tokenjét adja vissza.

    A még ÉRVÉNYES tokent szándékosan újrahasznosítjuk. Ha újat generálnánk,
    a korábbi levélben lévő hivatkozás azonnal érvénytelenné válna — márpedig
    aki kétszer tölti ki az űrlapot (mert azt hitte, elsőre nem ment el),
    tipikusan a régebbi levelet nyitja meg, és hibaüzenetet kapna.

    Újat csak akkor adunk, ha a régi lejárt. Már megerősített címnél None-t
    adunk vissza, és nem küldünk újabb levelet.
    """
    try:
        rows = supabase_client.table('subscribers') \
            .select('id,confirmed_at,confirm_token,token_expires_at') \
            .eq('email', address).limit(1).execute().data or []
        if not rows or rows[0].get('confirmed_at'):
            return None

        row = rows[0]
        expires = _parse_ts(row.get('token_expires_at'))
        still_valid = row.get('confirm_token') and expires and expires > datetime.now(timezone.utc)

        if still_valid:
            # Ugyanaz a token megy ki újra, így mindkét levél hivatkozása működik.
            return row['confirm_token']

        new_token = str(uuid.uuid4())
        supabase_client.table('subscribers').update({
            'confirm_token': new_token,
            'token_expires_at': (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat(),
            'unsubscribed_at': None,
        }).eq('id', row['id']).execute()
        return new_token
    except Exception:
        return None


@app.post('/api/survey')
async def survey(request: Request,
                 q1: str = Form(None),
                 q6: str = Form(None),
                 q2: str = Form(None),
                 q_effective: str = Form(None),
                 q_danger: str = Form(None),
                 q_transparency: str = Form(None),
                 q_reporting: str = Form(None),
                 q_health: str = Form(None),
                 q_updates: str = Form(None),
                 email: str = Form(None),
                 consent: str = Form(None),
                 hp_field: str = Form(None)):

    if hp_field:
        raise HTTPException(status_code=400, detail='Érvénytelen beküldés')

    ip = ip_from_request(request)
    if not check_rate(ip):
        raise HTTPException(status_code=429, detail='Túl sok kérést küldött, kérjük próbálja később')

    if not supabase_client:
        raise HTTPException(status_code=503, detail='A szolgáltatás jelenleg nem érhető el')

    # --- 1. Anonim válaszsor. Se e-mail, se IP, se pontos időbélyeg. ---
    answers = {
        'respondent_type': choice(q1, ('gazdalkodo', 'maganszemely')),
        'hail_damage': choice(q6, ('igen', 'nem')),
        'county': (q2 or '').strip() or None,
        'effective': scale(q_effective),
        'danger': scale(q_danger),
        'transparency': scale(q_transparency),
        'reporting': scale(q_reporting),
        'health': scale(q_health),
    }

    if not any(v is not None for v in answers.values()):
        raise HTTPException(status_code=400, detail='Kérjük, válaszoljon legalább egy kérdésre')

    try:
        supabase_client.table('survey_responses').insert(answers).execute()
    except Exception:
        raise HTTPException(status_code=500, detail='A mentés nem sikerült, kérjük próbálja újra')

    # --- 2. Hírlevél-feliratkozás. Külön tábla, közös azonosító nélkül. ---
    subscribed = False
    wants_updates = q_updates == 'igen'
    address = (email or '').strip().lower()

    if wants_updates and address:
        if consent not in ('on', 'yes'):
            raise HTTPException(
                status_code=400,
                detail='A hírlevélhez a hozzájárulás elfogadása szükséges'
            )

        token = None
        try:
            res = supabase_client.table('subscribers').insert({
                'email': address,
                'source': 'kerdoiv',
                'consent': True,
            }).execute()
            token = (res.data or [{}])[0].get('confirm_token')
            subscribed = True
        except Exception as exc:
            detail = str(exc)
            if 'subscribers_email_key' in detail or 'duplicate key' in detail or '23505' in detail:
                # Már szerepel a címe. Ha még nem erősítette meg, új tokent adunk és
                # újraküldjük a levelet -- tipikusan azért van itt, mert az első nem ért celba.
                subscribed = True
                token = token_for_existing(address)
            else:
                return JSONResponse({
                    'ok': True,
                    'subscribed': False,
                    'warning': 'A válaszokat rögzítettük, de a feliratkozás nem sikerült.',
                })

        if token and not send_confirmation_email(address, token):
            return JSONResponse({
                'ok': True,
                'subscribed': True,
                'warning': 'A válaszokat rögzítettük, de a megerősítő levelet nem sikerült elküldeni.',
            })

    return JSONResponse({'ok': True, 'subscribed': subscribed})


@app.get('/api/confirm')
async def confirm(token: str = None):
    """A megerősítő levélben lévő hivatkozás célpontja."""
    if not supabase_client:
        return RedirectResponse('/megerosites.html?allapot=hiba', status_code=303)

    if not token:
        return RedirectResponse('/megerosites.html?allapot=ervenytelen', status_code=303)

    try:
        rows = supabase_client.table('subscribers') \
            .select('id,email,confirmed_at,token_expires_at') \
            .eq('confirm_token', token).limit(1).execute().data or []
    except Exception:
        return RedirectResponse('/megerosites.html?allapot=hiba', status_code=303)

    if not rows:
        return RedirectResponse('/megerosites.html?allapot=ervenytelen', status_code=303)

    row = rows[0]
    if row.get('confirmed_at'):
        return RedirectResponse('/megerosites.html?allapot=mar-megerositve', status_code=303)

    expires = row.get('token_expires_at')
    if expires and _parse_ts(expires) and _parse_ts(expires) < datetime.now(timezone.utc):
        return RedirectResponse('/megerosites.html?allapot=lejart', status_code=303)

    try:
        supabase_client.table('subscribers').update({
            'confirmed_at': datetime.now(timezone.utc).isoformat(),
            'confirm_token': None,
        }).eq('id', row['id']).execute()
    except Exception:
        return RedirectResponse('/megerosites.html?allapot=hiba', status_code=303)

    # A Brevo-listára csak a megerősítés után kerül fel a cím.
    add_contact_to_list(row['email'])

    return RedirectResponse('/megerosites.html?allapot=ok', status_code=303)


@app.get('/api/count')
async def count():
    if not supabase_client:
        return JSONResponse({'count': None})
    try:
        res = supabase_client.table('survey_responses') \
            .select('id', count='exact').limit(1).execute()
        return JSONResponse({'count': res.count or 0})
    except Exception:
        return JSONResponse({'count': None})


@app.get('/api/admin/export')
async def admin_export(request: Request, dataset: str = 'survey'):
    admin_pw = os.getenv('ADMIN_PASSWORD')
    if not admin_pw:
        raise HTTPException(status_code=403, detail='Admin password not configured')

    ip = ip_from_request(request)
    if not admin_allowed(ip):
        raise HTTPException(status_code=429, detail='Túl sok sikertelen próbálkozás')

    # A jelszó kizárólag fejlécben fogadható el. Query paraméterként bekerülne a
    # Vercel access logjába, a böngésző előzményeibe és a Referer fejlécbe.
    hdr = request.headers.get('x-admin-password') or ''
    if not secrets.compare_digest(hdr.encode('utf-8'), admin_pw.encode('utf-8')):
        admin_record_failure(ip)
        raise HTTPException(status_code=401, detail='Unauthorized')

    table = {'survey': 'survey_responses', 'subscribers': 'subscribers'}.get(dataset)
    if not table:
        raise HTTPException(status_code=400, detail="dataset: 'survey' vagy 'subscribers'")

    if not supabase_client:
        raise HTTPException(status_code=503, detail='Adatbázis nem elérhető')

    try:
        data = supabase_client.table(table).select('*').execute().data or []
    except Exception:
        raise HTTPException(status_code=500, detail='Export hiba')

    def iter_rows():
        import csv, io
        buf = io.StringIO()
        if not data:
            yield ''
            return
        writer = csv.DictWriter(buf, fieldnames=list(data[0].keys()))
        writer.writeheader()
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
        for row in data:
            writer.writerow(row)
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    return StreamingResponse(
        iter_rows(),
        media_type='text/csv',
        headers={'Content-Disposition': 'attachment; filename="' + table + '.csv"'}
    )
