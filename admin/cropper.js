/* stopjeger.hu — belső felület: képkivágó.
   SJ.cropImage(file, opts) megnyit egy párbeszédablakot, ahol a felhasználó egy keret mozgatásával
   és átméretezésével kiválasztja, a kép melyik része kerüljön fel. A kivágott részt JPEG-be kódolja
   (az újrakódolás a helyadatokat, EXIF/GPS is eltávolítja).
   Visszaad: { blob, width, height, crop: {x, y, w, h}, ratio } — vagy null, ha a felhasználó mégsem vágott ki.

   opts:
     title    — az ablak címe
     hint     — magyarázó szöveg a keret alatt
     ratios   — választható képarányok: [{ label, value }]; value 0 = szabad arány. Egy elemnél nincs választó.
     square   — négyzetes kimenet ekkora oldalhosszal (profilfotó); ilyenkor a ratios figyelmen kívül marad
     round    — kör alakú keret (a profilfotó kör alakban jelenik meg)
     maxSide  — a kimenet hosszabbik oldala legfeljebb ennyi px (alapból 1600)
     minWidth — ha a kimenet ennél keskenyebb, figyelmeztet
     initial  — { crop, ratio }: egy korábbi kivágás visszaállítása
*/
(function () {
  'use strict';

  var MAX_BYTES = 3.5 * 1024 * 1024;   // a szerver 4 MB-ot fogad el
  var DISPLAY_MAX = 1400;               // a kivágó felületen megjelenített kép legnagyobb oldala
  var MIN_BOX = 40;                     // a keret legkisebb mérete, képernyő-pixelben

  var ui = null;   // a párbeszédablak elemei (első használatkor épül fel)
  var st = null;   // az éppen folyó kivágás állapota

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function build() {
    var dlg = el('dialog', 'crop-dlg');
    dlg.setAttribute('aria-labelledby', 'cropTitle');
    var title = el('h2');
    title.id = 'cropTitle';
    var ratios = el('div', 'crop-ratios');
    ratios.setAttribute('role', 'group');
    ratios.setAttribute('aria-label', 'Képarány');

    var stage = el('div', 'crop-stage');
    var canvas = el('canvas');
    var box = el('div', 'crop-box');
    box.tabIndex = 0;
    box.setAttribute('aria-describedby', 'cropInfo');
    box.setAttribute('aria-label', 'Kivágási keret: nyilakkal mozgatható, plusz és mínusz billentyűvel méretezhető');
    ['nw', 'ne', 'sw', 'se'].forEach(function (d) {
      var h = el('span', 'crop-handle crop-' + d);
      h.setAttribute('data-dir', d);
      h.setAttribute('aria-hidden', 'true');
      box.appendChild(h);
    });
    stage.appendChild(canvas);
    stage.appendChild(box);
    var wrap = el('div', 'crop-wrap');
    wrap.appendChild(stage);

    var hint = el('p', 'hint crop-hint');
    var info = el('p', 'hint crop-info');
    info.id = 'cropInfo';

    var actions = el('div', 'crop-actions');
    var full = el('button', 'btn btn-ghost btn-sm crop-full', 'Teljes kép');
    full.type = 'button';
    var spacer = el('span', 'crop-spacer');
    var cancel = el('button', 'btn btn-ghost', 'Mégse');
    cancel.type = 'button';
    var ok = el('button', 'btn', 'Kivágás alkalmazása');
    ok.type = 'button';
    actions.appendChild(full);
    actions.appendChild(spacer);
    actions.appendChild(cancel);
    actions.appendChild(ok);

    [title, ratios, wrap, hint, info, actions].forEach(function (n) { dlg.appendChild(n); });
    document.body.appendChild(dlg);

    ui = { dlg: dlg, title: title, ratios: ratios, stage: stage, canvas: canvas, box: box, hint: hint, info: info, ok: ok };

    cancel.addEventListener('click', function () { finish(null); });
    dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); finish(null); });
    ok.addEventListener('click', apply);
    full.addEventListener('click', function () {
      if (!st) return;
      st.crop = largest(st.ratio, st.W / 2, st.H / 2);
      render();
    });
    stage.addEventListener('pointerdown', pointerDown);
    stage.addEventListener('pointermove', pointerMove);
    stage.addEventListener('pointerup', pointerUp);
    stage.addEventListener('pointercancel', pointerUp);
    box.addEventListener('keydown', keyDown);
    if (window.ResizeObserver) new ResizeObserver(function () { if (st) render(); }).observe(canvas);
    else window.addEventListener('resize', function () { if (st) render(); });
  }

  /* ------------------------------------------------------------ geometria (forráskép-pixelben) */

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* A legnagyobb, adott arányú keret, amely (cx, cy) köré igazítva belefér a képbe. */
  function largest(ratio, cx, cy) {
    var W = st.W, H = st.H, w = W, h = H;
    if (ratio) {
      if (W / H > ratio) { h = H; w = H * ratio; } else { w = W; h = W / ratio; }
    }
    return { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w: w, h: h };
  }

  function scale() { return ui.canvas.clientWidth / st.W || 1; }

  function minSize() { return MIN_BOX / scale(); }

  function toImage(ev) {
    var r = ui.canvas.getBoundingClientRect(), s = scale();
    return { x: clamp((ev.clientX - r.left) / s, 0, st.W), y: clamp((ev.clientY - r.top) / s, 0, st.H) };
  }

  /* Méretezés: (ax, ay) a rögzített sarok, (px, py) a húzott sarok új helye. */
  function resizeTo(ax, ay, px, py, fallbackX, fallbackY) {
    var dx = px - ax, dy = py - ay;
    var dirX = dx ? Math.sign(dx) : fallbackX, dirY = dy ? Math.sign(dy) : fallbackY;
    var maxW = dirX > 0 ? st.W - ax : ax, maxH = dirY > 0 ? st.H - ay : ay;
    var w = Math.abs(dx), h = Math.abs(dy), r = st.ratio, min = minSize();
    if (r) {
      var limit = Math.min(maxW, maxH * r);
      w = clamp(Math.max(w, h * r), Math.min(min, limit), limit);
      h = w / r;
    } else {
      w = clamp(w, Math.min(min, maxW), maxW);
      h = clamp(h, Math.min(min, maxH), maxH);
    }
    st.crop = { x: dirX > 0 ? ax : ax - w, y: dirY > 0 ? ay : ay - h, w: w, h: h };
  }

  /* ------------------------------------------------------------ megjelenítés */

  function output() {
    var c = st.crop, o = st.opts;
    if (o.square) {
      var side = Math.max(1, Math.min(o.square, Math.round(c.w)));
      return { w: side, h: side };
    }
    var k = Math.min(1, (o.maxSide || 1600) / Math.max(c.w, c.h));
    return { w: Math.max(1, Math.round(c.w * k)), h: Math.max(1, Math.round(c.h * k)) };
  }

  function render() {
    var c = st.crop, s = scale(), b = ui.box.style;
    b.left = (c.x * s) + 'px';
    b.top = (c.y * s) + 'px';
    b.width = (c.w * s) + 'px';
    b.height = (c.h * s) + 'px';
    var out = output();
    var text = 'Eredmény: ' + out.w + ' × ' + out.h + ' px';
    var low = st.opts.minWidth && out.w < st.opts.minWidth;
    if (low) text += ' — kis felbontás, megosztáskor elmosódott lehet. Válassz nagyobb részt vagy nagyobb képet.';
    ui.info.textContent = text;
    ui.info.classList.toggle('crop-warn', !!low);
  }

  function renderRatios() {
    ui.ratios.textContent = '';
    var list = st.opts.square ? [] : (st.opts.ratios || []);
    ui.ratios.hidden = list.length < 2;
    list.forEach(function (item) {
      var btn = el('button', 'crop-ratio', item.label);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(item.value === st.ratio));
      btn.addEventListener('click', function () {
        st.ratio = item.value;
        ui.ratios.querySelectorAll('.crop-ratio').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        var c = st.crop;
        // szabad aránynál a meglévő keret marad; rögzített aránynál a lehető legnagyobb keret a mostani közepén
        if (item.value) st.crop = largest(item.value, c.x + c.w / 2, c.y + c.h / 2);
        render();
      });
      ui.ratios.appendChild(btn);
    });
  }

  /* ------------------------------------------------------------ egér, érintés, billentyűzet */

  function pointerDown(ev) {
    if (!st || ev.button > 0) return;
    ev.preventDefault();
    var p = toImage(ev), c = st.crop;
    var dir = ev.target.getAttribute && ev.target.getAttribute('data-dir');
    if (dir) {
      var sx = dir.charAt(1) === 'e' ? 1 : -1, sy = dir.charAt(0) === 's' ? 1 : -1;
      st.drag = { mode: 'resize', ax: sx > 0 ? c.x : c.x + c.w, ay: sy > 0 ? c.y : c.y + c.h, sx: sx, sy: sy };
    } else {
      if (ev.target !== ui.box) {
        // a kereten kívül kattintva a keret oda ugrik, és onnan húzható tovább
        st.crop = { x: clamp(p.x - c.w / 2, 0, st.W - c.w), y: clamp(p.y - c.h / 2, 0, st.H - c.h), w: c.w, h: c.h };
        render();
      }
      st.drag = { mode: 'move', px: p.x, py: p.y, x: st.crop.x, y: st.crop.y };
    }
    ui.stage.setPointerCapture(ev.pointerId);
    ui.stage.classList.add('is-dragging');
  }

  function pointerMove(ev) {
    if (!st || !st.drag) return;
    var d = st.drag, p = toImage(ev), c = st.crop;
    if (d.mode === 'move') {
      c.x = clamp(d.x + p.x - d.px, 0, st.W - c.w);
      c.y = clamp(d.y + p.y - d.py, 0, st.H - c.h);
    } else {
      resizeTo(d.ax, d.ay, p.x, p.y, d.sx, d.sy);
    }
    render();
  }

  function pointerUp(ev) {
    if (!st || !st.drag) return;
    st.drag = null;
    ui.stage.classList.remove('is-dragging');
    if (ui.stage.hasPointerCapture(ev.pointerId)) ui.stage.releasePointerCapture(ev.pointerId);
  }

  function keyDown(ev) {
    if (!st) return;
    var c = st.crop, step = Math.max(1, Math.min(st.W, st.H) * (ev.shiftKey ? 0.1 : 0.01));
    var moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[ev.key]) {
      c.x = clamp(c.x + moves[ev.key][0], 0, st.W - c.w);
      c.y = clamp(c.y + moves[ev.key][1], 0, st.H - c.h);
    } else if (ev.key === '+' || ev.key === '-' || ev.key === '=') {
      var k = ev.key === '-' ? 0.95 : 1 / 0.95;
      var cx = c.x + c.w / 2, cy = c.y + c.h / 2, min = minSize(), w, h;
      if (st.ratio) {
        var limit = Math.min(st.W, st.H * st.ratio);
        w = clamp(c.w * k, Math.min(min, limit), limit);
        h = w / st.ratio;
      } else {
        w = clamp(c.w * k, Math.min(min, st.W), st.W);
        h = clamp(c.h * k, Math.min(min, st.H), st.H);
      }
      st.crop = { x: clamp(cx - w / 2, 0, st.W - w), y: clamp(cy - h / 2, 0, st.H - h), w: w, h: h };
    } else {
      return;
    }
    ev.preventDefault();
    render();
  }

  /* ------------------------------------------------------------ indítás és befejezés */

  async function apply() {
    if (!st) return;
    var c = st.crop, out = output();
    ui.ok.disabled = true;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = out.w;
      canvas.height = out.h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';   // átlátszó PNG háttere
      ctx.fillRect(0, 0, out.w, out.h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(st.bitmap, c.x, c.y, c.w, c.h, 0, 0, out.w, out.h);
      var quality = 0.86, blob = null;
      do {
        blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
        quality -= 0.12;
      } while (blob && blob.size > MAX_BYTES && quality > 0.4);
      if (!blob) throw new Error('A képet nem sikerült előkészíteni.');
      var crop = { x: c.x, y: c.y, w: c.w, h: c.h };
      finish({ blob: blob, width: out.w, height: out.h, crop: crop, ratio: st.ratio });
    } catch (e) {
      ui.info.textContent = e.message || 'A képet nem sikerült előkészíteni.';
      ui.info.classList.add('crop-warn');
    } finally {
      ui.ok.disabled = false;
    }
  }

  function finish(result) {
    if (!st) return;
    var done = st;
    st = null;
    if (done.bitmap.close) done.bitmap.close();
    if (ui.dlg.open) ui.dlg.close();
    done.resolve(result);
  }

  async function cropImage(file, opts) {
    opts = opts || {};
    if (!file) return null;
    if (file.type && !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('JPEG, PNG vagy WebP képet válassz.');
    if (file.size > 25 * 1024 * 1024) throw new Error('A kép túl nagy (legfeljebb 25 MB).');
    var bitmap;
    try { bitmap = await createImageBitmap(file); } catch (e) { throw new Error('Ezt a képet nem sikerült beolvasni.'); }
    if (!ui) build();
    if (st) finish(null);

    return new Promise(function (resolve) {
      var list = opts.ratios || [];
      var ratio = opts.square ? 1 : (list.length ? list[0].value : 0);
      if (opts.initial && !opts.square && list.some(function (r) { return r.value === opts.initial.ratio; })) ratio = opts.initial.ratio;
      st = { bitmap: bitmap, W: bitmap.width, H: bitmap.height, ratio: ratio, opts: opts, resolve: resolve, drag: null };

      // a képernyőn egy kicsinyített másolat látszik; a kivágás az eredeti felbontásból készül
      var k = Math.min(1, DISPLAY_MAX / Math.max(st.W, st.H));
      ui.canvas.width = Math.max(1, Math.round(st.W * k));
      ui.canvas.height = Math.max(1, Math.round(st.H * k));
      ui.canvas.getContext('2d').drawImage(bitmap, 0, 0, ui.canvas.width, ui.canvas.height);

      ui.title.textContent = opts.title || 'Kép kivágása';
      ui.hint.textContent = opts.hint || '';
      ui.hint.hidden = !opts.hint;
      ui.box.classList.toggle('is-round', !!opts.round);
      renderRatios();

      ui.dlg.showModal();
      var init = opts.initial && opts.initial.crop;
      if (init && init.x >= 0 && init.y >= 0 && init.x + init.w <= st.W + 0.5 && init.y + init.h <= st.H + 0.5) {
        st.crop = { x: init.x, y: init.y, w: Math.min(init.w, st.W - init.x), h: Math.min(init.h, st.H - init.y) };
      } else {
        st.crop = largest(ratio, st.W / 2, st.H / 2);
      }
      render();
      ui.ok.focus({ preventScroll: true });
    });
  }

  window.SJ = window.SJ || {};
  window.SJ.cropImage = cropImage;
})();
