"""Az önálló hírlevél-feliratkozás (POST /api/subscribe) tesztjei, kiváltott adatbázissal és levélküldéssel.

Futtatás a repó gyökeréből:
    python -m unittest backend/tests/test_subscribe.py -v
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_admin  # noqa: E402,F401  (környezeti változók)

import index  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class FakeSubscribers:
    def __init__(self):
        self.rows = {}

    def table(self, name):
        assert name == 'subscribers'
        return self

    def insert(self, data):
        self._pending = data
        return self

    def execute(self):
        data = self._pending
        if data['email'] in self.rows:
            raise Exception('duplicate key value violates unique constraint "subscribers_email_key"')
        row = dict(data, confirm_token='tok-' + data['email'])
        self.rows[data['email']] = row
        return type('Res', (), {'data': [row]})()


class SubscribeTests(unittest.TestCase):
    def setUp(self):
        index.rate_store.clear()
        self.db = FakeSubscribers()
        index.supabase_client = self.db
        self.mails = []
        index.send_confirmation_email = lambda address, token, source='kerdoiv': self.mails.append((address, token, source)) or True
        index.token_for_existing = lambda address: None  # már megerősített cím
        self.client = TestClient(index.app)

    def post(self, **data):
        return self.client.post('/api/subscribe', data=data)

    def test_subscribe_sends_confirmation_with_blog_source(self):
        r = self.post(email=' Anna@Example.org ', consent='on')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {'ok': True})
        self.assertEqual(self.db.rows['anna@example.org']['source'], 'blog')
        self.assertEqual(self.mails, [('anna@example.org', 'tok-anna@example.org', 'blog')])

    def test_validation_and_honeypot(self):
        self.assertEqual(self.post(email='nem-email', consent='on').status_code, 400)
        self.assertEqual(self.post(email='a@b.hu').status_code, 400)  # hozzájárulás nélkül
        self.assertEqual(self.post(email='a@b.hu', consent='on', hp_field='bot').status_code, 400)
        self.assertEqual(self.db.rows, {})

    def test_existing_address_gets_same_response(self):
        first = self.post(email='anna@example.org', consent='on')
        again = self.post(email='anna@example.org', consent='on')
        self.assertEqual(first.json(), again.json())
        self.assertEqual(len(self.mails), 1)  # megerősített címre nem megy újabb levél

    def test_confirmation_email_intro_depends_on_source(self):
        self.assertIn('blogján', index.CONFIRM_INTRO['blog'][0])
        self.assertIn('kérdőívet', index.CONFIRM_INTRO['kerdoiv'][0])


if __name__ == '__main__':
    unittest.main()
