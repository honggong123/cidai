/* dev: what colour is that pixel, actually?
 *
 *   node tools/_px.mjs <url> "x,y,w,h" [scanY] [cdpPort] [dpr]
 *
 * WHY THIS EXISTS
 * Several things on this page are decided by *numbers* that can only be read off
 * the picture — "is the contour around her darker than the wall it is drawn on"
 * being the one that prompted it. Every other probe in this directory answers a
 * question about state; this one answers a question about pixels, and it exists
 * so that question does not have to be settled by looking at a screenshot and
 * forming an opinion.
 *
 * It prints one horizontal scanline as luminance, then the same line as the
 * three channels, then where the extremes are. The interesting shape for a rim
 * is "wall, a dip, hair": if the minimum sits at the edge rather than in her,
 * the rim is doing its job.
 *
 * PNG is decoded here rather than with a dependency: the repo has two runtime
 * deps and neither of them decodes images, and this is 60 lines of `zlib`.
 * Chrome emits 8-bit non-interlaced RGB or RGBA; anything else is refused loudly
 * rather than misread.
 */
import { inflateSync } from 'node:zlib';

const [url, box, scanYArg = '', cdpPort = '9445', dpr = '1'] = process.argv.slice(2);
if (!url || !box) { console.error('usage: node tools/_px.mjs <url> "x,y,w,h" [scanY] [cdpPort] [dpr]'); process.exit(2); }
const [bx, by, bw, bh] = box.split(',').map(Number);
if ([bx, by, bw, bh].some((v) => !Number.isFinite(v))) { console.error('box wants "x,y,w,h"'); process.exit(2); }

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
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  const guard = setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out`)); } }, 180000);
  guard.unref?.();
  pending.set(n, { resolve: (v) => { clearTimeout(guard); resolve(v); }, reject: (e) => { clearTimeout(guard); reject(e); } });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: +dpr, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url });
for (let i = 0, ok = false; i < 90 && !ok; i++) {
  await sleep(1000);
  ok = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
await sleep(4000);

const shot = await send('Page.captureScreenshot', {
  format: 'png', fromSurface: true, captureBeyondViewport: false,
  clip: { x: bx, y: by, width: bw, height: bh, scale: 1 },
});
const png = Buffer.from(shot.result.data, 'base64');
ws.close();

/* ---------- the smallest PNG reader that is not a lie ---------- */
function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const tag = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (tag === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; type = body[9]; interlace = body[12];
    } else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth} — this reader only does 8`);
  if (interlace) throw new Error('interlaced PNG — this reader only does non-interlaced');
  if (type !== 2 && type !== 6) throw new Error(`colour type ${type} — this reader does 2 (RGB) and 6 (RGBA)`);
  const ch = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const line = raw.subarray(q, q + stride); q += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      const v = line[i];
      cur[i] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
    }
  }
  return { w, h, ch, px: out };
}

const img = decode(png);
const lum = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
const scanY = scanYArg === '' ? Math.round(img.h / 2) : Math.round(+scanYArg);
if (scanY < 0 || scanY >= img.h) { console.error(`scanY ${scanY} outside 0..${img.h - 1}`); process.exit(2); }
const at = (x, y) => { const o = (y * img.w + x) * img.ch; return [img.px[o], img.px[o + 1], img.px[o + 2]]; };

console.log(`${img.w}x${img.h} @${img.ch}ch  box ${bx},${by},${bw},${bh}  scanline y=${scanY}`);
/* a coarse map first, because the scanline is only useful once you know *where*
   she is — guessing the coordinates off a screenshot is how this tool got
   written, and it guessed wrong twice. One character per cell, cell size chosen
   so the width lands under 112 columns. */
const STEP = Math.max(1, Math.ceil(img.w / 112));
const RAMP = ' .:-=+*#%@';
console.log(`map  ${STEP}px per cell, dark->light  "${RAMP}"`);
for (let y = Math.floor(STEP / 2); y < img.h; y += STEP * 2) {
  let row = '';
  for (let x = Math.floor(STEP / 2); x < img.w; x += STEP) {
    const v = lum(...at(x, y));
    row += RAMP[Math.min(RAMP.length - 1, Math.floor((v / 256) * RAMP.length))];
  }
  console.log(`     ${row}`);
}
console.log('');
const L = [];
for (let x = 0; x < img.w; x++) L.push(lum(...at(x, scanY)));
console.log('lum  ' + L.map((v, x) => (x % 10 === 0 ? '|' : '')).join(''));
console.log('     ' + L.map((v) => (v >= 232 ? '@' : v >= 216 ? '#' : v >= 196 ? '+' : v >= 168 ? '-' : v >= 120 ? '.' : ' ')).join(''));
let lo = 0, hi = 0;
for (let x = 1; x < img.w; x++) { if (L[x] < L[lo]) lo = x; if (L[x] > L[hi]) hi = x; }
const span = L[hi] - L[lo];
console.log(`     min ${L[lo]} at x=${lo}   max ${L[hi]} at x=${hi}   span ${span}`);
console.log('     every 16th: ' + L.filter((_, x) => x % 16 === 0).map((v) => String(v).padStart(4)).join(''));
const [r, g, b] = at(lo, scanY);
console.log(`     darkest rgb(${r},${g},${b})   wall rgb(${at(2, scanY).join(',')})`);
