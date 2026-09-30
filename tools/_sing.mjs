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
 * `overSpirit` raycasts her quad, so the region where `body.over-spirit` is on
 * *is* her screen footprint — and that box is a function of exactly the two
 * numbers singing drives: the bob (position) and the breath (scale). Idle is the
 * control: it is the same three motions at a third of the size and half the
 * speed, so the assertion is not "does it move" but "is singing bigger than not
 * singing" — which no amount of scene drift can fake.
 *
 * WIDTH AND HEIGHT, NOT POSITION — AND WHY
 * Her quad is a rectangle, so a horizontal line through any interior point gives
 * the full width and a vertical line gives the full height, which makes both
 * measurements immune to her drifting across the frame. She does drift, a lot:
 * the synthetic `pointermove` this probe needs for the raycast also reaches
 * `Orbit._onMove` (both listeners are on the canvas), so the scan drives the
 * pointer parallax. That moves her by up to ~160 px — four times the bob it
 * would otherwise be measuring. It does *not* change her projected size, because
 * the parallax only swings the camera around her, and orbiting a target near her
 * centre leaves the distance to her essentially fixed (the dolly is <0.3%).
 * So position is unusable here and size is clean.
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
 *     0.35 — a 7x shorter run for the same number of her seconds). The raycast
 *     is unaffected: it maps clientX/innerWidth, not pixels.
 *
 * The window is then sized from arithmetic rather than hope: `idleSec` has to
 * cover one full bob period (2*pi/1.05 = 6.0 s of her clock, the slowest thing
 * she does), and `singSec` one of the singing bob (2.5 s).
 *
 * THE INTRO IS A CAMERA MOVE, SO IT IS SKIPPED
 * The page plays a 3.4 s dolly on first load, but only when the URL carries no
 * query at all (`main.js`: `prefs.intro && ![...Q.keys()].length`). That is
 * exactly the shape of a `file://` URL, so the standalone build always has it
 * running while the dev-server URLs — which carry `?intro=0&t=...` — never do.
 * A camera move changes her projected size, which is the quantity being
 * measured: the standalone reported an idle range of 65 px against the dev
 * server's 12, every pixel of it the intro's tail, and failed. Her clock runs
 * at 1/40 speed here, so "wait it out" means minutes of wall time for a move
 * that is over in 3.4 s of page time. So the query is added instead, and the
 * substitution is printed — a run that asked for the intro is never quietly
 * handed something else. Same move as the media override above: a variable
 * removed, not a hope.
 *
 * HOVER IS PARKED, NOT IGNORED
 * Bisecting an edge necessarily probes outside her, and every probe lands in the
 * same synchronous block — but `spiritHover` is read by the *next* frame, so
 * whichever probe came last decides what `st.hover` eases toward. Left alone
 * that adds a flickering +3.5% of scale, which is twice the idle breath it is
 * supposed to be the control for. So each sample ends with one dispatch at her
 * centre, and the frame that follows always sees `hovered = true`; the lift and
 * the 3.5% become constants in both states instead of noise.
 *
 * The press is delivered as real input rather than `element.click()`. The
 * synthetic path would be reporting on a press that never reached the button,
 * and playback is the one thing this probe cannot take on faith — so the state
 * is read back afterwards and the run aborts if the music is not actually
 * running, rather than quietly measuring an idle spirit and calling it a
 * regression.
 */
