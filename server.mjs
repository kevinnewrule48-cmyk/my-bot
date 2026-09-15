import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const oauthStates = new Map();
const sessions = new Map();
const clientId = process.env.DERIV_CLIENT_ID;
const redirectUri = process.env.DERIV_REDIRECT_URI;
const oauthReady = Boolean(clientId && redirectUri && redirectUri.startsWith('https://'));
const base64url = (value) => Buffer.from(value).toString('base64url');
const cookieValue = (req, name) => (req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);

async function exchangeCode(code, verifier) {
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri });
  const response = await fetch('https://auth.deriv.com/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
  return response.json();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/auth/status') {
    const session = sessions.get(cookieValue(req, 'deriv_session'));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ configured: oauthReady, connected: Boolean(session), mode: session ? 'demo connection pending account selection' : 'not connected' }));
  }
  if (url.pathname === '/api/auth/start') {
    if (!oauthReady) { res.writeHead(409, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'OAuth is not configured. Set DERIV_CLIENT_ID and an HTTPS DERIV_REDIRECT_URI first.' })); }
    const state = base64url(crypto.randomBytes(32));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    oauthStates.set(state, { verifier, expires: Date.now() + 10 * 60 * 1000 });
    const authorize = new URL('https://auth.deriv.com/oauth2/auth');
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'trade', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    res.writeHead(302, { location: authorize.toString(), 'cache-control': 'no-store' }); return res.end();
  }
  if (url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state'), code = url.searchParams.get('code'), record = state && oauthStates.get(state);
    oauthStates.delete(state);
    if (!record || record.expires < Date.now() || !code) { res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('Invalid or expired sign-in response. Return to the dashboard and try again.'); }
    try {
      const token = await exchangeCode(code, record.verifier);
      const sessionId = base64url(crypto.randomBytes(32));
      sessions.set(sessionId, { accessToken: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 });
      res.writeHead(302, { location: '/', 'set-cookie': `deriv_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token.expires_in ?? 3600}`, 'cache-control': 'no-store' }); return res.end();
    } catch { res.writeHead(502, { 'content-type': 'text/plain' }); return res.end('Deriv sign-in could not be completed. Check the registered callback URL and try again.'); }
  }
  const requested = req.url === '/' ? '/public/index.html' : `/public${req.url.split('?')[0]}`;
  const target = path.normalize(path.join(root, requested));
  if (!target.startsWith(path.join(root, 'public'))) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': mime[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Deriv Over/Under Lab: http://localhost:${port}`));
