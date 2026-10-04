/* dev: one-off — where is the brim's topmost pixel?

   WHY IT WAS ASKED. `_sil.mjs` reported the brim's bbox as 382 px tall while the
   span between its two tips was only 331, and for a *flat* tilted disc those two
   are the same number. That 51 px gap looked like a bug in the model, and the
   obvious suspect was the radial tip modulation added to `brimFn`.

   WHAT IT FOUND. The topmost brim pixel sits at x=312, 11 px right of the
   leftmost point (x=301), and 25 px above it. So the brim's extreme top is *not*
   its tip — the disc is not planar, because `brimDrop` lowers the rim relative to
   the middle and the tip modulation moves the rim outward at the same time.

   WHETHER THAT IS WRONG. It is not. Measuring the same two numbers on the
   reference gives the same shape: its tips are at y 210 and 525, its brim bbox is
   rows 190..535 — i.e. also about ±20 px of overhang at each end. Two independent
   models agreeing on a non-obvious number is the answer; the arithmetic that
   expected 331 was the thing that was wrong, because it assumed a flat disc.

   Run:  node tools/_sil.mjs && node tools/_brimrows.mjs
*/
import { readFileSync } from 'node:fs';
const buf = readFileSync('_shots/sil-mine.ppm');
let i = 0; const tok = [];
while (tok.length < 4) { let s = ''; while (buf[i] !== 10 && buf[i] !== 32) s += String.fromCharCode(buf[i++]); i++; tok.push(s); }
const W = +tok[1], H = +tok[2];
const px = buf.subarray(i);
const at = (x, y, c) => px[(y * W + x) * 3 + c];
let top = null, bot = null;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y, 1)) { if (!top) top = [x, y]; bot = [x, y]; }
console.log('brim topmost', top, ' lowest', bot, ` frame ${W}x${H}`);
for (const y of [top[1], top[1] + 5, top[1] + 15, top[1] + 30, 140, 200, 300, 400, 470, bot[1]]) {
  let a = -1, b = -1;
  for (let x = 0; x < W; x++) if (at(x, y, 1)) { if (a < 0) a = x; b = x; }
  console.log(`  row ${String(y).padStart(4)}: ${a}..${b}  span ${b - a}`);
}
