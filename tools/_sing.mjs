/* dev: does she actually sing?
 *
 *   node tools/_sing.mjs <url> [cdpPort] [dpr] [idleSec] [singSec]
 *
 * WHY NOT A SCREENSHOT DIFF
 * That is the test this project has already been burned by: her idle and her
 * singing differ by a few percent, and the room's dust, grain and bloom are the
 * same order of magnitude as the difference. So this measures the animated
 * quantity directly.
 *
 * WHAT IT MEASURES, AND WHY IT CHANGED
 * It used to measure her *screen footprint* — the region where `over-spirit` is
 * on, found by bisecting the hover edge. That was the right measurement while
 * she was a billboard: a billboard's footprint *is* its scale, so the box was a
 * function of exactly the two numbers singing drives, the bob and the breath.
 *
 * She is a solid now, and `overSpirit` raycasts an invisible capsule proxy. A
 * capsule does not scale with the breath, so the box stopped meaning anything —
 * it went from a 12 px idle range to a 3 px one and the probe failed, reporting
 * a regression that did not exist. **The assertion was wrong, not the model.**
 *
 * So it now reads the two numbers themselves, through the page's one read-only
 * hook (`window.__spirit`, see `main.js`). `bob` is her vertical offset and
 * `sing` is the eased singing weight, both taken from the same place `update`
 * writes them. Two things follow, and both are the point:
 *
 *   - the measurement is *her*, not a proxy for her, so it cannot silently stop
 *     tracking what she does the next time her body changes;
 *   - `bob` is a local offset, not a screen position, so the camera cannot move
 *     it. The old version needed a whole section of this header to explain why
 *     the parallax it was driving did not corrupt the reading. This one cannot
 *     be corrupted by the camera at all, and the section is gone.
 *
 * The three assertions are independent, so a failure says which half broke:
 * she is not singing before the press, she is singing after it, and she moves
 * more because of it. The last is the one that would catch someone rewiring her
 * to `musicLive` — the state would still flip, but only when there is sound.
 *
 * WHY THE WINDOW IS MINUTES LONG
 * The loop caps `dt` at 1/20 s, so on a software renderer slower than 20 fps the
 * page's own clock advances at `fps x 0.05` seconds per second of wall time —
 * and every motion on the page is slowed by that same factor. Measured here at
 * 1440x900 / dpr 1: 0.5 fps, i.e. her clock runs at 1/40 speed, which makes one
 * idle breath 179 seconds of wall time. A probe that samples for two seconds
 * therefore sees a hundredth of a cycle and reports "she does not move" — which
 * is exactly the false negative this file was written to avoid. Two things fix
 * it, and both are needed:
 *
 *   - `Emulation.setEmulatedMedia` before the navigation. Headless Chrome
 *     reports `prefers-reduced-motion: reduce`, the page reads that once at load
 *     into a module constant, and `spirit.update` is then handed `dt = 0`. With
 *     the media feature overridden her clock runs at all.
 *   - a device scale factor below 1. This is the only lever that speeds the
 *     renderer up without touching the CSS layout: the page still lays out at
 *     1440x900 and `innerWidth` is unchanged, but the drawing buffer shrinks and
 *     the frame rate goes up (measured: 0.5 fps at dpr 1, 1.75 at 0.5, 3.5 at
 *     0.35 — a 7x shorter run for the same number of her seconds). Nothing else
 *     is affected: the hook reads numbers, not pixels.
 *
 * The window is then sized from arithmetic rather than hope: `idleSec` has to
 * cover one full idle bob period (2*pi/1.05 = 6.0 s of her clock, the slowest
 * thing she does), and `singSec` one of the singing bob (2.5 s). At the measured
 * ~9.8 s of her clock per 45 s of wall, 45 s covers 1.6 idle periods.
 *
 * NO SCREENSHOTS, NO RAYCASTS, ONE ROUND TRIP PER SAMPLE
 * Reading two numbers is a single `Runtime.evaluate`, so the sample rate is set
 * by the renderer rather than by the probe. The old bisection cost dozens of
 * round trips per sample and could not keep up with the frame it was measuring.
 */
