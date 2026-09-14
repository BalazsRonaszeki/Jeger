"""A blog (api/_blog.py) tesztjei, memóriabeli adatbázissal és kiváltott Claude-hívással.

Futtatás a repó gyökeréből:
    python -m unittest backend/tests/test_blog.py -v
"""

import copy
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_admin  # noqa: E402  (környezeti változók, FakeStore, belépési segédek)

import _admin  # noqa: E402
import _blog  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

H = test_admin.H

# Egy valódi, 3x2 képpontos JPEG.
TINY_JPEG = bytes.fromhex(
    'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f14'
    '1d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080002000301011100'
    'ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000'
    '017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a'
    '3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a9293949596'
    '9798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2'
    'f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9')


class FakeBlogStore:
    def __init__(self):
        self.posts, self.images, self.objects = {}, {}, {}

    def list_posts(self):
        return sorted((copy.deepcopy(p) for p in self.posts.values()), key=lambda p: p['updated_at'], reverse=True)

    def get_post(self, post_id):
        return copy.deepcopy(self.posts.get(post_id))

    def slug_owner(self, slug):
        return next((p['id'] for p in self.posts.values() if p['slug'] == slug), None)

    def insert_post(self, data):
        row = dict({'fact_check': None, 'published_at': None, 'pub_updated_at': None, 'pub_hash': None,
                    'pub_title': None}, **data)
        row['id'] = str(uuid.uuid4())
        self.posts[row['id']] = row
        return copy.deepcopy(row)

    def update_post(self, post_id, version, data):
        row = self.posts.get(post_id)
        if not row or row['version'] != version:
            return None
        row.update(copy.deepcopy(data))
        return copy.deepcopy(row)

    def set_fact_check(self, post_id, data):
        self.posts[post_id]['fact_check'] = copy.deepcopy(data)

    def delete_post(self, post_id):
        if self.posts[post_id]['status'] == 'draft':
            del self.posts[post_id]

    def published(self, offset, limit):
        rows = sorted((p for p in self.posts.values() if p['status'] == 'published'),
                      key=lambda p: p['published_at'], reverse=True)
        return [copy.deepcopy(p) for p in rows[offset:offset + limit]], len(rows)

    def published_by_slug(self, slug):
        return next((copy.deepcopy(p) for p in self.posts.values() if p['slug'] == slug and p['status'] == 'published'), None)

    def published_slugs(self):
        return [copy.deepcopy(p) for p in self.posts.values() if p['status'] == 'published']

    def insert_image(self, data):
        self.images[data['id']] = dict(data)
        return dict(data)

    def upload_object(self, path, data):
        self.objects[path] = data

    def download_object(self, path):
        if path not in self.objects:
            raise KeyError(path)
        return self.objects[path]


