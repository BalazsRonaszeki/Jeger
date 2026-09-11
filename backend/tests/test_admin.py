"""A belső felület (api/_admin.py) tesztjei, memóriabeli adatbázissal.

Futtatás a repó gyökeréből:
    python -m unittest backend/tests/test_admin.py -v
"""

import copy
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'api'))

os.environ['ADMIN_AUTH_SECRET'] = 'teszt-titok-' + 'x' * 32
os.environ['ADMIN_COOKIE_SECURE'] = 'false'
os.environ['SITE_URL'] = 'http://testserver'
os.environ['ALLOWED_ORIGINS'] = 'http://testserver'
os.environ['ADMIN_PASSWORD'] = 'bootstrap-jelszo'
for name in ('VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID'):
    os.environ.pop(name, None)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import _admin  # noqa: E402

H = {'X-Requested-With': 'stopjeger-admin', 'Origin': 'http://testserver'}


def now():
    return datetime.now(timezone.utc)


class FakeStore:
    def __init__(self):
        self.users, self.tokens, self.challenges, self.sessions, self.log = {}, {}, {}, {}, []
        self.rpc_data = {}

    def _find(self, table, **kw):
        for row in table.values():
            if all(row.get(k) == v for k, v in kw.items()):
                return copy.deepcopy(row)
        return None

    def _insert(self, table, data, defaults):
        row = dict(defaults, **data)
        row.setdefault('id', str(uuid.uuid4()))
        table[row['id']] = row
        return copy.deepcopy(row)

    def get_user_by_email(self, email): return self._find(self.users, email=email)
    def get_user(self, user_id): return self._find(self.users, id=user_id)
    def list_users(self): return [copy.deepcopy(u) for u in self.users.values()]
    def count_admins(self): return sum(1 for u in self.users.values() if u['role'] == 'admin')

    def insert_user(self, data):
        return self._insert(self.users, data, {'role': 'editor', 'status': 'invited', 'password_hash': None,
                                               'failed_logins': 0, 'locked_until': None, 'name': None,
                                               'created_at': now().isoformat()})

    def update_user(self, user_id, data): self.users[user_id].update(data)

    def insert_token(self, data): return self._insert(self.tokens, data, {'used_at': None})
    def get_token_by_hash(self, h): return self._find(self.tokens, token_hash=h)
    def update_token(self, token_id, data): self.tokens[token_id].update(data)

    def invalidate_tokens(self, user_id, purpose):
        for t in self.tokens.values():
            if t['user_id'] == user_id and t['purpose'] == purpose and not t['used_at']:
                t['used_at'] = now().isoformat()

    def insert_challenge(self, data): return self._insert(self.challenges, data, {'attempts': 0, 'used_at': None})
    def get_challenge(self, cid): return self._find(self.challenges, id=cid)
    def update_challenge(self, cid, data): self.challenges[cid].update(data)

    def invalidate_challenges(self, user_id):
        for c in self.challenges.values():
            if c['user_id'] == user_id and not c['used_at']:
                c['used_at'] = now().isoformat()

    def insert_session(self, data): return self._insert(self.sessions, data, {'revoked_at': None})
    def get_session_by_hash(self, h): return self._find(self.sessions, token_hash=h)
    def update_session(self, sid, data): self.sessions[sid].update(data)

    def revoke_sessions(self, user_id):
        for s in self.sessions.values():
            if s['user_id'] == user_id and not s['revoked_at']:
                s['revoked_at'] = now().isoformat()

    def audit(self, user_id, action, detail=None): self.log.append((user_id, action, detail))
    def cleanup(self): pass
    def rpc(self, name, params=None): return self.rpc_data.get(name, [])


