import os
import secrets
import time
from fastapi import FastAPI, Form, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
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
        try:
            supabase_client.table('subscribers').insert({
                'email': address,
                'source': 'kerdoiv',
                'consent': True,
            }).execute()
            subscribed = True
        except Exception as exc:
            detail = str(exc)
            # Már feliratkozott cím: a válasz mentve, ez nem hiba a kitöltő felé.
            if 'subscribers_email_key' in detail or 'duplicate key' in detail or '23505' in detail:
                subscribed = True
            else:
                return JSONResponse({
                    'ok': True,
                    'subscribed': False,
                    'warning': 'A válaszokat rögzítettük, de a feliratkozás nem sikerült.',
                })

    return JSONResponse({'ok': True, 'subscribed': subscribed})


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