class SanitizerTests(unittest.TestCase):
    def test_strips_scripts_handlers_and_bad_links(self):
        out = _blog.sanitize_html(
            '<p onclick="x()" style="color:red">Szia <b>vastag</b> <i>dőlt</i> <a href="javascript:alert(1)">rossz</a> '
            '<a href="https://pelda.hu/?a=1&b=2">jó</a></p><script>alert(1)</script><style>p{}</style>'
            '<img src="https://evil.example/x.png" onerror="x()">')
        self.assertEqual(out, '<p>Szia <strong>vastag</strong> <em>dőlt</em> rossz '
                              '<a href="https://pelda.hu/?a=1&amp;b=2">jó</a></p>')

    def test_structure_normalized(self):
        out = _blog.sanitize_html('laza szöveg<h1>Cím</h1><div>sor egy</div><div><p>bent</p></div>'
                                  '<ul><li>egy</li><li><p>kettő</p></li></ul><h5>kicsi</h5><p><br></p>')
        self.assertEqual(out, '<p>laza szöveg</p><h2>Cím</h2><p>sor egy</p><p>bent</p>'
                              '<ul><li>egy</li><li>kettő</li></ul><h3>kicsi</h3>')

    def test_escapes_text_and_attributes(self):
        out = _blog.sanitize_html('<p>&lt;script&gt; "idéző" <a href="/tudastar" title="x">belső</a></p>')
        self.assertEqual(out, '<p>&lt;script&gt; &quot;idéző&quot; <a href="/tudastar">belső</a></p>')

    def test_only_own_images_in_figures(self):
        img_id = str(uuid.uuid4())
        out = _blog.sanitize_html('<figure><img src="/blog/kepek/%s.jpg" alt="Generátor" width="1600" height="900" '
                                  'onload="x()"><figcaption>AI-generált <b>illusztráció</b></figcaption></figure>'
                                  '<p><img src="/blog/kepek/%s.jpg">szöveg</p>' % (img_id, img_id))
        self.assertEqual(out, '<figure><img src="/blog/kepek/%s.jpg" alt="Generátor" width="1600" height="900">'
                              '<figcaption>AI-generált <strong>illusztráció</strong></figcaption></figure>'
                              '<figure><img src="/blog/kepek/%s.jpg" alt=""></figure><p>szöveg</p>' % (img_id, img_id))

    def test_fix_marks_kept_in_draft_resolved_in_public(self):
        src = ('<p>Ez <del class="sj-fix-old" data-fix="f1" title="egybeírás">meg nézem</del>'
               '<ins class="sj-fix-new" data-fix="f1" title="egybeírás" onclick="x">megnézem</ins>.</p>')
        draft = _blog.sanitize_html(src)
        self.assertIn('<del class="sj-fix-old" data-fix="f1" title="egybeírás">meg nézem</del>', draft)
        self.assertTrue(_blog.has_pending_fixes(draft))
        self.assertEqual(_blog.sanitize_html(src, mode='public'), '<p>Ez megnézem.</p>')
        self.assertEqual(_blog.html_to_text(draft), 'Ez megnézem.')

    def test_public_external_links_open_in_new_tab(self):
        out = _blog.sanitize_html('<p><a href="https://doi.org/x">külső</a> <a href="https://stopjeger.hu/tudastar">belső</a></p>',
                                  mode='public')
        self.assertIn('<a href="https://doi.org/x" target="_blank" rel="noopener noreferrer">külső</a>', out)
        self.assertIn('<a href="https://stopjeger.hu/tudastar">belső</a>', out)

    def test_slugify_and_jpeg_size(self):
        self.assertEqual(_blog.slugify('Ősszel is: „Jégeső-elhárítás” – mit mond a tudomány?'),
                         'osszel-is-jegeso-elharitas-mit-mond-a-tudomany')
        self.assertEqual(_blog.slugify('!!!'), 'bejegyzes')
        self.assertEqual(_blog.jpeg_size(TINY_JPEG), (3, 2))
        self.assertIsNone(_blog.jpeg_size(b'\x89PNG\r\n'))

    def test_tudastar_parses_live_page(self):
        _blog._tudastar_cache.update(at=0, data=None)
        data = _blog.load_tudastar()
        self.assertEqual(len(data['claims']), 5)
        self.assertGreater(len(data['entries']), 20)
        first = data['entries'][0]
        self.assertEqual(first['id'], 'T01')
        self.assertTrue(first['title'] and first['found'] and first['url'].startswith('http'))
        self.assertIn('[T01]', _blog.tudastar_prompt(data))


