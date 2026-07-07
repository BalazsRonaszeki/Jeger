const form = document.getElementById('sigForm');
const msg = document.getElementById('msg');
const isFarmer = document.getElementById('isFarmer');
const hectaresGroup = document.getElementById('hectaresGroup');

isFarmer.addEventListener('change', () => {
  hectaresGroup.hidden = isFarmer.value !== 'yes';
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
      msg.textContent = 'Köszönjük, az aláírás regisztrálva.';
      form.reset();
      hectaresGroup.hidden = true;
    } else {
      msg.textContent = json.detail || 'Hiba történt.';
    }
  } catch (err) {
    console.error(err);
    msg.textContent = 'Kapcsolati hiba, próbáld meg később.';
  }
});
