/* Belépés: e-mail + jelszó -> e-mailes kód -> vezérlőpult. */
(function () {
  'use strict';
  var SJ = window.SJ;
  var $ = function (id) { return document.getElementById(id); };
  var msg = $('msg');
  var challenge = null;

  function step(name) {
    $('stepLogin').hidden = name !== 'login';
    $('stepCode').hidden = name !== 'code';
    $('stepForgot').hidden = name !== 'forgot';
    SJ.showMsg(msg, '');
  }

  async function busy(form, fn) {
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }

  (async function () {
    try {
      var s = await SJ.api('/session');
      if (s.authenticated) { location.replace('/admin/vezerlopult/'); return; }
    } catch (e) {
      if (e.status === 503) SJ.showMsg(msg, 'A belső felület még nincs beállítva a szerveren.', 'error');
    }
    $('email').focus();
  })();

  $('formLogin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var form = ev.currentTarget;
    busy(form, async function () {
      SJ.showMsg(msg, '');
      var email = $('email').value.trim();
      var password = $('password').value;
      if (!email || !password) { SJ.showMsg(msg, 'Add meg az e-mail-címed és a jelszavad.', 'error'); return; }
      try {
        var r = await SJ.api('/login', { method: 'POST', body: { email: email, password: password } });
        challenge = r.challenge;
        $('password').value = '';
        step('code');
        $('codeHint').textContent = 'Küldtünk egy 6 jegyű kódot ide: ' + r.email_hint + '. A kód 10 percig érvényes.';
        $('code').value = '';
        $('code').focus();
      } catch (e) {
        SJ.showMsg(msg, e.message, 'error');
      }
    });
  });

  $('formCode').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var form = ev.currentTarget;
    busy(form, async function () {
      var code = $('code').value.replace(/\D/g, '');
      if (code.length !== 6) { SJ.showMsg(msg, 'A kód 6 számjegyből áll.', 'error'); return; }
      try {
        await SJ.api('/login/verify', { method: 'POST', body: { challenge: challenge, code: code } });
        location.replace('/admin/vezerlopult/');
      } catch (e) {
        SJ.showMsg(msg, e.message, 'error');
        $('code').select();
      }
    });
  });

  $('backToLogin').addEventListener('click', function () {
    challenge = null;
    step('login');
    SJ.showMsg(msg, 'Add meg újra a jelszavad — új kódot küldünk.', '');
    $('password').focus();
  });

  $('toForgot').addEventListener('click', function () {
    step('forgot');
    $('forgotEmail').value = $('email').value.trim();
    $('forgotEmail').focus();
  });

  $('forgotBack').addEventListener('click', function () { step('login'); $('email').focus(); });

  $('formForgot').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var form = ev.currentTarget;
    busy(form, async function () {
      var email = $('forgotEmail').value.trim();
      if (!email) { SJ.showMsg(msg, 'Add meg az e-mail-címed.', 'error'); return; }
      try {
        await SJ.api('/password/forgot', { method: 'POST', body: { email: email } });
        SJ.showMsg(msg, 'Ha ez a cím szerepel a rendszerben, pár percen belül érkezik egy levél a hivatkozással. Nézd meg a levélszemét mappát is.', 'ok');
      } catch (e) {
        SJ.showMsg(msg, e.message, 'error');
      }
    });
  });
})();
