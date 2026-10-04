/* dev: per-viewport *inside-the-panel* readout.

   `_resp.mjs` answers "does anything stick out of the viewport". This answers the
   question that comes one step earlier, and that `_resp.mjs` deliberately does
   not: *which child of the record plate grew*. The two are not the same job. When
   a panel starts printing on the transport bar, the viewport sweep says "yes,
   something is 12px too tall" and stops; finding out that it was the note
   paragraph, and by how many pixels, otherwise costs a round of guessing at
   candidate edits.

   So this prints a per-element height table at every width, and it is meant to be
   run on two trees and diffed: the same expression against HEAD and against the
   working tree turns "the panel got taller" into "`#file-note` went 0 -> 199.7".

 *   node tools/_why.mjs <url> <cdpPort> [widths] [exprFile]

   widths is `1600x900,1100x760,...` and defaults to the four that matter for the
   record plate. exprFile defaults to `_shots/why-expr.js`; it is evaluated once
   per width, after the same settle the other probes use (two frames, then a
   pause), so the numbers are comparable across runs.

   NOTE: the expression is a template literal in `_resp.mjs` but a *file* here,
   which is the point — a file can hold backticks, quotes and comments without
   any of the escaping that has bitten every inline probe in this project. */
import { readFileSync } from 'node:fs';
import { pickPage } from './_cdp.mjs';

const [url, cdpPort = '9445', widthsArg = '1600x900,1240x800,1100x760,1000x700',
  exprFile = '_shots/why-expr.js'] = process.argv.slice(2);
if (!url) {
  console.error('usage: node tools/_why.mjs <url> <cdpPort> [widths] [exprFile]');
  process.exit(2);
}
const WIDTHS = widthsArg.split(',').map((s) => {
  const [w, h] = s.split('x');
  return [+w, +(h || Math.round(+w * 0.7))];
});
const expression = readFileSync(exprFile, 'utf8');

// By URL, never by position — see the note in `_cdp.mjs`.
const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const page = pickPage(list, url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const problems = [];
let loaded = false;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`)); else p.resolve(m);
    return;
  }
  if (m.method === 'Page.loadEventFired') loaded = true;
  if (m.method === 'Runtime.exceptionThrown') {
    problems.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    problems.push(m.params.args.map((a) => a.description || a.value).join(' '));
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  const guard = setTimeout(() => {
    if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out`)); }
  }, 300000);
  guard.unref?.();
  pending.set(n, {
    resolve: (v) => { clearTimeout(guard); resolve(v); },
    reject: (e) => { clearTimeout(guard); reject(e); },
  });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
    allowUnsafeEvalBlockedByCSP: true, userGesture: true,
  });
  if (r.result?.exceptionDetails) {
    problems.push(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  }
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
/* Before the navigation: this page reads the media feature once at load and then
   declines to animate anything, so a `reduce` reading is a stopped clock. */
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTHS[0][0], height: WIDTHS[0][1], deviceScaleFactor: 1, mobile: false,
});
problems.length = 0;
await send('Page.navigate', { url });
for (let i = 0; i < 60 && !loaded; i++) await sleep(200);
await evaluate('(async () => { await document.fonts.ready; return document.fonts.size; })()').catch(() => 0);
for (let i = 0; i < 120; i++) {
  const busy = await evaluate(`(() => { const l = document.getElementById('loader');
    return !!l && getComputedStyle(l).opacity !== '0' && getComputedStyle(l).visibility !== 'hidden'; })()`);
  if (!busy) break;
  await sleep(1000);
}

for (const [w, h] of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
  await sleep(1200);
  const out = await evaluate(expression);
  console.log(`---- ${w}x${h} ----`);
  console.log(typeof out === 'string' ? out : JSON.stringify(out));
}
if (problems.length) console.log('page errors:\n  ' + problems.join('\n  '));
ws.close();
process.exit(problems.length ? 1 : 0);
