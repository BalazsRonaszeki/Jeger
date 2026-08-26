export const config = {
  matcher: ['/infotainment', '/infotainment/:path*'],
};

const COOKIE_NAME = 'infotainment_auth';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 nap

function loginPage({ error } = {}) {
  return `<!doctype html>
<html lang="hu"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Belépés szükséges</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#eef1ea;color:#1b2420;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:1.5rem}
  @media(prefers-color-scheme:dark){body{background:#12181a;color:#e9ede5}}
  form{background:#fff;border:1px solid #ccd6c8;border-radius:12px;padding:2rem 2.2rem;max-width:340px;width:100%;box-shadow:0 10px 28px -14px rgba(20,30,25,.22);display:flex;flex-direction:column;gap:1rem}
  @media(prefers-color-scheme:dark){form{background:#1a2224;border-color:#2c3a37}}
  .eyebrow{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#b3560a;font-weight:600;font-family:ui-monospace,monospace}
  h1{font-size:1.25rem;margin:0;line-height:1.3}
  input{padding:.7em .9em;border-radius:8px;border:1px solid #ccd6c8;background:transparent;color:inherit;font-size:1rem;font-family:inherit}
  button{padding:.7em 1em;border-radius:8px;border:none;background:#b3560a;color:#fff;font-weight:600;font-size:1rem;cursor:pointer;font-family:inherit}
  .err{color:#b3560a;font-size:.85rem;margin:0}
</style>
</head><body>
<form method="POST">
  <div class="eyebrow">Munkapéldány &middot; nem publikus</div>
  <h1>Ez az oldal jelszóval védett</h1>
  <input type="password" name="password" placeholder="Jelszó" autocomplete="off" autofocus>
  <button type="submit">Belépés</button>
  ${error ? '<p class="err">Hibás jelszó, próbáld újra.</p>' : ''}
</form>
</body></html>`;
}

function unauthorized(opts) {
  return new Response(loginPage(opts), {
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}

export default async function middleware(request) {
  const pass = process.env.INFOTAINMENT_PASSWORD;
  if (!pass) {
    return new Response('INFOTAINMENT_PASSWORD nincs beállítva', { status: 500 });
  }

  const url = new URL(request.url);

  if (request.method === 'POST') {
    const form = await request.formData();
    if (form.get('password') === pass) {
      const res = new Response(null, {
        status: 303,
        headers: { Location: url.pathname },
      });
      res.headers.append(
        'Set-Cookie',
        `${COOKIE_NAME}=${pass}; Path=/infotainment; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
      );
      return res;
    }
    return unauthorized({ error: true });
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const authed = cookieHeader
    .split(';')
    .some((c) => c.trim() === `${COOKIE_NAME}=${pass}`);

  if (!authed) {
    return unauthorized();
  }

  // Hitelesített GET: hagyjuk, hogy a Vercel a statikus fájlt normálisan kiszolgálja.
}
