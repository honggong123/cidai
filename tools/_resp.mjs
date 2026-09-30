/* dev: sweep the layout across viewport widths and report, per width, only the
   numbers that can go wrong — horizontal overflow, a nav that has wrapped, and
   the deck/plate overlap that round seven chased by hand.

   Measurements, not screenshots: at 0.9 fps a screenshot of each of a dozen
   widths costs minutes and still has to be read by eye, while getBoundingClientRect
   answers the same question synchronously. Navigation happens once; every other
   width is a device-metrics change, which re-runs the media queries without
   reloading the page (and without rebuilding the scene).

 *   node tools/_resp.mjs [url] [cdpPort]

   Needs tools/_dev.mjs up. Prints one line per width, plus a flag on any width
   that overflows or wraps.
 */
const [url = 'http://127.0.0.1:8932/', cdpPort = '9445', widthsArg = ''] = process.argv.slice(2);

const ALL = [
  [1600, 900], [1440, 820], [1280, 800], [1240, 800], [1100, 760],
  [1080, 760], [1000, 700], [900, 700], [820, 640], [700, 600],
  [620, 560], [480, 520], [380, 640],
];
// `widths=1000,1080` narrows the sweep — a comparison run only needs the band
// that was flagged, and every width costs a re-render under SwiftShader
const WIDTHS = widthsArg
  ? widthsArg.split(',').map((s) => { const [w, h] = s.split('x'); return [+w, +(h || Math.round(+w * 0.7))]; })
  : ALL;

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
  if (m.method === 'Runtime.exceptionThrown') {
    problems.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    problems.push(m.params.args.map((a) => a.description || a.value).join(' '));
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
// the prelude and any RESP_WHEEL run before the sweep, so they need to start at
// the size the caller is asking about rather than at the sweep's first width
const START = process.env.RESP_SIZE ? process.env.RESP_SIZE.split('x').map(Number) : [1600, 900];
await send('Emulation.setDeviceMetricsOverride', { width: START[0], height: START[1], deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

let ready = false;
for (let i = 0; i < 120 && !ready; i++) {
  await sleep(1000);
  ready = await evaluate(`(() => { const l = document.getElementById('loader');
    return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
if (!ready) console.log('warning: loader never cleared — the plate may still be mid-intro\n');

/* Fonts are the one thing here that resolves late, and it resolves *after* the
   loader: the page asks for `Cascadia Mono`, and until the platform has actually
   enumerated it Chrome lays the counter out in the generic fallback, which is a
   different width. A sweep that starts the moment the loader clears therefore
   reads the counter mid-swap — the very first run of this tool reported the
   counter wrapping at 1100 (44.4×80, five lines) and at 1280 (82.3×32); the same
   sweep a minute later reported 94.3×16 everywhere, matching the original build.
   So: wait for the font set, and then measure every width twice and shout if the
   two disagree — a transient reading is indistinguishable from a real one by eye,
   and silently reporting one is worse than not measuring at all. */
await evaluate('(async () => { await document.fonts.ready; return document.fonts.size; })()').catch(() => 0);
/* Changing the device metrics re-runs the media queries but the page then
   *transitions* to the new layout: .sheet carries a .58s margin-left and .dossier
   a .7s left, and the plate's width changes with the breakpoint — so the whole
   record is re-measured at a width it never settles at. Two things have to be
   true before a reading means anything, and neither is a fixed sleep:
   the change must have been through a style recalc and a paint (two frames), and
   the transitions those frames started must have finished. Waiting a flat 250ms
   reported the plate overlapping the transport at 1100 (32232px²) when a fresh
   load at 1100 overlaps it by nothing at all, and reported the record clipped at
   1280 when a fresh load at 1280 is complete. Both were the transition. */
const settle = async () => {
  await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))')
    .catch(() => 0);
  await sleep(1500);
};

/* Not every state is reachable by resizing. `--give` retracts the plate from the
   camera's orbit radius and a retracted plate is narrower, so its text reflows
   taller — which is exactly the state a ceiling on the plate's height is most
   likely to be wrong in, and one the sweep below would never visit on its own.
   So a caller can hand in a prelude, run once after the loader clears and before
   any width is measured:

     RESP_PRELUDE='(async () => { ... return somethingPrintable })' node tools/_resp.mjs

   It is awaited, so a poll-until-settled loop works. The `state` line of every
   row then carries the --give it ran under. */
if (process.env.RESP_PRELUDE) {
  const out = await evaluate(process.env.RESP_PRELUDE);
  console.log('prelude → ' + JSON.stringify(out) + '\n');
}

/* A wheel sent through CDP's Input domain is *trusted*, and that is the only way
   to ask whether the page's own wheel handler steals a scroll: a synthetic
   WheelEvent built in page JS never performs the default action, so it cannot
   answer the question at all. RESP_WHEEL="x,y,deltaY[,deltaY...]" scrolls at that
   point and reports what the body and the camera each did. */
if (process.env.RESP_WHEEL) {
  const [wx, wy, ...deltas] = process.env.RESP_WHEEL.split(',').map(Number);
  const probe = `(() => { const d = document.querySelector('.dbody');
    const s = document.querySelector('.sheet');
    return { dbodyScrollTop: d ? d.scrollTop : null,
             sheetScrollTop: s ? s.scrollTop : null,
             give: getComputedStyle(document.querySelector('.dossier')).getPropertyValue('--give').trim(),
             wheelSeen: window.__wheelSeen ?? null,
             events: window.__ev ?? null }; })()`;
  const before = await evaluate(probe);
  for (const deltaY of deltas) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wx, y: wy, deltaX: 0, deltaY, pointerType: 'mouse' });
    await sleep(500);
  }
  await sleep(Number(process.env.RESP_WHEEL_WAIT ?? 1500));
  const after = await evaluate(probe);
  console.log('wheel @' + wx + ',' + wy + ' deltas=' + deltas.join('/') +
    '\n  before ' + JSON.stringify(before) + '\n  after  ' + JSON.stringify(after) + '\n');
}

/* NOTE FOR ANYONE EDITING THE PROBE BELOW: it is a template literal, so a
   backtick anywhere inside it — including inside a comment — ends the string.
   That has cost five rounds now, and the fifth is the instructive one: the
   truncated string is *still valid JavaScript*, so node --check passes and the
   failure only appears when the probe runs (as "x is not a function"). Use plain
   quotes in the comments, and rely on the tail check below rather than --check. */
const MEASURE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1),
             w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const vw = innerWidth, vh = innerHeight;
  const nav = document.querySelector('.mast-nav');
  const theme = document.getElementById('theme');
  const btns = [...document.querySelectorAll('#theme button')];
  const deck = document.querySelector('.deck');
  const transport = document.querySelector('.transport');
  const sheet = document.querySelector('.sheet');
  const now = document.querySelector('.now');
  const dossier = document.querySelector('.dossier');
  const hud = document.querySelector('.hud');

  // A nav that has wrapped has children on more than one line. Comparing their
  // top values directly reports several "rows" on a single line, because the
  // seg and the tb buttons are different heights and a flex line centres them.
  // Dividing the nav's height by a guessed row pitch is worse: at 480 a genuine
  // two-row nav came out as six. Cluster by vertical centre instead.
  const navKids = nav ? [...nav.children].filter((c) => getComputedStyle(c).display !== 'none') : [];
  const centres = navKids
    .map((c) => { const b = c.getBoundingClientRect(); return b.top + b.height / 2; })
    .sort((a, b) => a - b);
  const rows = centres.reduce((n, c, i) => n + (i === 0 || c - centres[i - 1] > 4 ? 1 : 0), 0);

  // A grid track that is auto is floored at the item's min-content, but the
  // item's *own* min-content is not the floor when the item is itself a flex or
  // grid container whose children can be squeezed past it — so when the
  // transport's four columns stop fitting, the counter is handed less width than
  // its digits need and the read-out falls apart (measured at 1100: 44.4px wide
  // and five lines tall, against 94.3×16 healthy). Nothing overflows the
  // *viewport*, so the spill check above never sees it. Asking each box whether
  // its content fits is the font-independent way to catch it. */
  const fit = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    return e.scrollWidth - e.clientWidth; };
  // .sel is not one element: the deck has one (the 选带 block) and the plate
  // has one per rendered record (.row.sel, added by JS, and the plate is
  // earlier in document order) — so a bare .sel resolves to the selected row
  // *inside* the plate and every reading it gives is the row against the sheet
  // it lives on. Constant across widths, which is how it was caught: a real
  // squeeze moves. Scope it to the deck.
  const squeezed = ['.transport', '.deck-right', '.counter', '.track', '.deck > .sel', '.pager']
    .map((sel) => [sel, fit(sel)])
    .filter(([, d]) => d !== null && d > 8)
    .map(([sel, d]) => sel + '+ ' + d);

  // Two vertical questions the horizontal check above cannot see, and they are
  // different questions. (1) Does the *visible* plate print on the transport?
  // (2) Is any of the record clipped away where the reader cannot get at it?
  //
  // (1) cannot be asked of the boxes: capping the sheet and clipping the body
  // makes box-overlap read zero while the last row of the record is simply gone.
  // So it is asked of the last row's own bottom — but only while that row is
  // actually on screen, because a row that is clipped is not printing anywhere.
  //
  // (2) is the reason this matters here: the whole .ui layer is pointer-events:
  // none (only buttons/rows/inputs opt back in), so a scrollable box inside the
  // panel has no scrollbar anyone can drag, and the wheel belongs to the camera
  // (controls.js preventDefaults it everywhere except the archive list). Content
  // past the body's box is therefore not merely scrolled — it is unreachable.
  const db = document.querySelector('.dbody');
  const dbBox = db ? db.getBoundingClientRect() : null;
  const dbPE = db ? getComputedStyle(db).pointerEvents : '-';
  const dbOver = db ? db.scrollHeight - db.clientHeight : null;
  const folded = !!document.querySelector('.dossier.folded');
  const hiddenBy = (el) => {
    const b = el.getBoundingClientRect().bottom;
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflow === 'visible' && cs.overflowY === 'visible') continue;
      if (b > n.getBoundingClientRect().bottom + 1) return n.className || n.tagName;
    }
    return null;
  };
  const dbRows = db ? [...db.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 2) : [];
  const dbLastEl = dbRows.length
    ? dbRows.reduce((a, b) => (a.getBoundingClientRect().bottom >= b.getBoundingClientRect().bottom ? a : b))
    : null;
  const dbLast = dbLastEl ? dbLastEl.getBoundingClientRect().bottom : null;
  const dbLastHiddenBy = dbLastEl ? hiddenBy(dbLastEl) : null;
  const visOverTransport = dbLast !== null && !dbLastHiddenBy && transport
    ? +Math.max(0, dbLast - transport.getBoundingClientRect().top).toFixed(1) : 0;
  const unreachable = !folded && dbPE === 'none' && dbOver > 2 ? dbOver : 0;

  // when something is squeezed, the shape of the thing that gave way is the
  // whole diagnosis — so carry it, rather than re-running and hoping to catch
  // the same state twice
  const diag = squeezed.length ? (() => {
    const c = document.querySelector('.counter');
    const tc = document.getElementById('tc');
    const col = (sel) => { const e = document.querySelector(sel); if (!e) return '-';
      const b = e.getBoundingClientRect(); return e.className.split(' ')[0] + ':' + b.width.toFixed(0); };
    return {
      cols: ['.deck > .sel', '.pager', '.deck-right', '.transport'].map(col).join(' '),
      counterHTML: c ? c.outerHTML.slice(0, 240) : '-',
      counterKids: c ? [...c.children].map((k) => k.tagName + '.' + (k.className || '-')
        + ':' + k.getBoundingClientRect().width.toFixed(1) + 'x' + k.getBoundingClientRect().height.toFixed(1)).join(' ') : '-',
      tcDisplay: tc ? getComputedStyle(tc).display : '-',
      tcKids: tc ? [...tc.children].map((k) => k.tagName + '.' + (k.className || '-')
        + ':' + getComputedStyle(k).display).join(' ') : '-',
    };
  })() : null;

  // anything sticking out to the right of the viewport, worst first
  const spill = [...document.querySelectorAll('.ui *')]
    .map((el) => ({ el, b: el.getBoundingClientRect() }))
    .filter(({ b }) => b.width > 0 && b.height > 0 && b.right > vw + 1)
    .map(({ el, b }) => el.className + ':' + el.tagName + '@+' + (b.right - vw).toFixed(0))
    .slice(0, 4);

  const overlap = (a, b) => !a || !b ? 0
    : Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)) *
      Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l));

  return {
    vw, vh,
    root: getComputedStyle(document.documentElement).fontSize,
    scrollW: document.documentElement.scrollWidth,
    navRows: rows,
    // the plate's length is not a constant: --give retracts it as the wheel
    // brings the lens in, and a retracted plate is narrower and therefore
    // taller. Two runs can differ by a third of the sheet on that alone, so the
    // state has to travel with the numbers or the comparison means nothing.
    state: dossier ? dossier.className
      + ' give=' + getComputedStyle(dossier).getPropertyValue('--give').trim()
      + ' retract=' + getComputedStyle(dossier).getPropertyValue('--retract').trim()
      : 'no dossier',
    sans: getComputedStyle(document.documentElement).getPropertyValue('--sans').trim().slice(0, 30),
    nav: r(nav), theme: r(theme),
    themeBtns: btns.map((b) => { const q = r(b); return b.textContent.trim() + ' ' + q.w; }),
    deck: r(deck), transport: r(transport), sheet: r(sheet), now: r(now), hud: r(hud),
    dossier: r(dossier),
    dbody: r(document.querySelector('.dbody')),
    crumb: r(document.querySelector('.sheet .crumb')),
    counter: r(document.querySelector('.counter')),
    track: r(document.querySelector('.track')),
    squeezed, diag,
    dbodyOver: dbOver,
    dbodyOverflowY: db ? getComputedStyle(db).overflowY : '-',
    dbodyPointerEvents: dbPE,
    dbodyLastPast: dbLast !== null && dbBox ? +(dbLast - dbBox.bottom).toFixed(1) : null,
    dbodyLastHiddenBy: dbLastHiddenBy,
    visOverTransport,
    unreachable,
    dbodyScrollTop: db ? db.scrollTop : null,
    dbodyMax: document.querySelector('.dbody')
      ? getComputedStyle(document.querySelector('.dbody')).maxHeight : '-',
    // 100vh as the layout actually resolves it, plus which guard queries match —
    // under setDeviceMetricsOverride the two can disagree with innerHeight
    vh100: (() => { const d = document.createElement('div');
      d.style.cssText = 'position:absolute;top:0;left:0;width:0;height:100vh';
      document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; })(),
    mq: [matchMedia('(min-width: 901px) and (max-width: 1190px)').matches,
         matchMedia('(min-width: 901px) and (max-width: 1080px)').matches].join('/'),
    spill,
    deckOverSheet: +overlap(r(deck), r(sheet)).toFixed(0),
    transportOverSheet: +overlap(r(transport), r(sheet)).toFixed(0),
    // the deck is a transparent grid, so its own box overlapping the plate means
    // nothing — what matters is whether a thing that is *drawn* lands on it
    selOverSheet: +overlap(r(document.querySelector('.deck > .sel')), r(sheet)).toFixed(0),
    pagerOverSheet: +overlap(r(document.querySelector('.pager')), r(sheet)).toFixed(0),
    // ...and .deck-right is the child the old box check could never see: the
    // transport *inside* it is measured above, but the flex row around it is
    // wider than the transport and reaches further left, so a plate that grew
    // into that row would slip past every other drawn measure.
    rightOverSheet: +overlap(r(document.querySelector('.deck-right')), r(sheet)).toFixed(0),
    nowOverSheet: +overlap(r(now), r(sheet)).toFixed(0),
    navOverTheme: +overlap(r(nav), r(theme)).toFixed(0),
    dossier: r(dossier),
  };
})()`;
// A stray backtick truncates MEASURE into something that can still parse, so
// node --check does not catch it and the failure surfaces later as a nonsense
// "x is not a function" from inside the probe. Catch it here instead. (An odd
// number of stray backticks is a SyntaxError at load, which is loud enough.)
if (!MEASURE.trimEnd().endsWith('})()')) {
  throw new Error('MEASURE is truncated — a stray backtick inside the probe?');
}

console.log('  vw   vh  root   scrollW  navRows  deck(y x..r)          sheet(y x..r)         transport(w@x)   now(y)  spill  deck∩sheet');
const bad = [];
for (const [w, h] of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await settle();
  const m = await evaluate(MEASURE);
  if (!m) { console.log(`${w} measurement failed`); continue; }
  const again = await evaluate(MEASURE);
  const drift = again && (again.sheet.h !== m.sheet.h || again.transport.w !== m.transport.w
    || (again.counter && m.counter && again.counter.h !== m.counter.h)) ? ' UNSTABLE' : '';
  const flags = [];
  if (m.scrollW > m.vw + 1) flags.push(`H-OVERFLOW ${m.scrollW - m.vw}px`);
  if (m.spill.length) flags.push('spill ' + m.spill.join(' '));
  if (m.navRows > 1) flags.push(`nav wrapped (${m.navRows} rows)`);
  if (m.squeezed.length) flags.push('squeezed ' + m.squeezed.join(' '));
  // the plate's ceiling must not hide the record: content past the body's box in
  // a panel that takes no pointer events has no way back
  if (m.unreachable) flags.push(`record clipped out of reach (${m.unreachable}px)`);
  if (m.visOverTransport > 2) flags.push(`plate prints on transport (${m.visOverTransport}px)`);
  if (drift) flags.push('UNSTABLE — two reads of the same width disagree, re-run');
  /* The deck's own box is NOT flagged, and the reason is worth keeping here
     because the box number still prints in the table. `.deck` is a transparent
     grid, and at 1080 it is three rows whose first two are empty on the right —
     which is exactly where the plate lives. Measured there: box overlap
     48629px², and every single thing actually drawn in that band zero. Flagging
     the box made two widths cry wolf for a whole round. What is flagged is
     anything *drawn* on the plate, `.deck-right` included. */
  const drawnOnSheet = m.transportOverSheet + m.selOverSheet + m.pagerOverSheet
    + m.rightOverSheet + m.nowOverSheet;
  if (m.transportOverSheet > 0) flags.push(`transport∩sheet ${m.transportOverSheet}px²`);
  if (m.selOverSheet > 0) flags.push(`sel∩sheet ${m.selOverSheet}px²`);
  if (m.pagerOverSheet > 0) flags.push(`pager∩sheet ${m.pagerOverSheet}px²`);
  if (m.rightOverSheet > 0) flags.push(`deck-right∩sheet ${m.rightOverSheet}px²`);
  if (m.nowOverSheet > 0) flags.push(`now∩sheet ${m.nowOverSheet}px²`);
  if (m.theme && (m.theme.l < -1 || m.theme.r > m.vw + 1)) flags.push('theme seg out of view');
  if (flags.length) bad.push(`${w}×${h}: ${flags.join(' | ')}`);
  console.log(
    String(w).padStart(5) + String(h).padStart(5) +
    '  ' + m.root.padStart(5) +
    '  ' + String(m.scrollW).padStart(7) +
    '  ' + String(m.navRows).padStart(7) +
    '  ' + `${m.deck.t}..${m.deck.b} ${m.deck.l}..${m.deck.r}`.padStart(21) +
    '  ' + `${m.sheet.t}..${m.sheet.b} ${m.sheet.l}..${m.sheet.r}`.padStart(21) +
    '  ' + `${m.transport.w}@${m.transport.l}`.padStart(15) +
    '  ' + String(m.now ? m.now.t : '-').padStart(6) +
    '  ' + String(m.spill.length).padStart(5) +
    '  ' + String(m.deckOverSheet).padStart(10) +
    '   ' + m.themeBtns.join(' / ') +
    '\n        drawn-on-plate: transport=' + m.transportOverSheet +
    ' sel=' + m.selOverSheet + ' pager=' + m.pagerOverSheet + ' right=' + m.rightOverSheet +
    ' now=' + m.nowOverSheet + ' total=' + drawnOnSheet +
    '\n        state: ' + m.state + '   sans: ' + m.sans +
    '\n        dossier.h=' + m.dossier.h + '  sheet.h=' + m.sheet.h +
    '  crumb.h=' + (m.crumb ? m.crumb.h : '-') +
    '  dbody.h=' + (m.dbody ? m.dbody.h : '-') +
    '  dbody.max=' + m.dbodyMax + '  vh100=' + m.vh100 + '  mq=' + m.mq +
    '\n        transport: h=' + m.transport.h +
    '  counter=' + (m.counter ? `${m.counter.w}x${m.counter.h}` : '-') +
    '  track=' + (m.track ? `${m.track.w}x${m.track.h}` : '-') + drift +
    '\n        dbody: over=' + m.dbodyOver + ' overflowY=' + m.dbodyOverflowY +
    ' pointerEvents=' + m.dbodyPointerEvents + ' lastPast=' + m.dbodyLastPast +
    (m.dbodyLastHiddenBy ? ' hiddenBy=' + m.dbodyLastHiddenBy : '') +
    '  visOverTransport=' + m.visOverTransport + ' unreachable=' + m.unreachable
  );
  if (m.diag) console.log('        diag: ' + JSON.stringify(m.diag));
}

console.log('');
if (bad.length) { console.log('FLAGGED:\n  ' + bad.join('\n  ')); }
else console.log('no overflow, no wrap, no overlap at any tested width');

if (problems.length) console.log('\npage errors:\n  ' + problems.join('\n  '));
ws.close();
process.exit(0);
