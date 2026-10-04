/* dev: the model's own dimensions, in model units, without rendering anything.

   WHY THIS EXISTS
   `main.js` already carries a note about the last time a claim about the
   character's scale was *inferred from the picture*: a probe measured her hover
   footprint, which was a faithful proxy while she was a billboard and became
   meaningless the day she turned into a solid. The same trap sits here — the
   screenshot is a perspective view of a floating, bobbing, root-tilted object,
   so "the hat looks 20% too tall" off it conflates the model with the camera.

   This builds the real thing and asks it directly. `three` needs no GL context
   for geometry, and the one DOM call in `ghost.js` is the canvas behind
   `emissiveMap`, so a three-line stub is enough. It runs in well under a second,
   which is what makes it usable as a tuning loop instead of a post-mortem.

   WHAT IS MEASURED, AND WHY THOSE THINGS
   The reference's numbers are all "model extreme / brim width", because the brim
   is the one part whose extent does not depend on the pose. So the same three
   extremes are read here:

     brim width   horizontal extent of the brim discs
     hem bottom   lowest point of the sheet  (NOT the broom: the broom hangs
                  below her on purpose and including it moves the number by 40%)
     crown top    highest point of the hat   (NOT the hit capsule or the aura:
                  both are far larger than the model, and the capsule's bottom is
                  a metre under the floor)

   Run:  node tools/_bbox.mjs
*/
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

const boxOf = (o) => new THREE.Box3().setFromObject(o);
const inGroup = (o, g2) => { for (let p = o; p; p = p.parent) if (p === g2) return true; return false; };

/* which meshes belong to which part. The broom is its own group; the hat is
   `crown`; the hit capsule and the aura are excluded by name. */
const under = (grp) => {
  const b = new THREE.Box3();
  grp.traverse((o) => { if (o.isMesh) b.union(boxOf(o)); });
  return b;
};

const hat = boxOf(g.crown);
let bodyB = new THREE.Box3(), broomB = new THREE.Box3();
g.root.traverse((o) => {
  if (!o.isMesh || o === g.hit || o === g.aura) return;
  if (inGroup(o, g.crown)) return;
  if (inGroup(o, g.broom)) { broomB.union(boxOf(o)); return; }
  bodyB.union(boxOf(o));
});

/* the brim: the two disc meshes under the hat group. Identify them by being the
   widest flat pair — the cone is tall and narrow, the band is small. */
let brimW = 0, brimY = 0;
g.crown.traverse((o) => {
  if (!o.isMesh) return;
  const b = boxOf(o), w = b.max.x - b.min.x;
  if (w > brimW) { brimW = w; brimY = b.max.y; }
});
/* `hat.rotation` tilts the discs, so the horizontal extent is the *world* x
   extent, which is what a camera sees. Read it off the widest hat mesh. */
let brimWorldW = 0;
g.crown.traverse((o) => {
  if (!o.isMesh) return;
  const b = boxOf(o);
  if (b.max.x - b.min.x < 0.55 * (hat.max.x - hat.min.x)) return;   // skip cone/band
  brimWorldW = Math.max(brimWorldW, b.max.x - b.min.x);
});

const BW = brimWorldW || (hat.max.x - hat.min.x);
const rows = [
  ['total height (crown top -> hem bottom)', hat.max.y - bodyB.min.y, 0.810],
  ['hat height   (crown top -> brim bottom)', hat.max.y - hat.min.y, 0.535],
  ['body width   (widest, incl. arms)', bodyB.max.x - bodyB.min.x, 0.771],
  ['brim width', BW, 1.0],
];
console.log(`body   y ${bodyB.min.y.toFixed(3)} .. ${bodyB.max.y.toFixed(3)}   x ${bodyB.min.x.toFixed(3)} .. ${bodyB.max.x.toFixed(3)}`);
console.log(`hat    y ${hat.min.y.toFixed(3)} .. ${hat.max.y.toFixed(3)}   x ${hat.min.x.toFixed(3)} .. ${hat.max.x.toFixed(3)}`);
console.log(`broom  y ${broomB.min.y.toFixed(3)} .. ${broomB.max.y.toFixed(3)}   x ${broomB.min.x.toFixed(3)} .. ${broomB.max.x.toFixed(3)}`);
console.log(`\n==== ratios, brim width ${BW.toFixed(3)} ====`);
for (const [nm, v, ref] of rows) {
  const r = v / BW;
  const mark = ref == null ? '' : `   reference ${ref.toFixed(3)}   ${r > ref * 1.04 ? '** too big' : r < ref * 0.96 ? '** too small' : 'ok'}`;
  console.log(`  ${nm.padEnd(42)} ${v.toFixed(3).padStart(7)}  = ${r.toFixed(3)}${mark}`);
}
console.log(`\n  B (body param) = ${(5.58 / 1.402).toFixed(3)}   brim/B = ${(BW / (5.58 / 1.402)).toFixed(3)}`);
