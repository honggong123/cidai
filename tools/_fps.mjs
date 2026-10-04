/* dev: how fast does this page's clock actually run under headless?
 *
 *   node tools/_fps.mjs <url> [cdpPort] [w] [h]
 *
 * The loop caps dt at 1/20 s (main.js), so while the renderer is slower than
 * 20 fps the page's own clock advances at `fps x 0.05` seconds per second of
 * wall time. Everything time-based on this page — including her breath, whose
 * period is 1.87 s of *her* clock — is slowed by the same factor, and a probe
 * that samples for a couple of seconds sees a hundredth of a cycle and reports
 * "she does not move". This measures the factor so the window can be sized from
 * arithmetic instead of from hope.
 */
const [url, cdpPort = '9445', w = '1440', h = '900', dpr = '1'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_fps.mjs <url> [cdpPort] [w] [h] [dpr]'); process.exit(2); }

// The tab is picked by URL, never by position: /json/list lists every page in
// the browser, and another project's page being first is a normal accident.
// Imports are hoisted, so the helper can be declared here, next to its use.
import { pickPage } from './_cdp.mjs';
const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const page = pickPage(list, url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  const guard = setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out`)); } }, 180000);
  guard.unref?.();
  pending.set(n, { resolve: (v) => { clearTimeout(guard); resolve(v); }, reject: (e) => { clearTimeout(guard); reject(e); } });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
/* dpr below 1 is the one lever that speeds this up without touching the CSS
   layout: the page lays out at w x h and draws into a smaller buffer */
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: +dpr, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url });
for (let i = 0, ok = false; i < 90 && !ok; i++) {
  await sleep(1000);
  ok = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
await sleep(3000);

const out = await evaluate(`(async () => {
  let n = 0, t0 = performance.now();
  const tick = () => { n++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 8000));
  const wall = (performance.now() - t0) / 1000;
  const fps = n / wall;
  return JSON.stringify({ viewport: innerWidth + 'x' + innerHeight, frames: n, wall: +wall.toFixed(2),
    fps: +fps.toFixed(2), clockPerSecond: +Math.min(fps, 20).toFixed(2) * 0.05,
    idleBreathPeriod: +(2 * Math.PI / (1.05 * 1.34)).toFixed(2),
    singBreathPeriod: +(2 * Math.PI / (2.5 * 1.34)).toFixed(2) });
})()`);
console.log(out);
ws.close();
