/* stopjeger.hu/blog — téma, link másolása, natív megosztás. Süti és külső kérés nélkül. */
(function () {
  'use strict';
  var root = document.documentElement;
  var KEY = 'infotainment_theme';

  try {
    var stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);
  } catch (e) { /* privát mód */ }

  var toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      if (!current) current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* nem baj */ }
    });
  }

  function status(btn, text) {
    var box = btn.closest('.share');
    var out = box && box.querySelector('.share-status');
    if (!out) return;
    out.textContent = text;
    setTimeout(function () { out.textContent = ''; }, 2500);
  }

  document.querySelectorAll('.share-copy').forEach(function (btn) {
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-copy');
      function fallback() {
        var input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(input);
        status(btn, ok ? 'Link kimásolva ✓' : url);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { status(btn, 'Link kimásolva ✓'); }, fallback);
      } else {
        fallback();
      }
    });
  });

  // Hírlevél: a gomb nyitja az űrlapot; beküldés fetch-csel, oldalfrissítés nélkül.
  var nlOpen = document.querySelector('.nl-open');
  var nlForm = document.getElementById('nlForm');
  if (nlOpen && nlForm) {
    nlOpen.hidden = false;
    nlForm.hidden = true;
    nlOpen.addEventListener('click', function () {
      nlForm.hidden = false;
      nlOpen.hidden = true;
      nlOpen.setAttribute('aria-expanded', 'true');
      nlForm.querySelector('input[type=email]').focus();
    });
    var nlStatus = nlForm.querySelector('.nl-status');
    var say = function (text, kind) { nlStatus.textContent = text; nlStatus.className = 'nl-status' + (kind ? ' ' + kind : ''); };
    nlForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = nlForm.elements.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { say('Adj meg egy érvényes e-mail-címet.', 'error'); return; }
      if (!nlForm.elements.consent.checked) { say('A feliratkozáshoz fogadd el a hozzájárulást.', 'error'); return; }
      var btn = nlForm.querySelector('.nl-submit');
      btn.disabled = true;
      say('Feliratkozás…');
      fetch('/api/subscribe', { method: 'POST', body: new FormData(nlForm), headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (!res.ok) { say(res.data.detail || 'A feliratkozás most nem sikerült. Próbáld újra később.', 'error'); return; }
          if (res.data.warning) { say(res.data.warning, 'error'); return; }
          nlForm.reset();
          say('Köszönjük! Küldtünk egy megerősítő levelet — a feliratkozás a benne lévő hivatkozásra kattintva lesz érvényes. Ha pár percen belül nem érkezik meg, nézd meg a Spam / Levélszemét mappát (Gmailben a Promóciók fület) is.', 'ok');
        })
        .catch(function () { say('Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot.', 'error'); })
        .then(function () { btn.disabled = false; });
    });
  }

  if (navigator.share) {
    document.querySelectorAll('.share-native').forEach(function (btn) {
      btn.hidden = false;
      btn.addEventListener('click', function () {
        var data = { title: btn.getAttribute('data-title'), url: btn.getAttribute('data-url') };
        var intro = btn.getAttribute('data-text');
        if (intro) data.text = intro;
        navigator.share(data).catch(function () {});
      });
    });
  }

  /* Olvasásszámláló. Csak akkor jelez, ha a látogató tényleg olvasni kezdte a cikket:
     vagy eltelt 15 másodperc a látható oldalon, vagy legörgetett a feléig. Egy oldalbetöltés
     legfeljebb egyszer számít. Sütit és semmilyen böngészőben tárolt azonosítót nem használ,
     ezért ugyanaz az olvasó újratöltéskor újra beleszámít — cserébe nem követünk senkit. */
  var article = document.querySelector('article.prose[data-post]');
  if (article) {
    var slug = article.getAttribute('data-post');
    var sent = false, timer = 0;

    var count = function () {
      if (sent) return;
      sent = true;
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisible);
      try {
        fetch('/api/blog/olvasas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: slug }),
          cache: 'no-store',
          keepalive: true
        }).catch(function () { /* a számláló sosem zavarhatja az olvasást */ });
      } catch (e) { /* régi böngésző: nem számolunk */ }
    };

    var onScroll = function () {
      var doc = document.documentElement;
      var scrolled = doc.scrollHeight - doc.clientHeight;
      if (scrolled <= 0 || (doc.scrollTop || document.body.scrollTop) / scrolled > 0.5) count();
    };

    var startTimer = function () { timer = setTimeout(count, 15000); };

    var onVisible = function () {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      startTimer();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    // Előretöltött vagy háttérben nyitott lapon csak akkor indul az óra, ha tényleg látszik.
    if (document.visibilityState === 'visible') startTimer();
    else document.addEventListener('visibilitychange', onVisible);
  }
})();
