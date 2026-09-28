/* dev: the two things every check in this project needs — a static server that
   serves modules with the right MIME types, and a headless browser with a
   devtools port open. tools/page-shot.mjs expects the browser; nothing else
   provides it.

 *   node tools/_dev.mjs [root] [port] [cdpPort]
 *
 * Stays in the foreground: kill it when the session is over. The browser gets a
 * throwaway profile, so it never joins a Chrome the user already has running
 * (which is what makes `chrome --version` print "opening in existing session").
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createNetServer } from 'node:net';

const ROOT = resolve(process.argv[2] || '.');
const PORT = +(process.argv[3] || 8931);
const CDP = +(process.argv[4] || 9445);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let p = normalize(join(ROOT, url));
  if (!p.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
  } catch {
    // no such path: a bare origin still has to answer, or a module import
    // evaluated from the devtools console has nowhere to run
    if (url === '/') { res.writeHead(200, { 'content-type': MIME['.html'] }).end('<!doctype html><meta charset="utf-8"><title>dev</title>'); return; }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  try {
    const buf = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p).toLowerCase()] || 'application/octet-stream' }).end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

const free = (port) => new Promise((res) => {
  const s = createNetServer();
  s.once('error', () => res(false));
  s.once('listening', () => s.close(() => res(true)));
  s.listen(port, '127.0.0.1');
});

if (!(await free(CDP))) {
  console.error(`port ${CDP} is already in use — an old browser is still up. Kill it, or pass another cdpPort.`);
  process.exit(1);
}

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`serving ${ROOT}  →  http://127.0.0.1:${PORT}/`);

const profile = await mkdtemp(join(tmpdir(), 'ohm-dev-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErr = '';
chrome.on('error', (e) => { chromeErr = e.message; });
chrome.stderr.on('data', (d) => { chromeErr += d.toString(); });

// wait for the devtools endpoint to answer
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const r = await fetch(`http://127.0.0.1:${CDP}/json/version`);
    up = r.ok;
  } catch { /* not yet */ }
}
if (!up) {
  console.error('browser never opened its devtools port.\n' + chromeErr);
  chrome.kill();
  server.close();
  process.exit(1);
}
console.log(`browser  →  devtools on ${CDP}  (profile ${profile})`);
console.log('ready');

const bye = () => { try { chrome.kill(); } catch { /* gone */ } server.close(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
