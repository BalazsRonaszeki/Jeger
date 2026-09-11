/* Vezérlőpult: kezdőlap, dashboard (napi oszlopdiagramok), felhasználókezelés. */
(function () {
  'use strict';
  var SJ = window.SJ;
  var $ = function (id) { return document.getElementById(id); };
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var me = null;

  var ROLE = { admin: 'Adminisztrátor', editor: 'Szerkesztő' };
  var STATUS = { invited: ['Meghívva', 'warn'], active: ['Aktív', 'ok'], disabled: ['Letiltva', 'danger'] };

  function node(tag, props, children) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') el.textContent = props[k];
      else if (k === 'class') el.className = props[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), props[k]);
      else el.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function svg(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function handleAuthError(e) {
    if (e && e.status === 401) { location.replace('/admin/'); return true; }
    return false;
  }

  /* ------------------------------------------------------------------ indulás */
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
    $('helloName').textContent = me.name ? ', ' + me.name.split(' ')[0] : '';
    var isAdmin = me.role === 'admin';
    $('navUsers').hidden = !isAdmin;
    $('tileUsers').hidden = !isAdmin;
    window.addEventListener('hashchange', route);
    route();
  })();

  $('logoutBtn').addEventListener('click', async function () {
    try { await SJ.api('/logout', { method: 'POST' }); } catch (e) { /* a süti úgyis lejár */ }
    location.replace('/admin/');
  });

  function route() {
    var h = location.hash.replace('#', '');
    var view = h === 'dashboard' ? 'dashboard' : (h === 'felhasznalok' && me.role === 'admin') ? 'users' : 'home';
    $('viewHome').hidden = view !== 'home';
    $('viewDashboard').hidden = view !== 'dashboard';
    $('viewUsers').hidden = view !== 'users';
    document.querySelectorAll('.nav a').forEach(function (a) {
      if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = { home: 'Vezérlőpult', dashboard: 'Dashboard', users: 'Felhasználók' }[view] + ' — stopjeger.hu belső felület';
    if (view === 'dashboard') initDashboard();
    if (view === 'users') loadUsers();
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ dashboard */
  var dashReady = false;
  var charts = {};

  function initDashboard() {
    if (dashReady) { Object.keys(charts).forEach(function (k) { charts[k].render(); }); return; }
    dashReady = true;
    charts.visitors = makeChart($('cardVisitors'), 'visitors', 'látogató', [['visitors', 'Látogatók'], ['pageviews', 'Oldalletöltések']]);
    charts.survey = makeChart($('cardSurvey'), 'n', 'kitöltés', [['n', 'Kitöltések']]);
    charts.subs = makeChart($('cardSubs'), 'confirmed', 'megerősített feliratkozás', [['confirmed', 'Megerősített'], ['signups', 'Összes feliratkozási kísérlet']]);

    document.querySelectorAll('.preset').forEach(function (b) {
      b.addEventListener('click', function () { applyPreset(b.dataset.preset); load(); });
    });
    $('rangeForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!$('dFrom').value || !$('dTo').value) { SJ.showMsg($('dashMsg'), 'Adj meg kezdő és záró dátumot.', 'error'); return; }
      setPressed('');
      load();
    });
    document.addEventListener('sj:themechange', function () { Object.keys(charts).forEach(function (k) { charts[k].render(); }); });
    applyPreset('30');
    load();
  }

  function setPressed(preset) {
    document.querySelectorAll('.preset').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.preset === preset)); });
  }

  function applyPreset(preset) {
    var today = new Date();
    var from = new Date(today);
    if (preset === 'month') from = new Date(today.getFullYear(), today.getMonth(), 1);
    else from.setDate(today.getDate() - (parseInt(preset, 10) - 1));
    $('dFrom').value = SJ.localIso(from);
    $('dTo').value = SJ.localIso(today);
    setPressed(preset);
  }

  var loadSeq = 0;
  async function load() {
    var seq = ++loadSeq;
    var body = $('dashBody');
    body.classList.add('loading');
    SJ.showMsg($('dashMsg'), '');
    try {
      var data = await SJ.api('/stats?from=' + encodeURIComponent($('dFrom').value) + '&to=' + encodeURIComponent($('dTo').value));
      if (seq !== loadSeq) return;
      renderDashboard(data);
    } catch (e) {
      if (handleAuthError(e)) return;
      SJ.showMsg($('dashMsg'), e.message, 'error');
    } finally {
      if (seq === loadSeq) body.classList.remove('loading');
    }
  }

  function renderDashboard(d) {
    $('rangeLabel').textContent = SJ.longDate(d.range.from) + ' – ' + SJ.longDate(d.range.to) + ' · ' + d.range.days + ' nap';
    $('dFrom').value = d.range.from;
    $('dTo').value = d.range.to;

    var v = d.visitors;
    if (v.status === 'ok') {
      $('kpiVisitors').textContent = SJ.num(v.total.visitors);
      $('kpiVisitorsSub').textContent = SJ.num(v.total.pageviews) + ' oldalletöltés az időszakban';
    } else {
      $('kpiVisitors').textContent = '—';
      $('kpiVisitorsSub').textContent = v.status === 'not_configured' ? 'A Vercel-lekérdezés még nincs beállítva' : 'Az adat most nem érhető el';
    }
    charts.visitors.update(v);

    var s = d.survey;
    $('kpiSurvey').textContent = s.status === 'ok' ? SJ.num(s.total) : '—';
    $('kpiSurveySub').textContent = s.status === 'ok' ? 'az időszakban · összesen eddig ' + SJ.num(s.all_time) : 'Az adat most nem érhető el';
    charts.survey.update(s);

    var sub = d.subscribers;
    $('kpiSubs').textContent = sub.status === 'ok' ? SJ.num(sub.total_confirmed) : '—';
    $('kpiSubsSub').textContent = sub.status === 'ok'
      ? 'megerősített az időszakban · aktív feliratkozó: ' + SJ.num(sub.active) + ' · megerősítésre vár: ' + SJ.num(sub.pending)
      : 'Az adat most nem érhető el';
    charts.subs.update(sub);
  }

  /* ------------------------------------------------------------------ oszlopdiagram */
  function niceTicks(max) {
    if (!max || max <= 0) return [0, 1];
    var rough = max / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    step = Math.max(1, Math.round(step));
    var top = Math.ceil(max / step) * step;
    var ticks = [];
    for (var t = 0; t <= top; t += step) ticks.push(t);
    return ticks;
  }

  function makeChart(card, key, unit, tableCols) {
    var host = card.querySelector('.chart');
    var note = card.querySelector('.card-note');
    var tableWrap = card.querySelector('.table-wrap');
    var toggle = card.querySelector('.table-toggle');
    var block = null;
    var active = -1;
    var tip = node('div', { class: 'tooltip', role: 'status', 'aria-live': 'polite' });
    tip.hidden = true;

    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Táblázat bezárása' : 'Táblázat';
      tableWrap.hidden = !open;
      if (open) renderTable();
    });

    if (window.ResizeObserver) {
      var raf = 0, lastW = 0;
      new ResizeObserver(function (entries) {
        var w = Math.round(entries[0].contentRect.width);
        if (w === lastW) return;
        lastW = w;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(render);
      }).observe(host);
    }

    function update(b) {
      block = b;
      if (b.status !== 'ok') {
        SJ.showMsg(note, b.message || 'Az adat most nem érhető el.', b.status === 'not_configured' ? '' : 'error');
      } else {
        SJ.showMsg(note, '');
      }
      render();
      if (!tableWrap.hidden) renderTable();
    }

    function renderTable() {
      tableWrap.textContent = '';
      if (!block || block.status !== 'ok') return;
      var thead = node('thead', {}, [node('tr', {}, [node('th', { text: 'Nap' })].concat(tableCols.map(function (c) {
        return node('th', { class: 'num', text: c[1] });
      })))]);
      var tbody = node('tbody');
      block.daily.slice().reverse().forEach(function (row) {
        tbody.appendChild(node('tr', {}, [node('td', { text: SJ.longDate(row.day) })].concat(tableCols.map(function (c) {
          return node('td', { class: 'num', text: SJ.num(row[c[0]]) });
        }))));
      });
      tableWrap.appendChild(node('table', { class: 'data-table' }, [thead, tbody]));
    }

    function render() {
      host.textContent = '';
      tip.hidden = true;
      var rows = block && block.status === 'ok' ? block.daily : [];
      var width = Math.max(280, Math.round(host.clientWidth || 600));
      var height = 230;
      var m = { top: 14, right: 10, bottom: 30, left: 46 };
      var W = width - m.left - m.right;
      var H = height - m.top - m.bottom;
      var max = rows.reduce(function (acc, r) { return Math.max(acc, r[key] || 0); }, 0);
      var ticks = niceTicks(max);
      var top = ticks[ticks.length - 1];

      var total = rows.reduce(function (acc, r) { return acc + (r[key] || 0); }, 0);
      var root = svg('svg', {
        viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, role: 'img', tabindex: rows.length ? '0' : '-1',
        'aria-label': rows.length
          ? 'Oszlopdiagram, napi ' + unit + ', ' + rows.length + ' nap, összesen ' + SJ.num(total) + '. A nyílbillentyűkkel napról napra léptethető.'
          : 'Nincs megjeleníthető adat.'
      });

      ticks.forEach(function (t) {
        var y = m.top + H - (t / top) * H;
        root.appendChild(svg('line', { class: t === 0 ? 'axis' : 'grid', x1: m.left, x2: width - m.right, y1: y, y2: y }));
        var label = svg('text', { class: 'tick', x: m.left - 8, y: y + 4, 'text-anchor': 'end' });
        label.textContent = SJ.num(t);
        root.appendChild(label);
      });

      if (!rows.length) {
        host.appendChild(root);
        return;
      }

      var band = W / rows.length;
      var barW = Math.max(1, Math.min(24, band * 0.7, band - 2));
      var bars = [];
      rows.forEach(function (r, i) {
        var value = r[key] || 0;
        if (value <= 0) { bars.push(null); return; }
        var h = Math.max(1, (value / top) * H);
        var x = m.left + i * band + (band - barW) / 2;
        var y = m.top + H - h;
        var rad = Math.min(4, barW / 2, h);
        var d = 'M' + x + ',' + (y + h) + 'V' + (y + rad) + 'Q' + x + ',' + y + ' ' + (x + rad) + ',' + y +
                'H' + (x + barW - rad) + 'Q' + (x + barW) + ',' + y + ' ' + (x + barW) + ',' + (y + rad) + 'V' + (y + h) + 'Z';
        var p = svg('path', { class: 'bar', d: d });
        root.appendChild(p);
        bars.push(p);
      });

      // Az utolsó nap mindig kap feliratot; a szabályos feliratok közül kimarad az, amelyik
      // egy teljes lépésnél közelebb esne hozzá, különben a két dátum egymásra csúszik.
      var maxLabels = Math.max(2, Math.floor(W / 58));
      var every = Math.ceil(rows.length / maxLabels);
      var last = rows.length - 1;
      rows.forEach(function (r, i) {
        var regular = i % every === 0 && last - i >= every;
        if (!regular && i !== last) return;
        var t = svg('text', { class: 'tick', x: m.left + i * band + band / 2, y: height - 8, 'text-anchor': 'middle' });
        t.textContent = SJ.shortDate(r.day);
        root.appendChild(t);
      });

      var guide = svg('line', { class: 'guide', y1: m.top, y2: m.top + H, x1: 0, x2: 0, visibility: 'hidden' });
      root.appendChild(guide);
      var hit = svg('rect', { class: 'hit', x: m.left, y: m.top, width: W, height: H + m.bottom });
      root.appendChild(hit);

      function show(i) {
        i = Math.max(0, Math.min(rows.length - 1, i));
        if (active >= 0 && bars[active]) bars[active].classList.remove('is-active');
        active = i;
        if (bars[i]) bars[i].classList.add('is-active');
        var cx = m.left + i * band + band / 2;
        guide.setAttribute('x1', cx); guide.setAttribute('x2', cx);
        guide.setAttribute('visibility', bars[i] ? 'hidden' : 'visible');
        var r = rows[i];
        tip.textContent = '';
        tip.appendChild(node('strong', { text: SJ.num(r[key]) + ' ' + unit }));
        tableCols.slice(1).forEach(function (c) {
          tip.appendChild(node('span', { class: 'tip-row', text: c[1] + ': ' + SJ.num(r[c[0]]) }));
        });
        tip.appendChild(node('span', { class: 'tip-row' }, [node('span', { class: 'key' }), document.createTextNode(SJ.longDate(r.day))]));
        tip.hidden = false;
        var scale = host.clientWidth / width;
        var tipW = tip.offsetWidth;
        var left = cx * scale - tipW / 2;
        left = Math.max(0, Math.min(host.clientWidth - tipW, left));
        tip.style.left = left + 'px';
        var barTop = bars[i] ? bars[i].getBBox().y : m.top + H;
        tip.style.top = Math.max(0, barTop * scale - tip.offsetHeight - 10) + 'px';
      }

      function hide() {
        if (active >= 0 && bars[active]) bars[active].classList.remove('is-active');
        active = -1;
        guide.setAttribute('visibility', 'hidden');
        tip.hidden = true;
      }

      root.addEventListener('pointermove', function (ev) {
        var rect = root.getBoundingClientRect();
        var x = (ev.clientX - rect.left) * (width / rect.width);
        if (x < m.left || x > width - m.right) { hide(); return; }
        show(Math.floor((x - m.left) / band));
      });
      root.addEventListener('pointerleave', hide);
      root.addEventListener('focus', function () { show(active >= 0 ? active : rows.length - 1); });
      root.addEventListener('blur', hide);
      root.addEventListener('keydown', function (ev) {
        var next = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: rows.length - 1 }[ev.key];
        if (next === undefined) return;
        ev.preventDefault();
        show(next);
      });

      host.appendChild(root);
      host.appendChild(tip);
    }

    return { update: update, render: render };
  }

  /* ------------------------------------------------------------------ felhasználók */
  async function loadUsers() {
    var tbody = $('usersTable').querySelector('tbody');
    try {
      var data = await SJ.api('/users');
      tbody.textContent = '';
      data.users.forEach(function (u) {
        var st = STATUS[u.status] || [u.status, ''];
        var actions = node('div', { class: 'actions' });
        if (u.id !== data.me) {
          if (u.status === 'invited') actions.appendChild(actionBtn('Meghívó újraküldése', u, 'resend', 'btn btn-ghost btn-sm'));
          if (u.status !== 'disabled') actions.appendChild(actionBtn('Letiltás', u, 'disable', 'btn btn-danger btn-sm'));
          else actions.appendChild(actionBtn('Engedélyezés', u, 'enable', 'btn btn-ghost btn-sm'));
        } else {
          actions.appendChild(node('span', { class: 'muted', text: 'te' }));
        }
        tbody.appendChild(node('tr', {}, [
          node('td', { text: u.name || '—' }),
          node('td', { text: u.email }),
          node('td', { text: ROLE[u.role] || u.role }),
          node('td', {}, [node('span', { class: 'badge ' + st[1], text: st[0] })]),
          node('td', { text: SJ.dateTime(u.last_login_at) }),
          node('td', { class: 'num' }, [actions])
        ]));
      });
      SJ.showMsg($('usersMsg'), '');
    } catch (e) {
      if (handleAuthError(e)) return;
      SJ.showMsg($('usersMsg'), e.message, 'error');
    }
  }

  function actionBtn(label, user, action, cls) {
    return node('button', {
      type: 'button', class: cls, text: label,
      onclick: async function (ev) {
        if (action === 'disable' && !window.confirm('Biztosan letiltod ' + user.email + ' hozzáférését? Az aktív munkamenetei azonnal megszűnnek.')) return;
        ev.currentTarget.disabled = true;
        try {
          await SJ.api('/users/' + encodeURIComponent(user.id) + '/' + action, { method: 'POST' });
          SJ.showMsg($('usersMsg'), { resend: 'Új meghívót küldtünk: ', disable: 'Letiltva: ', enable: 'Engedélyezve: ' }[action] + user.email, 'ok');
          loadUsers();
        } catch (e) {
          if (handleAuthError(e)) return;
          SJ.showMsg($('usersMsg'), e.message, 'error');
          ev.currentTarget.disabled = false;
        }
      }
    });
  }

  $('formInvite').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var btn = ev.currentTarget.querySelector('button[type=submit]');
    var email = $('invEmail').value.trim();
    if (!email) { SJ.showMsg($('inviteMsg'), 'Add meg a meghívandó e-mail-címét.', 'error'); return; }
    btn.disabled = true;
    try {
      await SJ.api('/users/invite', { method: 'POST', body: { email: email, name: $('invName').value.trim(), role: $('invRole').value } });
      SJ.showMsg($('inviteMsg'), 'Meghívót küldtünk ide: ' + email + '. A hivatkozás 72 óráig érvényes.', 'ok');
      $('formInvite').reset();
      loadUsers();
    } catch (e) {
      if (handleAuthError(e)) return;
      SJ.showMsg($('inviteMsg'), e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
})();
