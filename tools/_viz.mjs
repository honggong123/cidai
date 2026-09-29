/* dev: does the picture actually follow the music?
 *
 * Three things in the frame are driven by the sound rather than a clock — the
 * four bars, the dust's drift and the bloom's strength — and this checks the
 * last one, which is the one that cannot be seen in a still: it is a 22% swing
 * in UnrealBloomPass.strength, and a screenshot of a moving target proves
 * nothing.
 *
 * It was long assumed to be unverifiable headless ("the theme's damping takes
 * fifty seconds to converge"). It is verifiable, and the two reasons it looked
 * otherwise are worth keeping:
 *
 *   1. `const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches`
 *      (main.js:17). Headless Chrome reports reduce by default, and the page
 *      *deliberately* does not wire the picture to the sound under it — that is
 *      the accessibility behaviour, not a bug. Without emulating
 *      no-preference, what gets measured is the correctly-disabled build.
 *
 *   2. `const dt = Math.min((now - last) / 1000, 1 / 20)` (main.js:2819). dt is
 *      capped at 50ms. Under SwiftShader the page runs at ~0.9fps, so 1.1s of
 *      wall clock advances 0.05s of simulated time — time is dilated 22x. The
 *      theme transition needs 32 frames (themeP += dt/THEME_DUR) and the bloom's
 *      damping creeps accordingly; that is where "fifty seconds" came from.
 *
 * So the numbers alone cannot settle it here. What can is the *update law*,
 * which is frame-rate independent. applyTheme() does, every frame:
 *
 *     strength <- damp(strength, base * beat, l, dt)
 *               = lerp(strength, base * beat, 1 - exp(-l * dt))
 *
 * so the n-th frame's displacement must equal k_n * (want_n - s_n) with
 * k_n = 1 - exp(-l_n * dt_n). If that holds to a fraction of a percent, the
 * mechanism is right; substituting dt = 1/60 then gives what a real machine
 * shows.
 *
 * Reading the internals needs a probe inside the bundle, because bloomGain,
 * `bloom` and viz are module-scope. Rather than instrument src/ and rebuild,
 * this copies the built bundle into a throwaway `_viz_probe/` beside it and
 * splices one read-only line into the (unminified, one-statement-per-line)
 * IIFE. The repository is never touched.
 *
 *   node tools/_dev.mjs . 8932 9445          # server + browser, as usual
 *   node tools/_viz.mjs [root] [port] [cdpPort]
 *
 * Prints the settle trace, the per-frame table, the law's error, and PASS/FAIL
 * per check. Cleans `_viz_probe/` up itself when it finishes.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const [ROOT = '.', portArg = '8932', cdpPort = '9445'] = process.argv.slice(2);
const PROBE = join(ROOT, '_viz_probe');

/* ---------- 1. build the instrumented copy ---------- */

const HOOK_ANCHOR = '    bloomGain = viz.beat;\n';
const HOOK = HOOK_ANCHOR +
  `    globalThis.__dbg = { frame: ((globalThis.__dbg && globalThis.__dbg.frame) || 0) + 1,
      theme: themeName, beat: bloomGain, strength: bloom ? bloom.strength : null,
      base: ((THEMES[themeName].grade || {}).bloom != null ? THEMES[themeName].grade.bloom : 0.32),
      want: ((THEMES[themeName].grade || {}).bloom != null ? THEMES[themeName].grade.bloom : 0.32) * bloomGain,
      dt: dt, themeP: themeP, l: themeRate(), ct: audioEl.currentTime };
    (globalThis.__trace = globalThis.__trace || []).length < 900 &&
      globalThis.__trace.push({ f: globalThis.__dbg.frame, s: bloom ? bloom.strength : null,
        want: globalThis.__dbg.want, dt: dt, l: themeRate(), themeP: themeP,
        beat: bloomGain, lv0: lv[0], ct: audioEl.currentTime });
`;

await rm(PROBE, { recursive: true, force: true });
await mkdir(PROBE, { recursive: true });

