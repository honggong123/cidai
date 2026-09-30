/* dev: does the pointer actually reach her, and does she answer it?
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
 *      the raycast answering, so the box it prints is a real screen footprint —
 *      the *capsule's*, not hers: she is eighty meshes that move every frame, and
 *      picking against those would give a target that wobbles under the cursor.
 *   2. whether she looks at the pointer, and **which way**. Four probes, one per
 *      side, against `__spirit.aimX` / `aimY`. This is the only assertion here
 *      that is about a sign, and a sign is exactly what a refactor flips without
 *      anything on screen looking obviously wrong.
 *   3. a tap on her plays a greeting — and does *not* touch the transport. She
 *      used to toggle play when clicked, which made the one object you would
 *      instinctively poke the one object that did not answer.
 *   4. a drag that *starts* on her is a drag, not a greeting (the 6 px threshold).
 *   5. a hold that starts on her is not a greeting either (the 500 ms threshold).
 *   6. two taps 90 ms apart greet once, not twice (the double-click collapse).
 *   7. a click on the empty room does not greet her.
 *
 * WHY THE NEGATIVE CASES ASSERT ON THE *NAME* AND NOT ON NULL
 * A greeting is 1.2-1.9 s of the page's own clock, and this page caps `dt` at
 * 1/20 s — under a software renderer at 0.9 fps that is a clock running at about
 * a twenty-secondth of wall time, so "wait for the nod to finish" is a thirty
 * second wait per case. Worse, it is a wait that silently stops working the
 * moment the frame rate changes. The three greetings cycle, so the clock-free
 * question is just as sharp: *did the greeting counter advance?* If a drag had
 * greeted her, the name would have moved on from `nod` to `wave`. It reads the
 * same whether the previous clip is still running or has finished, and it does
 * not care what the frame rate is.
 */
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

/* `action` comes off `window.__spirit` and not off the panel's highlight: the
   highlight is the page's *opinion* of what she is doing, and the question here
   is what she is actually doing. They agree because main.js reads the model
   back, but a probe that asserts that agreement by reading only one side of it
   would pass on a page where the panel had stopped listening.
   Which is why `playingRow` is read as well, and separately. It is the one
   thing that can only be asked of the DOM, and it did in fact break: `render()`
   used to write `className` wholesale on every row, so the `.playing` class that
   `syncMoveButtons()` had just added was erased on the same frame — the model
   played the clip, the panel said it was playing, and the row stayed dark. */
const state = () => evaluate(`JSON.stringify({
  hover: document.body.classList.contains('over-spirit'),
  cursor: getComputedStyle(document.querySelector('#gl')).cursor,
  playing: document.body.classList.contains('playing'),
  label: document.querySelector('#play-label')?.textContent,
  dragging: document.body.classList.contains('dragging'),
  action: window.__spirit ? window.__spirit.action : 'no hook',
  playingRows: [...document.querySelectorAll('#ref-list .row.playing')].map((r) => r.textContent.trim()),
})`).then(JSON.parse);

const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
const down = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
const up = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });

