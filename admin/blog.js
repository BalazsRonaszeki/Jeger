/* Blog: bejegyzéslista és szerkesztő — helyesírás-ellenőrzés, tényellenőrzés, képfeltöltés,
   automatikus formázás, publikálás és megosztás. */
(function () {
  'use strict';
  var SJ = window.SJ;
  var $ = function (id) { return document.getElementById(id); };
  var ROLE = { admin: 'Adminisztrátor', editor: 'Szerkesztő' };
  var SEVERITY = { magas: 'Magas', kozepes: 'Közepes', alacsony: 'Alacsony' };
  var CATEGORY = {
    tudastarnak_ellentmond: 'Ellentmond a Tudástárnak',
    tulzo_allitas: 'Túlzó állítás',
    szemelyes_vad: 'Személyre szóló vád',
    nem_ellenorizheto: 'Nem ellenőrizhető'
  };
  var AI_CREDIT = 'AI-generált illusztráció';
  var AUTOSAVE_MS = 4000;

  var me = null;
  var aiReady = true;
  var currentView = null;
  var editor = $('editor');

  function node(tag, props, children) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') el.textContent = props[k];
      else if (k === 'class') el.className = props[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), props[k]);
      else el.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function handleAuthError(e) {
    if (e && e.status === 401) { location.replace('/admin/'); return true; }
    return false;
  }

  var msgTimer = 0;
  function flash(text, kind) {
    clearTimeout(msgTimer);
    SJ.showMsg($('edMsg'), text, kind);
    if (text && kind !== 'error') msgTimer = setTimeout(function () { SJ.showMsg($('edMsg'), ''); }, 9000);
  }

  function slugify(text) {
    return (text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90).replace(/-+$/, '');
  }

  function clockTime() {
    return new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  }

  /* ================================================================== indulás */
  (async function init() {
    try {
      var s = await SJ.api('/session');
      if (!s.authenticated) { location.replace('/admin/'); return; }
      me = s.user;
    } catch (e) {
      SJ.showMsg($('fatal'), e.status === 503 ? 'A belső felület még nincs beállítva a szerveren.' : e.message, 'error');
      return;
    }
    $('whoName').textContent = me.name || me.email;
    $('whoRole').textContent = ROLE[me.role] || me.role;
    $('navUsers').hidden = me.role !== 'admin';
    window.addEventListener('hashchange', route);
    route();
  })();

  $('logoutBtn').addEventListener('click', async function () {
    try { await saveNow(); } catch (e) { /* kilépünk így is */ }
    try { await SJ.api('/logout', { method: 'POST' }); } catch (e) { /* a süti úgyis lejár */ }
    location.replace('/admin/');
  });

  async function route() {
    var h = location.hash.replace(/^#/, '');
    if (currentView === 'editor' && isDirty()) {
      try { await saveNow(); } catch (e) { /* a hibaüzenet már megjelent */ }
    }
    hidePop();
    if (h === 'uj') openEditor(null);
    else if (h.indexOf('szerkeszt/') === 0) openEditor(h.slice('szerkeszt/'.length));
    else showList();
    window.scrollTo(0, 0);
  }

  function setView(name) {
    currentView = name;
    $('viewList').hidden = name !== 'list';
    $('viewEditor').hidden = name !== 'editor';
  }

  /* ================================================================== lista */
  async function showList() {
    setView('list');
    document.title = 'Blog — stopjeger.hu belső felület';
    var tbody = $('postsTable').querySelector('tbody');
    try {
      var data = await SJ.api('/blog/posts');
      aiReady = data.ai_ready;
      $('aiNote').hidden = aiReady;
      tbody.textContent = '';
      data.posts.forEach(function (p) {
        var badge = p.status === 'published' ? ['Publikálva', 'ok'] : p.published_at ? ['Visszavonva', 'warn'] : ['Vázlat', ''];
        var actions = node('div', { class: 'actions' }, [
          node('a', { class: 'btn btn-ghost btn-sm', href: '#szerkeszt/' + p.id, text: 'Szerkesztés' }),
          p.status === 'published' ? node('a', { class: 'btn btn-ghost btn-sm', href: '/blog/' + p.slug, target: '_blank', rel: 'noopener', text: 'Megnyitás ↗' }) : null
        ]);
        tbody.appendChild(node('tr', {}, [
          node('td', {}, [node('a', { href: '#szerkeszt/' + p.id, text: p.title || '(cím nélkül)' })]),
          node('td', {}, [node('span', { class: 'badge ' + badge[1], text: badge[0] })]),
          node('td', { text: SJ.dateTime(p.updated_at) }),
          node('td', { text: SJ.dateTime(p.published_at) }),
          node('td', { class: 'num' }, [actions])
        ]));
      });
      $('listEmpty').hidden = data.posts.length > 0;
      SJ.showMsg($('listMsg'), '');
    } catch (e) {
      if (handleAuthError(e)) return;
      SJ.showMsg($('listMsg'), e.status === 503 ? 'A blog adatbázisa még nincs beállítva (SQL-migráció).' : e.message, 'error');
    }
  }

  /* ================================================================== szerkesztő: állapot */
  var post = null;          // a szerver által utoljára visszaadott állapot
  var cover = { id: '', alt: '', credit: '' };
  var authors = [];          // aktív munkatársak névvel: {id, name, photo_id}
  var myProfile = null;      // {id, name, photo_id}
  var changeSeq = 0, savedSeq = 0;
  var saving = null, autosaveTimer = 0, conflict = false;
  var retryDelay = 0; // átmeneti szerverhiba után ennyi ms múlva újrapróbáljuk a mentést
  var slugTouched = false;
  var dirtyBlocks = new Set();
  var checkedFields = { title: '', excerpt: '' };
  var undoStack = [];
  var tracking = true;

  function isDirty() { return changeSeq !== savedSeq; }

  function hasContent() {
    return !!($('postTitle').value.trim() || $('postExcerpt').value.trim() || editor.textContent.trim() || editor.querySelector('img') || cover.id);
  }

  async function openEditor(id) {
    setView('editor');
    resetEditor();
    await loadAuthors();
    if (!id) {
      setAuthor(myProfile && myProfile.name ? myProfile.id : 'org', '');
      document.title = 'Új bejegyzés — stopjeger.hu belső felület';
      $('postTitle').focus();
      return;
    }
    try {
      var data = await SJ.api('/blog/posts/' + encodeURIComponent(id));
      aiReady = data.ai_ready;
      loadPost(data.post);
    } catch (e) {
      if (handleAuthError(e)) return;
      flash(e.status === 404 ? 'Ez a bejegyzés nem létezik (vagy törölték).' : e.message, 'error');
    }
  }

  function resetEditor() {
    post = null;
    cover = { id: '', alt: '', credit: '' };
    conflict = false;
    slugTouched = false;
    clearTimeout(autosaveTimer);
    ['postTitle', 'postExcerpt', 'postAuthor', 'postSlug'].forEach(function (f) { $(f).value = ''; });
    checkedFields = { title: '', excerpt: '' };
    dirtyBlocks.clear();
    undoStack = [];
    setEditorHtml('');
    ['titleFix', 'excerptFix'].forEach(function (f) { $(f).hidden = true; });
    $('factCard').hidden = true;
    clearHighlight();
    renderCover();
    changeSeq = savedSeq = 0;
    SJ.showMsg($('edMsg'), '');
    setSaveState('');
    updateMeta();
    updateUndo();
  }

  function loadPost(p) {
    post = p;
    $('postTitle').value = p.title || '';
    $('postExcerpt').value = p.excerpt || '';
    setAuthor(p.author_id || (p.author_display ? 'custom' : 'org'), p.author_display || '');
    $('postSlug').value = p.slug || '';
    slugTouched = true;
    checkedFields = { title: p.title || '', excerpt: p.excerpt || '' };
    cover = { id: p.cover_image || '', alt: p.cover_alt || '', credit: p.cover_credit || '' };
    renderCover();
    setEditorHtml(p.body_html);
    if (p.fact_check && p.fact_check.issues) renderFactCard(p.fact_check, p.fact_check_current);
    changeSeq = savedSeq = 0;
    document.title = (p.title || 'Bejegyzés') + ' — stopjeger.hu belső felület';
    setSaveState(p.updated_at ? 'Mentve: ' + SJ.dateTime(p.updated_at) : '');
    updateMeta();
  }

  function setEditorHtml(html) {
    withoutTracking(function () { editor.innerHTML = html || '<p><br></p>'; });
    updateFixBar();
    updateEmpty();
    updateExcerptCount();
  }

  function updateMeta() {
    var published = !!(post && post.status === 'published');
    var badge = $('edStatus');
    badge.textContent = !post ? 'Új vázlat' : published ? 'Publikálva' : post.published_at ? 'Visszavonva' : 'Vázlat';
    badge.className = 'badge ' + (published ? 'ok' : post && post.published_at ? 'warn' : '');
    var changes = published && (post.has_unpublished_changes || isDirty());
    $('btnPublish').textContent = published ? 'Módosítások publikálása…' : 'Publikálás…';
    $('btnPublish').disabled = published && !changes;
    $('btnPublish').title = published && !changes ? 'Nincs publikálatlan módosítás.' : '';
    $('btnUnpublish').hidden = !published;
    $('btnDelete').hidden = !post || published;
    $('postSlug').disabled = !!(post && post.published_at);
    $('slugHint').textContent = post && post.published_at
      ? 'A webcím az első publikálás óta rögzített, hogy a megosztott hivatkozások ne romoljanak el.'
      : 'A címből készül. Első publikálás után már nem változtatható, mert a megosztott hivatkozások elromlanának.';
    $('sharePanel').hidden = !published;
    $('shareChanges').hidden = !changes;
    if (published) renderShare();
  }

  function setSaveState(text) { $('saveState').textContent = text; }

  function onChange() {
    changeSeq++;
    if (!conflict) setSaveState('Nem mentett módosítások');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () { saveNow().catch(function () {}); }, AUTOSAVE_MS);
    if (post && post.status === 'published') { $('shareChanges').hidden = false; $('btnPublish').disabled = false; $('btnPublish').title = ''; }
  }

  function payload() {
    return {
      title: $('postTitle').value,
      excerpt: $('postExcerpt').value,
      slug: $('postSlug').value,
      author_id: authorChoice().id,
      author_display: authorChoice().display,
      body_html: editor.innerHTML,
      cover_image: cover.id,
      cover_alt: cover.alt,
      cover_credit: cover.credit,
      version: post ? post.version : 0
    };
  }

  function saveNow() {
    if (conflict) return Promise.reject(new Error('A bejegyzést közben más is módosította.'));
    if (saving) return saving.then(function () { return saveNow(); }, function () { return saveNow(); });
    if (post && !isDirty()) return Promise.resolve(post);
    if (!post && !hasContent()) return Promise.resolve(null);
    clearTimeout(autosaveTimer);
    var seq = changeSeq;
    setSaveState('Mentés…');
    saving = (async function () {
      try {
        var wasNew = !post;
        var res = wasNew
          ? await SJ.api('/blog/posts', { method: 'POST', body: payload() })
          : await SJ.api('/blog/posts/' + post.id, { method: 'POST', body: payload() });
        post = res.post;
        savedSeq = seq;
        if (wasNew) history.replaceState(null, '', '#szerkeszt/' + post.id);
        if (document.activeElement !== $('postSlug')) $('postSlug').value = post.slug;
        updateMeta();
        if (isDirty()) {
          setSaveState('Nem mentett módosítások');
          autosaveTimer = setTimeout(function () { saveNow().catch(function () {}); }, AUTOSAVE_MS);
        } else {
          setSaveState('Mentve ' + clockTime());
        }
        if (retryDelay) { retryDelay = 0; SJ.showMsg($('edMsg'), ''); }
        return post;
      } catch (e) {
        if (!handleAuthError(e)) {
          if (e.status === 409) {
            conflict = true;
            setSaveState('Nem mentve — ütközés');
            flash(e.message, 'error');
          } else if (e.status === 0 || e.status >= 500) {
            // Átmeneti kimaradás (pl. a Supabase átjárója nem válaszol): a szöveg a böngészőben
            // megvan, csendben újrapróbáljuk, egyre ritkábban.
            retryDelay = Math.min(retryDelay ? retryDelay * 2 : 5000, 60000);
            setSaveState('Nem sikerült menteni — újrapróbálom ' + Math.round(retryDelay / 1000) + ' mp múlva…');
            flash('A szerver átmenetileg nem válaszolt. A szöveged megvan, a mentést automatikusan újrapróbáljuk — ne zárd be a lapot.', '');
            clearTimeout(autosaveTimer);
            autosaveTimer = setTimeout(function () { saveNow().catch(function () {}); }, retryDelay);
          } else {
            setSaveState('A mentés nem sikerült');
            flash(e.message, 'error');
          }
        }
        throw e;
      } finally {
        saving = null;
      }
    })();
    return saving;
  }

  window.addEventListener('beforeunload', function (ev) {
    if (currentView === 'editor' && isDirty() && hasContent()) { ev.preventDefault(); ev.returnValue = ''; }
  });

  document.addEventListener('keydown', function (ev) {
    if (currentView !== 'editor') return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      saveNow().catch(function () {});
    }
    if (ev.key === 'Escape') hidePop();
  });

  $('btnSave').addEventListener('click', function () {
    saveNow().then(function (p) { if (p) flash('Mentve.', 'ok'); }).catch(function () {});
  });

  $('postTitle').addEventListener('input', function () {
    if (!slugTouched && !(post && post.published_at)) $('postSlug').value = slugify($('postTitle').value);
    onChange();
  });
  $('postSlug').addEventListener('input', function () { slugTouched = true; onChange(); });
  $('postSlug').addEventListener('blur', function () { $('postSlug').value = slugify($('postSlug').value); });
  $('postAuthor').addEventListener('input', onChange);
  $('postAuthorSel').addEventListener('change', function () {
    setAuthor($('postAuthorSel').value, $('postAuthor').value);
    if ($('postAuthorSel').value === 'custom') $('postAuthor').focus();
    onChange();
  });

  /* ================================================================== szerző és profil */
  async function loadAuthors() {
    try {
      var data = await SJ.api('/blog/authors');
      authors = data.authors;
      myProfile = data.me;
    } catch (e) {
      if (handleAuthError(e)) return;
      authors = [];
      myProfile = { id: me.id, name: me.name || '', photo_id: null };
      flash(e.message, 'error');
    }
  }

  function renderAuthorOptions(selected) {
    var sel = $('postAuthorSel');
    sel.textContent = '';
    var list = authors.slice();
    if (myProfile && !list.some(function (a) { return a.id === myProfile.id; })) {
      list.unshift({ id: myProfile.id, name: myProfile.name || '(még nincs megadva a neved)', photo_id: myProfile.photo_id });
    }
    list.forEach(function (a) {
      var label = a.name + (myProfile && a.id === myProfile.id ? ' (te)' : '');
      sel.appendChild(node('option', { value: a.id, text: label }));
    });
    if (selected && selected !== 'org' && selected !== 'custom' && !list.some(function (a) { return a.id === selected; })) {
      sel.appendChild(node('option', { value: selected, text: 'Korábbi munkatárs' }));
    }
    sel.appendChild(node('option', { value: 'org', text: 'STOP JÉGER-kezdeményezés (szervezet)' }));
    sel.appendChild(node('option', { value: 'custom', text: 'Más szerző (név megadása)…' }));
    sel.value = selected;
  }

  function authorById(id) {
    if (myProfile && myProfile.id === id) return myProfile;
    return authors.filter(function (a) { return a.id === id; })[0] || null;
  }

  function setAuthor(choice, customName) {
    renderAuthorOptions(choice);
    $('postAuthor').hidden = choice !== 'custom';
    $('postAuthor').value = choice === 'custom' ? customName : '';
    var person = authorById(choice);
    var avatar = $('authorAvatar');
    avatar.textContent = '';
    avatar.className = 'avatar';
    if (person && person.photo_id) {
      avatar.appendChild(node('img', { src: '/blog/kepek/' + person.photo_id + '.jpg', alt: '' }));
    } else {
      avatar.className = 'avatar avatar-empty';
      avatar.textContent = choice === 'org' ? 'SJ' : initials(person ? person.name : customName);
    }
    var mine = !!(myProfile && choice === myProfile.id);
    $('profileBox').hidden = !mine;
    if (mine) {
      $('profileName').value = myProfile.name || '';
      $('profilePhoto').textContent = myProfile.photo_id ? 'Fotó cseréje' : 'Fotó feltöltése';
      $('profilePhotoRemove').hidden = !myProfile.photo_id;
    }
  }

  function initials(name) {
    return (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('');
  }

  function authorChoice() {
    var v = $('postAuthorSel').value;
    if (v === 'org') return { id: '', display: '' };
    if (v === 'custom') return { id: '', display: $('postAuthor').value };
    return { id: v, display: '' };
  }

  async function saveProfile(extra) {
    var body = Object.assign({ name: $('profileName').value }, extra || {});
    var res = await SJ.api('/blog/me', { method: 'POST', body: body });
    myProfile = res.me;
    await loadAuthors();
    setAuthor($('postAuthorSel').value, $('postAuthor').value);
    onChange(); // a bejegyzés a szerző friss nevét és fotóját a következő mentéskor veszi át
    return res.me;
  }

  $('profileSave').addEventListener('click', async function () {
    var done = busyButton($('profileSave'), 'Mentés…');
    try {
      await saveProfile();
      flash('A profilod elmentve.', 'ok');
    } catch (e) {
      if (!handleAuthError(e)) flash(e.message, 'error');
    } finally {
      done();
    }
  });

  $('profilePhoto').addEventListener('click', function () {
    if (!$('profileName').value.trim()) { flash('Előbb add meg a neved.', 'error'); $('profileName').focus(); return; }
    openImageDialog('profile');
  });

  $('profilePhotoRemove').addEventListener('click', async function () {
    try {
      await saveProfile({ photo_id: '' });
      flash('A profilfotód eltávolítva.', 'ok');
    } catch (e) {
      if (!handleAuthError(e)) flash(e.message, 'error');
    }
  });
  $('postExcerpt').addEventListener('input', function () { updateExcerptCount(); onChange(); });

  function updateExcerptCount() { $('excerptCount').textContent = $('postExcerpt').value.length; }

  /* ================================================================== szerkesztő: követés */
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* régi böngésző */ }

  var observer = new MutationObserver(function (mutations) {
    if (!tracking) return;
    mutations.forEach(function (m) {
      markDirty(m.target);
      m.addedNodes.forEach(markDirty);
    });
    updateFixBar();
    onChange();
  });
  observer.observe(editor, { childList: true, subtree: true, characterData: true });

  function withoutTracking(fn) {
    tracking = false;
    try { fn(); } finally { observer.takeRecords(); tracking = true; }
  }

  function topBlock(n) {
    while (n && n.parentNode !== editor) n = n.parentNode;
    return n && n.parentNode === editor ? n : null;
  }

  function markDirty(n) {
    if (n === editor) return;
    var b = topBlock(n);
    if (b && b.nodeType === 1) dirtyBlocks.add(b);
  }

  function editorRange() {
    var sel = window.getSelection();
    if (!sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    return editor.contains(r.commonAncestorContainer) ? r : null;
  }

  function caretOffset() {
    var r = editorRange();
    if (!r) return null;
    var pre = document.createRange();
    pre.selectNodeContents(editor);
    pre.setEnd(r.endContainer, r.endOffset);
    return pre.toString().length;
  }

  function restoreCaret(offset) {
    if (offset === null) return;
    var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    var n, seen = 0, last = null;
    while ((n = walker.nextNode())) {
      last = n;
      if (seen + n.data.length >= offset) {
        var r = document.createRange();
        r.setStart(n, offset - seen);
        r.collapse(true);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
      seen += n.data.length;
    }
    if (last) restoreCaret(seen);
  }

  var BLOCK_RE = /^(P|H2|H3|UL|OL|BLOCKQUOTE|FIGURE|HR)$/;

  /* A böngésző néha blokk nélküli szöveget hagy a szerkesztő gyökerében (pl. mindent kijelölve
     és törölve) — ezeket bekezdésbe tesszük, a kurzor helyét megtartva. */
  function normalizeTop() {
    var stray = Array.prototype.some.call(editor.childNodes, function (n) {
      return (n.nodeType === 3 && n.data.trim()) || (n.nodeType === 1 && !BLOCK_RE.test(n.nodeName));
    });
    if (!stray) {
      if (!editor.firstChild) withoutTracking(function () { editor.innerHTML = '<p><br></p>'; });
      return;
    }
    var caret = caretOffset();
    wrapStray();
    restoreCaret(caret);
  }

  function wrapStray() {
    var run = null;
    Array.prototype.slice.call(editor.childNodes).forEach(function (n) {
      var block = n.nodeType === 1 && BLOCK_RE.test(n.nodeName);
      if (n.nodeType === 1 && n.nodeName === 'DIV') {
        var p = document.createElement('p');
        p.setAttribute('data-sj-dirty', '1');
        while (n.firstChild) p.appendChild(n.firstChild);
        editor.replaceChild(p, n);
        run = null;
        return;
      }
      if (block) { run = null; return; }
      if (n.nodeType === 3 && !n.data.trim() && !run) { editor.removeChild(n); return; }
      if (n.nodeType !== 1 && n.nodeType !== 3) return;
      if (!run) { run = document.createElement('p'); run.setAttribute('data-sj-dirty', '1'); editor.insertBefore(run, n); }
      run.appendChild(n);
    });
  }

  function updateEmpty() {
    editor.classList.toggle('is-empty', !editor.textContent.trim() && !editor.querySelector('img'));
  }

  editor.addEventListener('input', function () {
    normalizeTop();
    updateEmpty();
    clearHighlight();
  });

  /* ================================================================== beillesztés */
  var DROP_TAGS = /^(SCRIPT|STYLE|META|LINK|TITLE|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|MATH|NOSCRIPT|BUTTON|INPUT|SELECT|TEXTAREA|CANVAS|VIDEO|AUDIO|HEAD)$/;
  var PASTE_BLOCKS = { P: 'p', H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3', BLOCKQUOTE: 'blockquote', UL: 'ul', OL: 'ol', LI: 'li' };

  function hasBlockChild(el) {
    return !!el.querySelector('p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,div,table,section,article');
  }

  function cleanInto(src, dst, stats) {
    Array.prototype.forEach.call(src.childNodes, function (n) {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(plainLetters(n.data.replace(/[\r\n]+/g, ' ')))); return; }
      if (n.nodeType !== 1 || DROP_TAGS.test(n.nodeName)) return;
      var tag = n.nodeName;
      if (tag === 'IMG' || tag === 'PICTURE') { stats.images++; return; }
      if (tag === 'BR') { dst.appendChild(document.createElement('br')); return; }
      var style = (n.getAttribute('style') || '').toLowerCase();
      var target = null, inner = null;
      if (PASTE_BLOCKS[tag]) {
        target = document.createElement(PASTE_BLOCKS[tag]);
      } else if (tag === 'STRONG' || (tag === 'B' && !/font-weight:\s*(normal|[1-5]00)/.test(style))) {
        target = document.createElement('strong');
      } else if (tag === 'EM' || tag === 'I') {
        target = document.createElement('em');
      } else if (tag === 'A' && /^(https?:|mailto:)/i.test(n.getAttribute('href') || '')) {
        target = document.createElement('a');
        target.setAttribute('href', n.getAttribute('href'));
      } else if (tag === 'SPAN' && (/font-weight:\s*(bold|[6-9]00)/.test(style) || /font-style:\s*italic/.test(style))) {
        var bold = /font-weight:\s*(bold|[6-9]00)/.test(style), italic = /font-style:\s*italic/.test(style);
        target = document.createElement(bold ? 'strong' : 'em');
        if (bold && italic) { inner = document.createElement('em'); target.appendChild(inner); }
      } else if (/^(DIV|SECTION|ARTICLE|TD|TH|DD|DT|FIGCAPTION|CAPTION)$/.test(tag) && !hasBlockChild(n)) {
        target = document.createElement('p');
      }
      if (!target) { cleanInto(n, dst, stats); return; }
      cleanInto(n, inner || target, stats);
      if (target.textContent.trim()) dst.appendChild(target);
    });
  }

  function listMarker(text) {
    var m = /^\s*([-–—•*▪●◦])\s+/.exec(text);
    if (m) return { type: 'ul', length: m[0].length };
    m = /^\s*(\d{1,3})[.)]\s+/.exec(text);
    return m ? { type: 'ol', length: m[0].length } : null;
  }

  /* „Díszes szöveg”-generátorok betűi (𝐁𝐨𝐥𝐝, 𝓦𝓲𝓷𝓰, Ｗｉｄｅ, Ⓐ): normál betűre cseréljük, mint a szerver is. */
  function plainLetters(s) {
    return s.replace(/[\u{1D400}-\u{1D7FF}\uFF01-\uFF5E\u24B6-\u24E9\u{1F130}-\u{1F149}]/gu, function (c) { return c.normalize('NFKC'); });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function textToHtml(text) {
    text = text.replace(/\r\n?/g, '\n').trim();
    if (!text) return '';
    var chunks;
    if (/\n[ \t]*\n/.test(text)) {
      chunks = text.split(/\n[ \t]*\n+/).map(function (chunk) {
        var lines = chunk.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
        // listát soronként hagyunk, hogy a Formázás felismerje; a tördelt prózát egy sorba tesszük
        return lines.length > 1 && lines.every(listMarker)
          ? lines.map(escapeHtml).join('<br>')
          : escapeHtml(lines.join(' '));
      });
    } else {
      chunks = text.split('\n').map(function (l) { return escapeHtml(l.trim()); });
    }
    return chunks.filter(Boolean).map(function (c) { return '<p>' + c + '</p>'; }).join('');
  }

  editor.addEventListener('paste', function (ev) {
    var cd = ev.clipboardData;
    if (!cd) return;
    ev.preventDefault();
    var html = cd.getData('text/html');
    var text = plainLetters(cd.getData('text/plain'));
    var out = '', images = 0;
    if (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var holder = document.createElement('div');
      var stats = { images: 0 };
      cleanInto(doc.body, holder, stats);
      out = holder.innerHTML;
      images = stats.images;
    }
    if (!out.trim()) out = textToHtml(text);
    if (!out) return;
    if (/^<p>[^<]*<\/p>$/.test(out) && text && text.indexOf('\n') === -1) {
      document.execCommand('insertText', false, text);
    } else {
      document.execCommand('insertHTML', false, out);
    }
    if (images) flash('A beillesztett szövegben ' + images + ' kép volt — ezeket kihagytuk. Képet a „Kép” gombbal tölts fel, hogy a jogcíme is rögzüljön.', '');
  });

  editor.addEventListener('drop', function (ev) {
    if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
      ev.preventDefault();
      flash('Képet a „Kép” gombbal tölts fel — ott kell megadni a kép jogcímét is.', '');
    }
  });

  /* ================================================================== eszköztár */
  document.querySelectorAll('.toolbar .tb').forEach(function (b) {
    b.addEventListener('mousedown', function (ev) { ev.preventDefault(); }); // a kijelölés maradjon a szövegben
  });

  document.querySelectorAll('.tb[data-block]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!editorRange()) editor.focus();
      var tag = b.dataset.block;
      var r = editorRange();
      var inside = r && topBlock(r.startContainer);
      if (inside && inside.nodeName.toLowerCase() === tag && tag !== 'p') tag = 'p';
      document.execCommand('formatBlock', false, '<' + tag + '>');
    });
  });

  document.querySelectorAll('.tb[data-cmd]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.cmd === 'link') return insertLink();
      if (!editorRange()) editor.focus();
      document.execCommand(b.dataset.cmd, false, null);
    });
  });

  function insertLink() {
    var r = editorRange();
    if (!r || r.collapsed) { flash('Jelöld ki a szöveget, amiből hivatkozás legyen.', ''); return; }
    var saved = r.cloneRange();
    var anchor = r.startContainer.parentElement && r.startContainer.parentElement.closest('a');
    var url = window.prompt('A hivatkozás címe (üresen hagyva a hivatkozás törlődik):', anchor ? anchor.getAttribute('href') : 'https://');
    if (url === null) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(saved);
    url = url.trim();
    if (!url || url === 'https://') { document.execCommand('unlink'); return; }
    if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) url = 'https://' + url;
    document.execCommand('createLink', false, url);
  }

  /* ================================================================== visszavonás (automatikus műveletek) */
  function snapshot() {
    var dirty = [];
    Array.prototype.forEach.call(editor.children, function (b, i) { if (dirtyBlocks.has(b)) dirty.push(i); });
    undoStack.push({ html: editor.innerHTML, title: $('postTitle').value, excerpt: $('postExcerpt').value, dirty: dirty });
    if (undoStack.length > 20) undoStack.shift();
    updateUndo();
  }

  function updateUndo() { $('btnUndo').disabled = undoStack.length === 0; }

  $('btnUndo').addEventListener('click', function () {
    var s = undoStack.pop();
    if (!s) return;
    withoutTracking(function () { editor.innerHTML = s.html; });
    dirtyBlocks.clear();
    s.dirty.forEach(function (i) { if (editor.children[i]) dirtyBlocks.add(editor.children[i]); });
    $('postTitle').value = s.title;
    $('postExcerpt').value = s.excerpt;
    updateExcerptCount();
    updateFixBar();
    updateEmpty();
    updateUndo();
    onChange();
    flash('Visszavonva.', 'ok');
  });

  /* ================================================================== szövegtérkép */
  /* Egy elem szövege és a karakterpozíciók visszakereshetősége a DOM-ban. A javításra jelölt régi
     szöveg (del.sj-fix-old) kimarad, a sortörés egy virtuális '\n'. */
  function textMap(root) {
    var parts = [], text = '';
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
        if (n.nodeName === 'BR') return NodeFilter.FILTER_ACCEPT;
        if (n.nodeName === 'DEL' && n.classList.contains('sj-fix-old')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 1) { parts.push({ node: null, start: text.length, len: 1 }); text += '\n'; }
      else { parts.push({ node: n, start: text.length, len: n.data.length }); text += n.data; }
    }
    return { text: text, parts: parts };
  }

  function pointAt(map, offset, atEnd) {
    var last = null;
    for (var i = 0; i < map.parts.length; i++) {
      var p = map.parts[i];
      if (!p.node) continue;
      last = p;
      var end = p.start + p.len;
      if (offset < end || (atEnd && offset === end)) {
        return { node: p.node, offset: Math.max(0, offset - p.start) };
      }
    }
    return last ? { node: last.node, offset: last.len } : null;
  }

  function rangeFor(root, start, end) {
    var map = textMap(root);
    var a = pointAt(map, start, false), b = pointAt(map, end, true);
    if (!a || !b) return null;
    var r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  }

  function unitsOf(block) {
    if (block.nodeName === 'UL' || block.nodeName === 'OL') {
      return Array.prototype.filter.call(block.children, function (li) { return li.nodeName === 'LI'; });
    }
    if (block.nodeName === 'BLOCKQUOTE') {
      var kids = Array.prototype.filter.call(block.children, function (k) { return /^(P|H2|H3)$/.test(k.nodeName); });
      return kids.length ? kids : [block];
    }
    if (block.nodeName === 'FIGURE') {
      var cap = block.querySelector('figcaption');
      return cap ? [cap] : [];
    }
    if (block.nodeName === 'HR') return [];
    return [block];
  }

  /* ================================================================== helyesírás */
  /* A módosítás legkisebb, egész szavakra kerekített része: így „csak egy szó” is jelölhető. */
  function narrow(a, b) {
    var max = Math.min(a.length, b.length), p = 0, s = 0;
    while (p < max && a[p] === b[p]) p++;
    while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    while (p > 0 && !/\s/.test(a[p - 1])) p--;
    while (s > 0 && !/\s/.test(a[a.length - s])) s--;
    return { start: p, oldEnd: a.length - s, newText: b.slice(p, b.length - s) };
  }

  function planCorrections(text, corrections) {
    var cursor = 0, spans = [];
    corrections.forEach(function (c) {
      var pos = text.indexOf(c.original, cursor);
      if (pos < 0) pos = text.indexOf(c.original);
      if (pos < 0) return;
      var d = narrow(c.original, c.replacement);
      var span = { s: pos + d.start, e: pos + d.oldEnd, text: d.newText, reason: c.reason, old: text.slice(pos + d.start, pos + d.oldEnd) };
      if (spans.some(function (x) { return span.s < x.e && span.e > x.s; })) return;
      spans.push(span);
      cursor = pos + c.original.length;
    });
    return spans;
  }

  var fixSeq = 0;
  function newFixId() { fixSeq++; return 'f' + Date.now().toString(36).slice(-6) + fixSeq.toString(36); }

  function applyCorrections(el, text, corrections) {
    var spans = planCorrections(text, corrections).sort(function (x, y) { return y.s - x.s; });
    spans.forEach(function (sp) {
      var r = rangeFor(el, sp.s, sp.e);
      if (!r) return;
      var id = newFixId();
      var ins = null;
      if (sp.text) {
        ins = node('ins', { class: 'sj-fix-new', 'data-fix': id, title: sp.reason, text: sp.text });
      }
      var fragment = r.extractContents();
      if (ins) r.insertNode(ins);
      if (fragment.textContent) {
        var del = node('del', { class: 'sj-fix-old', 'data-fix': id, title: sp.reason });
        del.appendChild(fragment);
        r.insertNode(del);
      }
    });
    return spans.length;
  }

  function selectionBlocks() {
    var r = editorRange();
    if (!r || r.collapsed) return [];
    return Array.prototype.filter.call(editor.children, function (b) { return r.intersectsNode(b); });
  }

  function busyButton(btn, label) {
    var original = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.textContent = label;
    return function () { btn.disabled = false; btn.classList.remove('is-busy'); btn.textContent = original; };
  }

  $('btnSpell').addEventListener('click', spellcheck);

  async function spellcheck() {
    hidePop();
    if (!aiReady) { flash('A helyesírás-ellenőrzés még nincs beállítva a szerveren.', 'error'); return; }
    var blocks = selectionBlocks(), scope = 'a kijelölt bekezdésekben';
    if (!blocks.length) {
      blocks = Array.from(dirtyBlocks).filter(function (b) { return b.parentNode === editor; });
      scope = 'a módosított részekben';
    }
    var fields = ['title', 'excerpt'].filter(function (f) {
      var v = (f === 'title' ? $('postTitle') : $('postExcerpt')).value;
      return v.trim() && v !== checkedFields[f];
    });
    if (!blocks.length && !fields.length) {
      if (!editor.textContent.trim()) { flash('Még nincs mit ellenőrizni.', ''); return; }
      if (!window.confirm('Az utolsó ellenőrzés óta nem módosult a szöveg. Ellenőrizzem a teljes bejegyzést?')) return;
      blocks = Array.from(editor.children);
      scope = 'a teljes szövegben';
    }

    var units = [];
    blocks.forEach(function (b) {
      unitsOf(b).forEach(function (u) {
        var t = textMap(u).text;
        if (t.trim()) units.push({ id: 'b' + (units.length + 1), el: u, block: b, text: t });
      });
    });
    fields.forEach(function (f) {
      units.push({ id: f, field: f, text: (f === 'title' ? $('postTitle') : $('postExcerpt')).value });
    });
    if (!units.length) { blocks.forEach(function (b) { dirtyBlocks.delete(b); }); flash('Nincs ellenőrizhető szöveg.', ''); return; }

    var chunks = [], current = [], size = 0;
    units.forEach(function (u) {
      if (size + u.text.length > 8000 && current.length) { chunks.push(current); current = []; size = 0; }
      current.push(u);
      size += u.text.length;
    });
    if (current.length) chunks.push(current);

    var done = busyButton($('btnSpell'), 'Ellenőrzés…');
    var results = {};
    try {
      for (var i = 0; i < chunks.length; i++) {
        var res = await SJ.api('/blog/spellcheck', { method: 'POST', body: { blocks: chunks[i].map(function (u) { return { id: u.id, text: u.text }; }) } });
        res.blocks.forEach(function (b) { results[b.id] = b.corrections; });
      }
    } catch (e) {
      done();
      if (!handleAuthError(e)) flash(e.message, 'error');
      return;
    }
    done();

    var total = 0, skipped = 0, snapped = false;
    var stale = new Set();
    units.forEach(function (u) {
      var fixes = results[u.id];
      if (u.field) {
        checkedFields[u.field] = u.text;
        if (fixes && fixes.length) { total += fixes.length; showFieldFix(u.field, u.text, fixes); }
        return;
      }
      if (textMap(u.el).text !== u.text || !u.el.isConnected) { stale.add(u.block); skipped++; return; }
      if (!fixes || !fixes.length) return;
      if (!snapped) { snapshot(); snapped = true; }
      withoutTracking(function () { total += applyCorrections(u.el, u.text, fixes); });
    });
    blocks.forEach(function (b) { if (!stale.has(b)) dirtyBlocks.delete(b); });
    updateFixBar();
    if (snapped) onChange();

    var note = skipped ? ' (' + skipped + ' bekezdést közben átírtál — azt a következő ellenőrzés nézi meg)' : '';
    if (total) flash(total + ' javítási javaslat ' + scope + '. Kékkel az új, pirossal áthúzva a régi szöveg — kattints rájuk a döntéshez.' + note, 'ok');
    else flash('Nem találtunk hibát ' + scope + '.' + note, 'ok');
  }

  function showFieldFix(field, text, corrections) {
    var box = $(field + 'Fix');
    var input = field === 'title' ? $('postTitle') : $('postExcerpt');
    var spans = planCorrections(text, corrections).sort(function (x, y) { return x.s - y.s; });
    if (!spans.length) return;
    var corrected = '', pos = 0, preview = node('span', { class: 'field-fix-text' });
    spans.forEach(function (sp) {
      corrected += text.slice(pos, sp.s) + sp.text;
      preview.appendChild(document.createTextNode(text.slice(pos, sp.s)));
      if (sp.old) preview.appendChild(node('del', { class: 'sj-fix-old', text: sp.old }));
      if (sp.text) preview.appendChild(node('ins', { class: 'sj-fix-new', text: sp.text }));
      pos = sp.e;
    });
    corrected += text.slice(pos);
    preview.appendChild(document.createTextNode(text.slice(pos)));
    var reasons = spans.map(function (sp) { return sp.reason; }).filter(Boolean).join(' · ');
    box.textContent = '';
    box.appendChild(node('span', { class: 'field-fix-label', text: field === 'title' ? 'Javaslat a címre:' : 'Javaslat a bevezetőre:' }));
    box.appendChild(preview);
    if (reasons) box.appendChild(node('span', { class: 'hint', text: reasons }));
    box.appendChild(node('span', { class: 'fix-actions' }, [
      node('button', { type: 'button', class: 'btn btn-sm', text: 'Elfogadom', onclick: function () {
        if (input.value === text) {
          input.value = corrected;
          checkedFields[field] = corrected;
          input.dispatchEvent(new Event('input'));
        } else {
          flash('A mezőt közben átírtad, ezért a javaslat már nem alkalmazható.', '');
        }
        box.hidden = true;
      } }),
      node('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Elvetem', onclick: function () { box.hidden = true; } })
    ]));
    box.hidden = false;
  }

  /* ---- javaslatok elfogadása / elvetése ---- */
  function fixMarks() { return editor.querySelectorAll('ins.sj-fix-new, del.sj-fix-old'); }

  function fixCount() {
    var ids = new Set();
    fixMarks().forEach(function (m) { ids.add(m.getAttribute('data-fix') || m); });
    return ids.size;
  }

  function updateFixBar() {
    var n = fixCount();
    $('fixCount').textContent = n;
    $('fixBar').hidden = n === 0;
  }

  function unwrap(el) {
    var parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }

  function resolveMark(m, accept) {
    if (!m.isConnected) return;
    var keep = accept ? m.nodeName === 'INS' : m.nodeName === 'DEL';
    if (keep) unwrap(m);
    else { var parent = m.parentNode; parent.removeChild(m); parent.normalize(); }
  }

  function resolveFix(id, accept) {
    withoutTracking(function () {
      Array.prototype.slice.call(editor.querySelectorAll('[data-fix]')).forEach(function (m) {
        if (m.getAttribute('data-fix') === id) resolveMark(m, accept);
      });
    });
    hidePop();
    updateFixBar();
    onChange();
  }

  function resolveAll(accept) {
    if (!fixCount()) return;
    snapshot();
    withoutTracking(function () {
      Array.prototype.slice.call(fixMarks()).forEach(function (m) { resolveMark(m, accept); });
    });
    hidePop();
    updateFixBar();
    onChange();
    flash(accept ? 'Minden javítás elfogadva.' : 'Minden javítás elvetve.', 'ok');
  }

  $('fixAcceptAll').addEventListener('click', function () { resolveAll(true); });
  $('fixRejectAll').addEventListener('click', function () { resolveAll(false); });

  var popFix = null;
  editor.addEventListener('click', function (ev) {
    var mark = ev.target.closest && ev.target.closest('ins.sj-fix-new, del.sj-fix-old');
    if (!mark || !editor.contains(mark)) { hidePop(); return; }
    openPop(mark);
  });

  function openPop(mark) {
    var id = mark.getAttribute('data-fix');
    var pop = $('fixPop');
    var oldText = '', newText = '';
    editor.querySelectorAll('[data-fix]').forEach(function (m) {
      if (m.getAttribute('data-fix') !== id) return;
      if (m.nodeName === 'DEL') oldText += m.textContent; else newText += m.textContent;
    });
    popFix = { id: id, mark: mark };
    var reason = $('fixPopReason');
    reason.textContent = '';
    reason.appendChild(node('del', { class: 'sj-fix-old', text: oldText || '∅' }));
    reason.appendChild(document.createTextNode(' → '));
    reason.appendChild(node('ins', { class: 'sj-fix-new', text: newText || '(törlés)' }));
    if (mark.title) reason.appendChild(node('span', { class: 'hint fix-pop-why', text: mark.title }));
    pop.hidden = false;
    var rect = mark.getBoundingClientRect();
    var left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, rect.left + window.scrollX));
    pop.style.left = left + 'px';
    pop.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  }

  function hidePop() { $('fixPop').hidden = true; popFix = null; }

  $('fixPopAccept').addEventListener('click', function () {
    if (!popFix) return;
    if (popFix.id) resolveFix(popFix.id, true);
    else { withoutTracking(function () { resolveMark(popFix.mark, true); }); hidePop(); updateFixBar(); onChange(); }
  });
  $('fixPopReject').addEventListener('click', function () {
    if (!popFix) return;
    if (popFix.id) resolveFix(popFix.id, false);
    else { withoutTracking(function () { resolveMark(popFix.mark, false); }); hidePop(); updateFixBar(); onChange(); }
  });
  document.addEventListener('mousedown', function (ev) {
    if (!$('fixPop').hidden && !$('fixPop').contains(ev.target) && !editor.contains(ev.target)) hidePop();
  });

  /* ================================================================== automatikus formázás */
  $('btnFormat').addEventListener('click', autoformat);

  function rename(el, tag) {
    var repl = document.createElement(tag);
    if (el.hasAttribute('data-sj-dirty')) repl.setAttribute('data-sj-dirty', '1');
    while (el.firstChild) repl.appendChild(el.firstChild);
    el.parentNode.replaceChild(repl, el);
    return repl;
  }

  function lineNodesByBr(p) {
    var lines = [[]];
    Array.prototype.slice.call(p.childNodes).forEach(function (n) {
      if (n.nodeName === 'BR') lines.push([]);
      else lines[lines.length - 1].push(n);
    });
    return lines;
  }

  function nodesText(nodes) {
    return nodes.map(function (n) { return n.textContent; }).join('');
  }

  function stripLeading(el, count) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var n;
    while (count > 0 && (n = walker.nextNode())) {
      var take = Math.min(count, n.data.length);
      n.data = n.data.slice(take);
      count -= take;
    }
  }

  function makeList(type, lineGroups) {
    var list = document.createElement(type);
    lineGroups.forEach(function (nodes) {
      var li = document.createElement('li');
      nodes.forEach(function (n) { li.appendChild(n); });
      var marker = listMarker(li.textContent);
      if (marker) stripLeading(li, marker.length);
      if (li.textContent.trim()) list.appendChild(li);
    });
    return list;
  }

  function autoformat() {
    hidePop();
    if (!editor.textContent.trim()) { flash('Még nincs mit formázni.', ''); return; }
    snapshot();
    var stats = { headings: 0, lists: 0, typo: 0, title: false, excerpt: false };

    // A még nem ellenőrzött blokkok jelölése túléli az átalakítást (új elemek keletkeznek).
    withoutTracking(function () {
      dirtyBlocks.forEach(function (b) { if (b.parentNode === editor) b.setAttribute('data-sj-dirty', '1'); });
    });
    withoutTracking(function () {
      // 1. idegen formázás ki (a javítási jelölések maradnak)
      Array.prototype.slice.call(editor.querySelectorAll('*')).forEach(function (el) {
        if (!el.isConnected || el.matches('ins.sj-fix-new, del.sj-fix-old')) return;
        ['style', 'class', 'id', 'dir', 'lang', 'align'].forEach(function (a) { el.removeAttribute(a); });
        var tag = el.nodeName;
        if (tag === 'SPAN' || tag === 'FONT' || tag === 'U') unwrap(el);
        else if (tag === 'B') rename(el, 'strong');
        else if (tag === 'I') rename(el, 'em');
        else if (tag === 'H1') rename(el, 'h2');
        else if (/^H[4-6]$/.test(tag)) rename(el, 'h3');
      });
      wrapStray();

      // 2. sortörésekkel tagolt bekezdések: lista, vagy üres soroknál új bekezdés
      Array.prototype.slice.call(editor.children).forEach(function (p) {
        if (p.nodeName !== 'P' || !p.querySelector('br')) return;
        var lines = lineNodesByBr(p);
        var filled = lines.filter(function (l) { return nodesText(l).trim(); });
        var markers = filled.map(function (l) { return listMarker(nodesText(l)); });
        if (filled.length >= 2 && markers.every(function (m) { return m && m.type === markers[0].type; })) {
          p.parentNode.replaceChild(inheritDirty(makeList(markers[0].type, filled), [p]), p);
          stats.lists++;
          return;
        }
        if (lines.some(function (l) { return !nodesText(l).trim(); })) {
          var groups = [[]];
          lines.forEach(function (l) {
            if (!nodesText(l).trim()) { if (groups[groups.length - 1].length) groups.push([]); return; }
            groups[groups.length - 1].push(l);
          });
          groups.filter(function (g) { return g.length; }).forEach(function (g) {
            var np = inheritDirty(document.createElement('p'), [p]);
            g.forEach(function (l, i) {
              if (i) np.appendChild(document.createElement('br'));
              l.forEach(function (n) { np.appendChild(n); });
            });
            p.parentNode.insertBefore(np, p);
          });
          p.parentNode.removeChild(p);
        }
        // a bekezdés végén maradt, felesleges sortörés
        var last = p.isConnected ? p.lastChild : null;
        if (last && last.nodeName === 'BR' && p.childNodes.length > 1) p.removeChild(last);
      });

      // 3. egymást követő, jelölővel kezdődő bekezdések -> lista
      var run = [];
      function flushRun() {
        if (run.length >= 2) {
          var type = listMarker(run[0].textContent).type;
          var list = inheritDirty(makeList(type, run.map(function (p) { return Array.prototype.slice.call(p.childNodes); })), run);
          run[0].parentNode.insertBefore(list, run[0]);
          run.forEach(function (p) { p.parentNode.removeChild(p); });
          stats.lists++;
        }
        run = [];
      }
      Array.prototype.slice.call(editor.children).forEach(function (el) {
        var m = el.nodeName === 'P' ? listMarker(el.textContent) : null;
        if (m && (!run.length || listMarker(run[0].textContent).type === m.type)) { run.push(el); return; }
        flushRun();
        if (m) run.push(el);
      });
      flushRun();

      // 4. alcímek: rövid, írásjel nélküli sor, amit hosszabb szöveg követ; vagy csupa félkövér rövid bekezdés
      var kids = Array.prototype.slice.call(editor.children);
      kids.forEach(function (el, i) {
        if (el.nodeName !== 'P') return;
        var t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t.length < 3) return;
        var next = kids[i + 1];
        var nextLonger = next && /^(P|UL|OL|BLOCKQUOTE)$/.test(next.nodeName) && next.textContent.trim().length > t.length;
        if (!nextLonger) return;
        var onlyStrong = el.children.length === 1 && el.firstElementChild.nodeName === 'STRONG' &&
          el.firstElementChild.textContent.replace(/\s+/g, ' ').trim() === t;
        var shortLine = t.length <= 90 && t.split(' ').length <= 12 && !/[.,;:!…"”»)]$/.test(t) && !listMarker(t) && !/^[„"“«(]/.test(t);
        if ((onlyStrong && t.length <= 120) || shortLine) {
          var h = rename(el, 'h2');
          if (onlyStrong) unwrap(h.firstElementChild);
          stats.headings++;
        }
      });

      // 5. tipográfia
      typography(stats);

      // 6. üres blokkok ki
      Array.prototype.slice.call(editor.children).forEach(function (el) {
        if (!el.textContent.trim() && !el.querySelector('img') && el.nodeName !== 'HR') el.parentNode.removeChild(el);
      });
    });

    // 7. a cím és a bevezető kitöltése, ha üres
    var first = editor.firstElementChild;
    if (!$('postTitle').value.trim() && first && first.nodeName === 'H2') {
      $('postTitle').value = first.textContent.trim();
      withoutTracking(function () { editor.removeChild(first); });
      if (!slugTouched && !(post && post.published_at)) $('postSlug').value = slugify($('postTitle').value);
      stats.title = true;
    }
    if (!$('postExcerpt').value.trim()) {
      var para = editor.querySelector(':scope > p');
      if (para) {
        $('postExcerpt').value = shorten(para.textContent.replace(/\s+/g, ' ').trim(), 240);
        updateExcerptCount();
        stats.excerpt = true;
      }
    }
    if (!editor.firstChild) withoutTracking(function () { editor.innerHTML = '<p><br></p>'; });
    dirtyBlocks.clear();
    withoutTracking(function () {
      editor.querySelectorAll('[data-sj-dirty]').forEach(function (el) {
        el.removeAttribute('data-sj-dirty');
        var b = topBlock(el);
        if (b) dirtyBlocks.add(b);
      });
    });

    updateFixBar();
    updateEmpty();
    onChange();
    var parts = [];
    if (stats.headings) parts.push(stats.headings + ' alcím');
    if (stats.lists) parts.push(stats.lists + ' lista');
    if (stats.typo) parts.push(stats.typo + ' tipográfiai javítás (idézőjel, gondolatjel, szóköz)');
    if (stats.title) parts.push('cím az első sorból');
    if (stats.excerpt) parts.push('bevezető az első bekezdésből');
    flash('Formázás kész' + (parts.length ? ': ' + parts.join(', ') : ' — nem kellett változtatni') + '. A „↶ Vissza” gombbal visszavonható.', 'ok');
  }

  function inheritDirty(el, sources) {
    if (sources.some(function (s) { return s.hasAttribute('data-sj-dirty'); })) el.setAttribute('data-sj-dirty', '1');
    return el;
  }

  function shorten(text, limit) {
    if (text.length <= limit) return text;
    var cut = text.slice(0, limit);
    var sentence = cut.lastIndexOf('. ');
    if (sentence > limit * 0.5) return cut.slice(0, sentence + 1);
    return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:–-]$/, '') + '…';
  }

  function typography(stats) {
    var units = [];
    Array.prototype.forEach.call(editor.children, function (b) { units = units.concat(unitsOf(b)); });
    units.forEach(function (u) {
      var nodes = [];
      var walker = document.createTreeWalker(u, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          return n.parentElement.closest('del.sj-fix-old') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = walker.nextNode())) nodes.push(n);
      var prev = '';
      nodes.forEach(function (t, i) {
        var s = t.data;
        if (i === 0) s = s.replace(/^\s+/, '');
        if (i === nodes.length - 1) s = s.replace(/\s+$/, '');
        s = s.replace(/[ \u00a0]{2,}/g, ' ')
          .replace(/ +([,;:!?])/g, '$1')
          .replace(/ +\.(?![.\d])/g, '.')
          .replace(/\.{3}/g, '…')
          .replace(/ (?:-{1,2}|—) /g, ' – ')
          .replace(/(^|[^\d\-–])(\d{1,4})-(\d{1,4})(?![\d\-])/g, '$1$2–$3');
        var out = '';
        for (var k = 0; k < s.length; k++) {
          var ch = s[k];
          if (ch === '"' || ch === '“' || ch === '”') {
            var before = out.length ? out[out.length - 1] : prev;
            ch = (!before || /[\s(\[{–—\/]/.test(before)) ? '„' : '”';
          }
          out += ch;
        }
        if (out.length) prev = out[out.length - 1];
        if (out !== t.data) { t.data = out; stats.typo++; }
      });
    });
  }

  /* ================================================================== képek */
  var imgState = { target: 'body', range: null, file: null, crop: null, prepared: null, autoCredit: false };

  /* A kivágó beállításai célonként: a borítókép a megosztási kép arányára (1,91:1) vágódik,
     így a bejegyzés tetején, a listában és megosztáskor is ugyanaz a részlet látszik. */
  var CROP = {
    cover: {
      title: 'Borítókép kivágása',
      ratios: [{ label: '1,91 : 1', value: 1200 / 628 }],
      minWidth: 1000,
      hint: 'A keretben lévő rész lesz a borítókép: ez látszik a bejegyzés tetején, a bejegyzéslistában és megosztáskor (Facebook, LinkedIn). Húzd a keretet, a sarkainál méretezd.'
    },
    profile: {
      title: 'Profilfotó kivágása', square: 480, round: true,
      hint: 'A körben lévő rész jelenik meg a neved mellett. Húzd a keretet, a sarkainál méretezd.'
    },
    body: {
      title: 'Kép kivágása',
      ratios: [{ label: 'Szabad', value: 0 }, { label: '16 : 9', value: 16 / 9 }, { label: '4 : 3', value: 4 / 3 }, { label: '1 : 1', value: 1 }, { label: '3 : 4', value: 3 / 4 }],
      hint: 'Húzd a keretet, a sarkainál méretezd. Ha az egész kép kell, csak kattints a „Kivágás alkalmazása” gombra.'
    }
  };

  $('btnImage').addEventListener('click', function () { openImageDialog('body'); });
  $('coverSet').addEventListener('click', function () { openImageDialog('cover'); });
  $('coverCrop').addEventListener('click', recropCover);
  $('coverRemove').addEventListener('click', function () {
    cover = { id: '', alt: '', credit: '' };
    renderCover();
    onChange();
  });

  function renderCover() {
    var fig = $('coverPreview');
    fig.hidden = !cover.id;
    if (cover.id) {
      fig.querySelector('img').src = '/blog/kepek/' + cover.id + '.jpg';
      fig.querySelector('img').alt = cover.alt;
      fig.querySelector('figcaption').textContent = cover.credit;
    }
    $('coverRemove').hidden = !cover.id;
    $('coverCrop').hidden = !cover.id;
    $('coverSet').textContent = cover.id ? 'Csere' : 'Borítókép feltöltése';
  }

  function openImageDialog(target) {
    var r = editorRange();
    imgState = { target: target, range: r ? r.cloneRange() : null, file: null, crop: null, prepared: null, autoCredit: false };
    $('formImage').reset();
    $('imgPreview').hidden = true;
    SJ.showMsg($('imgMsg'), '');
    $('dlgImageTitle').textContent = { cover: 'Borítókép feltöltése', profile: 'Profilfotó feltöltése' }[target] || 'Kép beszúrása a szövegbe';
    $('imgProfileNote').hidden = target !== 'profile';
    if (target === 'profile') {
      document.querySelector('input[name=rights][value=sajat]').checked = true;
      $('imgAlt').value = $('profileName').value.trim() + ' portréja';
    }
    $('dlgImage').showModal();
  }

  /* A már feltöltött borítókép újravágása: a kivágott rész új képként kerül fel, a leírás és a forrás megmarad. */
  async function recropCover() {
    if (!cover.id) return;
    var btn = $('coverCrop');
    btn.disabled = true;
    try {
      var res = await fetch('/blog/kepek/' + cover.id + '.jpg', { credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      var blob = await res.blob();
      openImageDialog('cover');
      $('dlgImageTitle').textContent = 'Borítókép kivágása';
      $('imgAlt').value = cover.alt;
      $('imgCredit').value = cover.credit;
      imgState.autoCredit = cover.credit === AI_CREDIT;
      await cropSelected(new File([blob], 'boritokep.jpg', { type: blob.type || 'image/jpeg' }));
      if (!imgState.prepared) $('dlgImage').close();
      else SJ.showMsg($('imgMsg'), 'Jelöld be újra, honnan származik a kép, és erősítsd meg a felhasználási jogot.');
    } catch (e) {
      flash('A borítóképet most nem sikerült betölteni.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  $('imgCancel').addEventListener('click', function () { $('dlgImage').close(); });

  document.querySelectorAll('input[name=rights]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      var credit = $('imgCredit');
      if (radio.value === 'ai' && (!credit.value.trim() || imgState.autoCredit)) {
        credit.value = AI_CREDIT;
        imgState.autoCredit = true;
      } else if (radio.value !== 'ai' && imgState.autoCredit && credit.value === AI_CREDIT) {
        credit.value = '';
        imgState.autoCredit = false;
      }
    });
  });
  $('imgCredit').addEventListener('input', function () { imgState.autoCredit = false; });

  $('imgFile').addEventListener('change', function () {
    var file = $('imgFile').files[0];
    if (file) cropSelected(file);
  });
  $('imgRecrop').addEventListener('click', function () {
    if (imgState.file) cropSelected(imgState.file);
  });

  /* Kivágás a SJ.cropImage ablakban. Mégse esetén a korábbi kivágás (ha volt) megmarad. */
  async function cropSelected(file) {
    SJ.showMsg($('imgMsg'), '');
    var opts = Object.assign({}, CROP[imgState.target] || CROP.body);
    if (file === imgState.file && imgState.crop) opts.initial = imgState.crop;
    var result;
    try {
      result = await SJ.cropImage(file, opts);
    } catch (e) {
      SJ.showMsg($('imgMsg'), e.message || 'Ezt a képet nem sikerült beolvasni.', 'error');
      if (!imgState.prepared) $('imgFile').value = '';
      return;
    }
    if (!result) {
      // mégse: új fájlnál visszaáll az előző állapot; így ugyanaz a fájl újra kiválasztható
      if (file !== imgState.file) $('imgFile').value = '';
      return;
    }
    imgState.file = file;
    imgState.crop = { crop: result.crop, ratio: result.ratio };
    imgState.prepared = result;
    var reader = new FileReader();
    reader.onload = function () {
      $('imgPreview').querySelector('img').src = reader.result;
      $('imgInfo').textContent = result.width + ' × ' + result.height + ' px · ' + Math.round(result.blob.size / 1024) + ' KB (kivágva, helyadatok nélkül)';
      $('imgPreview').hidden = false;
    };
    reader.readAsDataURL(result.blob);
  }

  $('formImage').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var rights = document.querySelector('input[name=rights]:checked');
    var alt = $('imgAlt').value.trim();
    var problem = !imgState.prepared ? 'Válassz ki egy képet.'
      : !rights ? 'Add meg, honnan származik a kép.'
      : !alt ? 'Írd le röviden, mit ábrázol a kép.'
      : !$('imgConfirm').checked ? 'Erősítsd meg, hogy a kép felhasználására jogosultak vagyunk.' : null;
    if (problem) { SJ.showMsg($('imgMsg'), problem, 'error'); return; }

    var form = new FormData();
    form.append('file', imgState.prepared.blob, 'kep.jpg');
    form.append('rights', rights.value);
    form.append('confirm', 'on');
    form.append('alt', alt);
    form.append('credit', $('imgCredit').value.trim());
    var done = busyButton($('imgSubmit'), 'Feltöltés…');
    try {
      var res = await SJ.api('/blog/images', { method: 'POST', form: form });
      if (imgState.target === 'profile') {
        await saveProfile({ photo_id: res.id });
      } else if (imgState.target === 'cover') {
        cover = { id: res.id, alt: alt, credit: $('imgCredit').value.trim() };
        renderCover();
        onChange();
      } else {
        insertFigure(res, alt, $('imgCredit').value.trim());
      }
      $('dlgImage').close();
      flash({ cover: 'Borítókép beállítva.', profile: 'A profilfotód elmentve.' }[imgState.target] || 'Kép beszúrva.', 'ok');
    } catch (e) {
      if (!handleAuthError(e)) SJ.showMsg($('imgMsg'), e.message, 'error');
    } finally {
      done();
    }
  });

  function insertFigure(img, alt, credit) {
    var fig = node('figure', {}, [
      node('img', { src: img.url, alt: alt, width: String(img.width), height: String(img.height) }),
      credit ? node('figcaption', { text: credit }) : null
    ]);
    var block = imgState.range ? topBlock(imgState.range.startContainer) : null;
    if (block && block.parentNode === editor) {
      if (!block.textContent.trim() && !block.querySelector('img')) editor.replaceChild(fig, block);
      else editor.insertBefore(fig, block.nextSibling);
    } else {
      editor.appendChild(fig);
    }
    if (!fig.nextElementSibling) editor.appendChild(node('p', {}, [document.createElement('br')]));
    updateEmpty();
  }

  /* ================================================================== tényellenőrzés */
  $('btnFact').addEventListener('click', async function () {
    hidePop();
    var done = busyButton($('btnFact'), 'Ellenőrzés… (akár 1-2 perc)');
    try {
      var fc = await runFactcheck();
      flash(fc.issues.length
        ? 'A tényellenőrzés ' + fc.issues.length + ' vitatható állítást talált — a részletek a jobb oldali panelen.'
        : 'A tényellenőrzés nem talált vitatható állítást.', fc.issues.length ? '' : 'ok');
      $('factCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      if (!handleAuthError(e)) flash(e.message, 'error');
    } finally {
      done();
    }
  });

  /* reuse: publikáláskor a szerver a mentett eredményt adja vissza, ha azóta semmi nem változott. */
  async function runFactcheck(reuse) {
    if (!aiReady) {
      var err = new Error('A tényellenőrzés még nincs beállítva a szerveren (ANTHROPIC_API_KEY).');
      err.status = 503;
      throw err;
    }
    await saveNow();
    if (!post) throw new Error('Előbb írj valamit a bejegyzésbe.');
    var res = await SJ.api('/blog/posts/' + post.id + '/factcheck' + (reuse ? '?reuse=true' : ''), { method: 'POST' });
    post.fact_check = res;
    renderFactCard(res, true);
    return res;
  }

  function renderFactCard(fc, current) {
    $('factCard').hidden = false;
    $('factMeta').textContent = 'Ellenőrizve: ' + SJ.dateTime(fc.checked_at) +
      (fc.tudastar_sources ? ' · ' + fc.tudastar_sources + ' Tudástár-forrás alapján' : '') +
      (current ? '' : ' · a szöveg azóta módosult, publikálás előtt újra lefut');
    $('factSummary').textContent = fc.summary || '';
    renderIssues($('factIssues'), fc.issues || [], false);
    if (!(fc.issues || []).length) $('factIssues').appendChild(node('li', { class: 'issue issue-clean', text: '✓ Nem talált vitatható állítást.' }));
  }

  function renderIssues(list, issues, inDialog) {
    list.textContent = '';
    issues.forEach(function (it) {
      var sources = (it.sources || []).map(function (s) {
        return node('a', { href: s.url || '/tudastar', target: '_blank', rel: 'noopener', text: s.title + ' ↗' });
      });
      list.appendChild(node('li', { class: 'issue sev-' + it.severity }, [
        node('div', { class: 'issue-head' }, [
          node('span', { class: 'badge sev', text: SEVERITY[it.severity] || it.severity }),
          node('span', { class: 'issue-cat', text: CATEGORY[it.category] || '' })
        ]),
        node('blockquote', { class: 'issue-quote', text: '„' + it.quote + '”' }),
        node('p', { text: it.problem }),
        it.suggestion ? node('p', { class: 'issue-suggest' }, [node('b', { text: 'Javaslat: ' }), it.suggestion]) : null,
        sources.length ? node('p', { class: 'issue-sources' }, [node('span', { text: 'Tudástár: ' })].concat(
          sources.reduce(function (acc, a, i) { if (i) acc.push(' · '); acc.push(a); return acc; }, []))) : null,
        node('button', { type: 'button', class: 'link', text: 'Megmutatom a szövegben', onclick: function () {
          if (inDialog) $('dlgPublish').close();
          highlightQuote(it.quote);
        } })
      ]));
    });
  }

  function normalizeWithMap(raw) {
    var out = '', idx = [], space = true;
    for (var i = 0; i < raw.length; i++) {
      if (/\s/.test(raw[i])) {
        if (!space) { out += ' '; idx.push(i); space = true; }
      } else {
        out += raw[i]; idx.push(i); space = false;
      }
    }
    return { text: out, idx: idx };
  }

  function clearHighlight() {
    if (window.CSS && CSS.highlights) CSS.highlights.delete('sj-fact');
  }

  function highlightQuote(quote) {
    var q = quote.replace(/\s+/g, ' ').trim();
    var candidates = [q, q.slice(0, 60)];
    var units = [];
    Array.prototype.forEach.call(editor.children, function (b) { units = units.concat(unitsOf(b)); });
    for (var c = 0; c < candidates.length; c++) {
      for (var i = 0; i < units.length; i++) {
        var map = textMap(units[i]);
        var norm = normalizeWithMap(map.text);
        var pos = norm.text.indexOf(candidates[c]);
        if (pos < 0 || !candidates[c]) continue;
        var start = norm.idx[pos], end = norm.idx[pos + candidates[c].length - 1] + 1;
        var r = rangeFor(units[i], start, end);
        if (!r) continue;
        if (window.CSS && CSS.highlights && window.Highlight) {
          CSS.highlights.set('sj-fact', new Highlight(r));
        } else {
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        }
        units[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    flash('Ezt a mondatot már nem találom a szövegben — lehet, hogy közben átírtad.', '');
  }

  /* ================================================================== publikálás */
  var pubAction = null;

  $('btnPublish').addEventListener('click', startPublish);

  function lockEditor(locked) {
    editor.contentEditable = locked ? 'false' : 'true';
    ['postTitle', 'postExcerpt', 'postAuthor', 'postAuthorSel', 'btnPublish', 'btnSave', 'btnSpell', 'btnFact', 'btnFormat', 'btnImage'].forEach(function (id) {
      $(id).disabled = locked;
    });
    if (!locked) { $('postSlug').disabled = !!(post && post.published_at); updateUndo(); updateMeta(); }
  }

  async function startPublish() {
    hidePop();
    var n = fixCount();
    if (n) {
      flash('Előbb fogadd el vagy vesd el a helyesírási javaslatokat (' + n + ' db).', 'error');
      $('fixBar').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!$('postTitle').value.trim()) { flash('Adj címet a bejegyzésnek.', 'error'); $('postTitle').focus(); return; }
    if (!editor.textContent.trim()) { flash('A bejegyzés még üres.', 'error'); return; }

    lockEditor(true);
    $('btnPublish').textContent = 'Tényellenőrzés…';
    try {
      await saveNow();
      if (!aiReady) {
        openPublishDialog({ mode: 'unavailable', message: 'A tényellenőrzés nincs beállítva a szerveren (hiányzik az ANTHROPIC_API_KEY), ezért most nem futott le.' });
        return;
      }
      var fc = await runFactcheck(true);
      openPublishDialog({ mode: fc.issues.length ? 'issues' : 'clean', fc: fc });
    } catch (e) {
      if (handleAuthError(e)) return;
      if (e.status === 409) { flash(e.message, 'error'); return; }
      openPublishDialog({ mode: 'error', message: e.message });
    } finally {
      lockEditor(false);
    }
  }

  function openPublishDialog(opts) {
    var dlg = $('dlgPublish'), lead = $('pubLead'), go = $('pubGo');
    $('pubIssues').textContent = '';
    lead.className = '';
    go.hidden = false;
    go.className = 'btn';
    $('pubBack').textContent = 'Vissza a szerkesztéshez';
    var republish = post.status === 'published';
    var reused = opts.fc && opts.fc.reused
      ? ' (A ' + SJ.dateTime(opts.fc.checked_at) + '-kor lefutott ellenőrzés eredménye — azóta nem változott a bejegyzés.)' : '';

    if (opts.mode === 'clean') {
      $('dlgPublishTitle').textContent = republish ? 'Mehetnek a módosítások?' : 'Mehet a blogra?';
      lead.textContent = '✓ A tényellenőrzés nem talált vitatható állítást (' + (opts.fc.tudastar_sources || 0) + ' Tudástár-forrás alapján). ' + (opts.fc.summary || '') + reused;
      go.textContent = republish ? 'Módosítások publikálása' : 'Publikálás';
      pubAction = { token: opts.fc.token };
      $('pubBack').textContent = 'Mégse';
    } else if (opts.mode === 'issues') {
      var count = opts.fc.issues.length;
      $('dlgPublishTitle').textContent = count === 1 ? 'Vitatható állítás a bejegyzésben' : count + ' vitatható állítás a bejegyzésben';
      lead.textContent = 'A tényellenőrzés a Tudástár alapján vitathatónak találta az alábbiakat. Javítsd őket, vagy — ha biztos vagy a dolgodban — hagyd figyelmen kívül a jelzést. A döntésed a naplóba kerül.' + reused;
      renderIssues($('pubIssues'), opts.fc.issues, true);
      go.textContent = 'Figyelmen kívül hagyom és publikálom';
      go.className = 'btn btn-danger';
      pubAction = { token: opts.fc.token, ignore_warnings: true };
    } else {
      var canSkip = opts.mode === 'unavailable' || (me && me.role === 'admin');
      $('dlgPublishTitle').textContent = 'A tényellenőrzés most nem futott le';
      lead.textContent = opts.message + (canSkip ? ' Publikálhatsz ellenőrzés nélkül is — ezt a napló rögzíti.' : ' Próbáld újra néhány perc múlva.');
      lead.className = 'msg error';
      go.hidden = !canSkip;
      go.textContent = 'Publikálás ellenőrzés nélkül';
      go.className = 'btn btn-danger';
      pubAction = { unchecked: true };
    }
    dlg.showModal();
    $('pubBack').focus();
  }

  $('pubBack').addEventListener('click', function () {
    $('dlgPublish').close();
    var issues = post && post.fact_check && post.fact_check.issues;
    if (pubAction && pubAction.ignore_warnings && issues && issues.length) {
      $('factCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      highlightQuote(issues[0].quote);
    }
  });

  $('pubGo').addEventListener('click', async function () {
    if (!post || !pubAction) return;
    var done = busyButton($('pubGo'), 'Publikálás…');
    try {
      var res = await SJ.api('/blog/posts/' + post.id + '/publish', { method: 'POST', body: Object.assign({ version: post.version }, pubAction) });
      post = res.post;
      $('dlgPublish').close();
      updateMeta();
      flash('Kint van a blogon: ' + post.url, 'ok');
      $('sharePanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      if (handleAuthError(e)) return;
      $('pubLead').className = 'msg error';
      $('pubLead').textContent = e.message;
    } finally {
      done();
    }
  });

  $('btnUnpublish').addEventListener('click', async function () {
    if (!post || !window.confirm('Biztosan leveszed a bejegyzést a blogról? A megosztott hivatkozás „nem található” oldalra visz, amíg újra nem publikálod.')) return;
    try {
      await saveNow();
      var res = await SJ.api('/blog/posts/' + post.id + '/unpublish', { method: 'POST', body: { version: post.version } });
      post = res.post;
      updateMeta();
      flash('A bejegyzés lekerült a blogról; vázlatként megmaradt.', 'ok');
    } catch (e) {
      if (!handleAuthError(e)) flash(e.message, 'error');
    }
  });

  $('btnDelete').addEventListener('click', async function () {
    if (!post || !window.confirm('Biztosan törlöd ezt a vázlatot? Nem vonható vissza.')) return;
    try {
      await SJ.api('/blog/posts/' + post.id + '/delete', { method: 'POST' });
      changeSeq = savedSeq;
      post = null;
      location.hash = '';
    } catch (e) {
      if (!handleAuthError(e)) flash(e.message, 'error');
    }
  });

  /* ================================================================== megosztás */
  function shareLinks(url, title, excerpt) {
    var u = encodeURIComponent(url), t = encodeURIComponent(title);
    var body = encodeURIComponent(excerpt ? title + '\n\n' + excerpt + '\n\n' + url : title + '\n\n' + url);
    return [
      ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + u],
      ['X', 'https://x.com/intent/post?url=' + u + '&text=' + t],
      ['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + u],
      ['E-mail', 'mailto:?subject=' + t + '&body=' + body]
    ];
  }

  function renderShare() {
    $('shareUrl').value = post.url;
    $('shareOpen').href = post.url;
    var row = $('shareLinks');
    row.textContent = '';
    shareLinks(post.url, post.title, post.excerpt).forEach(function (l) {
      var attrs = { class: 'btn btn-ghost btn-sm', href: l[1], text: l[0] };
      if (l[0] !== 'E-mail') { attrs.target = '_blank'; attrs.rel = 'noopener noreferrer'; }
      row.appendChild(node('a', attrs));
    });
  }

  $('shareCopy').addEventListener('click', async function () {
    var input = $('shareUrl');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (e) {
      input.select();
      document.execCommand('copy');
    }
    var btn = $('shareCopy');
    btn.textContent = 'Kimásolva ✓';
    setTimeout(function () { btn.textContent = 'Link másolása'; }, 2000);
  });
})();
