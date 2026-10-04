/* dev: my model's silhouette, orthographically, straight from the geometry.

   WHY THIS EXISTS
   `mine.py` tries to segment the *render*, and the render is a perspective view of
   a floating, bobbing, root-tilted object standing in a room whose walls are the
   same colour as the hat. Two rounds of thresholding produced two different
   answers for "brim width" on the same frame (373 px from `compare2.py`, 549 px
   from `mine.py`) — both plausible, neither trustworthy.

   The reference side has no such problem: `measure9.py` reads the finished
   colour render and gets the model as one connected blob, and every number it
   prints is a single-axis pixel count. So the honest thing to compare against is
   not a segmented render but the *model itself*, projected flat.

   This walks the real scene graph, transforms every vertex into world space and
   rasterises the triangles. No camera, no lights, no GL, no threshold. Two
   seconds, and the answer is exact.

   ★ `_bbox.mjs` is NOT a substitute. It reads `Box3.setFromObject`, which unions
   the *transformed bounding boxes* of each geometry — for the hat, whose cone is
   long and rotated 17 deg, that inflates the vertical extent by about 35%. It
   said the hat was 3.456 units tall; the actual vertex extent is 2.53. The
   reference's numbers come from a render, so they are exact, and the comparison
   has to be exact on this side too.

   OUTPUT
   `_shots/sil-mine.ppm`  R = body, G = brim, B = crown + band
   `_shots/sil-broom.pgm` the broom on its own (the reference's model blob
                          excludes it: it is a separate object crossing in front)

   Run:  node tools/_sil.mjs
*/
import { writeFileSync } from 'node:fs';

globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect() {}, set fillStyle(_) {}, get fillStyle() { return ''; },
    }),
  }),
};

const THREE = await import('three');
const { createGhost } = await import('../src/ghost.js');

const g = createGhost({ height: 6.38, y: 0 });
g.root.updateMatrixWorld(true);

/* ---------- 1. collect triangles, tagged by part ---------- */
const inGroup = (o, top) => { for (let p = o; p; p = p.parent) if (p === top) return true; return false; };
const box = (o) => new THREE.Box3().setFromObject(o);

/* The brim is identified by being *wide and flat*, not by name: `ghost.js` has no
   reason to name its meshes, and adding names just so a dev tool can find them
   would be the tail wagging the dog. The two discs span ~6.6 units, the cone
   2.6, the band 0.6 — a 50% threshold has an order of magnitude of headroom. */
const hatMeshes = [];
g.crown.traverse((o) => { if (o.isMesh) hatMeshes.push(o); });
const hatSpan = Math.max(...hatMeshes.map((o) => { const b = box(o); return b.max.x - b.min.x; }));
const brimSet = new Set(hatMeshes.filter((o) => { const b = box(o); return b.max.x - b.min.x > 0.5 * hatSpan; }));

const parts = { body: [], brim: [], crown: [], broom: [] };
const v = new THREE.Vector3();
g.root.traverse((o) => {
  if (!o.isMesh || o === g.hit || o === g.aura) return;
  const key = inGroup(o, g.crown) ? (brimSet.has(o) ? 'brim' : 'crown')
    : inGroup(o, g.broom) ? 'broom' : 'body';

  const pos = o.geometry.getAttribute('position');
  const idx = o.geometry.index;
  const n = idx ? idx.count : pos.count;
  const w = o.matrixWorld;
  const tri = [];
  for (let i = 0; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const j = idx ? idx.getX(i + k) : i + k;
      v.fromBufferAttribute(pos, j).applyMatrix4(w);
      tri.push(v.x, v.y);
    }
  }
  parts[key].push(tri);
});

/* ---------- 2. bounds -> pixel grid ---------- */
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const list of Object.values(parts)) {
  for (const tri of list) {
    for (let i = 0; i < tri.length; i += 2) {
      if (tri[i] < minX) minX = tri[i];
      if (tri[i] > maxX) maxX = tri[i];
      if (tri[i + 1] < minY) minY = tri[i + 1];
      if (tri[i + 1] > maxY) maxY = tri[i + 1];
    }
  }
}
const PAD = 6;
const PX = 1600;
const sc = PX / (maxX - minX);
const W = Math.round((maxX - minX) * sc) + PAD * 2;
const H = Math.round((maxY - minY) * sc) + PAD * 2;
const px = (x) => PAD + (x - minX) * sc;          // world +x -> right
const py = (y) => H - PAD - (y - minY) * sc;      // world +y -> up, rows run down

