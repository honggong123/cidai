/* dev: ask the running page a question over CDP and print the answer.
   tools/page-shot.mjs waits for the loader to clear before it shoots — which is
   right for a screenshot and wrong for everything else (an isolated test page
   has no loader, and the wait alone is ninety seconds). This navigates, waits
   for load, evaluates, and gets out.

 *   node tools/_eval.mjs <url> <expression> [cdpPort]

   The expression is awaited, so an async IIFE works, and its value is printed
   as JSON. Page errors and console errors are reported alongside it. An
   expression that starts with `@` names a file to read it from, which is the
   only sane way to pass a long one through a shell.
 */
import { readFileSync } from 'node:fs';

const [url, exprArg, cdpPort = '9445'] = process.argv.slice(2);
if (!url || !exprArg) {
  console.error('usage: node tools/_eval.mjs <url> <expression|@file> [cdpPort]');
  process.exit(2);
}
const expression = exprArg.startsWith('@') ? readFileSync(exprArg.slice(1), 'utf8') : exprArg;

const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target — start tools/_dev.mjs first');
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
  // SwiftShader runs this page at about one frame a second, and anything that
  // waits on the tape (a label sweep is 24 frames) is measured in tens of
  // seconds there — so the guard has to be generous
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

await send('Page.enable');
await send('Runtime.enable');
/* Headless Chrome reports prefers-reduced-motion as `reduce`, and this page reads
   that once at load and then declines to animate anything — so every question
   about motion, dust or the spectrum gets the wrong answer unless the media
   feature is overridden before the navigation. It has to be before: `reduce` is
   a module constant, not a live query. */
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
// Runtime.enable replays the console buffer of whatever page was already open,
// so the last run's errors would be reported as this run's. Everything worth
// reporting arrives after the navigation.
problems.length = 0;
await send('Page.navigate', { url });
for (let i = 0; i < 60 && !loaded; i++) await new Promise((r) => setTimeout(r, 200));

const r = await send('Runtime.evaluate', {
  expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true,
  // headless will not let an unmuted <audio> start without this, and half of
  // what is worth asking this page is asked while the tape is rolling
  userGesture: true,
});
if (r.result?.exceptionDetails) {
  problems.push(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
}
const value = r.result?.result?.value;
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
if (problems.length) console.log('page errors:\n  ' + problems.join('\n  '));
ws.close();
process.exit(problems.length ? 1 : 0);
