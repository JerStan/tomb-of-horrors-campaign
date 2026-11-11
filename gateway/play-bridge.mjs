import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { isIPv4 } from 'node:net';
import { isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const configuration = process.argv[2];
if (!configuration || !isAbsolute(configuration)) {
  throw new Error('Provide an absolute path to the private bridge configuration file.');
}
const { browserOrigin, port, upstream, codeHash, sessionKey } = JSON.parse(readFileSync(configuration, 'utf8'));
const publicUrl = new URL(browserOrigin);
const loopbackTest = publicUrl.protocol === 'http:' && publicUrl.hostname === 'localhost' && Number(publicUrl.port) === port;
if (browserOrigin !== publicUrl.origin || (!loopbackTest && publicUrl.protocol !== 'https:') ||
    !Number.isInteger(port) || port < 1024 || port > 65535 ||
    !isIPv4(upstream?.hostname) || !/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(upstream.hostname) ||
    !Number.isInteger(upstream.port) || upstream.port < 1024 || upstream.port > 65535 ||
    !isAbsolute(upstream.database ?? '') || !/^[a-f0-9]{64}$/.test(codeHash) || !/^[a-f0-9]{64}$/.test(sessionKey)) {
  throw new Error('The GameVault bridge configuration is invalid.');
}
const upstreamDatabase = new DatabaseSync(upstream.database, { readOnly: true });
const upstreamAccess = upstreamDatabase.prepare("SELECT value FROM settings WHERE key='access'").get()?.value;
upstreamDatabase.close();
if (typeof upstreamAccess !== 'string' || upstreamAccess.length !== 24) {
  throw new Error('GameVault could not read the existing game access settings.');
}

const entry = '/tomb-of-horrors/';
const stationEntry = '/murder-on-arturus-station/';
const entries = new Set(['/',entry,stationEntry]);
const apiPath = /^\/api\/(?:station\/(?:setup|start)|backup|restore|branches(?:\/[a-z][a-z0-9-]{0,47}(?:\/prepare|\/picture-status|\/preferences|\/rename|\/activity|\/archive\?after=\d+|\/pictures(?:\/[a-f0-9]{32})?)?)?)$/;
const cookieName = '__Host-gamevault';
const sessionSeconds = 8 * 60 * 60;
const responseHeaders = ['content-type', 'cache-control', 'x-content-type-options', 'content-security-policy', 'referrer-policy'];
const nativeAccess = "let access = sessionStorage.getItem('gamevault-access') || '';";
const remoteAccess = "let access = 'signed-in';";
const signInDigest = Buffer.from(codeHash, 'hex');
const signingKey = Buffer.from(sessionKey, 'hex');

function headers(type) {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
}

function fail(res, status, error) {
  res.writeHead(status, headers('application/json'));
  res.end(JSON.stringify({ error }));
}

function signInPage(res, incorrect = false, destination = entry) {
  res.writeHead(incorrect ? 401 : 200, {
    ...headers('text/html; charset=utf-8'),
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GameVault · Private Play</title>
<style>
body{margin:0;background:#191919;color:#f7ead5;font:1rem/1.5 system-ui,sans-serif}
main{box-sizing:border-box;max-width:30rem;margin:8vh auto;padding:1.5rem}
h1{font:700 2.4rem Georgia,serif}label{display:block;margin:1rem 0 .35rem}
input,button{box-sizing:border-box;width:100%;min-height:44px;font:inherit;padding:.6rem .8rem;border:1px solid #a68762;border-radius:.45rem}
input{background:#29231f;color:inherit}button{margin-top:.75rem;background:#74502f;color:white}
a{color:#f4c67f}
</style>
<main><h1>GameVault</h1><p>Private Play · ${destination === stationEntry ? 'Murder on Arturus Station' : destination === '/' ? 'Choose a game' : 'Tomb of Horrors'}</p>
<form method="post" action="/sign-in">
<input type="hidden" name="returnTo" value="${destination}">
${incorrect ? '<p role="alert">That code did not match. Please try again.</p>' : ''}
<label for="code">Private GameVault sign-in code</label>
<input id="code" name="code" type="password" autocomplete="current-password" required maxlength="64">
<button type="submit">Enter GameVault</button>
</form>
<p><a href="https://jerstan.github.io/tomb-of-horrors-campaign/">Return to the public library</a></p>
</main></html>`);
}

function signature(value) {
  return createHmac('sha256', signingKey).update(value).digest();
}

function signedIn(req) {
  const cookies = (req.headers.cookie || '').split(';').map(cookie => cookie.trim());
  const sessions = cookies.filter(cookie => cookie.startsWith(cookieName + '='));
  if (sessions.length !== 1) return false;
  const token = sessions[0].slice(cookieName.length + 1);
  const match = /^(\d{10}\.[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match || Number(match[1].slice(0, 10)) <= Date.now() / 1000) return false;
  const supplied = Buffer.from(match[2], 'base64url');
  return supplied.length === 32 && timingSafeEqual(supplied, signature(match[1]));
}

async function signIn(req, res) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    return fail(res, 415, 'Open the GameVault sign-in page.');
  }
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 512) return fail(res, 413, 'Sign-in request is too large.');
  }
  const fields = new URLSearchParams(body);
  const destination = fields.get('returnTo') || entry;
  if (fields.getAll('returnTo').length > 1 || !entries.has(destination)) return fail(res,400,'Choose a GameVault game.');
  const code = fields.get('code')?.trim() || '';
  const digest = createHash('sha256').update(code).digest();
  if (fields.getAll('code').length !== 1 || !timingSafeEqual(digest, signInDigest)) {
    return signInPage(res, true, destination);
  }
  const expires = Math.floor(Date.now() / 1000) + sessionSeconds;
  const payload = `${expires}.${randomBytes(16).toString('base64url')}`;
  const value = payload + '.' + signature(payload).toString('base64url');
  res.writeHead(303, {
    ...headers('text/plain; charset=utf-8'),
    Location: destination,
    'Set-Cookie': `${cookieName}=${value}; Path=/; Max-Age=${sessionSeconds}; Secure; HttpOnly; SameSite=Lax`,
  });
  res.end();
}

function forward(req, res, page) {
  const { hostname, port } = upstream;
  const host = `${hostname}:${port}`;
  const upstreamHeaders = { host, authorization: 'Bearer ' + upstreamAccess };
  if (req.method === 'POST') upstreamHeaders.origin = 'http://' + host;
  for (const name of ['content-type', 'content-length']) {
    if (req.headers[name] !== undefined) upstreamHeaders[name] = req.headers[name];
  }
  const backend = request({ hostname, port, method: req.method, path: req.url, headers: upstreamHeaders }, async response => {
    const safe = Object.fromEntries(responseHeaders.flatMap(name =>
      response.headers[name] === undefined ? [] : [[name, response.headers[name]]]));
    if (!page || response.statusCode !== 200) {
      res.writeHead(response.statusCode ?? 502, safe);
      return response.pipe(res);
    }
    try {
      response.setEncoding('utf8');
      let html = '';
      for await (const chunk of response) html += chunk;
      if (!html.includes(nativeAccess)) return fail(res, 502, 'The game page could not be opened.');
      res.writeHead(200, safe);
      return res.end(html.replace(nativeAccess, remoteAccess));
    } catch {
      if (!res.headersSent) fail(res, 502, 'The game page could not be opened.');
      else res.end();
    }
  });
  backend.on('error', () => {
    if (!res.headersSent) fail(res, 502, 'The game could not be reached on the laptop.');
    else res.end();
  });
  res.on('close', () => backend.destroy());
  req.pipe(backend);
}

async function handle(req, res) {
  if (req.headers.host !== publicUrl.host) {
    return fail(res, 421, 'Open the HTTPS GameVault address.');
  }
  if (!['GET', 'POST'].includes(req.method)) return fail(res, 405, 'Method not allowed.');
  if (req.method === 'POST' && req.headers.origin !== browserOrigin) {
    return fail(res, 403, 'Open GameVault directly.');
  }
  if (req.url === '/sign-in' && req.method === 'POST') return signIn(req, res);
  const page = req.method === 'GET' && entries.has(req.url);
  if (!page && !apiPath.test(req.url)) return fail(res, 404, 'Page not found.');
  if (!signedIn(req)) {
    if (page) return signInPage(res, false, req.url);
    return fail(res, 401, 'Your private session has ended. Reload the page to sign in.');
  }
  forward(req, res, page);
}

createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) fail(res, 503, 'GameVault sign-in is unavailable.');
    else res.end();
  });
}).listen(port, '127.0.0.1', () => console.log('GameVault bridge ready on loopback port ' + port));
