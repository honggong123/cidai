/* dev: does a click on her actually reach her?
 *
 *   node tools/_pick.mjs <url> [cdpPort] [dpr]
 *
 * WHY REAL INPUT AND NOT SYNTHETIC EVENTS
 * The orbit calls `setPointerCapture` on the canvas in its own pointerdown
 * listener, and a synthetic `pointerId` is not an active pointer, so the browser
 * throws NotFoundError *inside that listener*. A DOM listener's exception is
 * reported and swallowed — it never reaches `dispatchEvent`'s caller — so a probe
 * built on `new PointerEvent(...)` would report a page that looks fine while the
 * capture the orbit depends on silently never happened. `Input.dispatchMouseEvent`
 * goes in through the browser's real input pipeline, which synthesises trusted
 * pointer events with a real pointer behind them: it tests the thing that ships.
 *
 * WHAT IT MEASURES
 *   1. the hit region, by scanning for where `body.over-spirit` turns on. That is
 *      the raycast answering, so the box it prints is the sprite's actual screen
 *      quad — not a guess about where she "should" be.
 *   2. a click in the middle of that box toggles the transport.
 *   3. a drag that *starts* on her does not (the 6 px threshold).
 *   4. a hold that starts on her does not (the 500 ms threshold).
 *   5. two taps 90 ms apart toggle once, not twice (the double-click collapse).
 *   6. a click on the empty room does not.
 */
import { readFileSync } from 'node:fs';

const [url, cdpPort = '9445', dpr = '1'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_pick.mjs <url> [cdpPort] [dpr]'); process.exit(2); }

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
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`)); else p.resolve(m);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map((a) => a.description || a.value).join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  const guard = setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out`)); } }, 180000);
  guard.unref?.();
  pending.set(n, { resolve: (v) => { clearTimeout(guard); resolve(v); }, reject: (e) => { clearTimeout(guard); reject(e); } });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  .then((r) => r.result?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const W = 1440, H = 900;
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +dpr, mobile: false });
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
for (let i = 0, ok = false; i < 90 && !ok; i++) {
  await sleep(1000);
  ok = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
await sleep(1500);

const state = () => evaluate(`JSON.stringify({
  hover: document.body.classList.contains('over-spirit'),
  cursor: getComputedStyle(document.querySelector('#gl')).cursor,
  playing: document.body.classList.contains('playing'),
  label: document.querySelector('#play-label')?.textContent,
  dragging: document.body.classList.contains('dragging'),
})`).then(JSON.parse);

const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
const down = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
const up = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });

/* 1 — the hit region. A coarse scan, because this is a rectangle in screen space
   and the question is only where its edges are. One CDP round trip per probe, so
   the grid is deliberately wide: 60 px finds her inside a 6 px error, and the
   refinement below takes the rest off. */
const STEP = 60;
let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, hits = 0, n = 0;
for (let y = 40; y < H - 100; y += STEP) {
  for (let x = 20; x < 1000; x += STEP) {
    n++;
    await move(x, y);
    if (await evaluate(`document.body.classList.contains('over-spirit')`)) {
      hits++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
}
/* refine the four edges, 6 px at a time, from the coarse box */
const solid = async (x, y) => { await move(x, y); return evaluate(`document.body.classList.contains('over-spirit')`); };
for (let d = STEP - 6; d >= 6; d -= 6) {
  if (x0 - d >= 20 && await solid(x0 - d, (y0 + y1) / 2 | 0)) x0 -= d;
  if (x1 + d < 1000 && await solid(x1 + d, (y0 + y1) / 2 | 0)) x1 += d;
  if (y0 - d >= 20 && await solid((x0 + x1) / 2 | 0, y0 - d)) y0 -= d;
  if (y1 + d < H - 40 && await solid((x0 + x1) / 2 | 0, y1 + d)) y1 += d;
}
console.log(`hit region  x ${x0}..${x1}  y ${y0}..${y1}  (${hits} of ${n} probes hit, ${STEP} px grid then 6 px refinement)`);
const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);

/* 2 — a tap on her */
const before = await state();
await move(cx, cy);
const onHer = await state();
await down(cx, cy);
await up(cx, cy);
await sleep(400);
const afterTap = await state();
console.log(`hover       over-spirit ${onHer.hover}  cursor "${onHer.cursor}"`);
console.log(`tap         playing ${before.playing} → ${afterTap.playing}   label "${before.label}" → "${afterTap.label}"   title "${await evaluate('document.title')}"`);

/* 3 — a drag that starts on her */
await down(cx, cy);
for (let i = 1; i <= 6; i++) await move(cx + i * 12, cy + i * 3);
await up(cx + 72, cy + 18);
await sleep(400);
const afterDrag = await state();
console.log(`drag        playing ${afterTap.playing} → ${afterDrag.playing}  (must not change)  dragging=${afterDrag.dragging}`);

/* 4 — a hold that starts on her */
await down(cx, cy);
await sleep(750);
await up(cx, cy);
await sleep(400);
const afterHold = await state();
console.log(`hold 750ms  playing ${afterDrag.playing} → ${afterHold.playing}  (must not change)`);

/* 5 — two taps 90 ms apart: one toggle, not two */
await down(cx, cy); await up(cx, cy);
await sleep(90);
await down(cx, cy); await up(cx, cy);
await sleep(400);
const afterDbl = await state();
console.log(`two taps    playing ${afterHold.playing} → ${afterDbl.playing}  (must change exactly once)`);

/* 6 — a click on the room */
await move(60, 760);
await down(60, 760); await up(60, 760);
await sleep(400);
const afterBg = await state();
console.log(`empty room  playing ${afterDbl.playing} → ${afterBg.playing}  (must not change)  hover=${afterBg.hover}`);

console.log(problems.length ? 'page errors:\n  ' + problems.join('\n  ') : 'page errors: none');
ws.close();
