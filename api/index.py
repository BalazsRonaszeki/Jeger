import os
import time
import uuid
from fastapi import FastAPI, Form, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
UPLOAD_DIR = os.getenv('UPLOAD_DIR', '/tmp/uploads')
MAX_PER_MIN = int(os.getenv('MAX_SUBMISSIONS_PER_MINUTE', '6'))

Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

app = FastAPI(title='Jeger alairasgyujto API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory rate limiter (note: not persistent across serverless invocations/instances)
rate_store = {}

def ip_from_request(request: Request):
    xff = request.headers.get('x-forwarded-for')
    if xff:
        return xff.split(',')[0].strip()
    return request.client.host

def check_rate(ip: str):
    now = time.time()
    window = 60
    calls = rate_store.get(ip, [])
    # keep only last minute
    calls = [t for t in calls if now - t < window]
    if len(calls) >= MAX_PER_MIN:
        return False
    calls.append(now)
    rate_store[ip] = calls
    return True

try:
    from supabase import create_client
    supabase_client = None
    if SUPABASE_URL and SUPABASE_KEY:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception:
    supabase_client = None


@app.post('/api/submit')
async def submit(request: Request,
                 name: str = Form(...),
                 settlement: str = Form(...),
                 street_address: str = Form(...),
                 email: str = Form(...),
                 is_farmer: str = Form(''),
                 hectares: str = Form(None),
                 consent: str = Form(None),
                 updates_optin: str = Form(None),
                 hp_field: str = Form(None)):
    ip = ip_from_request(request)
    if not check_rate(ip):
        raise HTTPException(status_code=429, detail='Túl sok kérést küldött; próbálja később')

    # Honeypot check
    if hp_field:
        raise HTTPException(status_code=400, detail='Invalid submission')

    if consent != 'yes':
        raise HTTPException(status_code=400, detail='Az adatkezelési tájékoztató elfogadása kötelező')

    record_id = str(uuid.uuid4())

    # Persist record: try Supabase table 'signatures', fall back to local CSV
    record = {
        'id': record_id,
        'name': name,
        'settlement': settlement,
        'street_address': street_address,
        'email': email,
        'is_farmer': is_farmer,
        'hectares': hectares,
        'consent': True,
        'updates_optin': updates_optin == 'yes',
        'ip': ip,
        'created_at': int(time.time())
    }

    if supabase_client:
        try:
            supabase_client.table('signatures').insert(record).execute()
        except Exception:
            # ignore and fall back
            pass
    else:
        # append to local CSV for export
        import csv
        csvfile = Path(UPLOAD_DIR) / 'submissions.csv'
        write_header = not csvfile.exists()
        with open(csvfile, 'a', newline='', encoding='utf-8') as fh:
            writer = csv.DictWriter(fh, fieldnames=list(record.keys()))
            if write_header:
                writer.writeheader()
            writer.writerow(record)

    return JSONResponse({'ok': True})


@app.get('/api/count')
async def count():
    if supabase_client:
        try:
            res = supabase_client.table('signatures').select('id', count='exact').limit(1).execute()
            return JSONResponse({'count': res.count or 0})
        except Exception:
            return JSONResponse({'count': None})

    # Fallback ohne Supabase: lokale CSV zeilenweise zählen (minus Header)
    csvfile = Path(UPLOAD_DIR) / 'submissions.csv'
    if not csvfile.exists():
        return JSONResponse({'count': 0})
    with open(csvfile, 'r', encoding='utf-8') as fh:
        zeilen = sum(1 for _ in fh)
    return JSONResponse({'count': max(0, zeilen - 1)})


@app.get('/api/admin/export')
async def admin_export(request: Request, password: str = None):
    # simple admin protection via query param or header
    admin_pw = os.getenv('ADMIN_PASSWORD')
    if not admin_pw:
        raise HTTPException(status_code=403, detail='Admin password not configured')
    # allow password via query param or X-Admin-Password header
    hdr = request.headers.get('x-admin-password')
    if password != admin_pw and hdr != admin_pw:
        raise HTTPException(status_code=401, detail='Unauthorized')

    # If Supabase configured, export from table
    if supabase_client:
        try:
            res = supabase_client.table('signatures').select('*').execute()
            data = res.data or []
            # stream CSV
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

            return StreamingResponse(iter_rows(), media_type='text/csv')
        except Exception:
            raise HTTPException(status_code=500, detail='Export hiba')

    # fallback: local CSV
    csvfile = Path(UPLOAD_DIR) / 'submissions.csv'
    if not csvfile.exists():
        raise HTTPException(status_code=404, detail='Nincs adat')

    return StreamingResponse(csvfile.open('r', encoding='utf-8'), media_type='text/csv')