let fails = 0;
const check = (ok, line) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${line}`); };

/* 1 — the hit region. A coarse scan, because this is a rectangle in screen space
   and the question is only where its edges are. One CDP round trip per probe, and
   a round trip on this page costs most of a frame (software rendering, ~0.9 fps),
   so the grid is deliberately wide: 80 px finds her inside an 8 px error, and the
   refinement below takes the rest off. */
const STEP = 80;
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
/* refine the four edges, 8 px at a time, from the coarse box */
const solid = async (x, y) => { await move(x, y); return evaluate(`document.body.classList.contains('over-spirit')`); };
for (let d = STEP - 8; d >= 8; d -= 8) {
  if (x0 - d >= 20 && await solid(x0 - d, (y0 + y1) / 2 | 0)) x0 -= d;
  if (x1 + d < 1000 && await solid(x1 + d, (y0 + y1) / 2 | 0)) x1 += d;
  if (y0 - d >= 20 && await solid((x0 + x1) / 2 | 0, y0 - d)) y0 -= d;
  if (y1 + d < H - 40 && await solid((x0 + x1) / 2 | 0, y1 + d)) y1 += d;
}
console.log(`hit region  x ${x0}..${x1}  y ${y0}..${y1}  (${hits} of ${n} probes hit, ${STEP} px grid then 8 px refinement)`);
const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);

/* 2 — hover */
await move(cx, cy);
const onHer = await state();
check(onHer.hover && onHer.cursor === 'pointer', `hover  over-spirit ${onHer.hover}  cursor "${onHer.cursor}"`);

/* 3 — does she look at the pointer, and does she look the *right* way? Her head
   turns by `+aimX`, so a pointer to her right has to read positive; and the
   pitch is negated, so a pointer above her has to read positive too. Get either
   one backwards and she looks away from the cursor — which is subtle enough on
   a still frame to survive a lot of review.
   The probes stay clear of the dossier panel, because that is a real interactive
   element: the pointer stopping on it never reaches the canvas, and the aim
   would simply hold its last value — a false pass. */
const panelLeft = await evaluate(`Math.round(document.querySelector('.dossier').getBoundingClientRect().left)`);
const aim = async (x, y) => { await move(x, y); await sleep(60); return evaluate('({ x: window.__spirit.aimX, y: window.__spirit.aimY })'); };
const farLeft = await aim(Math.max(10, x0 - 200), cy);
const farRight = await aim(Math.min(x1 + 140, panelLeft - 50), cy);
const farUp = await aim(cx, Math.max(10, y0 - 200));
const farDown = await aim(cx, Math.min(y1 + 200, H - 10));
check(farLeft.x < -0.1 && farRight.x > 0.1,
  `aim x     left ${farLeft.x.toFixed(2)}  right ${farRight.x.toFixed(2)}   (left<0<right)`);
check(farUp.y > 0.1 && farDown.y < -0.1,
  `aim y     up   ${farUp.y.toFixed(2)}  down  ${farDown.y.toFixed(2)}   (down<0<up)`);

/* 4 — a tap on her greets her, and leaves the transport alone */
await move(cx, cy);
const before = await state();
await down(cx, cy); await up(cx, cy);
await sleep(120);
const afterTap = await state();
check(afterTap.action === 'nod' && afterTap.playing === before.playing,
  `tap        action ${JSON.stringify(before.action)} -> ${JSON.stringify(afterTap.action)}   playing ${before.playing} -> ${afterTap.playing} (must not change)`);
check(afterTap.playingRows.length === 1 && afterTap.playingRows[0].includes('点头'),
  `tap row    lit ${JSON.stringify(afterTap.playingRows)} (must be exactly the "点头" row)`);

/* 5 — a drag that starts on her is a drag, not a greeting. `nod` was the first
   greeting, so a greeting here would read `wave`. */
await down(cx, cy);
for (let i = 1; i <= 6; i++) await move(cx + i * 12, cy + i * 3);
await up(cx + 72, cy + 18);
await sleep(150);
const afterDrag = await state();
check(afterDrag.action === 'nod' || afterDrag.action === null,
  `drag       action ${JSON.stringify(afterDrag.action)} (must not advance past "nod")  dragging=${afterDrag.dragging}`);

/* 6 — a hold that starts on her */
await sleep(400);
await down(cx, cy);
await sleep(750);
await up(cx, cy);
await sleep(150);
const afterHold = await state();
check(afterHold.action === 'nod' || afterHold.action === null,
  `hold 750ms action ${JSON.stringify(afterHold.action)} (must not advance past "nod")`);

/* 7 — two taps 90 ms apart: one greeting, not two. The second tap is inside the
   320 ms double-click window, so it must be collapsed; if it is not, the counter
   advances twice and the name lands on `salute` instead of `wave`. */
await sleep(400);
await down(cx, cy); await up(cx, cy);
await sleep(90);
await down(cx, cy); await up(cx, cy);
await sleep(120);
const afterDbl = await state();
check(afterDbl.action === 'wave', `two taps   action ${JSON.stringify(afterDbl.action)} (must be "wave", i.e. exactly one more greeting)`);

/* 8 — a click on the room */
await sleep(600);
await move(60, 760);
await down(60, 760); await up(60, 760);
await sleep(150);
const afterBg = await state();
check(afterBg.action === 'wave' && !afterBg.hover,
  `empty room action ${JSON.stringify(afterBg.action)} (must stay "wave")  hover=${afterBg.hover}`);

console.log(problems.length ? 'page errors:\n  ' + problems.join('\n  ') : 'page errors: none');
console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
ws.close();
