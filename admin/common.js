/* stopjeger.hu — belső felület, közös segédek (téma, API-hívás, formázás). */
(function () {
  'use strict';

  var root = document.documentElement;
  var THEME_KEY = 'infotainment_theme'; // ugyanaz a kulcs, mint a nyilvános oldalon

  try {
    var stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);
  } catch (e) { /* privát mód: az alapértelmezett téma marad */ }

  function bindThemeToggle() {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      if (!current) current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* nem baj */ }
      document.dispatchEvent(new CustomEvent('sj:themechange'));
    });
  }

  function ApiError(message, status) {
    this.message = message;
    this.status = status;
  }
  ApiError.prototype = Object.create(Error.prototype);

  async function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'stopjeger-admin', 'Accept': 'application/json' }
    };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    var res;
    try {
      res = await fetch('/api/admin' + path, init);
    } catch (e) {
      throw new ApiError('Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot.', 0);
    }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var detail = data && typeof data.detail === 'string' ? data.detail : null;
      throw new ApiError(detail || ('Váratlan hiba történt (' + res.status + ').'), res.status);
    }
    return data;
  }

  function showMsg(node, text, kind) {
    if (!node) return;
    node.textContent = text || '';
    node.className = 'msg' + (kind ? ' ' + kind : '');
    node.hidden = !text;
  }

  var numberFmt = new Intl.NumberFormat('hu-HU');
  var longDate = new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
  var shortDate = new Intl.DateTimeFormat('hu-HU', { month: '2-digit', day: '2-digit', timeZone: 'UTC' });
  var dateTime = new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  function isoToDate(iso) { return new Date(iso + 'T00:00:00Z'); }

  function localIso(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  window.SJ = {
    api: api,
    showMsg: showMsg,
    num: function (n) { return (n === null || n === undefined) ? '—' : numberFmt.format(n); },
    longDate: function (iso) { return longDate.format(isoToDate(iso)); },
    shortDate: function (iso) { return shortDate.format(isoToDate(iso)); },
    dateTime: function (value) { return value ? dateTime.format(new Date(value)) : '—'; },
    localIso: localIso
  };

  bindThemeToggle();
})();
