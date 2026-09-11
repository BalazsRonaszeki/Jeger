/* Meghívó elfogadása / jelszó-visszaállítás. A token a URL #-részében érkezik (ez nem kerül
   szervernaplóba), és beolvasás után azonnal eltávolítjuk a címsorból és az előzményekből. */
(function () {
  'use strict';
  var SJ = window.SJ;
  var $ = function (id) { return document.getElementById(id); };
  var msg = $('msg');

  var params = new URLSearchParams(location.hash.slice(1));
  var token = params.get('meghivo') || params.get('visszaallitas') || '';
  if (location.hash) history.replaceState(null, '', location.pathname);

  function show(state) {
    ['stateChecking', 'stateForm', 'stateDone', 'stateInvalid'].forEach(function (id) {
      $(id).hidden = id !== state;
    });
  }

  (async function () {
    if (!token) { show('stateInvalid'); return; }
    try {
      var r = await SJ.api('/password/check', { method: 'POST', body: { token: token } });
      if (r.purpose === 'invite') {
        $('formTitle').textContent = 'Üdv a belső felületen' + (r.name ? ', ' + r.name : '') + '!';
        $('formLead').textContent = 'Állíts be egy jelszót a(z) ' + r.email + ' fiókhoz.';
      } else {
        $('formTitle').textContent = 'Új jelszó beállítása';
        $('formLead').textContent = 'Új jelszó a(z) ' + r.email + ' fiókhoz. Mentés után minden korábbi munkamenet kijelentkezik.';
      }
      $('accountEmail').value = r.email;
      show('stateForm');
      $('password').focus();
    } catch (e) {
      if (e.status !== 400) $('invalidText').textContent = e.message;
      show('stateInvalid');
    }
  })();

  $('formPassword').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var p1 = $('password').value, p2 = $('password2').value;
    if (p1.length < 12) { SJ.showMsg(msg, 'A jelszó legalább 12 karakter legyen.', 'error'); return; }
    if (p1 !== p2) { SJ.showMsg(msg, 'A két jelszó nem egyezik.', 'error'); return; }
    var btn = ev.currentTarget.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await SJ.api('/password/set', { method: 'POST', body: { token: token, password: p1 } });
      token = '';
      SJ.showMsg(msg, '');
      show('stateDone');
    } catch (e) {
      SJ.showMsg(msg, e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
})();
