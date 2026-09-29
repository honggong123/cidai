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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

let ready = false;
for (let i = 0; i < 120 && !ready; i++) {
  await sleep(1000);
  ready = await evaluate(`(() => { const l = document.getElementById('loader');
    return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
if (!ready) console.log('warning: loader never cleared — the plate may still be mid-intro\n');

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

  // a nav that has wrapped is taller than its own tallest child: comparing the
  // children's top values instead reports three "rows" on a wide window,
  // because the seg and the tb buttons are different heights and so are not
  // top-aligned even on one line
  const navKids = nav ? [...nav.children].filter((c) => getComputedStyle(c).display !== 'none') : [];
  const kidH = navKids.map((c) => c.getBoundingClientRect().height);
  const rows = nav && kidH.length ? Math.max(1, Math.round((nav.getBoundingClientRect().height - Math.max(...kidH)) / 6)) : 0;

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
    selOverSheet: +overlap(r(document.querySelector('.sel')), r(sheet)).toFixed(0),
    pagerOverSheet: +overlap(r(document.querySelector('.pager')), r(sheet)).toFixed(0),
    nowOverSheet: +overlap(r(now), r(sheet)).toFixed(0),
    navOverTheme: +overlap(r(nav), r(theme)).toFixed(0),
    dossier: r(dossier),
  };
})()`;

console.log('  vw   vh  root   scrollW  navRows  deck(y x..r)          sheet(y x..r)         transport(w@x)   now(y)  spill  deck∩sheet');
const bad = [];
for (const [w, h] of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(120);
  const m = await evaluate(MEASURE);
  if (!m) { console.log(`${w} measurement failed`); continue; }
  const flags = [];
  if (m.scrollW > m.vw + 1) flags.push(`H-OVERFLOW ${m.scrollW - m.vw}px`);
  if (m.spill.length) flags.push('spill ' + m.spill.join(' '));
  if (m.navRows > 1) flags.push(`nav wrapped (${m.navRows} rows)`);
  if (m.deckOverSheet > 0) flags.push(`deck∩sheet ${m.deckOverSheet}px²`);
  if (m.transportOverSheet > 0) flags.push(`transport∩sheet ${m.transportOverSheet}px²`);
  if (m.selOverSheet > 0) flags.push(`sel∩sheet ${m.selOverSheet}px²`);
  if (m.pagerOverSheet > 0) flags.push(`pager∩sheet ${m.pagerOverSheet}px²`);
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
    ' sel=' + m.selOverSheet + ' pager=' + m.pagerOverSheet + ' now=' + m.nowOverSheet +
    '\n        state: ' + m.state + '   sans: ' + m.sans +
    '\n        dossier.h=' + m.dossier.h + '  sheet.h=' + m.sheet.h +
    '  crumb.h=' + (m.crumb ? m.crumb.h : '-') +
    '  dbody.h=' + (m.dbody ? m.dbody.h : '-') +
    '  dbody.max=' + m.dbodyMax + '  vh100=' + m.vh100 + '  mq=' + m.mq
  );
}

console.log('');
if (bad.length) { console.log('FLAGGED:\n  ' + bad.join('\n  ')); }
else console.log('no overflow, no wrap, no overlap at any tested width');

if (problems.length) console.log('\npage errors:\n  ' + problems.join('\n  '));
ws.close();
process.exit(0);