class BlogApiTests(test_admin.AdminTests):
    """Az AdminTests belépési segédeit használjuk; az ottani teszteket itt nem futtatjuk újra."""

    def setUp(self):
        super().setUp()
        self.blog = FakeBlogStore()
        _blog.store = self.blog
        _blog._tudastar_cache.update(at=0, data=None)
        os.environ['ANTHROPIC_API_KEY'] = 'teszt'
        self.llm_calls = []
        self.fact_issues = []
        self.spell_result = None

        def fake_llm(system, user_text, schema, effort, max_tokens):
            self.llm_calls.append({'system': system, 'user': user_text, 'effort': effort})
            if schema is _blog.FACT_SCHEMA:
                return {'summary': 'Összegzés.', 'issues': self.fact_issues}
            return self.spell_result

        _blog.call_llm_json = fake_llm
        app = FastAPI()
        app.include_router(_admin.router)
        app.include_router(_blog.admin_router)
        app.include_router(_blog.public_router)
        self.client = TestClient(app)

    def tearDown(self):
        os.environ.pop('ANTHROPIC_API_KEY', None)

    def editor(self, role='editor', email='szerk@example.org'):
        user, pw = self.make_active(email=email, role=role)
        self.login(user['email'], pw)
        return user

    def create(self, **fields):
        body = dict({'title': 'Mit mond a tudomány?', 'excerpt': 'Rövid bevezető.',
                     'body_html': '<p>A hatékonyság nincs bizonyítva.</p>'}, **fields)
        r = self.client.post('/api/admin/blog/posts', json=body, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['post']

    def save(self, post, **fields):
        body = {k: post.get(k) or '' for k in ('title', 'excerpt', 'slug', 'author_display', 'body_html',
                                               'cover_image', 'cover_alt', 'cover_credit')}
        body.update(fields, version=post['version'])
        return self.client.post('/api/admin/blog/posts/%s' % post['id'], json=body, headers=H)

    def factcheck(self, post):
        r = self.client.post('/api/admin/blog/posts/%s/factcheck' % post['id'], headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def publish(self, post, **body):
        return self.client.post('/api/admin/blog/posts/%s/publish' % post['id'],
                                json=dict({'version': post['version']}, **body), headers=H)

    # --- tesztek -------------------------------------------------------------
    for _name in [n for n in dir(test_admin.AdminTests) if n.startswith('test_')]:
        locals()[_name] = None
    del _name

    def test_requires_login_and_csrf(self):
        self.assertEqual(self.client.get('/api/admin/blog/posts').status_code, 401)
        self.editor()
        r = self.client.post('/api/admin/blog/posts', json={'title': 'x'})
        self.assertEqual(r.status_code, 403)

    def test_create_sanitizes_and_makes_unique_slug(self):
        self.editor()
        a = self.create(body_html='<p>ok</p><script>x</script>')
        b = self.create()
        self.assertEqual(a['slug'], 'mit-mond-a-tudomany')
        self.assertEqual(b['slug'], 'mit-mond-a-tudomany-2')
        self.assertEqual(a['body_html'], '<p>ok</p>')
        self.assertEqual(a['status'], 'draft')

    def test_version_conflict(self):
        self.editor()
        post = self.create()
        r = self.save(post, title='Első módosítás')
        self.assertEqual(r.status_code, 200, r.text)
        r = self.save(post, title='Elavult változatból')  # a régi verziószámmal
        self.assertEqual(r.status_code, 409)

    def test_spellcheck_drops_invented_fragments(self):
        self.editor()
        self.spell_result = {'blocks': [{'id': 'b1', 'corrections': [
            {'original': 'meg nézem', 'replacement': 'megnézem', 'reason': 'egybeírás'},
            {'original': 'nincs a szövegben', 'replacement': 'x', 'reason': 'kitalált'},
            {'original': 'holnap', 'replacement': 'holnap', 'reason': 'nem változik'},
        ]}, {'id': 'ismeretlen', 'corrections': []}]}
        r = self.client.post('/api/admin/blog/spellcheck', json={'blocks': [{'id': 'b1', 'text': 'Holnap meg nézem.'}]}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['blocks'], [{'id': 'b1', 'corrections': [
            {'original': 'meg nézem', 'replacement': 'megnézem', 'reason': 'egybeírás'}]}])
        self.assertEqual(self.llm_calls[-1]['effort'], 'medium')

    def test_ai_not_configured(self):
        self.editor()
        os.environ.pop('ANTHROPIC_API_KEY')
        post = self.create()
        r = self.client.post('/api/admin/blog/spellcheck', json={'blocks': [{'id': 'b', 'text': 'x'}]}, headers=H)
        self.assertEqual(r.status_code, 503)
        self.assertEqual(self.client.post('/api/admin/blog/posts/%s/factcheck' % post['id'], headers=H).status_code, 503)
        # beállított AI nélkül szerkesztő is publikálhat ellenőrzés nélkül (naplózva)
        r = self.publish(post, unchecked=True)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn('blog_published_unchecked', [a for _, a, _ in self.store.log])

    def test_publish_requires_factcheck_and_ack_of_warnings(self):
        self.editor()
        post = self.create()
        self.assertEqual(self.publish(post).status_code, 409)             # nincs ellenőrzés
        self.assertEqual(self.publish(post, unchecked=True).status_code, 409)  # szerkesztő nem kerülheti meg

        self.fact_issues = [{'quote': 'A hatékonyság nincs bizonyítva.', 'problem': 'p', 'suggestion': 's',
                             'severity': 'alacsony', 'category': 'nem_ellenorizheto', 'sources': ['T01', 'T999']}]
        fc = self.factcheck(post)
        self.assertEqual(len(fc['issues']), 1)
        self.assertTrue(fc['issues'][0]['located'])
        self.assertEqual([s['id'] for s in fc['issues'][0]['sources']], ['T01'])  # ismeretlen azonosító eldobva
        self.assertIn('[T01]', self.llm_calls[-1]['system'])                      # a Tudástár a promptban van

        self.assertEqual(self.publish(post, token=fc['token']).status_code, 409)  # jelzés van, nincs nyugtázva
        r = self.publish(post, token=fc['token'], ignore_warnings=True)
        self.assertEqual(r.status_code, 200, r.text)
        published = r.json()['post']
        self.assertEqual(published['status'], 'published')
        self.assertFalse(published['has_unpublished_changes'])
        self.assertTrue(any(a == 'blog_published' and 'figyelmen kívül' in d for _, a, d in self.store.log))
        self.assertTrue(self.blog.posts[post['id']]['fact_check']['ignored_by'])

    def test_token_bound_to_content(self):
        self.editor()
        post = self.create()
        fc = self.factcheck(post)
        post = self.save(post, body_html='<p>Közben átírt szöveg.</p>').json()['post']
        self.assertEqual(self.publish(post, token=fc['token']).status_code, 409)
        fc = self.factcheck(post)
        self.assertEqual(self.publish(post, token=fc['token']).status_code, 200)

    def test_pending_fix_marks_block_publish(self):
        self.editor()
        post = self.create(body_html='<p><del class="sj-fix-old" data-fix="a">rosz</del><ins class="sj-fix-new" data-fix="a">rossz</ins></p>')
        fc = self.factcheck(post)
        r = self.publish(post, token=fc['token'])
        self.assertEqual(r.status_code, 409)
        self.assertIn('helyesírási', r.json()['detail'])

    def test_public_pages_show_only_published_snapshot(self):
        self.editor()
        post = self.create(author_display='Kovács Anna')
        self.assertEqual(self.client.get('/blog/%s' % post['slug']).status_code, 404)  # vázlat nem látszik
        post = self.publish(post, token=self.factcheck(post)['token']).json()['post']

        r = self.client.get('/blog/%s' % post['slug'])
        self.assertEqual(r.status_code, 200)
        self.assertIn("script-src 'self'", r.headers['content-security-policy'])
        self.assertIn('s-maxage', r.headers['cache-control'])
        page = r.text
        self.assertIn('<h1>Mit mond a tudomány?</h1>', page)
        self.assertIn('A hatékonyság nincs bizonyítva.', page)
        self.assertIn('Kovács Anna', page)
        self.assertIn('https://www.facebook.com/sharer/sharer.php?u=http%3A%2F%2Ftestserver%2Fblog%2Fmit-mond-a-tudomany', page)
        self.assertIn('https://x.com/intent/post?url=', page)
        self.assertIn('https://www.linkedin.com/sharing/share-offsite/?url=', page)
        self.assertIn('mailto:?subject=', page)
        self.assertIn('data-copy="http://testserver/blog/mit-mond-a-tudomany"', page)
        self.assertIn('<meta property="og:title" content="Mit mond a tudomány?">', page)

        # a publikált cikk szerkesztése nem látszik, amíg újra nem publikálják
        post = self.save(post, body_html='<p>Új, még nem ellenőrzött mondat.</p>').json()['post']
        self.assertTrue(post['has_unpublished_changes'])
        self.assertNotIn('még nem ellenőrzött', self.client.get('/blog/%s' % post['slug']).text)
        self.assertEqual(self.save(post, slug='mas-cim').status_code, 400)  # publikált webcím nem változhat

        listing = self.client.get('/blog').text
        self.assertIn('href="/blog/mit-mond-a-tudomany"', listing)
        self.assertIn('/blog/mit-mond-a-tudomany', self.client.get('/blog/sitemap.xml').text)
        self.assertIn('<title>Mit mond a tudomány?</title>', self.client.get('/blog/rss.xml').text)

        r = self.client.post('/api/admin/blog/posts/%s/unpublish' % post['id'], json={'version': post['version']}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.client.get('/blog/%s' % post['slug']).status_code, 404)

    def test_missing_tables_give_readable_503(self):
        class Broken:
            def __getattr__(self, name):
                def fail(*a, **kw):
                    raise RuntimeError('relation "public.blog_posts" does not exist')
                return fail

        _blog.store = _blog.GuardedStore(Broken())
        self.editor()
        r = self.client.get('/api/admin/blog/posts')
        self.assertEqual(r.status_code, 503)
        self.assertIn('2026-09-14_blog.sql', r.json()['detail'])
        self.assertEqual(self.client.get('/blog/sitemap.xml').status_code, 503)
        self.assertEqual(self.client.get('/blog').status_code, 503)

    def test_delete_only_drafts(self):
        self.editor()
        post = self.create()
        post = self.publish(post, token=self.factcheck(post)['token']).json()['post']
        self.assertEqual(self.client.post('/api/admin/blog/posts/%s/delete' % post['id'], headers=H).status_code, 400)
        draft = self.create()
        self.assertEqual(self.client.post('/api/admin/blog/posts/%s/delete' % draft['id'], headers=H).status_code, 200)
        self.assertNotIn(draft['id'], self.blog.posts)

    def test_image_upload_requires_rights_and_jpeg(self):
        self.editor()
        url = '/api/admin/blog/images'
        files = {'file': ('kep.jpg', TINY_JPEG, 'image/jpeg')}
        r = self.client.post(url, files=files, data={'rights': 'ai', 'alt': 'x'}, headers=H)
        self.assertEqual(r.status_code, 400)  # nincs megerősítés
        r = self.client.post(url, files=files, data={'rights': 'lopott', 'confirm': 'on'}, headers=H)
        self.assertEqual(r.status_code, 400)
        r = self.client.post(url, files={'file': ('x.jpg', b'<svg onload=x>', 'image/jpeg')},
                             data={'rights': 'ai', 'confirm': 'on'}, headers=H)
        self.assertEqual(r.status_code, 400)
        r = self.client.post(url, files=files, data={'rights': 'ai', 'confirm': 'on', 'alt': 'Generátor',
                                                     'credit': 'AI-generált illusztráció'}, headers=H)
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual((data['width'], data['height']), (3, 2))
        self.assertEqual(self.blog.images[data['id']]['rights'], 'ai')
        img = self.client.get(data['url'])
        self.assertEqual(img.status_code, 200)
        self.assertEqual(img.content, TINY_JPEG)
        self.assertIn('immutable', img.headers['cache-control'])
        self.assertEqual(self.client.get('/blog/kepek/%s.jpg' % uuid.uuid4()).status_code, 404)


if __name__ == '__main__':
    unittest.main()
