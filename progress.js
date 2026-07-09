// Aláírás-számláló mérföldkövekkel: a kijelzett "cél" 500-as ugrásokban nő,
// mindig amikor az aktuális szám a cél közelébe ér (cél−50-en belülre) —
// így a sáv sosem tűnik "majdnem késznek", és mindig van hova növekedni.
const MILESTONE_LEPES = 500;
const MILESTONE_KUSZOB = 50;

function kovetkezoCelszam(count) {
  let cel = MILESTONE_LEPES;
  while (count >= cel - MILESTONE_KUSZOB) cel += MILESTONE_LEPES;
  return cel;
}

async function frissitsHaladast() {
  const card = document.getElementById('progressCard');
  const fillEl = document.getElementById('progressBarFill');
  const countEl = document.getElementById('progressCount');
  const targetEl = document.getElementById('progressTarget');
  const hintEl = document.getElementById('progressHint');
  if (!card || !fillEl) return;

  try {
    const res = await fetch('/api/count');
    const data = await res.json();
    if (typeof data.count !== 'number') throw new Error('nincs szám a válaszban');

    const count = data.count;
    const cel = kovetkezoCelszam(count);
    const szazalek = Math.min(100, Math.max(0, Math.round((count / cel) * 100)));

    countEl.textContent = count.toLocaleString('hu-HU');
    targetEl.textContent = ' / ' + cel.toLocaleString('hu-HU');
    hintEl.textContent = 'Segíts elérni a következő mérföldkövet — küldd tovább a petíciót!';

    // Egy tick késleltetés, hogy a böngésző biztosan a 0%-ról induló
    // állapotot rendereljem előbb — enélkül a CSS-átmenet néha nem indul el.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { fillEl.style.width = szazalek + '%'; });
    });
  } catch (err) {
    console.error('[progress] Nem sikerült betölteni az aláírásszámot:', err);
    card.hidden = true;
  }
}

frissitsHaladast();
