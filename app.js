const form = document.getElementById('sigForm');
const msg = document.getElementById('msg');
const isFarmer = document.getElementById('isFarmer');
const hectaresGroup = document.getElementById('hectaresGroup');

function syncHectaresVisibility() {
  hectaresGroup.hidden = isFarmer.value !== 'yes';
}

isFarmer.addEventListener('change', syncHectaresVisibility);
syncHectaresVisibility();

// A böngésző natív űrlap-hibaüzenetei a böngésző/OS nyelvét követik, nem az
// oldal nyelvét — ezért saját, magyar üzeneteket állítunk be minden mezőhöz.
function hungarianMessage(field) {
  if (field.validity.valueMissing) {
    return field.type === 'checkbox'
      ? 'Ennek elfogadása kötelező a beküldéshez.'
      : 'Ez a mező kötelező.';
  }
  if (field.validity.typeMismatch && field.type === 'email') {
    return 'Adj meg egy érvényes e-mail címet.';
  }
  return 'Kérjük, ellenőrizd ezt a mezőt.';
}

form.querySelectorAll('[required]').forEach((field) => {
  field.addEventListener('invalid', () => {
    field.setCustomValidity(hungarianMessage(field));
  });
  field.addEventListener('input', () => field.setCustomValidity(''));
  field.addEventListener('change', () => field.setCustomValidity(''));
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = 'Küldés...';
  const data = new FormData(form);

  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      body: data
    });
    const json = await res.json();
    if (res.ok) {
      window.location.href = 'koszonjuk.html';
    } else {
      msg.textContent = json.detail || 'Hiba történt.';
    }
  } catch (err) {
    console.error(err);
    msg.textContent = 'Kapcsolati hiba, próbáld meg később.';
  }
});
