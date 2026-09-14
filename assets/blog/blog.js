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

  if (navigator.share) {
    document.querySelectorAll('.share-native').forEach(function (btn) {
      btn.hidden = false;
      btn.addEventListener('click', function () {
        navigator.share({ title: btn.getAttribute('data-title'), url: btn.getAttribute('data-url') }).catch(function () {});
      });
    });
  }
})();
