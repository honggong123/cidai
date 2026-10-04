/* dev: the plate-versus-transport question, asked of ink rather than of boxes.

   _resp.mjs already reports `transportOverSheet`, and it is the wrong number for
   deciding whether anything needs to change. The sheet is a padded, mostly
   transparent plate and the transport is a bar of small controls: their boxes
   overlap at every width from 901 to 1240 by tens of thousands of square pixels
   and always have, while most of that area is empty padding on one side and dead
   space between controls on the other. A number that never moves is not a
   reading.

   The question a reader actually has is narrower: *is there a word on the plate
   printed over a word on the transport.* That is a pairwise question between the
   elements that carry text, and it is answerable directly -- walk both subtrees,
   keep the elements that have a non-empty text node of their own, and intersect
   the pairs. Whatever survives is the collision; everything else is padding.

   It also prints the vertical budget, because that is what any fix has to spend:
   the gap between the masthead's bottom and the transport's top is the only room
   the plate has, and if the plate is taller than that gap then "no overlap" is
   not on the menu and the fix has to be about who wins rather than about fitting.

   usage: node tools/_ov.mjs [url] [cdpPort] [WxH,WxH,...]

   OV_REPIN=1 dispatches one more resize after everything has landed, so the pin
   is taken from the settled layout rather than from the one the resize handler
   saw. OV_WATCH=1 samples the masthead's bottom and the transport's top over the
   two seconds after a resize. OV_PARTS=1 prints the boxes the two measured
   numbers are made of -- the masthead's children (its height is the brand
   block's, and the pin reads that bottom) and the plate's (.dbody, .doc-note,
   .spec, .ref-list) -- which is what a disagreement between two readings of the
   same viewport has to be chased with, see below. OV_STACK=1 marks which lines
   of the plate fall inside the counter's band.

   ★ THE NOISE FLOOR, measured, so nobody chases it again: the same viewport read
   twice in one run does not come out identical. At 1440x820 the masthead's
   bottom is 134.7px on the first reading and 130.2..133.3 on every one after it
   -- the brand block's three children each lose about 0.7px, so the display face
   settles after the first reading. It is not the --band/--panel-top mechanism,
   and it is not document.fonts.ready, which has already resolved by then. At
   1092x588 the same pair reads 77.5 then 76.6..76.8. Everything the pin computes
   moves by that much and no more; collisions stay at zero either way. A reading
   that moves by 30px is not this -- it is a transition still in flight, so
   re-run before believing it.

   ★★ AND A BIGGER ONE, which cost an hour of chasing a page bug that was not
   there: under setDeviceMetricsOverride a *real* property that depends on the
   viewport can be one viewport behind, while a *custom* property is already
   current. Measured 1440x820 -> 1280x800 -> 1092x588 in one run: `.brand h1`'s
   font-size read 43.92px / 43.92px / 33.31px -- 43.92 is 3.05vw at *1440*, so
   the second viewport reported the first one's size -- while `--pad`
   (clamp(1.75rem, 3.6vw, 3.5rem)) read 51.8px / 39.3px, correct at every step.
   The masthead's bottom therefore came out 134.7px where the page's own layout
   says 114.5px, and the pin was clamped to a band 17px narrower than the page
   has (351.8px on a 368.9px record, hiding 65px of it). It is an emulation
   artifact, not a page bug -- but the first reading after a metrics change is
   the one to distrust, and OV_PARTS=1 is how you tell the two apart: it prints
   `innerWidth` and the logotype's font-size side by side. The page has since
   been made to re-pin whenever the masthead's own box changes (see plateWatch in
   main.js), which makes the pin converge regardless.

   Needs tools/_dev.mjs up.
 */
const [url = 'http://127.0.0.1:8932/', cdpPort = '9445', sizesArg = ''] = process.argv.slice(2);