const masks = { body: new Uint8Array(W * H), brim: new Uint8Array(W * H), crown: new Uint8Array(W * H), broom: new Uint8Array(W * H) };

function fill(tris, m) {
  for (const tri of tris) {
    for (let t = 0; t < tri.length; t += 6) {
      const x0 = px(tri[t]), y0 = py(tri[t + 1]);
      const x1 = px(tri[t + 2]), y1 = py(tri[t + 3]);
      const x2 = px(tri[t + 4]), y2 = py(tri[t + 5]);
      const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(d) < 1e-9) continue;
      const yA = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const yB = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const xA = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const xB = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      for (let y = yA; y <= yB; y++) {
        for (let x = xA; x <= xB; x++) {
          const cx = x + 0.5, cy = y + 0.5;
          const l0 = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) / d;
          const l1 = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) / d;
          if (l0 < -1e-6 || l1 < -1e-6 || l0 + l1 > 1 + 1e-6) continue;
          m[y * W + x] = 255;
        }
      }
    }
  }
}
for (const k of Object.keys(masks)) fill(parts[k], masks[k]);

const rgb = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  rgb[i * 3] = masks.body[i];
  rgb[i * 3 + 1] = masks.brim[i];
  rgb[i * 3 + 2] = masks.crown[i];
}
writeFileSync('_shots/sil-mine.ppm', Buffer.concat([
  Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), Buffer.from(rgb)]));
writeFileSync('_shots/sil-broom.pgm', Buffer.concat([
  Buffer.from(`P5\n${W} ${H}\n255\n`, 'ascii'), Buffer.from(masks.broom)]));

/* ---------- 3. landmarks, in the reference's own form ---------- */
const span = (m, y) => {
  let a = -1, b = -1;
  for (let x = 0; x < W; x++) if (m[y * W + x]) { if (a < 0) a = x; b = x; }
  return a < 0 ? null : [a, b, b - a];
};
const bbox = (m) => {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 > x1 ? null : { x0, x1, y0, y1 };
};
/* the model = body + hat, exactly as measure9.py defines its blob (the broom is
   a separate object and is not part of it) */
const model = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) model[i] = (masks.body[i] || masks.brim[i] || masks.crown[i]) ? 1 : 0;

const MB = bbox(model), BB = bbox(masks.body), HB = bbox(masks.brim), CB = bbox(masks.crown);
const BW = MB.x1 - MB.x0;
const rowAt = (x, m) => { const ys = []; for (let y = 0; y < H; y++) if (m[y * W + x]) ys.push(y); return ys; };
const tipL = rowAt(MB.x0 + 3, model), tipR = rowAt(MB.x1 - 3, model);

console.log(`model  x ${MB.x0}..${MB.x1} (w ${BW})   y ${MB.y0}..${MB.y1} (h ${MB.y1 - MB.y0})`);
console.log(`  body  x ${BB.x0}..${BB.x1} (w ${BB.x1 - BB.x0})   y ${BB.y0}..${BB.y1} (h ${BB.y1 - BB.y0})`);
console.log(`  brim  x ${HB.x0}..${HB.x1} (w ${HB.x1 - HB.x0})   y ${HB.y0}..${HB.y1} (h ${HB.y1 - HB.y0})`);
console.log(`  crown y ${CB.y0}..${CB.y1} (h ${CB.y1 - CB.y0})`);

let bodyWidest = 0, bodyWidestRow = 0;
for (let y = BB.y0; y <= BB.y1; y++) { const s = span(masks.body, y); if (s && s[2] > bodyWidest) { bodyWidest = s[2]; bodyWidestRow = y; } }

const V = (a, b) => `${String(a).padStart(5)} - ${String(b).padStart(5)} = ${String(a - b).padStart(5)}`;
console.log(`\n--- landmarks (px, single axis) ---`);
console.log(`crown top row            y = ${MB.y0}`);
console.log(`hem bottom row           y = ${MB.y1}      (row ${MB.y1 - 3} spans ${JSON.stringify(span(model, MB.y1 - 3))})`);
console.log(`brim left  tip           x = ${MB.x0}      y ${tipL[0]}..${tipL[tipL.length - 1]}`);
console.log(`brim right tip           x = ${MB.x1}      y ${tipR[0]}..${tipR[tipR.length - 1]}`);
console.log(`brim band rows           ${HB.y0}..${HB.y1}`);
console.log(`body widest row          y = ${bodyWidestRow}   span ${bodyWidest}`);
console.log(`brim tilt                ${(Math.atan2((tipR[0] + tipR[tipR.length - 1]) / 2 - (tipL[0] + tipL[tipL.length - 1]) / 2, BW) * 180 / Math.PI).toFixed(1)} deg`);

