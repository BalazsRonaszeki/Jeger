/*
 * Süti-hozzájárulás + Google Analytics 4 (Consent Mode v2)
 * -----------------------------------------------------------------------------
 * Bekötés bármelyik oldalon, közvetlenül a </body> elé:
 *     <script src="/cookie-consent.js" defer></script>
 *
 * Működés:
 *  - A GA szkript CSAK elfogadás után töltődik be (nem elég a Consent Mode).
 *  - Az alapértelmezés minden tárolási célra "denied".
 *  - A döntés localStorage-ban tárolódik; a POLICY_VERSION emelésével újra
 *    bekérhető (pl. ha új szolgáltató kerül a tájékoztatóba).
 *  - Az újranyitáshoz elég egy [data-cookie-settings] attribútumú elem,
 *    vagy a window.cookieConsent.open() hívás.
 */
(function () {
  'use strict';

  // --- BEÁLLÍTÁSOK ------------------------------------------------------------
  var GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';   // ← ide jön a valódi GA4 mérőazonosító
  var PRIVACY_URL       = '/adatkezeles.html';
  var STORAGE_KEY       = 'stopjeger_cookie_consent';
  var POLICY_VERSION    = 1;
  // ---------------------------------------------------------------------------

  var gaInjected = false;

  function readConsent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== POLICY_VERSION) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function writeConsent(analytics) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: POLICY_VERSION,
        analytics: !!analytics,
        ts: new Date().toISOString()
      }));
    } catch (e) { /* privát mód: a döntés csak az oldalbetöltésre él */ }
  }

  // --- Google Consent Mode v2 -------------------------------------------------
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  function injectGA() {
    if (gaInjected) return;
    if (!GA_MEASUREMENT_ID || GA_MEASUREMENT_ID.indexOf('XXXX') !== -1) {
      if (window.console) console.warn('[cookie-consent] Nincs beallitva GA4 merőazonosito.');
      return;
    }
    gaInjected = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
  }

  function applyConsent(analytics) {
    gtag('consent', 'update', { analytics_storage: analytics ? 'granted' : 'denied' });
    if (analytics) injectGA();
  }

  // --- Stílus -----------------------------------------------------------------
  // A var(--x, fallback) alak miatt átveszi az oldal palettáját, ha van ilyen,
  // és önállóan is helyesen jelenik meg, ha nincs.
  var CSS = [
    '.cc-banner{position:fixed;left:0;right:0;bottom:0;z-index:9999;',
    'background:var(--surface,#fff);color:var(--ink,#1b2420);',
    'border-top:1px solid var(--line,#ccd6c8);',
    'box-shadow:0 -8px 28px -18px rgba(20,30,25,.45);',
    'padding:1.15rem 1.2rem;font-size:.9rem;line-height:1.55;',
    'font-family:inherit;animation:cc-up .28s ease-out}',
    '@keyframes cc-up{from{transform:translateY(100%)}to{transform:translateY(0)}}',
    '@media (prefers-reduced-motion:reduce){.cc-banner{animation:none}}',
    '.cc-inner{max-width:64rem;margin:0 auto;display:flex;gap:1.1rem;',
    'align-items:flex-start;flex-wrap:wrap;justify-content:space-between}',
    '.cc-text{flex:1 1 22rem;min-width:0;margin:0}',
    '.cc-text b{display:block;margin-bottom:.3rem;font-size:.98rem}',
    '.cc-text a{color:var(--accent,#b3560a)}',
    '.cc-actions{display:flex;gap:.6rem;flex-wrap:wrap;flex:0 0 auto}',
    '.cc-btn{font:inherit;font-size:.88rem;font-weight:600;cursor:pointer;',
    'padding:.62em 1.35em;border-radius:8px;border:1px solid transparent;',
    'min-width:9.5rem;text-align:center}',
    '.cc-btn:focus-visible{outline:2px solid var(--accent,#b3560a);outline-offset:2px}',
    '.cc-accept{background:var(--accent,#b3560a);color:var(--accent-ink,#fff)}',
    '.cc-reject{background:transparent;color:var(--ink,#1b2420);',
    'border-color:var(--ink-soft,#48544c)}',
    '.cc-accept:hover,.cc-reject:hover{opacity:.88}',
    '@media (max-width:560px){.cc-actions{width:100%}.cc-btn{flex:1 1 auto}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('cc-style')) return;
    var st = document.createElement('style');
    st.id = 'cc-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // --- Banner -----------------------------------------------------------------
  var bannerEl = null;

  function closeBanner() {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
  }

  function decide(analytics) {
    writeConsent(analytics);
    applyConsent(analytics);
    closeBanner();
  }

  function showBanner() {
    if (bannerEl) return;
    injectCSS();

    bannerEl = document.createElement('div');
    bannerEl.className = 'cc-banner';
    bannerEl.setAttribute('role', 'dialog');
    bannerEl.setAttribute('aria-live', 'polite');
    bannerEl.setAttribute('aria-label', 'Süti-beállítások');

    var inner = document.createElement('div');
    inner.className = 'cc-inner';

    var text = document.createElement('p');
    text.className = 'cc-text';
    text.innerHTML =
      '<b>Sütiket használnánk a látogatottság méréséhez</b>' +
      'Az oldal működéséhez szükséges sütiket mindig használjuk. Ezen felül a Google Analytics ' +
      'segítségével mérnénk, hány látogató érkezik és mely tartalmakat olvassák — ehhez a te ' +
      'hozzájárulásod kell. A mérés nélkül is minden funkció ugyanúgy működik. ' +
      'Részletek az <a href="' + PRIVACY_URL + '">adatkezelési tájékoztatóban</a>.';

    var actions = document.createElement('div');
    actions.className = 'cc-actions';

    var reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'cc-btn cc-reject';
    reject.textContent = 'Csak a szükségeseket';
    reject.addEventListener('click', function () { decide(false); });

    var accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'cc-btn cc-accept';
    accept.textContent = 'Elfogadom';
    accept.addEventListener('click', function () { decide(true); });

    // Az elutasítás ugyanolyan elérhető és ugyanakkora, mint az elfogadás.
    actions.appendChild(reject);
    actions.appendChild(accept);
    inner.appendChild(text);
    inner.appendChild(actions);
    bannerEl.appendChild(inner);
    document.body.appendChild(bannerEl);
    reject.focus();
  }

  // --- Indulás ----------------------------------------------------------------
  function start() {
    var stored = readConsent();
    if (stored) {
      applyConsent(stored.analytics);
    } else {
      showBanner();
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-cookie-settings]'),
      function (el) {
        el.addEventListener('click', function (e) {
          e.preventDefault();
          showBanner();
        });
      }
    );
  }

  window.cookieConsent = {
    open: showBanner,
    get: readConsent,
    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      showBanner();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