const SIZES = sizesArg
  ? sizesArg.split(',').map((s) => { const [w, h] = s.split('x'); return [+w, +(h || Math.round(+w * 0.7))]; })
  : [[1440, 820], [1280, 800], [1240, 800], [1100, 760], [1080, 760], [1040, 720], [1000, 700], [960, 700]];

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
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`)); else p.resolve(m);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  const guard = setTimeout(() => {
    if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out`)); }
  }, 300000);
  guard.unref?.();
  pending.set(n, {
    resolve: (v) => { clearTimeout(guard); resolve(v); },
    reject: (e) => { clearTimeout(guard); reject(e); },
  });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  .then((r) => r.result?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
const START = SIZES[0];
await send('Emulation.setDeviceMetricsOverride', { width: START[0], height: START[1], deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

let ready = false;
for (let i = 0; i < 120 && !ready; i++) {
  await sleep(1000);
  ready = await evaluate(`(() => { const l = document.getElementById('loader');
    return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
if (!ready) console.log('warning: loader never cleared\n');
await evaluate('(async () => { await document.fonts.ready; return document.fonts.size; })()').catch(() => 0);

/* same reasoning as _resp.mjs: a device-metrics change re-runs the media queries
   and then the page *transitions* to the new layout (.sheet carries .58s
   margin-left, .dossier .7s left), so a reading taken before those finish is a
   reading of a layout the page never settles at. Two frames to get past the
   style recalc and the paint, then let the transitions land. */
const settle = async () => {
  await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))').catch(() => 0);
  await sleep(1500);
};

/* ★ A settle is not enough for the plate's own pin, and this is the whole reason
   the option below exists. `pinPanel()` measures the plate when the *resize*
   fires — but `.sheet` carries a .58s `margin-left` transition and its width is
   what the record reflows into, so at that instant the plate is still at an
   intermediate width and its height is an intermediate one too. The number it
   stores in `--panel-half` is therefore a reading of a layout the page never
   settles at, and it stays wrong until the next resize: measured at 1092x588,
   `--panel-half` says 208.7px while the plate is 371.5px tall (half = 185.8).
   23px of drift, silently, on the one viewport the user actually looks at.

   OV_REPIN=1 dispatches one more `resize` *after* everything has landed, so the
   pin is taken from the settled layout. Run it both ways: if the two readings
   differ, what you are looking at is a stale pin and not a layout. */
const repin = async () => {
  if (!process.env.OV_REPIN) return;
  await evaluate("window.dispatchEvent(new Event('resize'))").catch(() => 0);
  await settle();
};

/* ★ OV_WATCH=1 samples the two numbers `pinPanel` reads, over the two seconds
   after a resize. It exists because a forced layout inside the resize handler
   can disagree with the same layout once it has landed, and no amount of
   reasoning about *why* replaces the series: measured at 1092x588 the masthead's
   bottom reads 134.6px in the handler and 117.4px after — and the plate, which
   is pinned from it, came out 17px short of the room it had. */
const watch = async () => {
  if (!process.env.OV_WATCH) return;
  await evaluate("window.dispatchEvent(new Event('resize'))").catch(() => 0);
  const series = await evaluate(`(async () => {
    const m = document.querySelector('.mast'), t = document.querySelector('.transport');
    const d = document.querySelector('.dossier');
    const at = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = [];
    let prev = 0;
    for (const ms of [0, 50, 150, 400, 900, 1800]) {
      if (ms > prev) await at(ms - prev);
      prev = ms;
      out.push({ ms, mast: +m.getBoundingClientRect().bottom.toFixed(1),
                 tt: +t.getBoundingClientRect().top.toFixed(1),
                 half: getComputedStyle(d).getPropertyValue('--panel-half').trim() });
    }
    return out;
  })()`).catch(() => null);
  if (series) for (const s of series) {
    console.log(`   watch +${String(s.ms).padStart(4)}ms  mast.b=${s.mast}  tt=${s.tt}  band=${+(s.tt - s.mast).toFixed(1)}  half=${s.half}`);
  }
};

/* The measurement itself. ★ It is a real function and not a string, and that is
   a repair rather than a preference. It used to live in a template literal, and
   these comments quote CSS properties by name — so every backtick in a comment
   closed the string early. That happened four times; the fourth is why this is
   written this way. As a function the parser checks it on every run, the editor
   highlights it, and a backtick in a comment is just a comment.

   It may reach for globals only (`document`, `getComputedStyle`): it is
   serialised with toString() and evaluated inside the page, so nothing from this
   module — no imports, no constants — exists on that side. */
const measure = () => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1),
             w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };

  // an element "carries ink" if it has a text node child of its own -- an empty
  // wrapper, a padding box or a purely decorative pseudo-element does not, and
  // including those is what made the box-overlap number useless.
  //
  // And the rect that counts is the one you can see. Below 900 the plate is a
  // bottom sheet held to max(calc(100vh - 28.34rem), 5rem) with overflow:auto,
  // so its spec rows are laid out *outside* its own box and clipped away -- they
  // still have geometry, and intersecting that geometry against the transport
  // reports a collision between two things that are not both on screen. So clip
  // every rect against each ancestor that scrolls or hides first, and drop what
  // is left.
  const visible = (el) => {
    const b = el.getBoundingClientRect();
    let l = b.left, t = b.top, r = b.right, bo = b.bottom;
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const nb = n.getBoundingClientRect();
      l = Math.max(l, nb.left); t = Math.max(t, nb.top);
      r = Math.min(r, nb.right); bo = Math.min(bo, nb.bottom);
    }
    // same shape as getBoundingClientRect, so every consumer below can keep
    // reading .left/.top/.right/.bottom without knowing which rect it got
    return { left: l, top: t, right: r, bottom: bo, width: r - l, height: bo - t };
  };
  const ink = (root) => !root ? [] : [...root.querySelectorAll('*')]
    .filter((e) => {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
      const v = visible(e);
      return v.width >= 1 && v.height >= 1;
    })
    .map((e) => ({ cls: (e.className || e.tagName).toString().trim().split(/\\s+/)[0].slice(0, 20),
                   t: e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 20),
                   b: visible(e) }));

  const sheet = document.querySelector('.sheet');
  const transport = document.querySelector('.transport');
  const dossier = document.querySelector('.dossier');
  const mast = document.querySelector('.mast');
  const deck = document.querySelector('.deck');
  const now = document.querySelector('.now');

  const A = ink(sheet), B = ink(transport);
  const cross = (P, Q, pName, qName) => {
    const out = [];
    for (const a of P) for (const b of Q) {
      const ox = Math.min(a.b.right, b.b.right) - Math.max(a.b.left, b.b.left);
      const oy = Math.min(a.b.bottom, b.b.bottom) - Math.max(a.b.top, b.b.top);
      if (ox <= 0.5 || oy <= 0.5) continue;
      out.push({ a: pName + ' ' + a.cls + ':' + a.t, b: qName + ' ' + b.cls + ':' + b.t,
                 ox: +ox.toFixed(1), oy: +oy.toFixed(1), px: +(ox * oy).toFixed(0),
                 x: +Math.max(a.b.left, b.b.left).toFixed(1) + '..' + +Math.min(a.b.right, b.b.right).toFixed(1),
                 y: +Math.max(a.b.top, b.b.top).toFixed(1) + '..' + +Math.min(a.b.bottom, b.b.bottom).toFixed(1) });
    }
    return out;
  };
  // the plate against the console is the question this tool exists for; the other
  // two are the ones a layout change can newly break -- the chip has a row to
  // clear and the masthead has the chip to clear
  //
  // ★ The plate has two more neighbours it can land on and both were missing
  // here until 2026-10-04. sheet x mast is the one that bites first: the plate
  // hangs centred on the frame, so in a *short* window it runs over the masthead
  // (measured: 32px at 1440x600, 70px at 1100x460) long before it reaches the
  // transport. sheet x now is the <=900 case, where the chip sits 15px above
  // the plate's floor and a collapsed plate ends up underneath it. A probe that
  // only watches one pair cannot see either.
  const hits = [].concat(
    cross(A, B, 'sheet', 'transp'),
    cross(A, ink(mast), 'sheet', 'mast'),
    cross(A, ink(now), 'sheet', 'now'),
    cross(ink(now), ink(document.querySelector('.deck')), 'now', 'deck'),
    cross(ink(now), ink(mast), 'now', 'mast'));
  hits.sort((p, q) => q.px - p.px);

  // the vertical budget: what the plate may occupy before it lands on the bar.
  // mast.bottom is the first line it must clear; transport.top is the last.
  const mb = mast ? mast.getBoundingClientRect().bottom : 0;
  const tt = transport ? transport.getBoundingClientRect().top : null;
  const st = sheet ? sheet.getBoundingClientRect() : null;

  return {
    vw: innerWidth, vh: innerHeight,
    budget: tt === null ? null : +(tt - mb).toFixed(1),
    sheetH: st ? +st.height.toFixed(1) : null,
    overBudget: st && tt !== null ? +(st.height - (tt - mb)).toFixed(1) : null,
    panelHalf: dossier ? getComputedStyle(dossier).getPropertyValue('--panel-half').trim() : '-',
    root: getComputedStyle(document.documentElement).fontSize,
    // what pinPanel saw when it last ran, recomputed here. A plate that is
    // positioned from a stale pin looks exactly like a plate that is positioned
    // wrong, and the difference is whether these numbers agree with the boxes.
    pin: (() => {
      const m = mast, t = transport, d = dossier;
      const slide = m.getBoundingClientRect().top - m.offsetTop;
      return {
        slide: +slide.toFixed(2), mastTop: +m.getBoundingClientRect().top.toFixed(1),
        mastOffsetTop: m.offsetTop, mastBottom: +m.getBoundingClientRect().bottom.toFixed(1),
        tt: +t.getBoundingClientRect().top.toFixed(1),
        storedBand: d.style.getPropertyValue('--band'),
        storedTop: d.style.getPropertyValue('--panel-top'),
        storedHalf: d.style.getPropertyValue('--panel-half'),
      };
    })(),
    // the plate's own ceiling, read rather than assumed. max-height is the
    // number that decides whether the record is fully on screen, is clipped, or
    // -- when a calc() goes negative -- has collapsed to nothing but padding.
    // box-sizing decides which of those three the number means.
    css: (() => {
      const s = sheet ? getComputedStyle(sheet) : null;
      const d = dossier ? getComputedStyle(dossier) : null;
      return {
        sheetMaxH: s ? s.maxHeight : '-',
        dossierMaxH: d ? d.maxHeight : '-',
        sheetBox: s ? s.boxSizing : '-',
        sheetOverflow: s ? s.overflowY : '-',
        sheetPointer: s ? s.pointerEvents : '-',
        dossierTop: d ? d.top : '-',
        dossierBottom: d ? d.bottom : '-',
        // ★ The logotype's font-size, because the masthead's height — which is
        // what the pin reads — is `clamp(1.625rem, 3.05vw, 3.125rem)`, i.e. a
        // function of the viewport width. Printing it (next to `vw`, which the
        // top-level result already carries) is the only way to tell "the layout
        // really is narrower" from "the layout is still the width it was two
        // viewports ago".
        h1fs: (() => { const h = document.querySelector('.brand h1');
                       return h ? getComputedStyle(h).fontSize : '-'; })(),
        // the raw numbers and the page's own decision, because they are not the
        // same thing: syncSheetScroll adds SHEET_SLACK (8px) before it will give
        // the plate the pointer, so that a plate overflowing by its own bottom
        // padding does not take the wheel away from the lens. Reporting only the
        // comparison here would hide that.
        scroll: sheet ? { sh: sheet.scrollHeight, ch: sheet.clientHeight,
                          scrollable: sheet.scrollHeight > sheet.clientHeight + 1,
                          cls: dossier ? dossier.classList.contains('overflow') : null } : null,
      };
    })(),
    boxes: { mast: R(mast), now: R(now), dossier: R(dossier), sheet: R(sheet),
             deck: R(deck), sel: R(document.querySelector('.deck > .sel')),
             pager: R(document.querySelector('.pager')), right: R(document.querySelector('.deck-right')),
             transport: R(transport), counter: R(document.querySelector('.counter')),
             track: R(document.querySelector('.track')),
             grid: R(document.querySelector('.dossier-grid')),
             spec: R(document.querySelector('.spec')),
             specLi: R(document.querySelector('.spec li')),
             specSpan: R(document.querySelector('.spec li span')),
             specB: R(document.querySelector('.spec li b')),
             refList: R(document.querySelector('.ref-list')) },
    counterHTML: (() => { const c = document.querySelector('.counter'); return c ? c.outerHTML : '-'; })(),
    // What the masthead is made of and what the plate is made of. Both of the
    // pin's inputs -- the masthead's bottom, and the plate's natural length --
    // came out different when the same viewport was measured twice in one run,
    // which means one of these children is not the same size in both. A name, a
    // box and a computed `display` each is how that gets found instead of
    // guessed at. OV_PARTS=1 prints it.
    parts: [['.mast', mast], ['.brand', document.querySelector('.brand')],
            ['.brand h1', document.querySelector('.brand h1')],
            ['.mast-nav', document.querySelector('.mast-nav')],
            ['.mast .tb', document.querySelector('.mast .tb')],
            ['.dossier', dossier], ['.dbody', document.querySelector('.dbody')],
            ['.doc-note', document.querySelector('.doc-note')],
            ['.spec', document.querySelector('.spec')],
            ['.ref-list', document.querySelector('.ref-list')],
            ['.orn', document.querySelector('.orn')]]
      .map(([n, el]) => ({ n, h: el ? +el.getBoundingClientRect().height.toFixed(1) : null,
                           t: el ? +el.getBoundingClientRect().top.toFixed(1) : null,
                           d: el ? getComputedStyle(el).display : null,
                           kids: el ? el.children.length : null,
                           sub: el ? [...el.children].map((c) =>
                             (c.className || c.tagName).toString().trim().split(/\s+/)[0].slice(0, 14) +
                             '=' + c.getBoundingClientRect().height.toFixed(1)).join(' ') : null })),
    inkCount: { sheet: A.length, transport: B.length },
    hits: hits.slice(0, 8),
    hitCount: hits.length,
    hitPx: +hits.reduce((s, h) => s + h.px, 0).toFixed(0),
    // the plate's own ink, top to bottom. Whether a collision can be dodged by
    // moving the plate depends on where the gaps in this stack are: a stack with
    // no gap wider than the transport's own height cannot be threaded through it,
    // and a shift that fixes one line only pushes the next one in.
    stack: A.map((a) => ({ cls: a.cls, t: a.t, t_: +a.b.top.toFixed(1), b_: +a.b.bottom.toFixed(1),
                           l_: +a.b.left.toFixed(1), r_: +a.b.right.toFixed(1) }))
      .sort((p, q) => p.t_ - q.t_),
  };
};
const MEASURE = `(${measure.toString()})()`;

for (const [w, h] of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await settle();
  await repin();
  await watch();
  const m = await evaluate(MEASURE);
  if (!m) { console.log(`${w}x${h}: measurement failed`); continue; }
  const b = m.boxes;
  console.log(`${w}x${h}  root=${m.root}  sheetH=${m.sheetH}  budget=${m.budget}  ` +
    `over=${m.overBudget > 0 ? '+' : ''}${m.overBudget}  panelHalf=${m.panelHalf}`);
  console.log(`   sheet   y ${b.sheet.t}..${b.sheet.b}   x ${b.sheet.l}..${b.sheet.r}`);
  console.log(`   deck    y ${b.deck.t}..${b.deck.b}   sel y ${b.sel.t}..${b.sel.b}  ` +
    `pager y ${b.pager.t}..${b.pager.b}  right y ${b.right.t}..${b.right.b}`);
  console.log(`   transp  y ${b.transport.t}..${b.transport.b}  x ${b.transport.l}..${b.transport.r}  ` +
    `counter y ${b.counter.t}..${b.counter.b} x ${b.counter.l}..${b.counter.r}`);
  console.log(`   mast.b=${b.mast.b}  now y ${b.now.t}..${b.now.b} x ${b.now.l}..${b.now.r}  ` +
    `sel x ${b.sel.l}..${b.sel.r}  pager x ${b.pager.l}..${b.pager.r}`);
  console.log(`   counter: ${m.counterHTML}`);
  console.log(`   grid w=${b.grid.w}  spec w=${b.spec.w}  li w=${b.specLi.w}  ` +
    `span w=${b.specSpan.w} h=${b.specSpan.h}  b w=${b.specB.w} h=${b.specB.h}  ` +
    `refList w=${b.refList.w}  spec.h=${b.spec.h} li.h=${b.specLi.h}`);
  console.log(`   ink: sheet=${m.inkCount.sheet} transport=${m.inkCount.transport}  ` +
    `collisions=${m.hitCount} (${m.hitPx}px²)`);
  const c = m.css;
  console.log(`   css: sheet maxH=${c.sheetMaxH} box=${c.sheetBox} overflowY=${c.sheetOverflow} ` +
    `pointer=${c.sheetPointer}  dossier maxH=${c.dossierMaxH} top=${c.dossierTop} bottom=${c.dossierBottom}`);
  console.log(`        scroll sh=${c.scroll.sh} ch=${c.scroll.ch} scrollable=${c.scroll.scrollable} ` +
    `overflowClass=${c.scroll.cls}`);
  const p = m.pin;
  console.log(`   pin: slide=${p.slide} mastTop=${p.mastTop} mastOffsetTop=${p.mastOffsetTop} ` +
    `mastBottom=${p.mastBottom} tt=${p.tt}  stored band=${p.storedBand} top=${p.storedTop} half=${p.storedHalf}`);
  for (const t of m.hits) console.log(`      ${t.px}px²  "${t.a}" x "${t.b}"  ox=${t.ox} oy=${t.oy}  x ${t.x}  y ${t.y}`);
  if (process.env.OV_PARTS) {
    /* The masthead's height is `.brand h1`'s, and that font-size is
       clamp(1.625rem, 3.05vw, 3.125rem) -- so the number the pin reads is a
       function of `vw`, and the only way to tell "the layout really is narrower"
       from "the layout is still the old width" is to print `vw` beside it. Both
       are read in the page (see `css.vw` / `css.h1fs`), not here. */
    console.log(`      viewport innerWidth=${m.vw}  h1 font-size=${m.css.h1fs}`);
    for (const q of m.parts) {
      console.log(`      ${String(q.n).padEnd(12)} h=${String(q.h).padStart(7)} t=${String(q.t).padStart(7)}` +
        `  display=${String(q.d).padEnd(10)} kids=${q.kids}`);
      if (q.sub) console.log(`                   ${q.sub}`);
    }
  }
  if (process.env.OV_STACK) {
    // the counter's own band is the only place a collision can happen, so mark
    // which lines of the plate are inside it -- and which are not
    const c = b.counter;
    for (const s of m.stack) {
      const inBand = s.b_ > c.t && s.t_ < c.b;
      console.log(`      ${inBand ? '>>' : '  '} ${String(s.t_).padStart(7)}..${String(s.b_).padStart(7)}` +
        `  x ${String(s.l_).padStart(7)}..${String(s.r_).padStart(7)}  ${s.cls.padEnd(20)} ${s.t}`);
    }
  }
  console.log('');
}
ws.close();
process.exit(0);
