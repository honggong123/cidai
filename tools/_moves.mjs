/* dev: does she still hold together *while she moves*?
 *
 *   node tools/_moves.mjs <url> [cdpPort] [dpr] [outPrefix]
 *
 * The rest pose is the one frame `page-shot.mjs` can photograph without help,
 * and it is the wrong frame for this question. The whole point of the JK rebuild
 * is that the silhouette has to survive motion: a pleated skirt that clears the
 * thigh standing still can pass through it at the top of a hop, a ponytail that
 * hangs behind the shoulder can swing into the face on a turn, and an arm raised
 * over the head can put the sleeve through the ear. None of those are visible in
 * a still. So this file drives her through all five moves with **real input** —
 * the same `Input.dispatchMouseEvent` path `_pick.mjs` argues for, because a
 * synthetic `element.click()` does not reliably start a clip — and photographs
 * each one at three points along it.
 *
 * TWO THINGS HAVE TO BE TRUE BEFORE ANY OF IT WORKS
 *
 *   1. `Emulation.setEmulatedMedia` **before** the navigation. Headless Chrome
 *      reports `prefers-reduced-motion: reduce`; main.js reads that once into a
 *      module constant and then hands `spirit.update` `dt = 0`, because under
 *      reduced motion her clock is *stopped*, deliberately ("a rest pose worth
 *      landing on"). Skip this and every frame comes back as the rest pose, and
 *      the strip reads as a model that does not animate — a false negative that
 *      blames the implementation. It has to be before the navigation: `reduce`
 *      is a constant, not a live query.
 *
 *   2. The wait has to be counted in *frames*, not in milliseconds. `loop()` in
 *      main.js does `const dt = Math.min((now - last) / 1000, 1 / 20)`, so one
 *      frame advances her clock by exactly 0.05 s however long the frame took —
 *      a clip is a *frame count*, not a duration: `nod` is 23 frames, `wave` is
 *      37. On this page a frame costs most of a second, so a wall-clock wait
 *      would have to guess the frame rate, and it would guess wrong: the first
 *      version of this file measured 0.67 fps over a 2.5 s window right after
 *      boot — one or two frames, during the first-frame shader and texture
 *      work — then waited 22 s for a moment 7 frames away, and photographed the
 *      rest pose on three of five moves while reporting that the clips had
 *      fired. Counting rAF ticks in the page and waiting on that counter is
 *      exact at any frame rate, and it needs no calibration.
 *
 * The moves are triggered the way a person triggers them: one click on the row.
 * It used to be two — select, then play — and this file used to click twice to
 * match; `pick()` in main.js now selects and fires in the same gesture, so a
 * second click would only restart the clip under the probe's own frame counter.
 * Row centres are re-read every iteration even though they no longer move: a
 * move used to hand the camera to its own framing, which dragged the panel
 * around underneath the probe's own cursor. That is gone — a move is only a
 * pose now — so the re-read is cheap insurance rather than a requirement.
 *
 * The third sample point (0.82) will report `action=null` on the shorter clips.
 * That is this file, not the model: `Page.captureScreenshot` under software
 * rendering costs 5-8 frames and `action()` is read *after* the shot, by which
 * time a 21-frame clip is over. The 32-frame `wave` is the one long enough to
 * still be running at its own 0.82 mark.
 */
import { writeFileSync } from 'node:fs';