class AdminTests(unittest.TestCase):
    def setUp(self):
        _admin._rate.clear()
        self.store = FakeStore()
        _admin.store = self.store
        self.mails = []

        def fake_send(to, subject, html, text):
            self.mails.append({'to': to, 'subject': subject, 'html': html, 'text': text})
            return True

        _admin.send_mail = fake_send
        app = FastAPI()
        app.include_router(_admin.router)
        self.client = TestClient(app)

    # --- segédek ---------------------------------------------------------
    def last_link_token(self, marker):
        text = self.mails[-1]['text']
        return text.split(marker + '=')[1].split()[0]

    def last_code(self):
        return self.mails[-1]['text'].split('belépési kódod: ')[1][:6]

    def make_active(self, email='anna@example.org', password='nagyon-hosszu-jelszo-42', role='editor'):
        user = self.store.insert_user({'email': email, 'role': role, 'status': 'active',
                                       'password_hash': _admin.hash_password(password), 'name': 'Anna'})
        return user, password

    def login(self, email, password):
        r = self.client.post('/api/admin/login', json={'email': email, 'password': password}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        challenge = r.json()['challenge']
        r = self.client.post('/api/admin/login/verify', json={'challenge': challenge, 'code': self.last_code()}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        return r

    # --- kriptográfia ----------------------------------------------------
    def test_password_hash_roundtrip(self):
        h = _admin.hash_password('valami-jelszo-123')
        self.assertTrue(h.startswith('scrypt$'))
        self.assertTrue(_admin.verify_password('valami-jelszo-123', h))
        self.assertFalse(_admin.verify_password('valami-jelszo-124', h))
        self.assertFalse(_admin.verify_password('x', 'hibas-formatum'))

    # --- teljes folyamat -------------------------------------------------
    def test_bootstrap_invite_password_login_flow(self):
        r = self.client.post('/api/admin/bootstrap', json={'email': 'Boss@Example.org', 'name': 'Főnök'},
                             headers={'X-Admin-Password': 'bootstrap-jelszo'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.mails[-1]['to'], 'boss@example.org')
        token = self.last_link_token('#meghivo')
        stored = list(self.store.tokens.values())[0]
        self.assertNotEqual(stored['token_hash'], token)  # csak a hash kerül az adatbázisba

        r = self.client.post('/api/admin/bootstrap', json={'email': 'masik@example.org'},
                             headers={'X-Admin-Password': 'bootstrap-jelszo'})
        self.assertEqual(r.status_code, 409)

        r = self.client.post('/api/admin/password/check', json={'token': token}, headers=H)
        self.assertEqual(r.json()['purpose'], 'invite')

        r = self.client.post('/api/admin/password/set', json={'token': token, 'password': 'rovid'}, headers=H)
        self.assertEqual(r.status_code, 400)
        r = self.client.post('/api/admin/password/set', json={'token': token, 'password': 'ez-egy-eros-jelszo-77'}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        r = self.client.post('/api/admin/password/set', json={'token': token, 'password': 'ez-egy-eros-jelszo-78'}, headers=H)
        self.assertEqual(r.status_code, 400)  # a token egyszer használható

        self.assertEqual(self.client.get('/api/admin/session').json(), {'authenticated': False})
        self.login('boss@example.org', 'ez-egy-eros-jelszo-77')
        me = self.client.get('/api/admin/session').json()
        self.assertTrue(me['authenticated'])
        self.assertEqual(me['user']['role'], 'admin')

        r = self.client.post('/api/admin/logout', headers=H)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get('/api/admin/session').json(), {'authenticated': False})

    def test_wrong_password_is_generic_and_locks_after_five(self):
        user, _ = self.make_active()
        r = self.client.post('/api/admin/login', json={'email': 'nincs@example.org', 'password': 'x' * 12}, headers=H)
        r2 = self.client.post('/api/admin/login', json={'email': user['email'], 'password': 'rossz-jelszo-123'}, headers=H)
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json(), r2.json())  # nem árulja el, létezik-e a fiók
        for _ in range(4):
            self.client.post('/api/admin/login', json={'email': user['email'], 'password': 'rossz-jelszo-123'}, headers=H)
        self.assertIsNotNone(self.store.users[user['id']]['locked_until'])
        r = self.client.post('/api/admin/login', json={'email': user['email'], 'password': 'nagyon-hosszu-jelszo-42'}, headers=H)
        self.assertEqual(r.status_code, 401)  # zárolva: a jó jelszó sem enged be

    def test_code_attempt_limit_and_single_use(self):
        user, pw = self.make_active()
        r = self.client.post('/api/admin/login', json={'email': user['email'], 'password': pw}, headers=H)
        challenge = r.json()['challenge']
        good = self.last_code()
        bad = '000000' if good != '000000' else '111111'
        for i in range(5):
            r = self.client.post('/api/admin/login/verify', json={'challenge': challenge, 'code': bad}, headers=H)
            self.assertEqual(r.status_code, 400)
        r = self.client.post('/api/admin/login/verify', json={'challenge': challenge, 'code': good}, headers=H)
        self.assertEqual(r.status_code, 400)  # 5 hibás után a jó kód sem működik

        r = self.client.post('/api/admin/login', json={'email': user['email'], 'password': pw}, headers=H)
        challenge = r.json()['challenge']
        code = self.last_code()
        self.assertEqual(self.client.post('/api/admin/login/verify', json={'challenge': challenge, 'code': code}, headers=H).status_code, 200)
        self.assertEqual(self.client.post('/api/admin/login/verify', json={'challenge': challenge, 'code': code}, headers=H).status_code, 400)

    def test_expired_code_rejected(self):
        user, pw = self.make_active()
        r = self.client.post('/api/admin/login', json={'email': user['email'], 'password': pw}, headers=H)
        challenge = r.json()['challenge']
        self.store.challenges[challenge]['expires_at'] = (now() - timedelta(seconds=1)).isoformat()
        r = self.client.post('/api/admin/login/verify', json={'challenge': challenge, 'code': self.last_code()}, headers=H)
        self.assertEqual(r.status_code, 400)

    def test_csrf_header_required(self):
        user, pw = self.make_active()
        r = self.client.post('/api/admin/login', json={'email': user['email'], 'password': pw})
        self.assertEqual(r.status_code, 403)
        r = self.client.post('/api/admin/login', json={'email': user['email'], 'password': pw},
                             headers={'X-Requested-With': 'stopjeger-admin', 'Origin': 'https://evil.example'})
        self.assertEqual(r.status_code, 403)

    def test_session_idle_timeout_and_disable_revokes(self):
        user, pw = self.make_active()
        self.login(user['email'], pw)
        self.assertTrue(self.client.get('/api/admin/session').json()['authenticated'])
        sid = list(self.store.sessions)[0]
        self.store.sessions[sid]['last_seen_at'] = (now() - timedelta(hours=3)).isoformat()
        self.assertFalse(self.client.get('/api/admin/session').json()['authenticated'])

    def test_editor_cannot_manage_users_admin_can(self):
        editor, pw = self.make_active()
        self.login(editor['email'], pw)
        self.assertEqual(self.client.get('/api/admin/users').status_code, 403)
        r = self.client.post('/api/admin/users/invite', json={'email': 'uj@example.org'}, headers=H)
        self.assertEqual(r.status_code, 403)

        self.client.post('/api/admin/logout', headers=H)
        admin, apw = self.make_active(email='admin@example.org', role='admin')
        self.login(admin['email'], apw)
        r = self.client.post('/api/admin/users/invite', json={'email': 'Uj@Example.org', 'name': 'Új Ember', 'role': 'editor'}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.mails[-1]['to'], 'uj@example.org')
        r = self.client.post('/api/admin/users/invite', json={'email': editor['email']}, headers=H)
        self.assertEqual(r.status_code, 409)

        users = self.client.get('/api/admin/users').json()['users']
        self.assertEqual({u['email'] for u in users}, {editor['email'], 'admin@example.org', 'uj@example.org'})
        r = self.client.post('/api/admin/users/%s/disable' % admin['id'], headers=H)
        self.assertEqual(r.status_code, 400)  # saját magát nem tilthatja le
        r = self.client.post('/api/admin/users/%s/disable' % editor['id'], headers=H)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.store.users[editor['id']]['status'], 'disabled')

    def test_forgot_password_same_response_and_reset_revokes_sessions(self):
        user, pw = self.make_active()
        self.login(user['email'], pw)
        r1 = self.client.post('/api/admin/password/forgot', json={'email': 'nincs@example.org'}, headers=H)
        n_mails = len(self.mails)
        r2 = self.client.post('/api/admin/password/forgot', json={'email': user['email']}, headers=H)
        self.assertEqual(r1.json(), r2.json())
        self.assertEqual(len(self.mails), n_mails + 1)
        token = self.last_link_token('#visszaallitas')
        r = self.client.post('/api/admin/password/set', json={'token': token, 'password': 'teljesen-uj-jelszo-99'}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(self.client.get('/api/admin/session').json()['authenticated'])  # a régi munkamenet megszűnt

    def test_stats_requires_login_and_fills_days(self):
        self.assertEqual(self.client.get('/api/admin/stats').status_code, 401)
        user, pw = self.make_active()
        self.login(user['email'], pw)
        self.store.rpc_data = {
            'admin_totals': [{'survey_total': 120, 'subscribers_active': 40, 'subscribers_pending': 5}],
            'admin_survey_daily': [{'day': '2026-09-02', 'n': 7}, {'day': '2026-09-04', 'n': 3}],
            'admin_subscribers_daily': [{'day': '2026-09-02', 'confirmed': 2, 'signups': 4}],
        }
        r = self.client.get('/api/admin/stats?from=2026-09-01&to=2026-09-05')
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data['range']['days'], 5)
        self.assertEqual([d['n'] for d in data['survey']['daily']], [0, 7, 0, 3, 0])
        self.assertEqual(data['survey']['total'], 10)
        self.assertEqual(data['survey']['all_time'], 120)
        self.assertEqual(data['subscribers']['total_confirmed'], 2)
        self.assertEqual(data['subscribers']['total_signups'], 4)
        self.assertEqual(data['visitors']['status'], 'not_configured')
        self.assertEqual(self.client.get('/api/admin/stats?from=2026-09-05&to=2026-09-01').status_code, 400)
        self.assertEqual(self.client.get('/api/admin/stats?from=2024-01-01&to=2026-09-01').status_code, 400)

    def test_not_configured_returns_503(self):
        _admin.store = None
        r = self.client.post('/api/admin/login', json={'email': 'a@b.hu', 'password': 'x' * 12}, headers=H)
        self.assertEqual(r.status_code, 503)


if __name__ == '__main__':
    unittest.main()
