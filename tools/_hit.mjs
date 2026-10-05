/* dev: is anything standing in front of the controls?

   A layout can be wrong in a way no overlap measurement sees. The plate is
   `pointer-events: none` so a drag on the paper turns the model -- except while
   it is overflowing, when `.dossier.overflow .sheet` claims the pointer so the
   record can be scrolled. Claiming the pointer is claiming the *box*: a
   transparent background is still hittable, so wherever that box lies on top of
   a button, the button is dead. Box intersection cannot tell you that (the
   plate's box overlaps the transport at every width from 901 to 1240 by tens of
   thousands of square pixels and always has), and neither can an ink
   intersection, because the overlap can be over the button's padding.

   Hit-testing is the only question that matches the failure: *if a reader taps
   here, what do they get?* This walks every control the page exposes, hit-tests
   its own centre and the two points 20% in from its vertical edges, and reports
   any that do not come back as themselves -- plus, for each, what was in front.

 *   node tools/_hit.mjs [url] [cdpPort] [WxH,WxH,...]

   Needs tools/_dev.mjs up. The page is navigated once; every other viewport is
   a device-metrics change. Exits non-zero if any control is covered.

   ★ Two things this probe had to learn about itself, both of which produced
   confident wrong answers before they were fixed:

   1. A control scrolled out of its container is not a covered control.
      `getBoundingClientRect` returns the layout rect, which is not clipped by an
      ancestor's scroll box, so the action cells below the fold of a capped plate
      hit-tested to whatever was behind them -- fifteen false positives at
      900x700, every one of them a statement about the scroll position. They are
      counted as `offscreen` and skipped.
   2. Waiting for the pin to settle needs a floor on the elapsed time, not just
      "three reads in a row agree". The first quiet moment after a metrics change
      is not the settled layout: the pin can fire a second or two later, and a
      poll that stops early reports the *previous* viewport's `--band` as this
      one's. Measured 1440x820 -> 620x560: 583.8px (the wide window's) against
      the correct 86.2px, which put the plate's top at -58px and looked exactly
      like a page that had ignored the resize.

   HIT_REPIN=1 dispatches one synthetic `resize` after each metrics change, the
   same escape hatch _ov.mjs carries as OV_REPIN. It is slow (it re-runs the
   whole resize path) and it is here only to tell "the page did not re-pin" apart
   from "the emulator did not tell the page", which is the one question the two
   findings above cannot answer on their own.
 */
const [url = 'http://127.0.0.1:8932/', cdpPort = '9445', sizesArg = ''] = process.argv.slice(2);

const ALL = [
  [1440, 820], [1280, 800], [1080, 760], [900, 700], [820, 640],
  [700, 600], [620, 560], [480, 520], [380, 640], [760, 420],
  /* ★ The phone-landscape band, and the one where the plate has to be pinned to
     the top of the frame rather than hung under the masthead (see --plate-floor
     in styles.css). It is the band where the plate is closest to the nav, so it
     is the band where a hit test has the most to say. 568x320 is the smallest
     landscape phone still in use (iPhone SE 1st gen). */
  [844, 390], [780, 360], [667, 375], [568, 320],
];
const SIZES = sizesArg
  ? sizesArg.split(',').map((s) => { const [w, h] = s.split('x'); return [+w, +(h || Math.round(+w * 0.7))]; })
  : ALL;

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

await send('Runtime.enable');
await send('Page.enable');
// Metrics before navigation, the way _ov.mjs does it: the first layout is then
// already the right size, and the pin does not have to converge from the wrong
// one (which it does, but a probe should not depend on that).
await send('Emulation.setDeviceMetricsOverride', { width: SIZES[0][0], height: SIZES[0][1], deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
/* Wait for the page's own "everything is built" signal, the same one _smoke.js
   uses. Until the loader clears it is the topmost element over the entire
   viewport and every hit test returns it -- which reads as "every control is
   covered" and is a statement about the loader, not about the layout. It takes
   ~20s under software rendering. */
{
  const t0 = Date.now();
  for (;;) {
    const { result } = await send('Runtime.evaluate', {
      expression: "(() => { const l = document.querySelector('#loader'); return !l || getComputedStyle(l).opacity === '0'; })()",
      returnByValue: true,
    });
    if (result?.result?.value) break;
    if (Date.now() - t0 > 180000) { console.error('loader never cleared'); process.exit(3); }
    await new Promise((r) => setTimeout(r, 250));
  }
}
// The plate's own height is settled by a 700ms re-pin after the loader goes
// (see pinSoon), and the boot slide runs 1.2s.
await new Promise((r) => setTimeout(r, 2200));

/* Written as a real function and serialised, so nothing in here can be broken by
   a backtick in a comment -- the mistake `_ov.mjs` made four times. It may only
   touch globals. */
const probe = () => {
  const out = [];
  let skipped = 0;
  const label = (el) => {
    if (!el || el.nodeType !== 1) return el === null ? '(null)' : String(el);
    const cls = String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ')
      .slice(0, 14);
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (own ? ':' + own : '');
  };
  /* A control scrolled out of the plate is not a covered control -- it is a
     control that is not on screen yet, and the plate at 900x700 is 246px tall
     carrying 289px of record, so half the action cells are legitimately out of
     view. getBoundingClientRect does not know that: it returns the layout rect,
     which for an element inside a scroll container is wherever it would be if
     the container were tall enough. Without this test the probe reported every
     one of those cells as "blocked by canvas", which is a statement about the
     scroll position and not about the layout. */
  const clippedOut = (el, x, y) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = a.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true;
    }
    return false;
  };
  const seen = new Set();
  const controls = Array.from(document.querySelectorAll('.ui-hit, button, input, [tabindex]'));
  for (const el of controls) {
    if (seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const pts = [
      ['mid', r.left + r.width / 2, r.top + r.height / 2],
      ['top', r.left + r.width / 2, r.top + r.height * 0.2],
      ['bot', r.left + r.width / 2, r.top + r.height * 0.8],
    ];
    for (const [where, x, y] of pts) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      if (clippedOut(el, x, y)) { skipped++; continue; }
      const top = document.elementFromPoint(x, y);
      const ok = top === el || el.contains(top) || (top && top.contains(el));
      if (!ok) out.push({ what: label(el), where, at: Math.round(x) + ',' + Math.round(y), got: label(top) });
    }
  }
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
  };
  const dos = document.querySelector('.dossier');
  return {
    vw: innerWidth, vh: innerHeight, n: seen.size, skipped, blocked: out,
    /* The geometry is here so a `blocked` line can be read against the boxes
       that produced it without a second probe run: "the plate covers the nav" is
       a claim about two rectangles, and the rectangles are cheap. */
    geom: {
      mast: box('.mast'), brand: box('.brand'), nav: box('.mast-nav'),
      dossier: box('.dossier'), sheet: box('.sheet'),
      overflow: !!dos?.classList.contains('overflow'),
      band: dos ? getComputedStyle(dos).getPropertyValue('--band').trim() : null,
      /* Whether the page agrees with the emulator about which side of 900 this
         is, and what it thinks the viewport is: the pin's whole decision is
         made from these two, so a stale `--band` is read against them. */
      mq900: matchMedia('(max-width: 900px)').matches,
      iw: innerWidth,
      ih: innerHeight,
    },
  };
};

