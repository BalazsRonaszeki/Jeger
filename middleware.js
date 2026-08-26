export const config = {
  matcher: ['/infotainment', '/infotainment/:path*'],
};

export default function middleware(request) {
  const user = process.env.INFOTAINMENT_USER || 'jeger';
  const pass = process.env.INFOTAINMENT_PASSWORD;

  if (!pass) {
    return new Response('INFOTAINMENT_PASSWORD nincs beállítva', { status: 500 });
  }

  const auth = request.headers.get('authorization');
  const expected = 'Basic ' + btoa(`${user}:${pass}`);

  if (auth !== expected) {
    return new Response('Belépés szükséges', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="infotainment", charset="UTF-8"',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  }

  // No return value: let Vercel serve the actual static file as normal.
}