console.log(`\n==== ratios, brim width ${BW} px ====`);
const row = (nm, v, ref) => console.log(
  `  ${nm.padEnd(40)} ${String(v).padStart(5)} / ${BW} = ${(v / BW).toFixed(3)}`
  + (ref == null ? '' : `   reference ${ref.toFixed(3)}`
    + (v / BW > ref * 1.04 ? '   ** too big' : v / BW < ref * 0.96 ? '   ** too small' : '   ok')));
/* The reference column is read off `measure9.py` / `measure10.py`, but two of the
   numbers those scripts print had to be corrected by hand, and both corrections
   are worth naming because each one sent this tool chasing a target that no model
   could hit:

   * "hat height" was 0.535, from `measure10.py`'s hue mask. That mask is dilated
     by 7x7 and its red arm also catches the blush, so it runs ~90 px below the
     brim. The right reading is the brim's own bottom edge (the right tip, ~535)
     minus the crown top (77) = 458, i.e. 0.446.
   * `measure9.py`'s "brim occupies rows 77..562" is *also* not the brim: 562 is
     the last row whose silhouette is wider than 0.8 of the brim, and below the
     brim's tip the sheet is still wide enough to pass that test — what it is
     catching is the brim's cast shadow on the body. The brim's own bbox is
     rows 190..535, height 345 = 0.336.
   * the hem: `measure9.py` puts the blob's bottom at 935, but `measure10.py`'s
     body profile ends at ~910 (y=903 still spans 87 px). 935 is the broom's
     shadow. Total height is therefore (910 - 77) / 1026 = 0.812. */
row('total height  (crown top -> hem bottom)', MB.y1 - MB.y0, 0.812);
row('hat height    (crown top -> brim bottom)', HB.y1 - MB.y0, 0.446);
row('crown cone h  (crown top -> brim mid)', ((HB.y0 + HB.y1) / 2) - MB.y0, 0.283);
row('brim band h   (brim bbox)', HB.y1 - HB.y0, 0.336);
row('body width    (widest row, incl. arms)', bodyWidest, 0.752);
/* ★★ This row's reference changed from 0.609 to 0.752, and the reason is the same
   class of mistake the note below describes — one level deeper.

   `measure10.py` measured the finished frame, and the ghost in that frame is
   *turned*: its sideways arm flaps point away from the camera, so their projected
   width is short by roughly cos(yaw). What that frame reports as "the widest row"
   is therefore the hem (0.609), and what it reports at the arm row (0.579) is a
   foreshortened arm — not a shape.

   `_ref/ghost/measure/clay-front-tight.png` is the clay viewport seen from the
   front, where the flaps point at the camera, and there the ordering is reversed:
   the arm row spans 669 px (0.752 of the brim) while the row just above it spans
   442 px (0.497). The two frames agree once the yaw is put back: 0.752 x cos45deg
   is about 0.53, and with the hem's own projection on top that is the 0.579.

   That the two runs at x 230..287 and x 807..872 in that clay view really are the
   arms and not the brim was checked by brightness, not by eye: at rows 354 and 364
   those x-ranges read ~55 (the brim, in shadow) and from row 374 on they read
   133..177 (the body). The flaps appear exactly where the body colour does.

   Caveat, deliberately not encoded: the clay view puts the hem at 0.562 against
   this frame's 0.609, so it reads ~8% small overall; 0.752 is its raw number and
   the scale-corrected one is nearer 0.815. 0.752 is used because this row is
   checked on the *widest* row, which for this model is now the arms — the hem is
   not separately checked here, and it is the hem that carries the 8%.

   The older note, still true for the bbox:
   `measure10.py` prints both a bbox (0.771) and a widest row, and only the second
   is comparable, because the bbox spans the left arm *at one height* to the right
   hem *at another* — 791 px of bbox against 625 px of any actual row. A body of
   revolution has no such offset, so matching the bbox would have made the sheet
   26% too wide, which is exactly what happened: the silhouette's widest point
   moved up to the shoulders and she read as a mushroom. */
row('body height   (body bbox)', BB.y1 - BB.y0, 0.565);
console.log(`\n${W}x${H}  scale ${sc.toFixed(1)} px/unit`);
