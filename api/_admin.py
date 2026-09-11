"""Belső felület (/admin): meghívás, jelszó, e-mailes belépési kód, munkamenet, dashboard.

Tervezési döntések röviden:

* Saját felhasználókezelés, nem a Supabase Auth: a második faktor e-mailben kiküldött kód,
  amit a Supabase Auth nem támogat.
* Az adatbázisba jelszó csak scrypt-hashként, token csak SHA-256-hashként, belépési kód csak
  HMAC-ként kerül. A munkamenet-süti HttpOnly + Secure + SameSite=Strict.
* Minden próbálkozás-számláló az adatbázisban él: serverless környezetben a memóriában tartott
  számláló példányonként külön indul, ezért csak kiegészítő fékként használjuk.
* A dashboard kizárólag összesített, napi darabszámot kap — e-mail-címet vagy egyedi
  válaszsort soha.
* Az adatréteg (Store) és a levélküldés (send_mail) cserélhető, hogy tesztelhető legyen.
"""

import base64
import hashlib
import hmac
import os
import re
import secrets
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(prefix='/api/admin')

COOKIE_NAME = 'sj_admin'
SESSION_TTL = timedelta(hours=12)        # abszolút élettartam
SESSION_IDLE = timedelta(hours=2)        # tétlenségi időkorlát
SESSION_TOUCH = timedelta(minutes=5)     # ennél ritkábban frissítjük a last_seen_at-et
INVITE_TTL = timedelta(hours=72)
RESET_TTL = timedelta(hours=1)
CODE_TTL = timedelta(minutes=10)
CODE_MAX_ATTEMPTS = 5
LOGIN_MAX_FAILS = 5
LOGIN_LOCK = timedelta(minutes=15)
PASSWORD_MIN = 12
PASSWORD_MAX = 128
STATS_MAX_DAYS = 366

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1
SCRYPT_MAXMEM = 64 * 1024 * 1024

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

GENERIC_LOGIN_ERROR = 'Hibás e-mail-cím vagy jelszó, vagy a fiók átmenetileg zárolva van.'


# ---------------------------------------------------------------------------
# Konfiguráció — hívásonként olvassuk, hogy a tesztek felülírhassák
# ---------------------------------------------------------------------------

def env(name, default=None):
    value = os.getenv(name)
    return value if value not in (None, '') else default


def site_url():
    return env('SITE_URL', 'https://stopjeger.hu').rstrip('/')


def auth_secret():
    secret = env('ADMIN_AUTH_SECRET')
    return secret.encode('utf-8') if secret else None


def cookie_secure():
    return env('ADMIN_COOKIE_SECURE', 'true').lower() != 'false'


def allowed_origins():
    origins = {o.strip().rstrip('/') for o in env(
        'ALLOWED_ORIGINS', 'https://stopjeger.hu,https://www.stopjeger.hu').split(',') if o.strip()}
    origins.add(site_url())
    return origins


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat() if dt else None


def parse_ts(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Kriptográfiai segédek
# ---------------------------------------------------------------------------

def _b64(raw):
    return base64.b64encode(raw).decode('ascii')


def hash_password(password):
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=SCRYPT_N, r=SCRYPT_R,
                             p=SCRYPT_P, dklen=32, maxmem=SCRYPT_MAXMEM)
    return 'scrypt$%d$%d$%d$%s$%s' % (SCRYPT_N, SCRYPT_R, SCRYPT_P, _b64(salt), _b64(derived))


def verify_password(password, stored):
    try:
        algo, n, r, p, salt_b64, hash_b64 = (stored or '').split('$')
        if algo != 'scrypt':
            return False
        expected = base64.b64decode(hash_b64)
        derived = hashlib.scrypt(password.encode('utf-8'), salt=base64.b64decode(salt_b64),
                                 n=int(n), r=int(r), p=int(p), dklen=len(expected),
                                 maxmem=SCRYPT_MAXMEM)
    except Exception:
        return False
    return hmac.compare_digest(derived, expected)


_DUMMY_HASH = None