const html = await readFile(join(ROOT, 'index.html'), 'utf8');
if (!html.includes('dist/app.js')) throw new Error('index.html does not load dist/app.js — has the build changed?');
await writeFile(join(PROBE, 'index.html'), html.replace('dist/app.js', 'app.js'));
await writeFile(join(PROBE, 'styles.css'), await readFile(join(ROOT, 'styles.css')));

const bundle = await readFile(join(ROOT, 'dist/app.js'), 'utf8');
if (!bundle.includes(HOOK_ANCHOR)) {
  throw new Error('probe anchor not found in dist/app.js — the loop was edited, or the build is minified (--min). Rebuild without --min.');
}
const hits = bundle.split(HOOK_ANCHOR).length - 1;
if (hits !== 1) throw new Error(`probe anchor is not unique (${hits} matches)`);
await writeFile(join(PROBE, 'app.js'), bundle.replace(HOOK_ANCHOR, HOOK));
console.log(`probe bundle → ${PROBE}/app.js  (${(bundle.length / 1024).toFixed(0)} KB, 1 line spliced)\n`);

/* ---------- 2. drive it ---------- */

const url = `http://127.0.0.1:${portArg}/_viz_probe/`;
const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target — start tools/_dev.mjs first');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`)); else p.resolve(m);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  const guard = setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out`)); } }, 300000);
  guard.unref?.();
  pending.set(n, { resolve: (v) => { clearTimeout(guard); resolve(v); }, reject: (e) => { clearTimeout(guard); reject(e); } });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  .then((r) => r.result?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await send('Page.enable');
  await send('Runtime.enable');
  /* reason 1 above: without this the page is correct and silent */
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });

  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    await sleep(1000);
    ready = await evaluate(`(() => { const l = document.getElementById('loader');
      return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
  }
  if (!ready) console.log('warning: loader never cleared\n');
  await evaluate('(async () => { await document.fonts.ready; return document.fonts.size; })()').catch(() => 0);

  console.log('--- switch to abyss ---');
  console.log('  before: ' + JSON.stringify(await evaluate(
    `({ theme: document.documentElement.dataset.theme,
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches })`)));
  await evaluate(`document.querySelector('#theme button[data-theme="abyss"]').click()`);

  /* reason 2 above: themeP advances by dt/THEME_DUR = 0.05/1.6 per frame, so it
     needs 32 frames. At 0.9fps that is ~36s — measuring before it lands reads
     the transition's much smaller l, which is what "it never converges" was. */
  console.log('  waiting for themeP to reach 1 (32 frames at ~1.1s)…');
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const st = await evaluate(`(() => { const d = globalThis.__dbg;
      return d ? { frame: d.frame, theme: d.theme, themeP: +d.themeP.toFixed(3), l: +d.l.toFixed(3) } : null; })()`);
    if (st) console.log(`    frame=${st.frame} theme=${st.theme} themeP=${st.themeP} l=${st.l}`);
    if (st && st.themeP >= 1) break;
  }

  console.log('\n--- roll the tape, record every frame ---');
  await evaluate('globalThis.__trace = []; document.getElementById("btn-play").click()');
  await sleep(30000);

  const trace = (await evaluate('globalThis.__trace')) || [];
  console.log('  recorded ' + trace.length + ' frames\n');
  console.log('  f    dt      l      themeP  beat    want    strength   lv[0]   ct');
  for (const r of trace.slice(0, 40)) {
    console.log(
      String(r.f).padStart(4) +
      '  ' + r.dt.toFixed(4) +
      '  ' + r.l.toFixed(3).padStart(6) +
      '  ' + r.themeP.toFixed(3).padStart(6) +
      '  ' + r.beat.toFixed(3).padStart(6) +
      '  ' + r.want.toFixed(4).padStart(7) +
      '  ' + (r.s === null ? '-' : r.s.toFixed(5)).padStart(9) +
      '  ' + r.lv0.toFixed(3).padStart(6) +
      '  ' + r.ct.toFixed(2).padStart(6));
  }

  console.log('\n--- verdict ---');
  const span = (a) => (a.length ? `${Math.min(...a).toFixed(4)} .. ${Math.max(...a).toFixed(4)}` : '-');
  const lv0 = trace.map((r) => r.lv0);
  const beat = trace.map((r) => r.beat);
  const st = trace.map((r) => r.s).filter((v) => v !== null);
  const want = trace.map((r) => r.want);

  /* the update law: s_{n+1} - s_n must equal k_n * (want_n - s_n) */
  const law = [];
  for (let n = 0; n + 1 < trace.length; n++) {
    const a = trace[n], b = trace[n + 1];
    if (a.s === null || b.s === null || b.f !== a.f + 1) continue;
    const k = 1 - Math.exp(-a.l * a.dt);
    const pred = a.s + k * (a.want - a.s);
    law.push({ k, moved: b.s - a.s, pred: pred - a.s, err: Math.abs(b.s - pred) });
  }
  const rel = law.map((r) => r.err / Math.max(1e-9, Math.abs(r.pred)));
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
  const L = trace.at(-1)?.l ?? 2.8;

  console.log('  frames sampled                 ' + trace.length);
  console.log('  themeP reached 1               ' + (trace.length && trace.every((r) => r.themeP >= 1) ? 'yes' : 'NO (still transitioning)'));
  console.log('  damping rate l                 ' + [...new Set(trace.map((r) => r.l.toFixed(3)))].join(', '));
  console.log('  dt as measured                 ' + span(trace.map((r) => r.dt)) + '  (cap is 1/20 = 0.05)');
  console.log('  lv[0] low band                 ' + span(lv0));
  console.log('  beat (= bloomGain)             ' + span(beat) + '   design range [0.85, 1.30]');
  console.log('  bloom.strength                 ' + span(st) + '   (' + new Set(st.map((v) => v.toFixed(5))).size + ' distinct)');
  console.log('  adjacent frame pairs checked   ' + law.length);
  console.log('  update-law relative error      median ' + (isNaN(med(rel)) ? '-' : (med(rel) * 100).toFixed(2) + '%') +
    '  max ' + (rel.length ? (Math.max(...rel) * 100).toFixed(2) + '%' : '-'));

  /* what a 60fps machine does with the same law. The time constant is 1/l
     seconds, full stop — it does not depend on the frame rate, because damp()
     is written against dt. Only the number of frames it takes does. */
  const k60 = 1 - Math.exp(-L / 60);
  console.log('\n  at 60fps, same law (l=' + L.toFixed(3) + '):');
  console.log('    k = ' + k60.toFixed(4) + ' per frame  →  ' + (1 / L * 1000).toFixed(0) + 'ms time constant  (' +
    (1 / k60).toFixed(1) + ' frames)');
  console.log('    the swing it has to track is ' + span(want) + ', so bloom.strength rides that whole range');

  const checks = [
    ['prefers-reduced-motion emulated off (else the page is correctly silent)',
      trace.length > 0 && trace.every((r) => r.dt > 0)],
    ['the tape is rolling (currentTime advancing)', trace.length > 1 && trace.at(-1).ct > trace[0].ct + 5],
    ['viz has a level to read (lv[0] not constant)', new Set(lv0.map((v) => v.toFixed(4))).size > 3],
    ['beat actually swings', new Set(beat.map((v) => v.toFixed(4))).size > 3],
    ['beat stays inside [0.85, 1.30]', beat.every((b) => b >= 0.8499 && b <= 1.3001)],
    ['bloom.strength follows it', new Set(st.map((v) => v.toFixed(5))).size > 3],
    ['* per-frame update law holds (median error < 1%)', law.length > 3 && med(rel) < 0.01],
    ['* strength moves toward base·beat (sign agrees)', law.length > 3 && law.every((r) => r.moved * r.pred >= 0)],
    ['no page exceptions', pageErrors.length === 0],
  ];
  for (const [name, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (pageErrors.length) console.log('\npage errors:\n  ' + pageErrors.join('\n  '));
} finally {
  ws.close();
  await rm(PROBE, { recursive: true, force: true });
  console.log(`\n(_viz_probe/ removed)`);
}
process.exit(0);
