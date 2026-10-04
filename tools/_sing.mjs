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
 * WHICH SAMPLES COUNT
 * She is supposed to sing exactly while the transport rolls and is not spooling
 * back (`sheSings = mode !== 'rew' && cas.st.playing`, main.js:3318), so the
 * window is split on `body.playing` / `body.rewinding` and the assertion reads
 * the rolling half. This file got that wrong for a while and it mattered: the
 * probe reported `sing 0.72` and printed "she never started singing", when the
 * real cause was a 60 s side ending inside the window — and, underneath that, a
 * `mode = 'rew'` that could never be left at all (the tape transport's exit went
 * with `cassette.js`; see `tools/_rew.mjs` for the fix and its guard). The lesson
 * is the one this file already carried for its window length: **a number is only
 * an assertion once you have said which frames it is allowed to be about.**
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
  const s = [...a].sort((x, y) => x - y);
  return { min: s[0], max: s[s.length - 1], range: s[s.length - 1] - s[0],
    median: s[Math.floor(s.length / 2)],
    sd: Math.sqrt(a.reduce((s2, v) => s2 + (v - m) ** 2, 0) / a.length) };
};
/* ★★ 采样时把 `body.playing` / `body.rewinding` 一起读回来，理由不是好奇。
   `sheSings = mode !== 'rew' && cas.st.playing`（main.js:3318）—— 她**本来
   就**在倒带期间不唱，而一首歌放完必然进倒带。所以"窗口里 `sing` 的最小值"
   只有在窗口整段落在走带期间时才等于"她唱了没有"；窗口一旦压到曲尾，读到的是
   一个**按设计**的衰减。2026-10-03 就是这么来的：断言印的是 "she never started
   singing"，而真实情况是 60 秒的曲子恰好在窗口里放完（`_singtrace.mjs` 的
   时间线：`ended=true`、`sing` 0.115→0.086→0）。
   于是把样本分成两堆：`rolling` = 走带台在转**且**没在倒带 = 她本该开口的帧。
   断言只对 `rolling` 下。 */
const run = async (label, seconds) => {
  const f0 = await evaluate('window.__frames');
  const bob = [], sing = [], rolling = [];
  const until = Date.now() + seconds * 1000;
  /* poll faster than the frame rate: a sample that lands inside the frame
     already read is free, and skipping one that landed between frames is not */
  while (Date.now() < until) {
    const v = await evaluate(`({ b: window.__spirit.bob, s: window.__spirit.sing,
      p: document.body.classList.contains('playing'),
      w: document.body.classList.contains('rewinding') })`);
    bob.push(v.b); sing.push(v.s);
    if (v.p && !v.w) rolling.push(v.s);
    await sleep(90);
  }
  const f1 = await evaluate('window.__frames');
  return { label, bob: stat(bob), sing: stat(sing),
    rolling: rolling.length ? stat(rolling) : null, rollingN: rolling.length, n: sing.length,
    frames: f1 - f0, herSeconds: (f1 - f0) * 0.05 };
};
const show = (s) => console.log(
  `${s.label.padEnd(8)}  bob ${s.bob.min.toFixed(3).padStart(7)}..${s.bob.max.toFixed(3).padStart(7)}` +
  ` (range ${s.bob.range.toFixed(3)}, sd ${s.bob.sd.toFixed(4)})` +
  `   sing ${s.sing.min.toFixed(2)}..${s.sing.max.toFixed(2)} med ${s.sing.median.toFixed(2)}` +
  `   rolling ${s.rollingN}/${s.n}` +
  `   ${s.frames} frames = ${s.herSeconds.toFixed(2)} s of her clock`);

const idle = await run('idle', +idleSec);
show(idle);

/* the press, through the same door the user uses */
const btn = await evaluate(`(() => { const q = document.querySelector('#btn-play').getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`);
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
  await sleep(60);
}
/* ★★ 等缓动落地要按**页面自己的钟**等，不能按墙钟。
   `st.sing` 以 3.0/**页面秒**阻尼（`ghost.js:972`），而一帧只推进
   `dt = 1/20` 页面秒。2026-10-03 实测这个页面约 1 fps，于是旧写法
   `await sleep(12000)` 只换来 **0.6 页面秒** —— 缓动停在 0.45，采样窗从 0.45
   起步，下面 `sing.sing.min > 0.85` 必然失败，而失败信息印的是
   "she never started singing"。那是**探针的假阴性**，不是模型的问题：
   `st.sing` / `st.bob` 都不由身体位置决定（写它们的是 972 / 992 行）。
   改成轮询页面自己的读数，帧率再低也准。 */
let eased = null;
for (let i = 0; i < 150 && eased === null; i++) {
  if (await evaluate('window.__spirit.sing > 0.9')) eased = await evaluate('window.__spirit.sing');
  else await sleep(1000);
}
if (eased === null) {
  console.error('warning: `sing` never eased past 0.9 within 150 s — the window below will read low');
} else {
  console.log(`ease       sing reached ${eased.toFixed(3)} before the window opened`);
}
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

/* ★ Zero `rolling` samples is not "she did not sing" — it is "there was nothing
   to sing to", and the two want different messages. */
if (sing.rollingN === 0) {
  console.error(`the transport never rolled in the window (${sing.n} samples) — nothing to compare against`);
  console.error(problems.length ? 'page errors:\n  ' + problems.join('\n  ') : 'page errors: none');
  process.exit(1);
}

/* three independent checks, so a failure names the half that broke.
   The first two read `sing` over the samples where she is *supposed* to be
   singing (`rolling`, see `run`), and they take the **median**, not the minimum.
   The minimum is the number that lied here: a side that ends inside the window
   produces one honest dip (she does not sing during a rewind — `sheSings` in
   main.js) and one honest recovery, so `min` measures how the window was placed
   rather than whether she sings. A rewiring to `musicLive` still falls flat
   under the median — in the `SING_PRELUDE` case there is no audio at all, so
   every rolling sample would be 0. */
const quiet = (idle.rolling ?? idle.sing).max < 0.15;
const loud = sing.rolling.median > 0.85;
const moves = sing.bob.range > idle.bob.range * 2.0;
console.log(`ratio       bob range ${(sing.bob.range / (idle.bob.range || NaN)).toFixed(2)}x`
  + `   (needs > 2.00x, and sing < 0.15 idle / median > 0.85 while rolling)`);
console.log(quiet && loud && moves
  ? 'PASS  she is still until asked, sings when asked, and moves more because of it'
  : `FAIL  ${[!quiet && 'she was already singing before the press',
      !loud && 'she never started singing', !moves && 'singing does not move her more'].filter(Boolean).join('; ')}`);
if (sing.sing.min < 0.85) {
  console.log(`note        the window bottomed out at ${sing.sing.min.toFixed(3)} — if \`rolling\` is short of`
    + ` ${sing.n}, a side ended inside it (she is silent through a rewind by design; the rewind's own`
    + ' exit is `tools/_rew.mjs`\'s job)');
}
console.log(problems.length ? 'page errors:\n  ' + problems.join('\n  ') : 'page errors: none');
ws.close();
