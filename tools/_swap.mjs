/* does a track change survive? — the `staged` handoff, exercised end to end
 *
 *   node tools/_swap.mjs <url> [cdpPort] [dpr]
 *
 * WHY
 * `applyTrack()` and `reinitTrack()` used to both do
 *
 *     const staged = cas.setLabel({ title, artist, album, minutes });
 *     swap.neu = staged.neu;
 *     swap.old = staged.old;
 *
 * `staged` was the *old* cassette's label-plate staging — it handed back the two
 * arrays of canvases the write head swept between (`swap.neu` / `swap.old`).
 * `relic.js` replaced the deck and its `setLabel()` **returns nothing**, so
 * `staged` was `undefined` and both lines above read a property off it. The call
 * sites are gone; this probe is what keeps them gone, and it drives the two
 * doors a visitor actually uses (open the programme, click a track; press 重置)
 * rather than calling the functions directly.
 *
 * The distinction it is built to make: an unhandled rejection inside an `async`
 * function does NOT stop the caller, because `applyTrack(...)` is called without
 * `await` (main.js:744/771/2974). So the failure mode to look for is *silence* —
 * the track's audio loads, the label never sweeps, and the now-playing chip never
 * changes. `swap` is not on the hook, so the tell is behavioural.
 *
 * The two doors fail *differently*, which is why both are exercised here:
 *   · `applyTrack`  — thrown into an unawaited promise → one unhandled rejection,
 *                     and `showError()` writes it into a loader that is already
 *                     gone (`if (loaderLbl.parentElement)`, main.js:1235). Silent:
 *                     the track simply never arrives.
 *   · `reinitTrack` — called **synchronously** by `reinit()` from the 重置 click
 *                     handler (main.js:2683/2726) → the throw takes the rest of
 *                     `reinit()` with it (`setTheme('studio')`, `orbit.setPreset`,
 *                     `render()`), so 重置 resets nothing.
 *
 * Step 6 is a third thing the same two doors walked into, and it is not about
 * exceptions at all: 目录 opens with a rAF and the track row closes with a plain
 * call, so doing both in one task leaves `indexOpen === false` on a panel whose
 * `.open` class is about to be re-added by the queued frame. 重置 then cannot
 * close it. See step 6 for why the race is written as one task rather than timed.
 */
