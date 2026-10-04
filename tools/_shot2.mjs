/* dev: several frames of the *same running tape*, so the picture's own motion
   can be compared. tools/page-shot.mjs is built for a still page — it waits for
   the loader, navigates fresh, and never presses play, which is precisely what a
   spectrum test must not do.

 *   node tools/_shot2.mjs <url> <outDir> <prefix> <seekSecondsCsv> [cdpPort]

   Each entry is a *position on the tape*, not a wall-clock delay: the shot is
   taken after seeking there and letting the envelope settle. Wall-clock waits
   are useless here — headless runs the audio clock faster than real time, so a
   ten-second wait can land fifty seconds down the tape.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [url, outDir, prefix, seeksArg, cdpPort = '9445'] = process.argv.slice(2);
if (!url || !outDir || !prefix || !seeksArg) {
  console.error('usage: node tools/_shot2.mjs <url> <outDir> <prefix> <seekSecondsCsv> [cdpPort]');
  process.exit(2);
}
const seeks = seeksArg.split(',').map(Number);
const W = 1440, H = 900;

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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) problems.push(r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

/* The theme tokens are registered with @property and transitioned on `html`, and
   a custom-property transition is driven from the main thread. In a headless
   renderer running at about one frame a second it never advances — so a
   `?t=abyss` deep link measures, and photographs, as a room part-way between the
   one it is leaving and the one it is entering, and every element that reads a
   token lands at a different point of that same stalled fade. The 黑盒 / 白厅
   buttons came out with studio's and noir's ink on abyss's blue.

 *  (`styles.css` now kills the token transition itself under reduced motion, so
 *  the stalled fade no longer happens on the page — but the sheet below is kept,
 *  because a deep link is not the only thing that can land mid-transition.)
 *
 *  Killing transitions is not enough: a stalled transition keeps the in-flight
 *  value, and injecting the sheet after the change cannot un-start it. The only
 *  clean still is one where the room was never walked — so the theme goes on
 *  `<html>` *before the document's first style resolution*, and boot()'s own
 *  setTheme then sets the same value and fires no transition at all. */
const theme = new URL(url, 'http://x/').searchParams.get('t');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const st = document.createElement('style');
    st.textContent = '*, *::before, *::after { transition: none !important; }';
    const theme = ${JSON.stringify(theme)};
    // documentElement is still null when this runs, so both the sheet and the
    // theme have to be parked until there is somewhere to park them
    const put = () => {
      const h = document.head || document.documentElement;
      if (!h) return false;
      if (theme) document.documentElement.dataset.theme = theme;
      h.appendChild(st);
      return true;
    };
    if (!put()) { const t = setInterval(() => { if (put()) clearInterval(t); }, 0); }
  })();`,
});
problems.length = 0;
await send('Page.navigate', { url });
await sleep(1500);

// the tape has to be rolling for any of this to mean anything, and play() is
// refused without a gesture in headless
const hasTape = await evalJs(`(async () => {
  const s = (ms) => new Promise((r) => setTimeout(r, ms));
  const audio = document.querySelector('#tape-audio');
  for (let i = 0; i < 240 && !document.body?.classList.contains('ready'); i++) await s(500);
  // upstream has no demo tape — its music came from assets/, which is not in the
  // repository — so a still of it is just the room with the tape parked
  if (!audio) return false;
  document.querySelector('#btn-play')?.click();
  for (let i = 0; i < 240 && audio.paused; i++) await s(500);
  return true;
})()`);

mkdirSync(outDir, { recursive: true });
/* The first write of a bar height can be a long way after play(): the page is
   still finishing its boot render, and at one frame a second that is not a
   small delay. Waiting for the class is waiting for the loop to have run. */
await evalJs(`(async () => {
  const s = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 180 && !document.body?.classList.contains('eq-live'); i++) await s(500);
  return document.body?.className;
})()`);
/* …and then give the room a moment. A `?t=` deep link lands settled now —
   setTheme() snaps the rig, the exposure and the grade for `first`, the way it
   already did for the IBL and the backdrop — so this is only about letting the
   loop run a few frames after boot, not about waiting out a fade. Before that
   fix the room eased in at `themeRate()` and, with `dt` clamped to 1/20 and one
   frame a second, needed ~33 frames to arrive; a still taken at `eq-live` came
   out a third of the way there, which is how a `?t=noir` shot ended up with a
   blue backdrop. */
await sleep(Number(process.env.SETTLE_MS ?? 12000));
for (const at of seeks) {
  // seek, keep rolling, and let the envelope chase the new position: at one
  // frame a second it needs a few seconds to arrive
  const st = await evalJs(`(async () => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms));
    const a = document.querySelector('#tape-audio');
    if (a) {
      a.currentTime = ${at};
      if (a.paused) a.play().catch(() => {});
    }
    await s(5000);
    return {
      t: a ? +a.currentTime.toFixed(2) : null,
      eq: [...document.querySelectorAll('#now .eq i')].map((b) => b.style.height || '-'),
      bloomSeen: document.body.classList.contains('eq-live'),
      seg: [...document.querySelectorAll('#theme button')].map((b) => {
        const c = getComputedStyle(b);
        return \`\${b.textContent}\${b.classList.contains('on') ? '*' : ''}[\${c.color}]\`;
      }),
    };
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(outDir, `${prefix}-s${String(at).padStart(2, '0')}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  console.log(`${file}  currentTime=${st?.t}  live=${st?.bloomSeen}  eq=${(st?.eq || []).join(' ')}\n  seg=${(st?.seg || []).join('  ')}`);
}
if (problems.length) console.log('page errors:\n  ' + problems.join('\n  '));
ws.close();
process.exit(problems.length ? 1 : 0);
