/* Proxy Vercel -> Apps Script Web App (menghindari CORS).
   Env: GAS_URL = URL Web App (…/exec)

   Kontrak:
   - POST JSON  -> diteruskan apa adanya ke GAS (semua action API).
   - GET        -> query string diteruskan (dipakai publicGet via /p/<token>).
   - hanya JSON valid dari upstream yang dibalas 200; lainnya -> 502 terstruktur.
   - timeout 25s agar function tidak menggantung. */
const UPSTREAM_TIMEOUT_MS = 25000;

function noStore(res) { res.setHeader('Cache-Control', 'no-store'); }

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  const url = process.env.GAS_URL;
  if (!url) { noStore(res); return res.status(500).json({ ok: false, error: 'GAS_URL belum diset di env Vercel' }); }

  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') { noStore(res); return res.status(405).json({ ok: false, error: 'GET/POST saja' }); }

  let upstreamUrl = url;
  const init = { method, redirect: 'follow', headers: {} };

  if (method === 'POST') {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    init.headers['Content-Type'] = 'text/plain;charset=utf-8'; // Apps Script: hindari preflight
    init.body = body;
  } else {
    const qs = new URLSearchParams(String(req.url || '').split('?')[1] || '').toString();
    if (qs) upstreamUrl += (upstreamUrl.includes('?') ? '&' : '?') + qs;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  init.signal = ctrl.signal;

  try {
    const up = await fetch(upstreamUrl, init);
    const text = await up.text();
    noStore(res);
    try {
      return res.status(200).json(JSON.parse(text)); // GAS selalu balas {ok,...}
    } catch {
      if (up.status >= 400) return res.status(502).json({ ok: false, error: 'GAS upstream HTTP ' + up.status });
      return res.status(502).json({ ok: false, error: 'respons upstream bukan JSON valid' });
    }
  } catch (err) {
    noStore(res);
    const msg = err && err.name === 'AbortError' ? 'timeout upstream (' + UPSTREAM_TIMEOUT_MS + 'ms)' : err.message;
    return res.status(502).json({ ok: false, error: 'GAS upstream gagal: ' + msg });
  } finally {
    clearTimeout(timer);
  }
}