const [url, cdpPort = '9446', dpr = '1'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_swap.mjs <url> [cdpPort] [dpr]'); process.exit(2); }

import { pickPage } from './_cdp.mjs';
const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const page = pickPage(list, url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    events.push(['exception', d?.exception?.description || d?.text]);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    events.push(['console.error', m.params.args.map((a) => a.description || a.value).join(' ')]);
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
const drain = (tag) => {
  if (!events.length) { console.log(`  ${tag}: no exceptions, no console errors`); return; }
  console.log(`  ${tag}:`);
  for (const [kind, text] of events) {
    /* the stack matters as much as the message: the first two frames name the
       file and line, which is how you tell a live failure from a stale bundle
       being served out of the browser cache */
    for (const line of String(text).split('\n').slice(0, 3)) console.log(`    [${kind}] ${line.slice(0, 200)}`);
  }
  events.length = 0;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 740, deviceScaleFactor: +dpr, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url });
for (let i = 0, ok = false; i < 90 && !ok; i++) {
  await sleep(1000);
  ok = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
await sleep(4000);

const chip = () => evaluate(`(() => {
  const a = document.querySelector('audio');
  const t = document.querySelector('#now-title');
  return { now: t ? t.textContent.trim() : null,
    label: (document.querySelector('#play-label') || {}).textContent,
    paused: a.paused, ready: a.readyState, dur: a.duration,
    playing: document.body.classList.contains('playing') };
})()`);

console.log('1. after boot');
console.log('  ' + JSON.stringify(await chip()));
drain('boot');

console.log('2. press play');
{
  const b = await evaluate(`(() => { const q = document.querySelector('#btn-play').getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    await sleep(80);
  }
  await sleep(3000);
  console.log('  ' + JSON.stringify(await chip()));
  drain('press play');
}

console.log('3. pick a *track* out of the programme (the `staged` handoff)');
{
  /* ★ `#index .icol-h` matches the action rows too — the panel's five moves use
     the same row class, and `hs[1]` is 「02 晃一晃」. Only the track rows carry
     `data-track` on the `.icol` parent (buildTracks), so the selector has to say
     so, or this probe quietly measures `doMove()` instead of `applyTrack()`. */
  await evaluate(`(() => { const b = document.querySelector('#btn-index'); if (b) b.click(); return true; })()`);
  await sleep(1500);
  const rows = await evaluate(`(() => [...document.querySelectorAll('#index .icol[data-track]')].map((d) => ({
    id: d.dataset.track, text: (d.querySelector('.icol-h') || {}).textContent.trim().slice(0, 30),
  })))()`);
  console.log('  track rows: ' + JSON.stringify(rows));
  const before = (await chip()).now;
  /* ★ Shrink *before* clicking. `SWAP_DUR = 1.2` is in **page** seconds and the
     loop caps `dt` at 1/20 s, so the sweep is 24 frames — frames, not seconds,
     are the unit, and the viewport is the only lever on how long a frame takes.
     At 1180x740 a frame costs seconds and 24 of them outrun any sane poll
     window; at 480x300 they cost a fraction of that. A window that closes first
     reads as "the load did not commit" when it is only "still sweeping". */
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 300, deviceScaleFactor: +dpr, mobile: false });
  /* `.click()` rather than a synthetic mouse press: the row's handler is what is
     under test, and hit-testing a scrolling overlay would add a second way to
     get a false negative. */
  const picked = await evaluate(`(() => {
    const hs = [...document.querySelectorAll('#index .icol[data-track] .icol-h')];
    const h = hs[1];
    if (!h) return null;
    const t = h.textContent.trim();
    h.click();
    return t;
  })()`);
  const t0 = Date.now();
  let last = '';
  let committed = false;
  for (let i = 0; i < 90; i++) {
    const c = await chip();
    const key = `${c.now}|${c.label}|${c.playing}`;
    if (key !== last) {
      last = key;
      console.log(`  +${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(5)}s  now=${c.now}  label=${c.label}  playing=${c.playing}`);
    }
    /* the chip is the thing under test; `playing` is not part of the condition
       because a committed swap may leave the transport stopped */
    if (c.now && c.now !== before) { committed = true; break; }
    await sleep(1000);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 740, deviceScaleFactor: +dpr, mobile: false });
  const after = await chip();
  console.log(`  clicked: ${JSON.stringify(picked)}   chip: ${JSON.stringify(before)} → ${JSON.stringify(after.now)}   (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  drain('track change');
  if (!committed) console.log('  ⚠ the now-playing chip did NOT change — the load did not commit');
}

console.log('4. press play after the change (must start: `swap.state` has to be back to idle)');
{
  const b = await evaluate(`(() => { const q = document.querySelector('#btn-play').getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    await sleep(80);
  }
  await sleep(4000);
  console.log('  ' + JSON.stringify(await chip()));
  drain('press play (2nd)');
}

console.log('5. 重置 (reinit → reinitTrack, synchronous inside the click handler)');
{
  /* ★ The first version of this step compared `theme|label` before and after and
     called any equality a failure. That check is true no matter what the handler
     does: 重置's whole job is to put the page back in its *default* state, and
     the page was already in it (the previous step had just stopped the
     transport), so `before === after` even when `reinit()` never ran a line.
     A reset test has to be given something to undo — move the page off the
     default first, then read what 重置 puts back. Each change is idempotent, so
     the step does not depend on what the earlier steps left open. */
  await evaluate(`(() => {
    const idx = document.querySelector('#index');
    if (idx && !idx.classList.contains('open')) document.querySelector('#btn-index')?.click();
    document.querySelector('#theme button[data-theme="noir"]')?.click();
    const a = document.querySelector('#btn-auto');
    if (a && !a.classList.contains('on')) a.click();
    return true;
  })()`);
  /* ★ `.open` is added from a rAF, so at a few seconds a frame it takes a few
     seconds to land. Poll for it: a fixed sleep that returns first leaves the
     panel closed at read time and the step stops testing anything about it. */
  for (let i = 0; i < 20; i++) {
    if (await evaluate(`!!document.querySelector('#index.open')`)) break;
    await sleep(1000);
  }
  /* everything here is written synchronously by the handlers, so reading it is
     safe even though the theme's *rendering* eases over the next second */
  const state = () => evaluate(`[
    document.documentElement.dataset.theme,
    (document.querySelector('#index') || {}).classList?.contains('open') ? 'index' : '-',
    (document.querySelector('#btn-auto') || {}).classList?.contains('on') ? 'auto' : '-',
  ].join('|')`);
  const before = await state();
  const clicked = await evaluate(`(() => { const b = document.querySelector('#btn-reinit'); if (!b) return 'no button'; b.click(); return 'clicked'; })()`);
  await sleep(4000);
  const after = await state();
  console.log(`  ${clicked}   theme|index|auto: ${before} → ${after}`);
  console.log('  ' + JSON.stringify(await chip()));
  drain('重置');
  if (before === after) console.log('  ⚠ 重置 left the page exactly where it was — the handler threw before it could reset');
  else if (after !== 'studio|-|-') console.log('  ⚠ 重置 moved the page, but not all the way home');
}

console.log('6. 目录 + 点曲目 in one task (a queued rAF re-opening a closed panel)');
{
  /* ★ Both clicks in a single synchronous block: they are then guaranteed to be
     the same task, so `openIndex()`'s rAF is still queued when the row handler's
     `closeIndex()` runs. That is the whole bug — the queued callback adds `.open`
     to a panel whose `indexOpen` is already `false`, and `closeIndex()`'s
     `if (!indexOpen) return;` can never take it off again. Doing it in one task
     makes this a reproduction rather than a race to be lucky about. */
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 300, deviceScaleFactor: +dpr, mobile: false });
  /* the race needs the panel *closed* going in: otherwise `#btn-index` runs
     `closeIndex()` instead of `openIndex()`, no rAF is queued, and the step
     passes without testing anything (which is how its first version read) */
  if (await evaluate(`!!document.querySelector('#index.open')`)) {
    await evaluate(`document.querySelector('#btn-index').click()`);
    await sleep(4000);
  }
  const before = await evaluate(`!!document.querySelector('#index.open')`);
  await evaluate(`(() => {
    document.querySelector('#btn-index').click();
    const h = [...document.querySelectorAll('#index .icol[data-track] .icol-h')][1];
    if (h) h.click();
    return true;
  })()`);
  /* long enough for the queued frame to run at this size, and then some: the
     failure is "the class came back", so a window that closes early would read
     as a pass */
  await sleep(6000);
  const after = await evaluate(`(() => { const i = document.querySelector('#index'); return { open: i.classList.contains('open'), hidden: i.hidden }; })()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 740, deviceScaleFactor: +dpr, mobile: false });
  console.log(`  #index.open before=${before}  after=${JSON.stringify(after)}`);
  drain('same-task open+pick');
  if (after.open) console.log('  ⚠ the panel is open while `indexOpen === false` — a queued rAF re-opened a panel that had already been closed');
}
ws.close();