const results = [];
for (const [w, h] of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  /* HIT_REPIN=1 dispatches one synthetic resize after the metrics change, the
     same escape hatch _ov.mjs carries as OV_REPIN. It is here because a metrics
     change does not always reach the page as a `resize` event, and a stale pin
     then reads as a layout defect: measured 1440x820 -> 620x560 in one run, the
     page's own `matchMedia('(max-width: 900px)')` was true and `innerWidth` was
     620 while `--band` still held the wide window's 583.8px, which put the
     plate's top at -58px. Whether that is the page's fault or the emulator's is
     what the flag settles: with it, the same two viewports come out flush. */
  if (process.env.HIT_REPIN) {
    await send('Runtime.evaluate', { expression: "dispatchEvent(new Event('resize'))" });
  }
  /* Wait for the pin to stop moving, not for a fixed number of milliseconds.
     A fixed sleep reads whatever the layout happened to be at that instant:
     `pinSoon` re-pins 700ms after the resize, the boot slide runs 1.2s, and the
     retract is .58s -- and the first reading after a metrics change is the one
     to distrust anyway (see the note in _ov.mjs). Sampling until three
     consecutive reads agree costs a few hundred milliseconds and removes the
     question. */
  {
    const t0 = Date.now();
    let last = '';
    let same = 0;
    for (;;) {
      const { result } = await send('Runtime.evaluate', {
        expression: "(() => { const d = document.querySelector('.dossier'); const s = document.querySelector('.sheet'); const m = document.querySelector('.mast'); if (!d || !s || !m) return null; const a = d.getBoundingClientRect(); const b = s.getBoundingClientRect(); const c = m.getBoundingClientRect(); return [Math.round(a.top), Math.round(a.bottom), Math.round(b.left), Math.round(b.bottom), Math.round(c.bottom), getComputedStyle(d).getPropertyValue('--band')].join('|'); })()",
        returnByValue: true,
      });
      const now = String(result?.result?.value);
      same = now === last ? same + 1 : 0;
      last = now;
      /* Three agreeing reads *and* a floor on the elapsed time. The floor is the
         part that matters: the pin can fire a second or two after a metrics
         change -- the page's re-pin is driven by the masthead's own box, and
         under `setDeviceMetricsOverride` that box lags the viewport (see the
         note in _ov.mjs) -- so a poll that stops at the first quiet moment
         reports the previous viewport's pin as if it were this one's. */
      if ((same >= 3 && Date.now() - t0 > 5000) || Date.now() - t0 > 20000) break;
      await new Promise((r) => setTimeout(r, 220));
    }
  }
  const { result } = await send('Runtime.evaluate', {
    expression: '(' + probe.toString() + ')()',
    returnByValue: true,
    awaitPromise: false,
  });
  const v = result?.result?.value;
  if (!v) {
    console.log(`${w}x${h}  <no value: ${JSON.stringify(result?.exceptionDetails?.exception?.description || result)}>`);
    continue;
  }
  results.push([w, h, v]);
  const head = `${String(w).padStart(4)}x${String(h).padEnd(4)} controls=${String(v.n).padStart(2)} offscreen=${String(v.skipped).padStart(2)}  blocked=${v.blocked.length}`;
  console.log(head);
  const g = v.geom;
  console.log(`      mast ${g.mast}  nav ${g.nav}  sheet ${g.sheet}  overflow=${g.overflow} band=${g.band}  mq900=${g.mq900} inner=${g.iw}x${g.ih}`);
  for (const b of v.blocked) console.log(`      ${b.what}  @${b.where} ${b.at}  ->  ${b.got}`);
}

const bad = results.filter(([, , v]) => v && v.blocked.length);
console.log(bad.length ? `\n${bad.length} of ${results.length} viewports have a control behind something` : '\nall controls are reachable at every viewport');
ws.close();
process.exit(bad.length ? 1 : 0);