const [url, cdpPort = '9445', dpr = '0.35', idleSec = '45', singSec = '25'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_sing.mjs <url> [cdpPort] [dpr] [idleSec] [singSec]'); process.exit(2); }

const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target — start tools/_dev.mjs first');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map((a) => a.description || a.value).join(' '));
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: +dpr, mobile: false });
/* before the navigation: `reduce` is a module constant, not a live query */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
problems.length = 0;
await send('Page.navigate', { url });
for (let i = 0, ok = false; i < 90 && !ok; i++) {
  await sleep(1000);
  ok = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
await sleep(8000);

const flag = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
if (flag) { console.error('prefers-reduced-motion is still `reduce` — her clock is stopped, nothing to measure'); process.exit(1); }

/* the hook is the whole measurement, so its absence is a hard stop rather than
   a zero. A missing hook that read as "she does not move" would be this file
   making the same mistake it was written to catch. */
const hasHook = await evaluate(`!!(window.__spirit && typeof window.__spirit.bob === 'number')`);
if (!hasHook) {
  console.error('window.__spirit is missing — nothing to measure (see the hook in main.js)');
  process.exit(1);
}

/* Same escape hatch as _resp.mjs, for the same reason: the state most worth
   asking about here is not reachable by loading the page. "The transport is
   rolling and there is no audio at all" needs the audio element broken first,
   and that is the one state where her signal and the bars' signal part company
   (see `sheSings` in main.js) — so it is the state that would silently regress
   if someone tied her back to `musicLive`.

     SING_PRELUDE='(async () => { ... })' node tools/_sing.mjs ...

   A prelude is expected to leave the audio broken, so the press check below
   stops insisting the element is unpaused and only insists the transport runs. */
const noAudio = !!process.env.SING_PRELUDE;
if (noAudio) {
  const out = await evaluate(process.env.SING_PRELUDE);
  console.log('prelude → ' + JSON.stringify(out) + '\n');
}

/* installed once; every sample after that is a single property read */
await evaluate(`(() => {
  window.__frames = 0;
  const tick = () => { window.__frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return true;
})()`);

const stat = (a) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return { min: Math.min(...a), max: Math.max(...a), range: Math.max(...a) - Math.min(...a),
    sd: Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) };
};
const run = async (label, seconds) => {
  const f0 = await evaluate('window.__frames');
  const bob = [], sing = [];
  const until = Date.now() + seconds * 1000;
  /* poll faster than the frame rate: a sample that lands inside the frame
     already read is free, and skipping one that landed between frames is not */
  while (Date.now() < until) {
    const v = await evaluate('({ b: window.__spirit.bob, s: window.__spirit.sing })');
    bob.push(v.b); sing.push(v.s);
    await sleep(90);
  }
  const f1 = await evaluate('window.__frames');
  return { label, bob: stat(bob), sing: stat(sing), frames: f1 - f0, herSeconds: (f1 - f0) * 0.05 };
};
const show = (s) => console.log(
  `${s.label.padEnd(8)}  bob ${s.bob.min.toFixed(3).padStart(7)}..${s.bob.max.toFixed(3).padStart(7)}` +
  ` (range ${s.bob.range.toFixed(3)}, sd ${s.bob.sd.toFixed(4)})` +
  `   sing ${s.sing.min.toFixed(2)}..${s.sing.max.toFixed(2)}` +
  `   ${s.frames} frames = ${s.herSeconds.toFixed(2)} s of her clock`);

const idle = await run('idle', +idleSec);
show(idle);

/* the press, through the same door the user uses */
const btn = await evaluate(`(() => { const q = document.querySelector('#btn-play').getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`);
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
  await sleep(60);
}
await sleep(12000);          // let the ease land: `sing` damps at 3.0/s, so this is ~1.8 s of her clock
const live = await evaluate(`({ playing: document.body.classList.contains('playing'),
  paused: document.querySelector('audio').paused, t: +document.querySelector('audio').currentTime.toFixed(1) })`);
console.log(`press      playing=${live.playing}  audio.paused=${live.paused}  t=${live.t}s`);
if (!live.playing || (live.paused && !noAudio)) {
  console.error('the transport did not start — nothing to compare against');
  console.error(problems.length ? 'page errors:\n  ' + problems.join('\n  ') : 'page errors: none');
  process.exit(1);
}

const sing = await run('singing', +singSec);
show(sing);

/* three independent checks, so a failure names the half that broke */
const quiet = idle.sing.max < 0.15;
const loud = sing.sing.min > 0.85;
const moves = sing.bob.range > idle.bob.range * 2.0;
console.log(`ratio       bob range ${(sing.bob.range / (idle.bob.range || NaN)).toFixed(2)}x`
  + `   (needs > 2.00x, and sing < 0.15 idle / > 0.85 singing)`);
console.log(quiet && loud && moves
  ? 'PASS  she is still until asked, sings when asked, and moves more because of it'
  : `FAIL  ${[!quiet && 'she was already singing before the press',
      !loud && 'she never started singing', !moves && 'singing does not move her more'].filter(Boolean).join('; ')}`);
console.log(problems.length ? 'page errors:\n  ' + problems.join('\n  ') : 'page errors: none');
ws.close();