def burn_password_time(password):
    """Nem létező felhasználónál is végigszámoljuk a hash-t, hogy a válaszidő ne árulja el,
    létezik-e a fiók."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    verify_password(password or '', _DUMMY_HASH)


def token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def code_hash(challenge_id, code):
    return hmac.new(auth_secret(), ('%s:%s' % (challenge_id, code)).encode('utf-8'),
                    hashlib.sha256).hexdigest()


def new_code():
    return '%06d' % secrets.randbelow(10 ** 6)


def mask_email(address):
    local, _, domain = (address or '').partition('@')
    if not domain:
        return ''
    shown = local[:2] if len(local) > 2 else local[:1]
    return '%s%s@%s' % (shown, '•' * max(1, min(len(local) - len(shown), 6)), domain)


def password_problem(password):
    if not isinstance(password, str) or len(password) < PASSWORD_MIN:
        return 'A jelszó legalább %d karakter legyen.' % PASSWORD_MIN
    if len(password) > PASSWORD_MAX:
        return 'A jelszó legfeljebb %d karakter lehet.' % PASSWORD_MAX
    if len(set(password)) < 5:
        return 'A jelszó túl egyszerű — használj változatosabb karaktereket.'
    return None


# ---------------------------------------------------------------------------
# Memóriabeli, kiegészítő fék (példányonként; az igazi korlát az adatbázisban él)
# ---------------------------------------------------------------------------

_rate = {}


def rate_ok(bucket, key, limit, window_seconds):
    now = time.time()
    k = (bucket, key)
    hits = [t for t in _rate.get(k, []) if now - t < window_seconds]
    if len(hits) >= limit:
        _rate[k] = hits
        return False
    hits.append(now)
    _rate[k] = hits
    return True


def client_ip(request):
    xff = request.headers.get('x-forwarded-for')
    if xff:
        return xff.split(',')[0].strip()
    return request.client.host if request.client else 'unknown'


# ---------------------------------------------------------------------------
# Adatréteg
# ---------------------------------------------------------------------------

class SupabaseStore:
    """A Supabase (PostgREST) felé néző vékony réteg. A secret key RLS-t kerül meg."""

    def __init__(self, client):
        self.c = client

    def _one(self, rows):
        rows = rows or []
        return rows[0] if rows else None

    # felhasználók
    def get_user_by_email(self, email):
        return self._one(self.c.table('admin_users').select('*').eq('email', email).limit(1).execute().data)

    def get_user(self, user_id):
        return self._one(self.c.table('admin_users').select('*').eq('id', user_id).limit(1).execute().data)

    def list_users(self):
        return self.c.table('admin_users').select(
            'id,email,name,role,status,created_at,activated_at,last_login_at'
        ).order('created_at').execute().data or []

    def count_admins(self):
        res = self.c.table('admin_users').select('id', count='exact').eq('role', 'admin').limit(1).execute()
        return res.count or 0

    def insert_user(self, data):
        return self._one(self.c.table('admin_users').insert(data).execute().data)

    def update_user(self, user_id, data):
        self.c.table('admin_users').update(data).eq('id', user_id).execute()

    # tokenek
    def insert_token(self, data):
        return self._one(self.c.table('admin_tokens').insert(data).execute().data)

    def get_token_by_hash(self, h):
        return self._one(self.c.table('admin_tokens').select('*').eq('token_hash', h).limit(1).execute().data)

    def update_token(self, token_id, data):
        self.c.table('admin_tokens').update(data).eq('id', token_id).execute()

    def invalidate_tokens(self, user_id, purpose):
        self.c.table('admin_tokens').update({'used_at': iso(now_utc())}) \
            .eq('user_id', user_id).eq('purpose', purpose).is_('used_at', 'null').execute()

    # belépési kódok
    def insert_challenge(self, data):
        return self._one(self.c.table('admin_login_challenges').insert(data).execute().data)

    def get_challenge(self, challenge_id):
        return self._one(self.c.table('admin_login_challenges').select('*').eq('id', challenge_id)
                         .limit(1).execute().data)

    def update_challenge(self, challenge_id, data):
        self.c.table('admin_login_challenges').update(data).eq('id', challenge_id).execute()

    def invalidate_challenges(self, user_id):
        self.c.table('admin_login_challenges').update({'used_at': iso(now_utc())}) \
            .eq('user_id', user_id).is_('used_at', 'null').execute()

    # munkamenetek
    def insert_session(self, data):
        return self._one(self.c.table('admin_sessions').insert(data).execute().data)

    def get_session_by_hash(self, h):
        return self._one(self.c.table('admin_sessions').select('*').eq('token_hash', h).limit(1).execute().data)

    def update_session(self, session_id, data):
        self.c.table('admin_sessions').update(data).eq('id', session_id).execute()

    def revoke_sessions(self, user_id):
        self.c.table('admin_sessions').update({'revoked_at': iso(now_utc())}) \
            .eq('user_id', user_id).is_('revoked_at', 'null').execute()

    # napló, takarítás, összesítők
    def audit(self, user_id, action, detail=None):
        self.c.table('admin_audit_log').insert({'user_id': user_id, 'action': action, 'detail': detail}).execute()

    def cleanup(self):
        cutoff = iso(now_utc() - timedelta(days=7))
        self.c.table('admin_login_challenges').delete().lt('expires_at', cutoff).execute()
        self.c.table('admin_tokens').delete().lt('expires_at', cutoff).execute()
        self.c.table('admin_sessions').delete().lt('expires_at', cutoff).execute()

    def rpc(self, name, params=None):
        return self.c.rpc(name, params or {}).execute().data or []


store = None


def configure(supabase_client):
    global store
    store = SupabaseStore(supabase_client) if supabase_client else None


def safe_audit(user_id, action, detail=None):
    try:
        store.audit(user_id, action, detail)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Levélküldés (Brevo tranzakciós API — ugyanaz, mint a hírlevél-megerősítésnél)
# ---------------------------------------------------------------------------

def send_mail(to_address, subject, html, text):
    api_key = env('BREVO_API_KEY')
    if not api_key:
        return False
    try:
        r = requests.post(
            'https://api.brevo.com/v3/smtp/email',
            headers={'api-key': api_key, 'content-type': 'application/json'},
            json={
                'sender': {'name': env('MAIL_FROM_NAME', 'JÉGER-kezdeményezés'),
                           'email': env('ADMIN_MAIL_FROM_EMAIL', env('MAIL_FROM_EMAIL', 'hirlevel@news.stopjeger.hu'))},
                'replyTo': {'email': env('MAIL_REPLY_TO', 'info@stopjeger.hu')},
                'to': [{'email': to_address}],
                'subject': subject,
                'htmlContent': html,
                'textContent': text,
                'tags': ['admin-auth'],
            },
            timeout=10,
        )
        return r.status_code in (200, 201, 202)
    except Exception:
        return False


def _button(link, label):
    return ('<p><a href="%s" style="display:inline-block;padding:12px 22px;background:#b3560a;'
            'color:#fff;text-decoration:none;border-radius:8px;font-weight:600">%s</a></p>'
            '<p style="font-size:13px;color:#666">Ha a gomb nem működik, másold be ezt a címet a '
            'böngészőbe:<br>%s</p>') % (link, label, link)


def mail_invite(user, token, inviter_name):
    link = '%s/admin/jelszo/#meghivo=%s' % (site_url(), token)
    who = ('%s meghívott' % inviter_name) if inviter_name else 'Meghívást kaptál'
    html = ('<p>Szia%s!</p><p>%s a stopjeger.hu belső felületére.</p>'
            '<p>A hozzáféréshez állíts be egy jelszót. Belépéskor minden alkalommal egy 6 jegyű '
            'kódot is küldünk erre a címre — ez a második azonosítási lépés.</p>%s'
            '<p style="font-size:13px;color:#666">A meghívó 72 óráig érvényes. Ha nem számítottál rá, '
            'hagyd figyelmen kívül ezt a levelet.</p>') % (
        (' ' + user['name']) if user.get('name') else '', who, _button(link, 'Jelszó beállítása'))
    text = ('%s a stopjeger.hu belső felületére.\n\nJelszó beállítása:\n%s\n\n'
            'A meghívó 72 óráig érvényes.\n') % (who, link)
    return send_mail(user['email'], 'Meghívó a stopjeger.hu belső felületére', html, text)


def mail_reset(user, token):
    link = '%s/admin/jelszo/#visszaallitas=%s' % (site_url(), token)
    html = ('<p>Szia!</p><p>Jelszó-visszaállítást kértek a stopjeger.hu belső felületén ehhez a '
            'címhez.</p>%s<p style="font-size:13px;color:#666">A hivatkozás 1 óráig érvényes. Ha nem te '
            'kérted, hagyd figyelmen kívül — a jelszavad nem változik.</p>') % _button(link, 'Új jelszó beállítása')
    text = 'Jelszó-visszaállítás a stopjeger.hu belső felületén:\n%s\n\nA hivatkozás 1 óráig érvényes.\n' % link
    return send_mail(user['email'], 'Jelszó-visszaállítás — stopjeger.hu belső felület', html, text)


def mail_code(user, code):
    html = ('<p>Szia!</p><p>A belépési kódod a stopjeger.hu belső felületéhez:</p>'
            '<p style="font-size:32px;font-weight:700;letter-spacing:6px;font-family:monospace">%s</p>'
            '<p style="font-size:13px;color:#666">A kód 10 percig érvényes, és csak egyszer használható. '
            'Ha nem te próbáltál belépni, <b>változtasd meg a jelszavadat</b>, és szólj az adminisztrátornak — '
            'valaki ismeri a jelszavadat.</p>') % code
    text = ('A belépési kódod: %s\n\nA kód 10 percig érvényes. Ha nem te próbáltál belépni, '
            'változtasd meg a jelszavadat.\n') % code
    return send_mail(user['email'], 'Belépési kód — stopjeger.hu belső felület', html, text)


# ---------------------------------------------------------------------------
# Függőségek: konfiguráció, azonos eredet, munkamenet, szerepkör
# ---------------------------------------------------------------------------

def require_ready():
    if store is None or auth_secret() is None:
        raise HTTPException(status_code=503, detail='A belső felület nincs beállítva.')


def require_same_origin(request: Request):
    """CSRF-védelem a SameSite=Strict süti mellé: saját fejléc + az Origin ellenőrzése."""
    if request.headers.get('x-requested-with') != 'stopjeger-admin':
        raise HTTPException(status_code=403, detail='Érvénytelen kérés.')
    origin = request.headers.get('origin')
    if origin and origin.rstrip('/') not in allowed_origins():
        raise HTTPException(status_code=403, detail='Érvénytelen kérés.')


def public_user(user):
    return {'id': user['id'], 'email': user['email'], 'name': user.get('name'), 'role': user['role']}


def current_user(request: Request):
    require_ready()
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail='Bejelentkezés szükséges.')
    session = store.get_session_by_hash(token_hash(token))
    now = now_utc()
    if (not session or session.get('revoked_at')
            or parse_ts(session['expires_at']) <= now
            or parse_ts(session['last_seen_at']) + SESSION_IDLE <= now):
        raise HTTPException(status_code=401, detail='A munkamenet lejárt, jelentkezz be újra.')
    user = store.get_user(session['user_id'])
    if not user or user.get('status') != 'active':
        raise HTTPException(status_code=401, detail='Bejelentkezés szükséges.')
    if parse_ts(session['last_seen_at']) + SESSION_TOUCH <= now:
        store.update_session(session['id'], {'last_seen_at': iso(now)})
    user['_session_id'] = session['id']
    return user


def require_admin(user=Depends(current_user)):
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail='Ehhez adminisztrátori jogosultság kell.')
    return user


def no_store(payload, status_code=200):
    return JSONResponse(payload, status_code=status_code, headers={'Cache-Control': 'no-store'})


# ---------------------------------------------------------------------------
# Belépés
# ---------------------------------------------------------------------------

class LoginBody(BaseModel):
    email: str = ''
    password: str = ''


class VerifyBody(BaseModel):
    challenge: str = ''
    code: str = ''


@router.get('/session')
def session_info(request: Request):
    try:
        user = current_user(request)
    except HTTPException as exc:
        if exc.status_code == 503:
            raise
        return no_store({'authenticated': False})
    return no_store({'authenticated': True, 'user': public_user(user)})


@router.post('/login', dependencies=[Depends(require_same_origin)])
def login(body: LoginBody, request: Request):
    require_ready()
    ip = client_ip(request)
    if not rate_ok('login', ip, 20, 600):
        raise HTTPException(status_code=429, detail='Túl sok próbálkozás. Várj néhány percet.')

    address = (body.email or '').strip().lower()
    user = store.get_user_by_email(address) if EMAIL_RE.match(address) else None
    now = now_utc()

    if not user or not user.get('password_hash') or user.get('status') != 'active':
        burn_password_time(body.password)
        raise HTTPException(status_code=401, detail=GENERIC_LOGIN_ERROR)

    locked_until = parse_ts(user.get('locked_until'))
    if locked_until and locked_until > now:
        burn_password_time(body.password)
        raise HTTPException(status_code=401, detail=GENERIC_LOGIN_ERROR)

    if not verify_password(body.password or '', user['password_hash']):
        fails = int(user.get('failed_logins') or 0) + 1
        update = {'failed_logins': fails}
        if fails >= LOGIN_MAX_FAILS:
            update = {'failed_logins': 0, 'locked_until': iso(now + LOGIN_LOCK)}
            safe_audit(user['id'], 'login_locked')
        store.update_user(user['id'], update)
        safe_audit(user['id'], 'login_failed')
        raise HTTPException(status_code=401, detail=GENERIC_LOGIN_ERROR)

    store.update_user(user['id'], {'failed_logins': 0, 'locked_until': None})
    try:
        store.cleanup()
    except Exception:
        pass
    store.invalidate_challenges(user['id'])

    challenge_id = str(uuid.uuid4())
    code = new_code()
    store.insert_challenge({
        'id': challenge_id,
        'user_id': user['id'],
        'code_hash': code_hash(challenge_id, code),
        'expires_at': iso(now + CODE_TTL),
    })
    if not mail_code(user, code):
        store.update_challenge(challenge_id, {'used_at': iso(now)})
        raise HTTPException(status_code=502, detail='A belépési kódot nem sikerült elküldeni. Próbáld újra később.')

    return no_store({
        'ok': True,
        'challenge': challenge_id,
        'email_hint': mask_email(user['email']),
        'expires_in': int(CODE_TTL.total_seconds()),
    })


@router.post('/login/verify', dependencies=[Depends(require_same_origin)])
def login_verify(body: VerifyBody, request: Request):
    require_ready()
    code = re.sub(r'\D', '', body.code or '')
    try:
        challenge_id = str(uuid.UUID(body.challenge))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail='A kód lejárt vagy érvénytelen. Kérj újat.')

    challenge = store.get_challenge(challenge_id)
    now = now_utc()
    if (not challenge or challenge.get('used_at') or parse_ts(challenge['expires_at']) <= now
            or int(challenge.get('attempts') or 0) >= CODE_MAX_ATTEMPTS):
        raise HTTPException(status_code=400, detail='A kód lejárt vagy érvénytelen. Kérj újat.')

    if len(code) != 6 or not hmac.compare_digest(code_hash(challenge_id, code), challenge['code_hash']):
        attempts = int(challenge.get('attempts') or 0) + 1
        update = {'attempts': attempts}
        if attempts >= CODE_MAX_ATTEMPTS:
            update['used_at'] = iso(now)
        store.update_challenge(challenge_id, update)
        safe_audit(challenge['user_id'], 'code_failed')
        left = CODE_MAX_ATTEMPTS - attempts
        if left <= 0:
            raise HTTPException(status_code=400, detail='Túl sok hibás kód. Jelentkezz be újra, új kódot küldünk.')
        raise HTTPException(status_code=400, detail='Hibás kód. Még %d próbálkozásod van.' % left)

    store.update_challenge(challenge_id, {'used_at': iso(now)})
    user = store.get_user(challenge['user_id'])
    if not user or user.get('status') != 'active':
        raise HTTPException(status_code=401, detail=GENERIC_LOGIN_ERROR)

    session_token = secrets.token_urlsafe(32)
    store.insert_session({
        'user_id': user['id'],
        'token_hash': token_hash(session_token),
        'expires_at': iso(now + SESSION_TTL),
        'last_seen_at': iso(now),
    })
    store.update_user(user['id'], {'last_login_at': iso(now)})
    safe_audit(user['id'], 'login')

    response = no_store({'ok': True, 'user': public_user(user)})
    response.set_cookie(COOKIE_NAME, session_token, max_age=int(SESSION_TTL.total_seconds()),
                        httponly=True, secure=cookie_secure(), samesite='strict', path='/')
    return response


@router.post('/logout', dependencies=[Depends(require_same_origin)])
def logout(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if token and store is not None:
        try:
            session = store.get_session_by_hash(token_hash(token))
            if session and not session.get('revoked_at'):
                store.update_session(session['id'], {'revoked_at': iso(now_utc())})
                safe_audit(session['user_id'], 'logout')
        except Exception:
            pass
    response = no_store({'ok': True})
    response.delete_cookie(COOKIE_NAME, path='/', secure=cookie_secure(), httponly=True, samesite='strict')
    return response


# ---------------------------------------------------------------------------
# Jelszó: meghívó elfogadása, visszaállítás
# ---------------------------------------------------------------------------

class TokenBody(BaseModel):
    token: str = ''


class PasswordSetBody(BaseModel):
    token: str = ''
    password: str = ''


class ForgotBody(BaseModel):
    email: str = ''


def valid_token_row(token):
    if not token or len(token) > 200:
        return None
    row = store.get_token_by_hash(token_hash(token))
    if not row or row.get('used_at') or parse_ts(row['expires_at']) <= now_utc():
        return None
    return row


@router.post('/password/check', dependencies=[Depends(require_same_origin)])
def password_check(body: TokenBody):
    require_ready()
    row = valid_token_row(body.token)
    user = store.get_user(row['user_id']) if row else None
    if not row or not user or user.get('status') == 'disabled':
        raise HTTPException(status_code=400, detail='A hivatkozás lejárt vagy már felhasználták.')
    return no_store({'ok': True, 'purpose': row['purpose'], 'email': user['email'], 'name': user.get('name')})


@router.post('/password/set', dependencies=[Depends(require_same_origin)])
def password_set(body: PasswordSetBody):
    require_ready()
    row = valid_token_row(body.token)
    user = store.get_user(row['user_id']) if row else None
    if not row or not user or user.get('status') == 'disabled':
        raise HTTPException(status_code=400, detail='A hivatkozás lejárt vagy már felhasználták.')

    problem = password_problem(body.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if user['email'].split('@')[0].lower() in body.password.lower():
        raise HTTPException(status_code=400, detail='A jelszó ne tartalmazza az e-mail-címed elejét.')

    now = now_utc()
    update = {'password_hash': hash_password(body.password), 'failed_logins': 0, 'locked_until': None}
    if user.get('status') == 'invited':
        update.update({'status': 'active', 'activated_at': iso(now)})
    store.update_user(user['id'], update)
    store.update_token(row['id'], {'used_at': iso(now)})
    store.invalidate_tokens(user['id'], row['purpose'])
    store.revoke_sessions(user['id'])
    safe_audit(user['id'], 'password_set_' + row['purpose'])
    return no_store({'ok': True, 'email': user['email']})


@router.post('/password/forgot', dependencies=[Depends(require_same_origin)])
def password_forgot(body: ForgotBody, request: Request):
    require_ready()
    if not rate_ok('forgot', client_ip(request), 5, 900):
        raise HTTPException(status_code=429, detail='Túl sok kérés. Várj néhány percet.')
    address = (body.email or '').strip().lower()
    user = store.get_user_by_email(address) if EMAIL_RE.match(address) else None
    # A válasz mindig ugyanaz, hogy ne lehessen kipuhatolni, melyik cím létezik.
    if user and user.get('status') == 'active':
        store.invalidate_tokens(user['id'], 'reset')
        token = secrets.token_urlsafe(32)
        store.insert_token({'user_id': user['id'], 'purpose': 'reset', 'token_hash': token_hash(token),
                            'expires_at': iso(now_utc() + RESET_TTL)})
        mail_reset(user, token)
        safe_audit(user['id'], 'password_reset_requested')
    return no_store({'ok': True})


# ---------------------------------------------------------------------------
# Felhasználók kezelése (csak admin)
# ---------------------------------------------------------------------------

class InviteBody(BaseModel):
    email: str = ''
    name: str = ''
    role: str = 'editor'


class BootstrapBody(BaseModel):
    email: str = ''
    name: str = ''


def create_invite(user, inviter_name=None):
    store.invalidate_tokens(user['id'], 'invite')
    token = secrets.token_urlsafe(32)
    store.insert_token({'user_id': user['id'], 'purpose': 'invite', 'token_hash': token_hash(token),
                        'expires_at': iso(now_utc() + INVITE_TTL)})
    return mail_invite(user, token, inviter_name)


def clean_name(name):
    return re.sub(r'\s+', ' ', (name or '')).strip()[:80] or None


@router.get('/users')
def users_list(admin=Depends(require_admin)):
    return no_store({'users': store.list_users(), 'me': admin['id']})


@router.post('/users/invite', dependencies=[Depends(require_same_origin)])
def users_invite(body: InviteBody, admin=Depends(require_admin)):
    address = (body.email or '').strip().lower()
    if not EMAIL_RE.match(address) or len(address) > 254:
        raise HTTPException(status_code=400, detail='Érvénytelen e-mail-cím.')
    role = body.role if body.role in ('admin', 'editor') else None
    if not role:
        raise HTTPException(status_code=400, detail='Érvénytelen szerepkör.')

    existing = store.get_user_by_email(address)
    if existing and existing.get('status') != 'invited':
        raise HTTPException(status_code=409, detail='Ezzel a címmel már van felhasználó.')
    if existing:
        user = existing
    else:
        user = store.insert_user({'email': address, 'name': clean_name(body.name), 'role': role,
                                  'status': 'invited', 'invited_by': admin['id']})
    sent = create_invite(user, admin.get('name') or admin['email'])
    safe_audit(admin['id'], 'user_invited', address)
    if not sent:
        raise HTTPException(status_code=502, detail='A felhasználó létrejött, de a meghívó levelet nem sikerült elküldeni.')
    return no_store({'ok': True})


def _target(user_id, admin):
    try:
        user_id = str(uuid.UUID(user_id))
    except ValueError:
        raise HTTPException(status_code=404, detail='Nincs ilyen felhasználó.')
    user = store.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail='Nincs ilyen felhasználó.')
    if user['id'] == admin['id']:
        raise HTTPException(status_code=400, detail='Saját magadon ezt nem teheted meg.')
    return user


@router.post('/users/{user_id}/disable', dependencies=[Depends(require_same_origin)])
def users_disable(user_id: str, admin=Depends(require_admin)):
    user = _target(user_id, admin)
    store.update_user(user['id'], {'status': 'disabled'})
    store.revoke_sessions(user['id'])
    store.invalidate_challenges(user['id'])
    safe_audit(admin['id'], 'user_disabled', user['email'])
    return no_store({'ok': True})


@router.post('/users/{user_id}/enable', dependencies=[Depends(require_same_origin)])
def users_enable(user_id: str, admin=Depends(require_admin)):
    user = _target(user_id, admin)
    store.update_user(user['id'], {'status': 'active' if user.get('password_hash') else 'invited'})
    safe_audit(admin['id'], 'user_enabled', user['email'])
    return no_store({'ok': True})


@router.post('/users/{user_id}/resend', dependencies=[Depends(require_same_origin)])
def users_resend(user_id: str, admin=Depends(require_admin)):
    user = _target(user_id, admin)
    if user.get('status') != 'invited':
        raise HTTPException(status_code=400, detail='Csak függőben lévő meghívót lehet újraküldeni.')
    if not create_invite(user, admin.get('name') or admin['email']):
        raise HTTPException(status_code=502, detail='A meghívó levelet nem sikerült elküldeni.')
    safe_audit(admin['id'], 'invite_resent', user['email'])
    return no_store({'ok': True})


@router.post('/bootstrap')
def bootstrap(body: BootstrapBody, request: Request):
    """Az első adminisztrátor meghívása. Csak akkor működik, ha még egyetlen admin sincs,
    és a meglévő ADMIN_PASSWORD-öt X-Admin-Password fejlécben kapja."""
    require_ready()
    admin_pw = env('ADMIN_PASSWORD')
    ip = client_ip(request)
    if not admin_pw:
        raise HTTPException(status_code=403, detail='Nincs beállítva.')
    if not rate_ok('bootstrap', ip, 5, 900):
        raise HTTPException(status_code=429, detail='Túl sok próbálkozás.')
    header = request.headers.get('x-admin-password') or ''
    if not hmac.compare_digest(header.encode('utf-8'), admin_pw.encode('utf-8')):
        raise HTTPException(status_code=401, detail='Unauthorized')
    if store.count_admins() > 0:
        raise HTTPException(status_code=409, detail='Már van adminisztrátor; a további meghívás a felületről megy.')
    address = (body.email or '').strip().lower()
    if not EMAIL_RE.match(address):
        raise HTTPException(status_code=400, detail='Érvénytelen e-mail-cím.')
    user = store.get_user_by_email(address) or store.insert_user(
        {'email': address, 'name': clean_name(body.name), 'role': 'admin', 'status': 'invited'})
    if user.get('role') != 'admin':
        store.update_user(user['id'], {'role': 'admin'})
    if not create_invite(user):
        raise HTTPException(status_code=502, detail='A meghívó levelet nem sikerült elküldeni.')
    safe_audit(user['id'], 'bootstrap_invite', address)
    return no_store({'ok': True})


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

def _date(value, name):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail='Érvénytelen dátum: %s' % name)


def vercel_get(path, params):
    token, project = env('VERCEL_API_TOKEN'), env('VERCEL_PROJECT_ID')
    if not token or not project:
        return None
    query = dict(params, projectId=project)
    if env('VERCEL_TEAM_ID'):
        query['teamId'] = env('VERCEL_TEAM_ID')
    r = requests.get('https://api.vercel.com/v1/query/web-analytics/' + path,
                     headers={'Authorization': 'Bearer ' + token}, params=query, timeout=8)
    if r.status_code != 200:
        hints = {401: 'érvénytelen token', 402: 'a Vercel-csomag nem engedi ezt a lekérdezést',
                 403: 'a tokennek nincs jogosultsága', 404: 'a projekt nem található'}
        raise RuntimeError('Vercel API %d — %s' % (r.status_code, hints.get(r.status_code, 'hiba')))
    return r.json()


def visitors_block(d_from, d_to, days):
    since, until = d_from.isoformat(), d_to.isoformat()
    try:
        agg = vercel_get('visits/aggregate', {'since': since, 'until': until, 'by': 'day',
                                              'filter': "environment eq 'production'"})
        if agg is None:
            return {'status': 'not_configured',
                    'message': 'A Vercel Analytics lekérdezéséhez be kell állítani a VERCEL_API_TOKEN és VERCEL_PROJECT_ID változót.'}
        by_day = {}
        for row in agg.get('data') or []:
            day = str(row.get('timestamp') or row.get('day') or '')[:10]
            if day:
                by_day[day] = {'visitors': int(row.get('visitors') or 0), 'pageviews': int(row.get('pageviews') or 0)}
        total = (vercel_get('visits/count', {'since': since, 'until': until}) or {}).get('data') or {}
        daily = [dict({'day': d}, **by_day.get(d, {'visitors': 0, 'pageviews': 0})) for d in days]
        return {'status': 'ok', 'daily': daily,
                'total': {'visitors': int(total.get('visitors') or sum(x['visitors'] for x in daily)),
                          'pageviews': int(total.get('pageviews') or sum(x['pageviews'] for x in daily))}}
    except Exception as exc:
        return {'status': 'error', 'message': str(exc)[:200]}


def survey_block(d_from, d_to, days, totals):
    try:
        rows = store.rpc('admin_survey_daily', {'p_from': d_from.isoformat(), 'p_to': d_to.isoformat()})
        by_day = {str(r['day'])[:10]: int(r['n']) for r in rows}
        daily = [{'day': d, 'n': by_day.get(d, 0)} for d in days]
        return {'status': 'ok', 'daily': daily, 'total': sum(x['n'] for x in daily),
                'all_time': totals.get('survey_total')}
    except Exception:
        return {'status': 'error', 'message': 'A kérdőív-adatokat nem sikerült lekérdezni. Lefutott az SQL-migráció?'}


def subscribers_block(d_from, d_to, days, totals):
    try:
        rows = store.rpc('admin_subscribers_daily', {'p_from': d_from.isoformat(), 'p_to': d_to.isoformat()})
        by_day = {str(r['day'])[:10]: (int(r['confirmed']), int(r['signups'])) for r in rows}
        daily = [{'day': d, 'confirmed': by_day.get(d, (0, 0))[0], 'signups': by_day.get(d, (0, 0))[1]} for d in days]
        return {'status': 'ok', 'daily': daily,
                'total_confirmed': sum(x['confirmed'] for x in daily),
                'total_signups': sum(x['signups'] for x in daily),
                'active': totals.get('subscribers_active'), 'pending': totals.get('subscribers_pending')}
    except Exception:
        return {'status': 'error', 'message': 'A hírlevél-adatokat nem sikerült lekérdezni. Lefutott az SQL-migráció?'}


@router.get('/stats')
def stats(request: Request, user=Depends(current_user)):
    params = request.query_params
    today = now_utc().date()
    d_to = _date(params.get('to'), 'to') if params.get('to') else today
    d_from = _date(params.get('from'), 'from') if params.get('from') else d_to - timedelta(days=29)
    if d_to > today:
        d_to = today
    if d_from > d_to:
        raise HTTPException(status_code=400, detail='A kezdő dátum nem lehet későbbi a záró dátumnál.')
    span = (d_to - d_from).days + 1
    if span > STATS_MAX_DAYS:
        raise HTTPException(status_code=400, detail='Legfeljebb %d napos időszak kérdezhető le.' % STATS_MAX_DAYS)
    days = [(d_from + timedelta(days=i)).isoformat() for i in range(span)]

    try:
        totals_rows = store.rpc('admin_totals')
        totals = totals_rows[0] if totals_rows else {}
    except Exception:
        totals = {}

    return no_store({
        'range': {'from': d_from.isoformat(), 'to': d_to.isoformat(), 'days': span},
        'visitors': visitors_block(d_from, d_to, days),
        'survey': survey_block(d_from, d_to, days, totals),
        'subscribers': subscribers_block(d_from, d_to, days, totals),
    })