const [url, cdpPort = '9445', dpr = '0.35', idleSec = '45', singSec = '25'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_sing.mjs <url> [cdpPort] [dpr] [idleSec] [singSec]'); process.exit(2); }

/* see THE INTRO in the header: measured through it, this probe measures the intro */
if (/[?&]intro=1(?:&|$)/.test(url)) {
  console.error('the URL forces the intro on, and a camera move is not her — nothing to measure');
  process.exit(2);
}
const target = /[?&]intro=0(?:&|$)/.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'intro=0';
if (target !== url) console.log(`url        ${url}\n           + intro=0   (a camera move is not her — see the header)\n`);

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
await send('Page.navigate', { url: target });
for (let i = 0, ok = false; i < 90 && !ok; i++) {
  await sleep(1000);
  ok = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
await sleep(8000);

const flag = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
if (flag) { console.error('prefers-reduced-motion is still `reduce` — her clock is stopped, nothing to measure'); process.exit(1); }

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

/* installed once; every sample after that is a single round trip */
const SCAN = `(() => {
  if (!window.__scan) {
    const c = document.querySelector('#gl');
    const at = (x, y) => {
      c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y,
        pointerId: 99, isPrimary: true, pointerType: 'mouse' }));
      return document.body.classList.contains('over-spirit');
    };
    let cx = -1, cy = -1;
    outer: for (let y = 60; y < innerHeight - 100; y += 40)
      for (let x = 40; x < 1000; x += 40) if (at(x, y)) { cx = x; cy = y; break outer; }
    if (cx < 0) return null;
    /* walk outward to a definite miss, then bisect back to the edge: 1 px exact,
       and no assumption about how big she is */
    const edge = (ox, oy, dx, dy) => {
      let hit = 0;
      while (hit < 700 && at(ox + dx * (hit + 60), oy + dy * (hit + 60))) hit += 60;
      let lo = hit, hi = hit + 60;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (at(ox + dx * m, oy + dy * m)) lo = m; else hi = m; }
      return lo;
    };
    /* cx/cy stay floats: rounding them every sample would quantise the centre and
       inject a 1 px jitter that is the same size as the idle signal */
    window.__scan = () => {
      const l = edge(cx, cy, -1, 0), r = edge(cx, cy, 1, 0);
      cx = (cx - l + cx + r) / 2;
      const t = edge(cx, cy, 0, -1), b = edge(cx, cy, 0, 1);
      cy = (cy - t + cy + b) / 2;
      at(Math.round(cx), Math.round(cy));        // park on her, see HOVER above
      return JSON.stringify({ w: l + r, h: t + b, x0: cx - l, y0: cy - t });
    };
    window.__frames = 0;
    const tick = () => { window.__frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  return window.__scan();
})()`;

const first = JSON.parse(await evaluate(SCAN) || 'null');
if (!first) { console.error('she is nowhere on screen — nothing to measure'); process.exit(1); }
console.log(`her box    x ${first.x0.toFixed(0)}  y ${first.y0.toFixed(0)}   ${first.w.toFixed(0)} x ${first.h.toFixed(0)} px`);

const stat = (a) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return { min: Math.min(...a), max: Math.max(...a), range: Math.max(...a) - Math.min(...a),
    sd: Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) };
};
const run = async (label, seconds) => {
  const f0 = await evaluate('window.__frames');
  const w = [], h = [];
  const until = Date.now() + seconds * 1000;
  /* one sample per frame, not per clock tick: at 3.5 fps a 130 ms poll would
     spend most of its round trips re-reading a frame that has not changed */
  while (Date.now() < until) {
    const b = JSON.parse(await evaluate('window.__scan()'));
    w.push(b.w); h.push(b.h);
    await sleep(120);
  }
  const f1 = await evaluate('window.__frames');
  return { label, w: stat(w), h: stat(h), frames: f1 - f0, herSeconds: (f1 - f0) * 0.05 };
};
const show = (s) => console.log(
  `${s.label.padEnd(8)}  width ${s.w.min.toFixed(0).padStart(4)}..${s.w.max.toFixed(0).padStart(4)} (range ${s.w.range.toFixed(1).padStart(5)}, sd ${s.w.sd.toFixed(2)})` +
  `   height ${s.h.min.toFixed(0).padStart(4)}..${s.h.max.toFixed(0).padStart(4)} (range ${s.h.range.toFixed(1).padStart(5)}, sd ${s.h.sd.toFixed(2)})` +
  `   ${s.frames} frames = ${s.herSeconds.toFixed(2)} s of her clock`);

const idle = await run('idle', +idleSec);
show(idle);

/* the press, through the same door the user uses */
const btn = await evaluate(`(() => { const q = document.querySelector('#btn-play').getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`);
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
  await sleep(60);
}
await sleep(12000);          // let the ease land: 1.5 s of her clock
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

const ratio = (k) => (idle[k].range > 0 ? sing[k].range / idle[k].range : Infinity);
console.log(`ratio       width ${ratio('w').toFixed(2)}x   height ${ratio('h').toFixed(2)}x`);
console.log(sing.w.range > idle.w.range && sing.h.range > idle.h.range
  ? 'PASS  singing moves her more than idling does, on both axes'
  : 'FAIL  singing is not larger than idling');
console.log(problems.length ? 'page errors:\n  ' + problems.join('\n  ') : 'page errors: none');
ws.close();
