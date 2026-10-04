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

 *   node tools/_ov.mjs [url] [cdpPort] [WxH,WxH,...]

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

/* NOTE: template literal — no backticks anywhere inside, comments included. A
   stray one truncates the string into something that still parses, so node
   --check passes and the failure only shows up at run time. The tail check below
   is the guard. */
const MEASURE = `(() => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1),
             w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };

  // an element "carries ink" if it has a text node child of its own -- an empty
  // wrapper, a padding box or a purely decorative pseudo-element does not, and
  // including those is what made the box-overlap number useless.
  //
  // And the rect that counts is the one you can see. Below 900 the plate is a
  // bottom sheet held to calc(100vh - 36.5rem) with overflow:auto, so its spec
  // rows are laid out *outside* its own box and clipped away -- they still have
  // geometry, and intersecting that geometry against the transport reports a
  // collision between two things that are not both on screen. So clip every rect
  // against each ancestor that scrolls or hides first, and drop what is left.
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
  const hits = [].concat(
    cross(A, B, 'sheet', 'transp'),
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
})()`;
if (!MEASURE.trimEnd().endsWith('})()')) {
  throw new Error('MEASURE is truncated — a stray backtick inside the probe?');
}

for (const [w, h] of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await settle();
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
  for (const t of m.hits) console.log(`      ${t.px}px²  "${t.a}" x "${t.b}"  ox=${t.ox} oy=${t.oy}  x ${t.x}  y ${t.y}`);
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
