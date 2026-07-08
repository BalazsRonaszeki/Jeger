const SITE_URL = 'https://jeger-peticio.com/';
const SHARE_TITLE = 'JÉGER petíció';
const SHARE_TEXT = 'Írd alá te is a petíciót a JÉGER rendszer leállításáért!';

const shareNote = document.getElementById('shareNote');

function showNote(text) {
  shareNote.textContent = text;
}

document.getElementById('shareFb').addEventListener('click', () => {
  const url = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(SITE_URL);
  window.open(url, '_blank', 'noopener,width=600,height=520');
});

document.getElementById('shareEmail').href =
  'mailto:?subject=' + encodeURIComponent(SHARE_TITLE) +
  '&body=' + encodeURIComponent(SHARE_TEXT + '\n\n' + SITE_URL);

// Instagram nem támogat közvetlen, böngészőből hívható megosztó linket
// (nincs Facebookéhoz hasonló sharer-URL). Mobilon a natív megosztási
// felület (Web Share API) tartalmazza az Instagramot is, ha telepítve van;
// asztali gépen ez nem elérhető, ott a linket vágólapra másoljuk, hogy be
// lehessen illeszteni Instagram sztoriba vagy a bio linkbe.
document.getElementById('shareIg').addEventListener('click', async () => {
  if (navigator.share) {
    try {
      await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SITE_URL });
    } catch {
      // Felhasználó megszakította a megosztást — nincs teendő.
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(SITE_URL);
    showNote('Link másolva a vágólapra — illeszd be Instagram sztoridba vagy a bio linkedbe!');
  } catch {
    showNote('A link: ' + SITE_URL);
  }
});
