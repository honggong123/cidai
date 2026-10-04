/* why did `sing` dip? — a timeline, not a statistic
 *
 *   node tools/_singtrace.mjs <url> [cdpPort] [dpr] [sec]
 *
 *   SEEK=57   jump the audio near the end after pressing play, so `ended` — and
 *             the rewind it starts — lands inside the window instead of 60 s in
 *   VW=480 VH=300   shrink the viewport. The loop caps `dt` at 1/20 s, so a
 *             rewind is 170 frames no matter what; the only way to see it in
 *             reasonable wall time is more frames per second, and the viewport
 *             is the free lever (see the `_sing.mjs` header). The transport does
 *             not care about layout, so this one is safe to shrink.
 *   VW2=320 VH2=200  shrink again, *after* the press. `VW`/`VH` have to stay
 *             large enough for the play button to be where the click expects it;
 *             the sampling loop has no such constraint, so it gets the fastest
 *             size the machine will give. Measured 2026-10-03: 900x600/dpr 1 is
 *             0.45 fps, which puts the rewind's 170 frames 375 s of wall time
 *             away — past any window worth waiting for.
 *
 * `_sing.mjs` asserts `sing.min > 0.85` over a wall-clock window and reported
 * 0.72. A single number cannot say whether that is a real regression or the
 * window straddling a track change, so this prints the *transitions* instead:
 * every time one of {body.playing, audio.paused, audio.ended, currentTime
 * jumping backwards} changes, with `sing` / `bob` beside it.
 *
 * It samples the raw DOM rather than `window.__spirit`, because the question is
 * which of `sheSings = mode !== 'rew' && cas.st.playing`'s two halves went
 * false, and neither half is on the hook. `body.playing` mirrors `st.playing`
 * (main.js:3047), and `mode === 'rew'` is visible as `body.rewinding`
 * (main.js:1366).
 *
 * Same two rules as `_sing.mjs`, for the same reasons: the media feature goes
 * in *before* the navigation (it is read once into a module constant), and the
 * tab is picked by URL, never by position.
 */
const [url, cdpPort = '9446', dpr = '0.7', sec = '90'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_singtrace.mjs <url> [cdpPort] [dpr] [sec]'); process.exit(2); }
const VW = +(process.env.VW || 1440), VH = +(process.env.VH || 900);
const VW2 = +(process.env.VW2 || 0), VH2 = +(process.env.VH2 || 0);
const SEEK = process.env.SEEK ? +process.env.SEEK : null;

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
  const guard = setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out`)); } }, 300000);
  guard.unref?.();
  pending.set(n, { resolve: (v) => { clearTimeout(guard); resolve(v); }, reject: (e) => { clearTimeout(guard); reject(e); } });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: +dpr, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url });
for (let i = 0, ok = false; i < 90 && !ok; i++) {
  await sleep(1000);
  ok = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
await sleep(6000);

const snap = () => evaluate(`(() => {
  const a = document.querySelector('audio');
  return {
    body: document.body.className,
    paused: a.paused, ended: a.ended, t: +a.currentTime.toFixed(2),
    dur: Number.isFinite(a.duration) ? +a.duration.toFixed(2) : null,
    sing: +window.__spirit.sing.toFixed(3), bob: +window.__spirit.bob.toFixed(3),
    fr: window.__frames,
  };
})()`);

/* install the frame counter the same way _sing.mjs does */
await evaluate(`(() => { window.__frames = 0; const k = () => { window.__frames++; requestAnimationFrame(k); }; requestAnimationFrame(k); return true; })()`);

const btn = await evaluate(`(() => { const q = document.querySelector('#btn-play').getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`);
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
  await sleep(60);
}
/* straight to the tail of the side, so `ended` and the rewind it starts land
   inside the window. Written to the element rather than through the rail: the
   rail's own seek path (`seekTo`) *ends* a rewind by writing `dir = -1`, which
   is the one thing this probe must not do while it is trying to watch a rewind
   finish. */
if (SEEK != null) {
  const d = await evaluate(`(() => { const a = document.querySelector('audio'); a.currentTime = ${SEEK}; return a.duration; })()`);
  console.log(`seek       audio → ${SEEK}s  (side is ${d}s)\n`);
}

/* the button has been pressed, so the layout is no longer load-bearing: take the
   free speed (see the header) and count frames from here */
if (VW2 && VH2) {
  await send('Emulation.setDeviceMetricsOverride', { width: VW2, height: VH2, deviceScaleFactor: +dpr, mobile: false });
  await sleep(1500);
}
await evaluate('window.__frames = 0');

const t0 = Date.now();
let prev = null;
let wasBelow = false;
let lastBeat = -1;
const sings = [];
console.log('wall   t      paused ended  sing    bob     body');
while (Date.now() - t0 < +sec * 1000) {
  const s = await snap().catch(() => null);
  if (!s) { await sleep(200); continue; }
  sings.push(s.sing);
  const wall = (Date.now() - t0) / 1000;
  const key = `${s.body}|${s.paused}|${s.ended}`;
  const jumped = prev && Math.abs(s.t - prev.t) > 2.5 && s.t < prev.t;
  /* print the transitions, a crossing of the 0.85 line, and one heartbeat every
     15 s — not every sample: at 0.45 fps the same frame is read twenty times in
     a row, and a wall of identical rows hides the two rows that matter */
  const below = s.sing < 0.85;
  const beat = Math.floor(wall / 15);
  if (key !== prev?.key || jumped || below !== wasBelow || beat !== lastBeat) {
    lastBeat = beat;
    console.log(
      `${String(wall.toFixed(1)).padStart(5)}s ` +
      `${String(s.t).padStart(6)} ${String(s.paused).padStart(6)} ${String(s.ended).padStart(5)}  ` +
      `${s.sing.toFixed(3)}  ${s.bob.toFixed(3).padStart(7)}  ${s.body}` +
      `${jumped ? '   <-- currentTime jumped back' : ''}` +
      `${below !== wasBelow ? (below ? '   <-- sing dropped below 0.85' : '   <-- sing back above 0.85') : ''}`);
  }
  wasBelow = below;
  prev = { ...s, key };
  await sleep(120);
}
const n = sings.length;
const sorted = [...sings].sort((a, b) => a - b);
const frames = await evaluate('window.__frames').catch(() => null);
const wall = (Date.now() - t0) / 1000;
console.log(`\n${n} samples over ${wall.toFixed(0)}s wall   ${frames} frames = ${(frames / wall).toFixed(2)} fps` +
  `  (${(frames * 0.05).toFixed(2)} s of her clock)`);
console.log(`sing min ${sorted[0].toFixed(3)}  p10 ${sorted[Math.floor(n * 0.1)].toFixed(3)}` +
  `  median ${sorted[Math.floor(n / 2)].toFixed(3)}  max ${sorted[n - 1].toFixed(3)}`);
console.log(`samples below 0.85: ${sings.filter((v) => v < 0.85).length} / ${n}`);
ws.close();