const [url, cdpPort = '9445', dpr = '1', outPrefix = '_shots/mv'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_moves.mjs <url> [cdpPort] [dpr] [outPrefix]'); process.exit(2); }

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
ws.onclose = () => { for (const [, p] of pending) p.reject?.(new Error('devtools socket closed')); pending.clear(); };
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    /* 报错带上方法名：-32602 这类参数错不说是谁，只能全流程二分 */
    if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code}) [${p.method}]`)); else p.resolve(m);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map((a) => a.description || a.value).join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  if (process.env.MOVES_DEBUG) console.error('SEND', n, method, JSON.stringify(params).slice(0, 140));
  const guard = setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out`)); } }, 180000);
  guard.unref?.();
  pending.set(n, { method, resolve: (v) => { clearTimeout(guard); resolve(v); }, reject: (e) => { clearTimeout(guard); reject(e); } });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  .then((r) => r.result?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The dossier is a right-hand column only above ~1080 px of viewport; below that
   it folds itself into a horizontal bar and the move rows are not on screen at
   all, which is how the first run of this file clicked an empty patch of room at
   y = 688 in a 640 px-tall viewport and reported "action null" — a layout fact
   masquerading as a broken model. The guard below exists so that mistake cannot
   come back quietly. */
const W = 1180, H = 740;
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +dpr, mobile: false });
await send('Page.enable');
await send('Runtime.enable');
/* before the navigation — see the header. */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
problems.length = 0;
await send('Page.navigate', { url });
let ready = false;
for (let i = 0; i < 90 && !ready; i++) {
  await sleep(1000);
  ready = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
if (!ready) console.log('warning: loader never cleared');
await sleep(1500);

const flag = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
if (flag) { console.error('prefers-reduced-motion is still `reduce` — her clock is stopped, nothing to photograph'); process.exit(1); }

/* a frame counter of our own, ticking alongside the page's own loop. Everything
   below waits on this and never on the wall clock. */
await evaluate(`(() => { window.__fc = 0; const tick = () => { window.__fc++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick); return true; })()`);
const fc = () => evaluate('window.__fc');
const framesTo = (f) => evaluate(`new Promise((res) => { const go = () => {
  if (window.__fc >= ${f}) res(window.__fc); else requestAnimationFrame(go); }; go(); })`);

/* a frame count, not a duration: `dt` is clamped to 1/20 s, so the clip's
   seconds are frames at five per tenth of a second.
   ★ These five numbers and five names are a **copy of `ghost.js`'s `ACTIONS`
   and `main.js`'s `MOVES`**, and they were wrong: the durations were still the
   previous character's (1.15/1.85/1.60/1.25/1.50 against the real
   1.05/1.45/1.30/1.00/1.15) and `salute` still printed the old label 敬礼
   instead of 掀帽. A copy that is not checked is a copy that is wrong, and this
   one failed quietly in the worst way: the third sample of *every* move landed
   past the end of the clip and reported `action=null`, which reads like "the
   clip finished early" rather than "the probe aimed at the wrong frame".
   If a clip's length changes, change it here too. */
const MOVE = [
  { k: 'nod', cn: '点头', dur: 1.25 }, { k: 'wave', cn: '晃一晃', dur: 1.75 },
  { k: 'spin', cn: '转个圈', dur: 1.55 }, { k: 'jump', cn: '跳一跳', dur: 1.15 },
  { k: 'salute', cn: '掀帽', dur: 1.60 },
];
/* three points: committed, mid-flight, unwinding. A mesh that intersects often
   only does so on the way out, when a limb is coming down past the body. */
const AT = [0.32, 0.58, 0.82];

const shot = async (out) => {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(r.result.data, 'base64'));
};
const rowCentres = () => evaluate(`JSON.stringify([...document.querySelectorAll('#ref-list .row')]
  .map((r) => { const b = r.getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]; }))`).then(JSON.parse);
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const action = () => evaluate('window.__spirit ? window.__spirit.action : "no hook"');

/* the idle reference, so the strip has something to be compared against */
await shot(`${outPrefix}-00-idle.png`);
console.log(`${outPrefix}-00-idle.png  action=${JSON.stringify(await action())}`);

let fails = 0;
for (let i = 0; i < MOVE.length; i++) {
  const rows = await rowCentres();
  if (!rows[i]) { console.log(`FAIL  no row ${i} — the move list is not there`); fails++; continue; }
  const [x, y] = rows[i];
  if (x < 0 || x > W || y < 0 || y > H) {
    console.log(`FAIL  row ${i} sits at ${x},${y}, outside the ${W}x${H} viewport — the panel is folded`);
    fails++; continue;
  }
  const f0 = await fc();                   // the frame the clip starts on, ±1
  await click(x, y);                       // select *and* play — one gesture now
  await framesTo(f0 + 2);
  const started = await action();
  const ok = started === MOVE[i].k;
  if (!ok) fails++;
  console.log(`move ${i + 1} ${MOVE[i].cn}  clicked at ${x},${y}  action=${JSON.stringify(started)}  ${ok ? 'ok' : `FAIL (expected ${MOVE[i].k})`}`);

  const total = Math.round(MOVE[i].dur / 0.05);       // frames in the clip
  let at = 0;
  for (let k = 0; k < AT.length; k++) {
    const target = Math.round(total * AT[k]);
    await framesTo(f0 + target);
    const out = `${outPrefix}-${String(i + 1).padStart(2, '0')}${'abc'[k]}.png`;
    await shot(out);
    console.log(`   ${out}  frame ${target}/${total} (${AT[k]})  action=${JSON.stringify(await action())}`);
  }
  /* let the clip finish before the next one, or the new pose starts from the old
     one's leftovers and the strip shows two moves at once */
  await framesTo(f0 + total + 4);
}

console.log(problems.length ? 'page errors:\n  ' + problems.join('\n  ') : 'page errors: none');
console.log(fails ? `\n${fails} FAILED` : '\nall five moves fired');
ws.close();
