import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from './anim.js';

/* ============================== 纳西妲 ===================================
   She used to be one billboard: `assets/spirit-cut.webp` on a Sprite, with the
   rim put back as a second Sprite grown behind her. That was the right answer
   while the delivered art was the final look. It is the wrong answer now —
   the brief is a *three-dimensional* figure you can walk around and poke at,
   and no amount of 2D trickery survives being orbited.

   So this file builds her out of primitives. Nothing is loaded: no mesh, no
   texture file, no font. Every surface here is a `SphereGeometry`, a
   `LatheGeometry`, a `Shape`, or a canvas the page draws itself at boot —
   which is what keeps the single-file deliverable single-file, and what makes
   her palette something this file can state rather than something a PNG
   happens to contain.

   WHICH NAHIDA, AND WHY THE OUTFIT IS THE ANSWER
   The first solid version of her was dressed in a white leaf gown with a
   trifoliate crown and leaf wings — a plausible reading of the character, and
   the wrong one. The reference this pass is keyed to is the *sculpt*: a
   Q-version Nahida in a school uniform. White short-sleeve shirt, green
   striped tie, green plaid pleated skirt, white ankle socks with a green band,
   navy loafers. Silver-white hair that goes green at the tips, a high side
   ponytail, a rope braid down the other side, pointed elf ears, and clover
   hair ornaments instead of a crown.

   That is not a detail change, it is a different silhouette, and the
   silhouette is most of what "is it her" means at 200 px. So the gown, the
   wings and the crown are gone, and the five things that now do the work are:
     1. the palette — 素白 hair fading to 苔绿 tips, 青绿 uniform green,
        near-black 描边, and the navy shoes that anchor the whole figure.
     2. the four-leaf clover in each pupil, and the star sparkle over it.
     3. the pleated plaid skirt — the one shape nothing else on this page has.
     4. the big green-tipped side ponytail, and the braid on the far side.
     5. the pointed ears.
   Get those five and she is recognisable at 200 px; get the muscle definition
   of a forearm right and nobody will notice.

   PROPORTIONS: 2.8 HEADS, AND WHY THAT IS THE WHOLE DESIGN
   A Q-version figure is not a small adult, it is a *different ratio*, and the
   ratio is the style. She is authored at a nominal 6.40 tall — the same height
   the billboard was — with a head 2.32 across: 2.76 heads to the crown. Her
   real proportions are closer to five. Everything below is placed from that
   one decision: the head is a full third of her, the torso is short, the legs
   are short and mostly under the skirt, and the eyes sit at 62% of the head's
   height rather than at its middle — which is the single strongest "this is a
   child, drawn cute" cue there is.

   THE FACE IS TEXTURE, NOT GEOMETRY
   Anime eyes are drawn, not modelled. Each eye is a *patch of the head's own
   sphere* — `SphereGeometry` with a narrow phi/theta window — carrying a canvas
   texture. The patch curves exactly with the skull, so it cannot poke through
   or float off, and the UVs are already 0..1 across the window, so the canvas
   needs no mapping code. Blinking swaps the texture for a second canvas with
   the same brow drawn on it: a blink is 100 ms and two frames of 2D animation
   is what a blink *is*, so there is nothing to interpolate.

   THE AURA REPLACES THE OLD RIM, AND KEEPS ITS CONTRACT
   The 2D version needed a grown-back outline because a white cut-out in a white
   room has no edge (measured: 35 levels of contrast in 晴室). A 3D figure has
   real form and gets a real rim light from each rig, so it does not need the
   outline — but it does still need to *sit in the room*, which is what the
   theme's `spirit.rim` / `rimOp` were for. They now drive a fresnel shell
   instead: a slightly larger copy of her silhouette, drawn back-faces-only and
   under normal blending, brightest where the surface turns away from the lens.
   Same numbers, same meaning ("how much edge does this room need"), a different
   machine. The body's own colours are deliberately *not* tinted by the theme —
   she is a character, not a surface, and recolouring her per room would cost
   more than it buys.

   FLOATING, NOT STANDING
   Nahida floats. The bob is not decoration: her feet never touch the floor, so
   the shadow she casts has to be soft and offset, and `root.position.y` is the
   one number that moves her. Everything else is rotation.
   ======================================================================== */

const NOMINAL = 6.40;            // the height everything below is authored at
const TAU = Math.PI * 2;

/* ---------- palette ----------
   Sampled off the sculpt (a quantised histogram per region of the ZBrush
   viewport, not off the shaded 2D drawing): shirt #F6F4EF, tie #6E8C72,
   skirt #74907A, shoe #3F4350, hair #F2EEEE with a sage #A9BA86 tip.

   The `*Dark` entries are one step deeper than the artwork: the artwork had its
   shading painted in, and on a lit solid the only thing that separates a sleeve
   from the bodice behind it is that step. `shirtDark` is load-bearing — pull it
   up to the base colour and she goes flat white.

   `hairDark` is the exception, and it went the other way. At 0xb7bac2 — the
   tone the artwork's hair shadows actually are — the alternate fringe strands
   and the temple tufts read as *dirt* on white hair rather than as hair: the
   eye reads a cool grey patch on a warm white head as a smudge, not as a
   shadow. It is now a whisper, which is enough to separate one strand from the
   next and not enough to look like a mark. */
const C = {
  hair: 0xf2eeee, hairDark: 0xe2dddb, hairTip: 0xa9c4d8,
  skin: 0xf5e2d7, skinDark: 0xd9b8a8,
  shirt: 0xf6f4ef, shirtDark: 0xd6d2c9,
  collar: 0x49684f, collarLit: 0x6f9457,
  skirt: 0xf6f4ef, skirtInner: 0x8aa87c,
  capeTop: 0x8fae6e, capeBot: 0x9fc4dc,
  cream: 0xe8ddca,
  silver: 0xd8dce2,
  shoe: 0xf5f3ee, sole: 0xe8e5da,
  ink: 0x2a2b1f,
  leaf: 0x6f9457, leafLit: 0xb4cd94, leafDeep: 0x536232,
  gold: 0xd9c489,
};

/* ---------- geometry helpers ---------- */

/** a pointed leaf from (0,0) to (0,len), widest at `wide` of the way up */
function leafShape(len = 1, wid = 0.4, wide = 0.44) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(wid, len * wide * 0.5, wid, len * (wide + (1 - wide) * 0.62), 0, len);
  s.bezierCurveTo(-wid, len * (wide + (1 - wide) * 0.62), -wid, len * wide * 0.5, 0, 0);
  return s;
}

/* A leaf as a mesh, flat in XY, hinged at its base.

   Two ways to bend it, and they are not interchangeable:

   - `curve` is a **parabola**, `z = -curve·y²/len`. It is a stylistic bow, and
     it is what the crown leaves and the ponytail wisps want.
   - `arcR` is a **circular arc of that radius**, `z = -(R - √(R²-y²))`, and it
     is the only correct shape for a strand that is supposed to lie on a sphere.
     A parabola and an arc of the same *sagitta* are not the same curve: the
     parabola's end slope is `2·curve`, and matching the arc's end slope `tan(L/R)`
     needs `curve = tan(L/R)/2`, which is six times the sagitta-derived value at
     L ≈ R. That is exactly why the fringe flew off the front of her head —
     the strands left the crown tangent and never turned, so from the front they
     read as stripes on the crown with a bare forehead below them, and the
     "exact sagitta" in the note on `strand` was right about the magnitude and
     wrong about the shape. An arc is the shape. */
function leafMesh(len, wid, mat, { curve = 0.18, seg = 12, arcR = 0 } = {}) {
  const g = new THREE.ShapeGeometry(leafShape(len, wid), seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    let y = p.getY(i);
    // the cross-section curl, identical either way
    const curl = -curve * 0.35 * (x / wid) * (x / wid);
    if (arcR > 0) {
      // the chord of an arc of *arc length* `len`, so the strand measures its
      // own length along the skull rather than across it
      const chord = arcR * Math.sin(len / arcR);
      y *= chord / len;
      p.setY(i, y);
      p.setZ(i, -(arcR - Math.sqrt(Math.max(arcR * arcR - y * y, 1e-6))) + curl);
    } else {
      p.setZ(i, -curve * (y / len) * (y / len) * len + curl);
    }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** a flat outline given thickness. ExtrudeGeometry expands the outline by
    `bevel`, which is why every caller's numbers are the *finished* size. */
function plate(shape, thick, mat, { bevel = 0.022, seg = 10 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 2, curveSegments: seg,
  });
  g.translate(0, 0, -thick / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** a limb: cylinder with rounded ends, from a to b */
function limb(a, b, r0, r1, mat, seg = 10) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

/** a sphere, optionally squashed */
function ball(r, mat, sx = 1, sy = 1, sz = 1, seg = 18) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.72)), mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

/* ---------- the things a lathe cannot do ----------

   `LatheGeometry` revolves one profile, so every ring is a circle: it can make
   a cone and it cannot make a pleat, a taper along a curve, or a rope. Those
   three are hand-built below, and each one writes its own normals rather than
   calling `computeVertexNormals` — a grid or a tube whose seam vertices are
   duplicated gets a hard line down the seam from the averaging, and both of
   these have an exact normal available for free. */

/** an A-line skirt with `folds` pleats. The zigzag is in the radius, and the
    crispness is `flatShading` on the material — a triangle wave with averaged
    normals is a scallop, and a scallop is not a pleat. */
function pleatedSkirt({ rTop, rBot, yTop, yBot, folds = 22, depth = 0.085, rows = 7 }) {
  const cols = folds * 2;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const y = lerp(yTop, yBot, t);
    const rBase = lerp(rTop, rBot, Math.pow(t, 0.86));
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * TAU;
      // the fold deepens toward the hem, so the waist is smooth and the hem
      // is all edge — which is what a pleat does as it falls
      const r = rBase - (j % 2 ? depth : 0) * (0.30 + 0.70 * t);
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(j / cols, t);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------- a hair lock, built the way the sculpt builds one ----------

   The reference is a ZBrush sculpt, and its hair is not made of leaves. It is a
   handful of **thick, rounded, sausage-shaped locks**: each one a curve drawn
   on the skull, thickened, and closed with a dome at each end. That is the whole
   method — curve, sweep, thicken, smooth — and it is reproducible here.

   Three things make the difference between a lock of hair and a length of pipe,
   and a plain swept tube gets all three wrong:

   1. **The ends are domes, not discs.** A tube ends in a flat circle, and a flat
      circle at the tip of a lock reads as a cut pipe however good the rest of it
      is. `capA` / `capB` are the dome lengths in units of the local radius: 1 is
      a hemisphere, 0 is the flat disc. They are real geometry here, not a ball
      parked on the end, because a ball parked on the end leaves a crease where
      it meets the tube — which is exactly what the ponytail's tip used to be.

   2. **The cross-section is an ellipse, and both axes are stated.** `deep`
      scales the frame's *normal* axis and `flat` the *binormal* one. For a lock
      running down the front of the skull the normal points straight out of the
      head, so `deep` is how far the lock stands off the skull and `flat` is how
      wide it is across it — which are the two numbers that decide whether the
      fringe is relief on a head or a helmet around one. A circular
      cross-section at the radius a fringe needs is a helmet: 0.19 on a 1.01
      sphere protrudes a quarter of the skull's radius and the face disappears
      underneath it. The reference's locks are roughly 0.4 as deep as they are
      wide.

   3. **The normals come from the sphere each ring belongs to.** A ring along the
      body is a circle about its own centre; a ring inside a cap is a circle
      about the *end point*. Writing them that way keeps the dome shaded as a
      dome. `computeVertexNormals` cannot do this job here: the first and last
      columns are duplicated so the UV seam has somewhere to live, and averaging
      across that seam draws a hard line straight down the lock.

   4. **`out` is stated, and it has to be.** `computeFrenetFrames` picks its own
      roll about the tangent, and that roll is not the one this file wants. On
      the real fringe curves it comes back **90 degrees off the radial** on the
      centre lock and 62 to 77 degrees off on the outer ones — *a different roll
      per lock*. So `deep` was scaling the sideways axis and `flat` the radial
      one, and the fringe was a row of tall thin fins with bare skin between
      them, which is exactly what it looked like on screen. Passing `out` —
      `'radial'` for anything lying on the skull, a constant vector otherwise —
      makes `deep` mean "how far it stands off" and `flat` "how wide it is
      across", which is what every caller already assumed it meant.

   `prof` is the radius multiplier along the lock (0..1 of its length); the
   default swells slightly past the root and tapers toward the tip, which is
   what a lock of hair does. `taper` is an extra linear narrowing toward the tip,
   so `rad * (1 - taper)` is the radius the dome closes over. */
function lock(curve, {
  segs = 44, rad = 0.22, cols = 14, prof = null, taper = 0,
  flat = 1, deep = 1, capA = 1, capB = 1, capSeg = 3, out = null,
} = {}) {
  const fr = curve.computeFrenetFrames(segs, false);
  const radAt = (t) => rad * (prof ? prof(t) : (0.88 + 0.12 * Math.sin(Math.PI * t))) * (1 - taper * t);
  /* One frame per ring: `n` is the axis `deep` scales and `b` the axis `flat`
     scales. Handedness matches the Frenet pair (`b = t x n`), so the triangle
     winding — and therefore which side gets culled — is unchanged. */
  const frameAt = (i, p) => {
    const tan = fr.tangents[i];
    if (!out) return { t: tan, n: fr.normals[i], b: fr.binormals[i] };
    const o = out === 'radial' ? p.clone() : out.clone();
    o.addScaledVector(tan, -o.dot(tan));       // keep only what is perpendicular
    if (o.lengthSq() < 1e-8) return { t: tan, n: fr.normals[i], b: fr.binormals[i] };
    o.normalize();
    return { t: tan, n: o, b: new THREE.Vector3().crossVectors(tan, o).normalize() };
  };
  const rings = [];
  const p0 = curve.getPoint(0), r0 = radAt(0);
  const f0 = frameAt(0, p0);
  if (capA > 0) {
    for (let k = capSeg; k >= 1; k--) {
      const th = (k / capSeg) * (Math.PI / 2);
      rings.push({
        c: p0.clone().addScaledVector(f0.t, -r0 * Math.sin(th) * capA),
        n: f0.n, b: f0.b, r: r0 * Math.cos(th), ref: p0,
        pole: k === capSeg ? f0.t.clone().negate() : null,
      });
    }
  }
  for (let i = 0; i <= segs; i++) {
    const p = curve.getPoint(i / segs);
    const f = frameAt(i, p);
    rings.push({ c: p, n: f.n, b: f.b, r: radAt(i / segs), ref: null, pole: null });
  }
  const p1 = curve.getPoint(1), r1 = radAt(1);
  const f1 = frameAt(segs, p1);
  if (capB > 0) {
    for (let k = 1; k <= capSeg; k++) {
      const th = (k / capSeg) * (Math.PI / 2);
      rings.push({
        c: p1.clone().addScaledVector(f1.t, r1 * Math.sin(th) * capB),
        n: f1.n, b: f1.b, r: r1 * Math.cos(th), ref: p1,
        pole: k === capSeg ? f1.t.clone() : null,
      });
    }
  }
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i < rings.length; i++) {
    const R = rings[i];
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * TAU;
      const ox = Math.cos(a) * R.r * deep, oy = Math.sin(a) * R.r * flat;
      const px = R.c.x + R.n.x * ox + R.b.x * oy;
      const py = R.c.y + R.n.y * ox + R.b.y * oy;
      const pz = R.c.z + R.n.z * ox + R.b.z * oy;
      pos.push(px, py, pz);
      if (R.pole) { nrm.push(R.pole.x, R.pole.y, R.pole.z); } else {
        const ref = R.ref || R.c;
        const nx = px - ref.x, ny = py - ref.y, nz = pz - ref.z;
        const L = Math.hypot(nx, ny, nz) || 1;
        nrm.push(nx / L, ny / L, nz / L);
      }
      uv.push(j / cols, i / (rings.length - 1));
    }
  }
  /* THE WINDING IS REVERSED, AND THAT IS NOT A STYLE CHOICE.

     Written the obvious way round — `(a, b, a+1)` for a ring pair — the face
     normal comes out as `(v[i+1][j] - v[i][j]) x (v[i][j+1] - v[i][j])`, which
     is `dt x db` = `t x (t x n)` = `-n`. Inward. Every triangle on the outside
     of every lock was therefore back-facing and culled, and what actually
     rendered was the *far inner wall* of each tube, carrying vertex normals
     that pointed away from the camera. That is a surface lit from behind: flat,
     dark, and with its highlights on the wrong side — which is why the fringe
     read as a set of grey stripes drawn down her face however bright the room
     was, and why the centre lobe came out darker than the under-shell that
     exists only to be darker than it.

     Nothing else on this page has the bug because nothing else writes its own
     normals: `pleatedSkirt` calls `computeVertexNormals`, which derives them
     from the winding and is therefore self-consistent whatever the winding is.
     A mesh that states its normals has to get its winding right too. */
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* A point on the hair sphere. `yaw` is around Y with 0 at the face, `lat` is
   the latitude — 0 at the equator, +pi/2 at the crown — which is the same
   convention `strand` uses, so a lock can be authored in the same numbers the
   fringe's lengths used to be reasoned about in. */
function hp(yaw, lat, r = HAIR_R) {
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(lat) * r, Math.sin(lat) * r, Math.cos(yaw) * Math.cos(lat) * r);
}

/** one strand of a rope braid: a tube whose centreline is wound around `curve`
    on that curve's own frame. Two of these at phase 0 and pi *are* a braid —
    which is cheaper and truer than a chain of beads, and the reason the braid
    on her left reads as hair rather than as a string of pearls. */
function ropeStrand(curve, segs, r, turns, phase) {
  const fr = curve.computeFrenetFrames(segs, false);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPoint(t);
    const a = t * turns * TAU + phase;
    p.addScaledVector(fr.normals[i], Math.cos(a) * r * 0.60);
    p.addScaledVector(fr.binormals[i], Math.sin(a) * r * 0.60);
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

/* ---------- painting a gradient onto a mesh ----------
   The tips of her hair go green, and that is one attribute rather than a second
   material: a strand with a separate green leaf stuck on the end has a seam,
   and a seam on a 6-pixel-wide strand is the whole strand.

   `vAt(i)` returns 0..1 along the thing being painted — `y / len` for a leaf
   (its own +Y is its growth direction) and `uv.y` for a tube. The lerp is
   smoothstepped, because a linear fade on white-to-sage reads as a dirty
   smudge rather than as a dye line. */
function tipPaint(geom, vAt, amount, hex) {
  const p = geom.attributes.position;
  const arr = new Float32Array(p.count * 3);
  const a = new THREE.Color(C.hair), b = new THREE.Color(hex), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = clamp((vAt(i) - (1 - amount)) / Math.max(amount, 1e-4), 0, 1);
    tmp.copy(a).lerp(b, t * t * (3 - 2 * t));
    arr[i * 3] = tmp.r; arr[i * 3 + 1] = tmp.g; arr[i * 3 + 2] = tmp.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/* A hair strand: hinged on a sphere's surface at (yaw, pitch) and pointing
   *downhill* — tangentially at first, blended toward straight down as `droop`
   rises.

   Two things here are the difference between a fringe and a bowl cut, and both
   were wrong in the first pass:

   1. **The hinge is on the surface, not the centre.** A leaf rotated by a fixed
      angle ends up buried inside the skull the moment the radius it was
      authored at stops matching the sphere it is standing on.

   2. **The strand is bowed to match the skull's curvature, and the roll is
      stated rather than inherited.** `leafMesh` bends a leaf along its own -Z,
      so if the leaf does not know which way is "out", the bow points somewhere
      different on every strand — and on the ones where it pointed inward the
      strand sank and never came back. Measured: with `setFromUnitVectors` the
      entire fringe was buried to its tips, and the only part of any strand that
      ever reached the surface was one dark sliver at the hairline, which read
      as dirt on her hair. Building the full basis (side, growth, out) fixes the
      roll, and bowing by the *sagitta of the arc it is lying on* — R(1-cos(len/2R)),
      which is the exact sagitta and not the small-angle len²/2R — makes it
      follow the sphere by construction. (len²/2R was the first attempt and it
      is only valid while len << R; at len 1.90 on a 1.06 sphere it asks for a
      bow of 1.70, i.e. a leaf that curls past the centre of the skull and
      vanishes inside it. The long face-framing locks did exactly that.) */
const DOWN = new THREE.Vector3(0, -1, 0);
function strand(R, yaw, pitch, len, wid, mat, { droop = 0.10, curve = null, out = 1.04, tip = 0, tipMat = null } = {}) {
  const n = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const t = DOWN.clone().addScaledVector(n, -DOWN.dot(n)).normalize();
  t.lerp(DOWN, droop).normalize();
  // a right-handed basis: leaf +Y grows along the strand, leaf +Z faces away
  // from the head — so the leaf's own -Z bow curves *inward*, i.e. along the
  // skull, which is the direction the skull actually goes
  const side = new THREE.Vector3().crossVectors(t, n).normalize();
  const face = new THREE.Vector3().crossVectors(side, t).normalize();
  /* `arcR: R` and not a sagitta: with the arc, a strand of length L hinged at
     polar angle p ends at p + L/R, which is a *number you can do arithmetic
     with*. That is how the fringe below is placed — its hinge is 25 deg off the
     crown and its lengths are chosen to land between 70 and 88 deg, i.e. just
     above the eyes, which sit at 88 deg. */
  const lf = leafMesh(len, wid, mat, curve === null ? { arcR: R } : { curve });
  if (tip > 0 && tipMat) {
    const g = lf.geometry;
    tipPaint(g, (i) => clamp(g.attributes.position.getY(i) / (R * Math.sin(len / R)), 0, 1), tip, C.hairTip);
    lf.material = tipMat;
  }
  lf.position.copy(n).multiplyScalar(R * out);
  lf.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, t, face));
  return lf;
}

/* ---------- the face, drawn on canvas ---------- */

/* One canvas per state, both carrying the same brow so a blink only changes the
   eye. 256 x 292 because the patch it lands on is 0.60 x 0.684 radians — the
   drawing is stretched by the sphere's own UVs, so the canvas aspect has to
   match the *angular* window or the eye comes out egg-shaped. */
const EYE_W = 256, EYE_H = 292;

/** a four-point sparkle, which is what the reference's catchlight is — an
    ellipse reads as a smudge of light, a star reads as a *drawing* */
function star(g, x, y, R, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 4;
    const rr = i % 2 ? r : R;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
  g.fill();
}

function eyeCanvas(open) {
  const c = document.createElement('canvas');
  c.width = EYE_W; c.height = EYE_H;
  const g = c.getContext('2d');

  // ---- the brow: identical in both states, so blinking does not erase it ----
  g.strokeStyle = '#8d9377';
  g.lineWidth = 12; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(58, 58);
  g.quadraticCurveTo(128, 26, 198, 54);
  g.stroke();

  if (!open) {
    // a closed eye is one arc, and it curves *down* — an upward arc reads as a
    // smile and turns a blink into a wink
    g.strokeStyle = '#3a3d2c';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(52, 168);
    g.quadraticCurveTo(128, 214, 204, 162);
    g.stroke();
    return c;
  }

  const cx = 128, cy = 172;

  // ---- the lash: a wide almond, drawn first and used as the eye's outline ----
  g.fillStyle = '#33362a';
  g.beginPath();
  g.moveTo(30, 168);
  g.bezierCurveTo(44, 84, 96, 52, 130, 52);
  g.bezierCurveTo(176, 52, 220, 92, 228, 168);
  g.bezierCurveTo(196, 236, 66, 240, 30, 168);
  g.closePath();
  g.fill();

  // ---- the iris: lit from below, which is what stops it reading as a hole ----
  const ir = g.createLinearGradient(0, cy - 84, 0, cy + 84);
  ir.addColorStop(0, '#4d7b3d');
  ir.addColorStop(0.52, '#8fbf6a');
  ir.addColorStop(1, '#e4f2c6');
  g.fillStyle = ir;
  g.beginPath(); g.ellipse(cx, cy, 86, 90, 0, 0, TAU); g.fill();

  // a dark rim, so the light bottom of the gradient does not leak into the lash
  g.strokeStyle = 'rgba(45,80,38,0.80)';
  g.lineWidth = 9;
  g.beginPath(); g.ellipse(cx, cy, 83, 87, 0, 0, TAU); g.stroke();

  /* ---- the pupil: a four-pointed star ----

     It was a four-leaf clover, which is the right idea about *which* character
     and the wrong shape. The sculpt's pupil is a four-pointed star with concave
     sides — points up, down, left, right — and it is the single feature that
     says who this is at 60 pixels across.

     It is drawn as three nested stars rather than one, because a single fill
     vanishes: the iris under it is the same green, so the largest star is the
     dark rim, the middle one is the body, and a small near-white one is the
     core. `star` takes (R, r) and the ratio is what sets how concave the sides
     are — r/R near 0.5 is a diamond, near 0.25 the points are needles. */
  const pupil = (R, r, fill) => { g.fillStyle = fill; star(g, cx, cy, R, r); };
  pupil(70, 23, '#2f5b33');
  pupil(58, 18, '#8fc46a');
  pupil(34, 10, 'rgba(246,252,232,0.95)');

  // ---- one soft catchlight, up and to the inside ----
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath(); g.arc(cx - 48, cy - 54, 15, 0, TAU); g.fill();

  // ---- the lower lid: a light crescent, the cheapest way to say "wet" ----
  g.strokeStyle = 'rgba(238,236,232,0.75)';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(66, 214);
  g.quadraticCurveTo(128, 236, 192, 210);
  g.stroke();

  return c;
}

/** the mouth, in two states; the same patch cross-fades between them */
function mouthCanvas(open) {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 120;
  const g = c.getContext('2d');
  g.strokeStyle = '#4a3a30';
  g.fillStyle = '#8c4a48';
  if (!open) {
    g.lineWidth = 14; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(44, 46);
    g.quadraticCurveTo(80, 78, 116, 44);
    g.stroke();
    return c;
  }
  g.beginPath();
  g.ellipse(80, 60, 34, 30, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#c2706c';
  g.beginPath(); g.ellipse(80, 76, 22, 12, 0, 0, TAU); g.fill();
  return c;
}

/** a soft round blush, transparent at the rim so it has no edge to see */
function blushCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  /* The sculpt's blush is a strong pink oval, not a hint: it is the second
     thing the eye reads after the eyes themselves, and at 0.62 it disappeared
     into a face that is already pale cream. */
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(233,132,124,0.86)');
  r.addColorStop(0.55, 'rgba(233,140,130,0.46)');
  r.addColorStop(1, 'rgba(233,140,130,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/** the cape: a vertical wash from leaf green at the shoulders to lake blue at
    the hem — the one gradient the official sculpt carries that cloth alone
    cannot fake, because the two colours sit on the same continuous surface. */
function capeCanvas() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#8fae6e');
  grad.addColorStop(0.55, '#8cb59a');
  grad.addColorStop(1, '#9fc4dc');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  return c;
}

function canvasTex(canvas, { flipY = true, repeat = null, offset = null } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = flipY;
  t.anisotropy = 4;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  if (offset) t.offset.set(offset[0], offset[1]);
  return t;
}

/* a curved patch of a sphere, used for everything printed on the face */
function patch(radius, phiMid, thetaMid, halfW, halfH, segW = 16, segH = 14) {
  const g = new THREE.SphereGeometry(
    radius, segW, segH,
    phiMid - halfW, halfW * 2,
    thetaMid - halfH, halfH * 2,
  );
  return new THREE.Mesh(g, null);
}

export function createNahida({ height = NOMINAL, x = 0, y = 0, z = 0 } = {}) {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  root.scale.setScalar(height / NOMINAL);

  const materials = [];
  const M = (opt) => { const m = new THREE.MeshStandardMaterial({ toneMapped: true, ...opt }); materials.push(m); return m; };

  const matSkin = M({ color: C.skin, roughness: 0.74, metalness: 0 });
  const matSkinDark = M({ color: C.skinDark, roughness: 0.78, metalness: 0 });
  /* HAIR IS NOT A MIRROR, AND IT IS NOT BLACK IN SHADOW EITHER.

     At roughness 0.42 the hair was a shiny white shell whose underside — which
     is what you see of a fringe from the front — went to a dark blue-grey, so
     the centre lobe read as a stripe drawn down her nose rather than as a lock
     of hair. Two changes, and they are the same change: 0.58 takes the polish
     off (which is also the 搪胶 look the sculpt has — soft vinyl, not lacquer),
     and a small constant emissive stands in for the light that a translucent
     material scatters back out. It is *small*: at 0.28 of a dark warm grey it
     lifts the shadowed side by about 0x12 a channel, which is the difference
     between grey and off-white and not enough to clip the lit side. */
  const HAIR_FILL = { roughness: 0.58, metalness: 0.02, emissive: 0x484642, emissiveIntensity: 0.45 };
  const matHair = M({ color: C.hair, ...HAIR_FILL });
  const matHairDark = M({ color: C.hairDark, ...HAIR_FILL });
  /* white is the *base* and the attribute carries the colour: with
     `vertexColors` three multiplies material.color by the attribute, so a
     material that is not white would tint the whole strand, tips included */
  const matHairTip = M({ color: 0xffffff, ...HAIR_FILL, vertexColors: true });
  const matShirt = M({ color: C.shirt, roughness: 0.72, metalness: 0 });
  const matShirtBoth = M({ color: C.shirt, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
  const matShirtDark = M({ color: C.shirtDark, roughness: 0.76, metalness: 0 });
  const matCollar = M({ color: C.collar, roughness: 0.66, metalness: 0 });
  /* the gown skirt: smooth woven white, no plaid. flatShading comes off — the
     gentle vertical waves are the only relief the cloth needs, and averaged
     normals read as silk where a triangle wave needed the faceting. */
  const matSkirt = M({ color: C.skirt, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  const matSkirtInner = M({ color: C.skirtInner, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  const matCape = M({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, map: canvasTex(capeCanvas()) });
  const matSilver = M({ color: C.silver, roughness: 0.35, metalness: 0.55 });
  const matShoeWhite = M({ color: C.shoe, roughness: 0.5, metalness: 0.05 });
  const matLeaf = M({ color: C.leaf, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  const matLeafLit = M({ color: C.leafLit, roughness: 0.66, metalness: 0, side: THREE.DoubleSide });
  const matLeafDeep = M({ color: C.leafDeep, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  const matGold = M({ color: C.gold, roughness: 0.34, metalness: 0.28 });

  /* the three that the room's `tint` is allowed to touch, and nothing else.
     0.08, not 0.16: `studio` tints with a pale grey, and an emissive that
     brightens a mid-green leaf is the fastest way to make her foliage read as
     fog. The tint should be a glow in the black box, not a lift everywhere. */
  const leafMats = [matLeaf, matLeafLit, matLeafDeep];
  for (const m of leafMats) m.emissiveIntensity = 0.08;

  /* ---- where everything is. One block, so a proportion change is one edit.
     Three heads to the crown, not two: the first pass came out at 2.2 and read
     as a bobblehead rather than as a child — the ratio is the style, and it is
     the one number that has to be right before any detail is worth adding. ---- */
  const HEAD_R = 0.95, HEAD_Y = 4.96;
  /* 1.01, not 1.06. The shell is what the *silhouette* is, and at 1.06 the
     head read as a white ball with a face painted on the front of it — the
     hair was a full fifth of her head's width in every direction. The
     reference's hair is thick but it is hair on a skull, not a helmet, and the
     difference is 5 hundredths of a unit. */
  const HAIR_R = 1.01;
  const NECK_Y = 3.78;
  const SHOULDER_Y = 3.66, SHOULDER_X = 0.50;

  /* ============================ head ==================================== */
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  root.add(head);

  const skull = ball(HEAD_R, matSkin, 1, 1.03, 0.97, 30);
  head.add(skull);
  // a jaw, so the profile is not a perfect circle
  const jaw = ball(HEAD_R * 0.72, matSkin, 1, 0.86, 1.02, 20);
  jaw.position.set(0, -HEAD_R * 0.44, 0.04);
  head.add(jaw);

  /* ---- the ears. A pointed elf ear is the one thing about her head that a
     sphere cannot fake, and it is also the cheapest: one extruded outline per
     side, placed by a basis rather than by a chain of rotations.

     THE OUTLINE'S FRAME MATTERS MORE THAN THE OUTLINE, and the first version got
     it wrong in both axes and then in its size. It used to be turned 90 degrees
     about Y, which put the flat *sideways* and the long axis up-and-**backward**;
     from the front that is two small nubs behind her hair. Then the fix for that
     composed a roll about Z with a yaw about Y, and composing rotations is how
     you get a shape whose frame you cannot state — measured on screen the ear
     came back a broad triangular fin pointing sideways, and 0.96 of length on a
     0.95 sphere, i.e. as long as her head is wide.

     So the basis is written out: `growth` is the long axis (radial, tilted up),
     `nrm` is the flat's normal (forward and a little outward, so the ear is seen
     almost face-on the way the reference's is), and the width axis is their
     cross product. Length 0.51 and width 0.27 against a 0.95 head radius — the
     reference's ear is about half the head's radius long, slim, and rounded on
     its lower edge with a straighter upper edge, which is what `earShape` draws.
     The base sits at 0.90, inside the skull: a base that stops at the surface
     leaves a seam all the way round the ear, and a seam on a head this smooth is
     the one thing you cannot unsee. */
  function earShape() {
    const s = new THREE.Shape();
    s.moveTo(0.000, 0.000);
    s.bezierCurveTo( 0.125,  0.030,  0.150,  0.200,  0.100,  0.340);
    s.bezierCurveTo( 0.068,  0.430,  0.030,  0.500, -0.010,  0.500);
    s.bezierCurveTo(-0.062,  0.490, -0.108,  0.310, -0.115,  0.160);
    s.bezierCurveTo(-0.120,  0.050, -0.070, -0.015,  0.000,  0.000);
    s.closePath();
    return s;
  }
  const EAR_TILT = 0.42;                       // radians above the horizontal
  const UP = new THREE.Vector3(0, 1, 0);
  for (const side of [-1, 1]) {
    const base = hp(side * 1.15, -0.10, 0.90);
    const growth = base.clone().normalize().multiplyScalar(Math.cos(EAR_TILT))
      .addScaledVector(UP, Math.sin(EAR_TILT)).normalize();
    const nrm = new THREE.Vector3(side * 0.42, 0.06, 0.90);
    nrm.addScaledVector(growth, -nrm.dot(growth)).normalize();
    const width = new THREE.Vector3().crossVectors(growth, nrm).normalize();
    const e = plate(earShape(), 0.055, matSkin, { bevel: 0.022 });
    e.position.copy(base);
    e.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(width, growth, nrm));
    head.add(e);
  }

  /* ---- the face. phi = pi/2 is straight ahead; theta grows downward.
     The eyes are pulled in toward the middle (0.33, not 0.40) and made a
     little smaller, because a patch that wraps to 0.70 rad is already at the
     hair window's edge — and at the oblique vantage the page actually uses, the
     outer eye then compresses into a dark sliver while the inner one stays
     round. Same texture, same unlit material: the asymmetry was purely UV
     compression at a grazing angle, so the cure is to stop grazing. ---- */
  const FRONT = Math.PI / 2;
  /* 0.34 / 0.30 / 0.342, and the two half-widths are a budget rather than a
     taste. The hair's front window is +-0.66, so an eye centred at 0.34 with a
     half-width of 0.30 has its inner edge 0.04 from the centreline (a visible
     gap between the two eyes) and its outer edge 0.64 — just inside the window.
     Widening either one puts the outer lid *under* the hair, which is how the
     first pass ended up with one eye round and one a sliver. The canvas aspect
     256:292 = 0.877 is matched by 0.30:0.342, so the drawing is not stretched. */
  const EYE_YAW = 0.34, EYE_TH = Math.PI / 2 + 0.30;
  const eyeHalfW = 0.315, eyeHalfH = 0.359;

  const eyeTexOpen = canvasTex(eyeCanvas(true));
  const eyeTexShut = canvasTex(eyeCanvas(false));

  const eyes = [];
  for (const side of [-1, 1]) {
    const mat = new THREE.MeshBasicMaterial({ map: eyeTexOpen, transparent: true, toneMapped: true });
    const e = patch(HEAD_R * 1.004, FRONT + side * EYE_YAW, EYE_TH, eyeHalfW, eyeHalfH);
    e.material = mat;
    e.renderOrder = 2;
    head.add(e);
    eyes.push({ mesh: e, mat });
  }

  const blush = [];
  for (const side of [-1, 1]) {
    const mat = new THREE.MeshBasicMaterial({
      map: canvasTex(blushCanvas()), transparent: true, opacity: 0.75, depthWrite: false, toneMapped: true,
    });
    const b = patch(HEAD_R * 1.003, FRONT + side * 0.60, Math.PI / 2 + 0.50, 0.17, 0.13, 10, 8);
    b.material = mat;
    b.renderOrder = 2;
    head.add(b);
    blush.push(b);
  }

  /* The mouth was 0.115 x 0.086 radians of a 0.95 sphere -- about 13 x 10 page
     pixels at the default vantage -- carrying a 160 x 120 canvas. That is a
     twelve-to-one minification, so the 9-pixel stroke in the canvas arrived on
     screen as three quarters of a pixel and averaged itself into the skin. The
     proof was to paint it magenta at lineWidth 26 and screenshot it: what came
     back was a single dot. A face needs a mouth you can see, so the patch is
     bigger and the stroke is heavier -- the eye patches survive the same
     treatment because they were always drawn big and bold. */
  const mouthMatShut = new THREE.MeshBasicMaterial({
    map: canvasTex(mouthCanvas(false)), transparent: true, depthWrite: false, toneMapped: true,
  });
  const mouthMatOpen = new THREE.MeshBasicMaterial({
    map: canvasTex(mouthCanvas(true)), transparent: true, opacity: 0, depthWrite: false, toneMapped: true,
  });
  const mouth = patch(HEAD_R * 1.006, FRONT, Math.PI / 2 + 0.68, 0.20, 0.13, 14, 12);
  mouth.material = mouthMatShut;
  mouth.renderOrder = 3;
  head.add(mouth);
  const mouth2 = patch(HEAD_R * 1.007, FRONT, Math.PI / 2 + 0.68, 0.20, 0.13, 14, 12);
  mouth2.material = mouthMatOpen;
  mouth2.renderOrder = 3;
  head.add(mouth2);

  /* ============================ hair ==================================== */
  const hair = new THREE.Group();
  head.add(hair);

  // the cap: full azimuth, and it stops *above* the hairline on purpose — the
  // fringe below is what covers the forehead, because a shell can only end in a
  // ring and a ring is a bowl cut.
  // 1.004x, because `back` overlaps it between theta 47 and 72 degrees and two
  // shells at exactly the same radius z-fight — which drew a hard band across
  // the back of her head and read as a seam in the hair.
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(HAIR_R * 1.004, 30, 20, 0, TAU, 0, Math.PI * 0.40), matHair);
  cap.castShadow = true;
  // a taller dome: the reference's hair puffs *above* the crown, and a sphere
  // has no way to say that. Scaling the cap alone (not the hair group) lifts the
  // crown without pushing the fringe forward, which is the axis that matters —
  // a helmet is a shell that is too big at the front, not one that is too tall.
  cap.scale.set(1, 1.09, 1);
  hair.add(cap);
  /* the back and sides: everything except a window at the front, down past the ear.

     THE WINDOW'S EDGES ARE TWO STRAIGHT VERTICAL LINES ON HER FACE, and at
     +-0.66 of phi they were drawn *inside* the cheek — which is what the bare
     skin read as: a tan rectangle 61 per cent of the head's width with hard
     sides. A meridian seen from the front is a straight line, so the only two
     options are to move it out to where the head turns away (it stops being an
     edge at all) or to lay something over it. This does both: +-0.78 puts it
     just outside the eye's outer corner at 0.655, and the face-framing locks
     below sit on the seam rather than beside it. */
  const back = new THREE.Mesh(
    new THREE.SphereGeometry(HAIR_R, 30, 18, FRONT + 0.78, TAU - 1.56, Math.PI * 0.26, Math.PI * 0.52),
    matHair);
  back.castShadow = true;
  hair.add(back);
  /* A shell over the forehead, *under* the fringe. Two jobs, and the second one
     is the reason it is `matHairDark`.

     Without it the gaps between the lobes went all the way down to skin, and
     five separate locks on a bare forehead is five separate locks on a bare
     forehead — the grooves read as gaps rather than as creases.

     And with it in plain white, the lobes *still* did not read: a groove shows
     the shell behind it, white on white, so the fringe came back as one smooth
     mass with a curved lower edge and no lobes in it at all. A crease is visible
     because it is darker, and here the thing that makes it darker is what is at
     the bottom of it. One step down the palette is the whole difference between
     a fringe and a bowl cut. The shell also sits at 0.97 of the hair radius
     rather than on it, so the grooves are 0.145 deep instead of 0.110.

     Its lower edge is the *hairline*, so it is placed against the brow rather
     than against the eye: the brow is drawn at 9 to 20 per cent down the eye
     patch, which is latitude -0.005 to -0.084, and the shell stops at -0.016.
     Anything higher and the grooves show a band of forehead; anything lower and
     it eats the eyebrow. */
  const forehead = new THREE.Mesh(
    new THREE.SphereGeometry(HAIR_R * 0.97, 30, 16, FRONT - 0.80, 1.60, Math.PI * 0.28, Math.PI * 0.225),
    matHairDark);
  forehead.castShadow = true;
  hair.add(forehead);
  // a soft nape, so the hairline at the back of the neck is not a hard cut
  const nape = ball(HAIR_R * 0.94, matHair, 1, 0.72, 1);
  nape.position.set(0, -HAIR_R * 0.52, -HAIR_R * 0.34);
  hair.add(nape);

  /* ---- the fringe: five thick locks, not eleven thin ones ----

     The previous pass built the fringe out of eleven flat leaf-shaped strands,
     and that was the wrong *construction*, not the wrong tuning. The sculpt has
     five big rounded lobes with a part down the middle and a deep groove
     between each pair, because a lock of hair in ZBrush is a curve thickened
     into a tube and rounded off — not a flat ribbon lying on the skull. So the
     fringe is five curves now, each one authored as (yaw, latitude) pairs on
     the hair sphere and swept by `lock`.

     The latitudes are the numbers worth checking, because they are the ones
     that decide whether she has a face. Latitude 0 is the equator of the hair
     sphere and the top of the eye sits at +0.035, so a lobe ending at -0.16
     hangs across the middle of the eye, which is what the reference's centre
     lobe does. The outer pair ends lower and further out, beside the cheek.

     The lobes are deliberately *wider than they are deep* (`flat` 1.28). At a
     circular cross-section the grooves between them close up and the fringe
     becomes one smooth helmet — the exact failure the leaf version had, in the
     other direction. */
  const bangs = new THREE.Group();
  hair.add(bangs);
  /* TWO NUMBERS, AND BOTH WERE WRONG IN THE SAME DIRECTION THE FIRST TWO TIMES.

     `WIDE` is how wide a lock is across the skull and `DEEP` is how far it
     stands off it. The first pass had round locks of radius 0.12: at 0.30 of
     arc between neighbours against 0.25 of diameter every groove went all the
     way down to the skin, so the fringe came back as five fingers with a bare
     forehead between them. Widening them to 0.19 closed the grooves and produced
     the *second* failure — a helmet. 0.19 of round tube on a 1.01 sphere stands
     a quarter of the skull's radius proud of it, and a fringe that thick has no
     face underneath it.

     The reference is neither. It is **flat relief on the skull**: lobes about
     0.4 as deep as they are wide, so they read as hair combed over a head rather
     than as a shell built around one. So a lock is 0.16 * `WIDE` across and
     0.16 * `DEEP` deep, which is 0.43 wide by 0.18 deep — wide enough that
     neighbours overlap 1.6x and the seams close into grooves, shallow enough
     that the mass hugs the skull. */
  const WIDE = 1.28, DEEP = 0.55;
  /* THE RING RADIUS IS WHERE THE LOCK SITS, AND IT IS NOT `HAIR_R`.
     A lock's cross-section is an ellipse whose *radial* semi-axis is
     `rad * DEEP` — 0.118 at the numbers below. Put its centre on the shell and
     half the ellipse is buried while the other half stands 0.118 proud; the
     numbers that actually fall out of `HAIR_R + 0.005` are:
       outer surface  1.015 + 0.118 = 1.133   -> 0.119 proud of the 1.01 shell
       inner surface  1.015 - 0.118 = 0.897   -> buried inside the skull
       width where it meets the shell          0.550, on a 1.01 head radius
     0.119 of stand-off against 0.550 of width is 0.22 — the reference's ratio.
     Deep enough that the grooves between the lobes are real creases, shallow
     enough that this is hair combed over a skull, not a shell around one. */
  const FR = HAIR_R + 0.005;
  /* WHERE THE TIPS END IS THE WHOLE FACE BUDGET.

     The eye patch runs from latitude +0.059 (its top) down to -0.659, and it is
     0.63 of yaw wide, centred at 0.34. So a lobe that reaches -0.26 at yaw 0.72
     is not "falling beside the eye" — at the eye's own top edge it is already
     0.40 of the way across it, and the previous pass buried both eyes under the
     fringe and read as a white ball with a slit in it.

     The tips are therefore pushed outward past the eye's outer corner (yaw 0.84
     / 1.30), which is where the reference's are: its fringe stops at the
     eyebrows and the only lock that comes lower is the centre one, which
     belongs between her eyes and nowhere else.

     AND THE GAPS BETWEEN THEM ARE WHAT MAKES THE LOBES READ. Measured on the
     previous pass, at the level of the eyes the covered yaw ranges were
     [-0.19, 0.19], [0.43, 0.81] and [0.77, 1.14] — so there were two 0.24-wide
     holes over the forehead, and what showed through them was the shell behind.
     Too-wide lobes are a helmet; lobes with a hole between them are a fringe.
     These numbers leave a 0.14 groove instead, which is a crease rather than a
     window. */
  const FRINGE = [
    // yaw at the root, yaw at the tip, latitude at the root, at the tip, radius
    [ 0.00,  0.02, 0.92, -0.28, 0.165],   // centre: ends between the eyes
    [-0.22, -0.88, 0.84, -0.20, 0.215],
    [ 0.22,  0.88, 0.84, -0.20, 0.215],
    [-0.54, -1.32, 0.74, -0.16, 0.195],
    [ 0.54,  1.32, 0.74, -0.16, 0.195],
  ];
  for (const [yawR, yawT, latR, latT, rad] of FRINGE) {
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const u = i / 4;
      /* yaw eases in on a power above 1 and latitude on one below it: the lock
         leaves the crown steeply and then swings *outward* as it falls, which
         is the shape that makes the tips flare away from the face instead of
         hanging straight down like a curtain. */
      const yaw = yawR + (yawT - yawR) * Math.pow(u, 1.4);
      const lat = latR + (latT - latR) * Math.pow(u, 0.80);
      pts.push(hp(yaw, lat, FR));
    }
    const m = new THREE.Mesh(lock(new THREE.CatmullRomCurve3(pts), {
      segs: 30, rad, cols: 18, flat: WIDE, deep: DEEP, taper: 0.34, capA: 0.9, capB: 1.0,
      out: 'radial',
    }), matHair);
    m.castShadow = true;
    bangs.add(m);
  }

  /* Two long locks framing the face, and they are *on* the seam rather than
     beside it. The seam is the `back` sphere's phi window edge at FRONT +- 0.78,
     which runs from polar 46.8 to 140.4 degrees — latitude +0.63 down to -0.63.
     A lock hinged above the top of it and long enough to pass its bottom is the
     only shape that covers it end to end; anything shorter leaves the upper
     third showing as a straight vertical line on a ball, which is the one thing
     that reads as a cut-out rather than as a face. So the hinge is at 0.70 of
     latitude and the tip at -1.00, and the yaw runs 0.82 -> 1.02 so the lock's
     own width (0.38) straddles 0.78 all the way down. They are also the pair
     that goes green: the last third of each is sage, as in the reference. */
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      pts.push(hp(side * (0.82 + 0.20 * u * u), 0.70 - 1.70 * Math.pow(u, 0.92), FR));
    }
    const g = lock(new THREE.CatmullRomCurve3(pts), {
      segs: 34, rad: 0.165, cols: 16, flat: 1.15, deep: 0.55, taper: 0.26, capA: 0.9, capB: 1.0,
      out: 'radial',
    });
    tipPaint(g, (i) => g.attributes.uv.getY(i), 0.32, C.hairTip);
    const m = new THREE.Mesh(g, matHairTip);
    m.castShadow = true;
    hair.add(m);
  }

  /* ...and a short thick tuft beside each ear. It is short and thick on
     purpose: at 0.075 of radius it read as a stray wire lying across her cheek,
     which is the one thing in this whole build that looked like a bug. It sits
     outboard of the face-framing lock rather than under it, because two locks
     in the same place is one lock with a seam through it. */
  for (const side of [-1, 1]) {
    const pts = [
      hp(side * 1.16, 0.22, HAIR_R + 0.020),
      hp(side * 1.25, 0.00, HAIR_R + 0.022),
      hp(side * 1.34, -0.22, HAIR_R + 0.024),
    ];
    hair.add(new THREE.Mesh(lock(new THREE.CatmullRomCurve3(pts), {
      segs: 16, rad: 0.105, cols: 12, flat: 1.10, deep: 0.55, taper: 0.30, capA: 0.9, capB: 1.0,
      out: 'radial',
    }), matHairDark));
  }

  /* ---- the ponytail: HIGH on her left, and it is the thing that moves most —
     so it hangs off its own group and is driven by a lagged copy of the body's
     motion (see update).

     It used to be tied low at the nape. The reference's is tied up near the
     crown and falls almost to her waist, which is not a taste difference: a low
     tail is a shape at the back of the head, a high one is a shape *beside* the
     head, and only the second one survives being seen from the front.

     The first pass at that got the height right and the *direction* wrong: it
     climbed out to x 0.68 at head height before turning down, which from the
     front is a horn, not a ponytail. It has to clear the skull by the width of
     its own tie and then fall — so the outbound leg is short (0.30 at most) and
     everything after it is descent. */
  /* The pivot is a *point on the hair sphere*, not a pair of coordinates that
     looked about right. At `(0.58, 0.46, -0.30)` times HAIR_R its distance from
     the head's centre is 0.80 against a hair radius of 1.01, so the first third
     of the tail — the thickest third, 0.28 of radius — was buried inside the
     hair and the whole thing was invisible from every angle except straight on.
     Normalising the direction and multiplying by HAIR_R puts the tie on the
     surface where a tie goes. */
  const tailPivot = new THREE.Group();
  tailPivot.position.set(HAIR_R * 0.73, HAIR_R * 0.58, -HAIR_R * 0.38);
  hair.add(tailPivot);

  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.00, 0.00, 0.00),
    new THREE.Vector3(0.10, 0.22, -0.13),
    new THREE.Vector3(0.22, -0.22, -0.21),
    new THREE.Vector3(0.30, -0.86, -0.18),
    new THREE.Vector3(0.28, -1.50, -0.06),
    new THREE.Vector3(0.18, -2.06, 0.08),
    new THREE.Vector3(0.06, -2.44, 0.18),
  ]);
  /* The tail is *one thick lock*, and that is a change of construction rather
     than of size. It used to be a taper that ended in a disc with a ball parked
     on the end to hide it — and a ball parked on the end of a taper leaves a
     crease all the way round where the two surfaces meet, which is exactly what
     it looked like. `lock` closes the same sweep with a real dome, so the tip is
     one continuous surface, and the profile keeps the lock nearly full width for
     most of its length before it closes, which is what the reference does. */
  const tailGeom = lock(tailCurve, {
    segs: 40, rad: 0.315, cols: 16, flat: 0.92,
    prof: (t) => 0.94 + 0.06 * Math.sin(Math.PI * t), taper: 0.42,
    capA: 0.8, capB: 1.15,
  });
  tipPaint(tailGeom, (i) => tailGeom.attributes.uv.getY(i), 0.58, C.hairTip);
  const tail = new THREE.Mesh(tailGeom, matHairTip);
  tail.castShadow = true;
  tailPivot.add(tail);

  /* A helical ridge wound around the tail's lower two thirds. The reference's
     tail is not a smooth cone: it has one long twist running down it, which is
     what tells the eye it is a bundle of hair rather than a piece of soft
     serve. `ropeStrand` already knows how to wind a centreline around a curve
     on that curve's own frame, so the ridge is the braid's own maths with a
     wider winding radius — wide enough to ride the tail's surface (0.60 of the
     radius passed in, so 0.52 here lands the winding at 0.31 against a lock
     radius of 0.30) and not so wide that it floats. */
  const ridgeGeom = lock(ropeStrand(tailCurve, 44, 0.52, 2.3, 0), {
    segs: 64, rad: 0.082, cols: 10, flat: 0.9, taper: 0.30, capA: 0, capB: 1.0,
  });
  tipPaint(ridgeGeom, (i) => ridgeGeom.attributes.uv.getY(i), 0.52, C.hairTip);
  const ridge = new THREE.Mesh(ridgeGeom, matHairTip);
  ridge.castShadow = true;
  tailPivot.add(ridge);

  /* Two thin locks down the outside, so the tail's silhouette is not one arc.
     They hang off the same curve rather than being parked beside it, so they
     follow it when the tail swings. */
  for (const [side, off, sc] of [[1, 0.72, 1.0], [-1, 0.62, 0.78]]) {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = 0.16 + 0.80 * (i / 6);
      const p = tailCurve.getPoint(t).clone();
      const q = tailCurve.getPoint(Math.min(1, t + 0.02));
      const tang = q.sub(tailCurve.getPoint(Math.max(0, t - 0.02))).normalize();
      const side3 = new THREE.Vector3(0, 1, 0).cross(tang).normalize();
      p.addScaledVector(side3, side * 0.30 * sc * (0.4 + 0.6 * (i / 6)));
      pts.push(p);
    }
    const g = lock(new THREE.CatmullRomCurve3(pts), {
      segs: 26, rad: 0.075 * sc, cols: 10, flat: 1.0, taper: 0.45, capA: 0.9, capB: 1.0,
    });
    tipPaint(g, (i) => g.attributes.uv.getY(i), 0.55, C.hairTip);
    const m = new THREE.Mesh(g, matHairTip);
    m.castShadow = true;
    tailPivot.add(m);
  }

  /* ---- the braid, on the other side. A rope: two strands wound around one
     curve on that curve's own frame. It is the detail that stops her reading as
     "white bob with a tail" from the front-left, and it is 6 lines because the
     maths of a rope is the maths of a rope.

     The curve is *projected onto the hair* — every control point normalised to
     just outside HAIR_R — for the same reason the tail pivot is: a braid wound
     through the middle of the head is not a braid. Its first pass ran at radius
     0.82 to 1.02 and only the last two inches ever came out. */
  const braidCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.30, 0.94, 0.20),      // over the crown, just off centre
    new THREE.Vector3(-0.72, 0.74, 0.29),
    new THREE.Vector3(-0.98, 0.22, 0.23),
    new THREE.Vector3(-1.01, -0.32, 0.07),
    new THREE.Vector3(-0.86, -0.78, -0.10),
  ]);
  for (const phase of [0, Math.PI]) {
    /* Two rope strands, each swept as a `lock` rather than as a bare tube: a
       braid whose strands end in flat discs looks frayed at the tip, and the
       whole point of a braid is that it ends in a rounded point. */
    const g = lock(ropeStrand(braidCurve, 34, 0.150, 3.0, phase), {
      segs: 62, rad: 0.086, cols: 10, flat: 1.0, taper: 0.32, capA: 0.8, capB: 1.0,
    });
    tipPaint(g, (i) => g.attributes.uv.getY(i), 0.42, C.hairTip);
    const m = new THREE.Mesh(g, matHairTip);
    m.castShadow = true;
    hair.add(m);
  }

  /* ============================ the ornaments ==========================
     The official sculpt ties the ponytail with a white bow, not a clover —
     two wing blades splayed left and right, a knot bead between them, two
     short tails hanging. The leaf clip over the other ear stays. `crown` is
     still the name of the group the beat trembles, because it is still the
     ornament on her head. */
  const crown = new THREE.Group();
  crown.position.set(HAIR_R * 0.74, HAIR_R * 0.60, -HAIR_R * 0.38);
  hair.add(crown);
  for (const side of [-1, 1]) {
    const wing = leafMesh(0.30, 0.20, matShirtBoth, { curve: 0.16 });
    wing.rotation.set(-0.55, side * 0.5, side * 2.25);
    wing.position.set(side * 0.09, 0.02, 0.02);
    crown.add(wing);
    const tail = leafMesh(0.26, 0.09, matShirtBoth, { curve: 0.30 });
    tail.rotation.set(-0.2, side * 0.25, side * 0.55 + 0.35);
    tail.position.set(side * 0.07, -0.16, 0.03);
    crown.add(tail);
  }
  const knot = ball(0.085, matShirtBoth, 1.15, 1, 0.7, 12);
  knot.position.set(0, 0.02, 0.03);
  crown.add(knot);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.026, 6, 16), matGold);
  ring.rotation.set(1.15, 0, 0);
  ring.position.set(0, -0.10, 0.05);
  crown.add(ring);

  const clip = new THREE.Group();
  clip.position.set(-HAIR_R * 0.90, HAIR_R * 0.06, -0.06);
  clip.rotation.set(0, -0.5, 0.35);
  hair.add(clip);
  for (const [rot, len, mat] of [[-0.5, 0.34, matLeafDeep], [0.35, 0.28, matLeaf]]) {
    const lf = leafMesh(len, 0.19, mat, { curve: 0.20 });
    lf.rotation.set(-0.4, 0, rot);
    clip.add(lf);
  }

  /* ============================ body ==================================== */
  const body = new THREE.Group();
  root.add(body);

  const neck = limb(new THREE.Vector3(0, NECK_Y - 0.28, 0), new THREE.Vector3(0, NECK_Y + 0.24, 0), 0.24, 0.21, matSkin);
  body.add(neck);

  /* the shirt: a lathe, because a torso is a profile, not a cylinder. The
     numbers are (radius, y) — and they run *upward*, which is load-bearing:
     LatheGeometry winds its faces from the order the points arrive in, so a
     profile written top-down comes out inside-out and is culled to nothing.
     The first pass wrote the skirt that way and the skirt did not exist.

     The bottom is at 2.40 rather than 2.34 because the skirt's waistband is at
     2.46 and its radius (0.52) has to enclose the shirt's (0.44): a shirt that
     ends *below* the waistband pokes through it. */
  const bodiceProfile = [
    [0.44, 2.40], [0.50, 2.60], [0.48, 2.80], [0.53, 3.02],
    [0.62, 3.24], [0.60, 3.44], [0.42, 3.62], [0.24, 3.74],
  ].map(([r, yy]) => new THREE.Vector2(r, yy));
  const bodice = new THREE.Mesh(new THREE.LatheGeometry(bodiceProfile, 26), matShirt);
  bodice.castShadow = true;
  body.add(bodice);

  /* radius of the shirt at a height, so anything laid *on* the shirt can be
     placed on it rather than in front of it. The tie and the pocket both need
     this, and both were floating slabs until they got it. */
  function shirtR(y) {
    const p = bodiceProfile;
    if (y <= p[0].y) return p[0].x;
    for (let i = 1; i < p.length; i++) {
      if (y <= p[i].y) {
        const k = (y - p[i - 1].y) / (p[i].y - p[i - 1].y);
        return lerp(p[i - 1].x, p[i].x, k);
      }
    }
    return p[p.length - 1].x;
  }

  /* ---- the collar. The official sculpt has no shirt collar and no tie: a
     deep green band standing at the throat, one leaf-green gem on the sternum,
     and a green blade lying on each shoulder. That is the whole decoration —
     the gown is otherwise clean, and everything the tie/placket/pocket did is
     deleted with them. ---- */
  const collarBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.32, 0.20, 22, 1, true), matCollar);
  collarBand.position.y = 3.72;
  body.add(collarBand);
  const gem = ball(0.085, matLeaf, 1, 1.25, 0.7, 12);
  gem.position.set(0, 3.50, shirtR(3.50) + 0.05);
  body.add(gem);
  const gemSet = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.02, 6, 14), matGold);
  gemSet.rotation.x = 0.28;
  gemSet.position.set(0, 3.50, shirtR(3.50) + 0.048);
  body.add(gemSet);
  for (const side of [-1, 1]) {
    const ep = leafMesh(0.46, 0.30, matLeaf, { curve: 0.26 });
    ep.position.set(side * 0.34, 3.62, 0.08);
    ep.rotation.set(-0.55, side * 0.15, side * -1.30);
    body.add(ep);
  }

  /* ---- the skirt. The official gown: one smooth white A-line ending above
     the knee — the shins and the sandals are half the look — with a petal
     hem (few folds, deep waves) and the green lining showing underneath. ---- */
  const skirt = new THREE.Mesh(pleatedSkirt({
    rTop: 0.50, rBot: 1.26, yTop: 2.46, yBot: 1.50, folds: 14, depth: 0.115, rows: 8,
  }), matSkirt);
  skirt.castShadow = true;
  body.add(skirt);
  /* the lining: a green cone just inside and below the hem, so the skirt's
     underside reads leaf green wherever it lifts — standing still it shows as
     a thin green rim, on a spin it reads as the whole inner face. */
  const lining = new THREE.Mesh(
    new THREE.CylinderGeometry(1.29, 1.12, 0.26, 30, 1, true), matSkirtInner);
  lining.position.y = 1.44;
  body.add(lining);
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.545, 0.525, 0.10, 26, 1, true), matCollar);
  waist.position.y = 2.45;
  body.add(waist);

  /* ---- the cape: two wing-shaped panels off the shoulder blades, green
     washing to blue down their length. They end mid-skirt — the sculpt's
     wings do not reach the floor — and splay outward like leaves at rest. ---- */
  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(0.95, 1.90, 6, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);          // y: +0.95 top .. -0.95 hem
      const t = 1 - (y + 0.95) / 1.90;             // 0 at shoulder, 1 at hem
      const flare = 1 + 0.75 * t * t;              // hem spreads to 1.75x
      p.setX(i, x * flare);
      p.setZ(i, -0.30 * t * t - 0.12 * (x / 0.39) * (x / 0.39) * t);
      p.setY(i, y - 0.20 * t * t);                 // hem rides up a touch: it lifts, not drags
    }
    g.computeVertexNormals();
    const cape = new THREE.Mesh(g, matCape);
    cape.position.set(side * 0.40, 2.62, -0.40);
    cape.rotation.set(0.16, side * 0.30, side * 0.34);
    cape.castShadow = true;
    body.add(cape);
    /* the shoulder mount: a green wedge so the cloth grows out of the body
       instead of floating behind it */
    const mount = leafMesh(0.30, 0.20, matLeaf, { curve: 0.24 });
    mount.position.set(side * 0.36, 3.52, -0.18);
    mount.rotation.set(-1.9, 0, side * -0.9);
    body.add(mount);
  }

  /* arms. Kept off the body group so a wave can move the whole chain, and hung
     *outside* the shirt's radius so the hands are never buried in the skirt. */
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
    body.add(pivot);

    const upper = limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.09, -0.60, 0.05), 0.135, 0.115, matSkin);
    pivot.add(upper);
    /* a short sleeve, and it now has a *hem*: the first version was one cone,
       which reads as a bare shoulder with a stripe on it. The flared cuff is
       what makes it a sleeve. */
    const sleeve = limb(new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(side * 0.05, -0.32, 0.03), 0.215, 0.165, matShirt);
    pivot.add(sleeve);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.036, 8, 18), matShirt);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(side * 0.05, -0.32, 0.03);
    pivot.add(cuff);

    const fore = new THREE.Group();
    fore.position.set(side * 0.09, -0.60, 0.05);
    pivot.add(fore);
    const lower = limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.05, -0.54, 0.08), 0.115, 0.095, matSkin);
    fore.add(lower);
    const hand = ball(0.14, matSkin, 1, 1.1, 0.85, 12);
    hand.position.set(side * 0.05, -0.60, 0.09);
    fore.add(hand);
    /* the bangle: one silver ring instead of the striped wristband */
    const bangle = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.040, 8, 18), matSilver);
    bangle.rotation.x = Math.PI / 2;
    bangle.position.set(side * 0.04, -0.46, 0.07);
    fore.add(bangle);

    arms.push({ pivot, fore, side });
  }

  /* legs: short and bare all the way down — no socks, no loafers. The official
     sculpt is barefoot with white sandals: a strap across the instep and a
     gold ring above the ankle. */
  const legs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.22, 1.32, 0);
    body.add(pivot);
    const shin = limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.02, -1.08, 0.03), 0.165, 0.135, matSkin);
    pivot.add(shin);
    // the foot: skin, toes forward
    const foot = ball(0.175, matSkin, 0.94, 0.62, 1.72, 14);
    foot.position.set(side * 0.02, -1.14, 0.15);
    pivot.add(foot);
    // the sandal: a white strap over the instep, a gold ring at the ankle
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.055, 0.18), matShoeWhite);
    strap.position.set(side * 0.02, -1.07, 0.13);
    strap.castShadow = true;
    pivot.add(strap);
    const anklet = new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.028, 8, 16), matGold);
    anklet.rotation.x = Math.PI / 2;
    anklet.position.set(side * 0.02, -0.96, 0.03);
    pivot.add(anklet);
    legs.push({ pivot, side });
  }

  /* ============================ the aura ================================
     A fresnel shell around her head and hair: back faces only, brightest where
     the surface turns away from the lens, which is an edge drawn rather than
     lit.

     ** It is `NormalBlending`, not additive, and that is the whole trick. **
     Look at what the three rooms ask for: `studio` and `abyss` pass a *dark*
     rim (`0x2a2b1f`, `0x2e3a3a`) and only `noir` passes a warm one
     (`0xdcbe8c`). That is the page saying "in a white hall she needs a contour
     against the wall; in the black box she needs to glow". Additive can only
     ever do the second half — adding a dark colour adds nothing — so the
     contour was silently a no-op and she dissolved into the white hall. Under
     normal blending one shader does both: `mix(背景, rim, f·op)` darkens a
     light room and lightens a dark one, with no branch and no per-theme code.
     If the rim ever looks wrong in one room, the bug is the rim colour.

     It is deliberately *not* a shell around her whole body. The 2D version
     needed an outline because a cut-out has no form of its own. A solid figure
     is lit by the rig, and every rig on this page already has a rim light in
     it — so her body's edge is real and this is left for the part that has no
     hard edge to catch: hair. */
  const auraUniforms = {
    uColor: { value: new THREE.Color(C.leafLit) },
    uOpacity: { value: 0.4 },
  };
  /* The shell has to sit *just* outside the hair, and that is a number rather
     than a look. A fresnel shell peaks at its own silhouette, so a shell at
     1.22x draws its ring a fifth of a head out from the hair — which reads as a
     hoop floating around her, not as an edge (measured on the close-up: a soap
     bubble the width of her whole head).

     The shell is a *sphere* and her hair is not, so this radius is a compromise
     between two failures and both of them were seen on screen this pass. Too
     far out and the ring is drawn in mid-air, well clear of the cap — 1.10x
     gave a pale disc 1.22 times the head's width in 夜巢, which is a bubble and
     not a contour. Too far in and it is drawn across her forehead, because the
     fringe's outer surface is 1.133. 1.07x is 0.067 clear of the cap and
     *inside* the lobes: the ring then appears at the sides, where the hair
     really is 1.01, and the fringe simply draws over it at the front, which is
     what a contour is supposed to do. */
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(HAIR_R * 1.07, 26, 20),
    new THREE.ShaderMaterial({
      uniforms: auraUniforms,
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          /* The floor is the whole difference between a contour and a hairline.
             A bare fresnel is ~1 at the silhouette and ~0 a few pixels inside,
             so what it draws is a one-pixel line -- measured: a dip of 13 levels
             at 0.62 opacity, i.e. invisible in a white hall, and it took a
             deliberately absurd setting (power 1.0, shell 1.30, opacity 0.95) to
             prove the shader was even running. Lifting the floor to 0.70 makes
             the shell render at nearly constant alpha, so the visible annulus is
             a BAND whose width is the shell's radius and whose contrast is
             uOpacity alone. Two numbers, two separate jobs.
             (No backticks in here: this comment lives inside a JS template
             literal, and one backtick ends the string. node --check does not
             catch it -- the truncation still parses. esbuild does.) */
          f = 0.70 + 0.30 * pow(clamp(f, 0.0, 1.0), 2.0);
          gl_FragColor = vec4(uColor, f * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      blending: THREE.NormalBlending,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  aura.position.y = HEAD_Y;
  aura.scale.set(1, 1.10, 1);
  aura.renderOrder = -1;
  root.add(aura);

  /* ============================ the hit proxy ==========================
     Hovering and clicking are answered by one capsule, not by eighty meshes.
     Two reasons: a thin forearm makes a patchy target that is infuriating to
     hit, and the real meshes move every frame, so the target would wobble under
     the cursor. `material.visible = false` keeps it out of the render but the
     raycaster never looks at that flag — it only needs `material` to exist. */
  const hit = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.15, 3.6, 6, 14),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.y = 3.30;
  hit.scale.set(1, 1, 0.92);
  root.add(hit);

  /* ============================ animation ==============================
     Every state is an eased scalar and every motion is a function of those
     scalars, so nothing can pop: the transport can be pressed mid-word, the
     pointer can leave in the middle of a nod, and the worst case is a motion
     that is briefly between two amplitudes. */
  const st = {
    t: 0, sing: 0, hover: 0, lift: 0, aim: 0, aimX: 0, aimY: 0,
    beat: 0, sway: 0, blink: 0, nextBlink: 2.2,
    act: null,                       // { name, t, dur }
    tailSway: 0, tailSwayV: 0,
  };

  const ACTIONS = {
    // name: [duration, how it drives the pose]
    nod: [1.15, (p) => ({ headPitch: Math.sin(p * Math.PI * 1.6) * 0.30 })],
    wave: [1.85, (p) => {
      // the arm goes up over the first fifth, waves three times, comes down
      const up = smoothstep(0, 0.18, p) * (1 - smoothstep(0.84, 1, p));
      const w = Math.sin(p * Math.PI * 5.2) * up;
      return { armR: up, armRWave: w, headTilt: w * 0.10 };
    }],
    spin: [1.60, (p) => ({
      spin: easeInOut(p) * Math.PI * 2,
      hop: Math.sin(p * Math.PI) * 0.42,
    })],
    jump: [1.25, (p) => ({
      // crouch, launch, float, land — an asymmetric arc, not a sine
      hop: p < 0.22 ? -0.30 * Math.sin((p / 0.22) * Math.PI * 0.5)
        : Math.sin(((p - 0.22) / 0.78) * Math.PI) * 1.05,
      armsUp: p < 0.22 ? 0 : smoothstep(0.22, 0.40, p) * (1 - smoothstep(0.72, 1, p)),
    })],
    salute: [1.50, (p) => ({
      // hand to the brow, hold, and a small bow on the way out
      armR: smoothstep(0, 0.22, p) * (1 - smoothstep(0.76, 1, p)),
      armRBend: -1.5,
      bow: Math.sin(smoothstep(0.30, 0.70, p) * Math.PI) * 0.16,
    })],
  };

  function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

  return {
    root, hit, aura, materials, head, crown,
    /* Two read-only numbers, and the only reason they are on the outside is
       `tools/_sing.mjs`. It has to answer "is she singing, and does that move
       her more" from outside a closure, and the honest way to do that is to read
       the numbers `update` writes rather than to infer them from the picture —
       the picture is what burned this project once already (the probe used to
       measure her hover footprint, which was a proxy for her scale while she was
       a billboard and stopped meaning anything the day she became a solid).
       Nothing on the page reads these. */
    get sing() { return st.sing; },
    get bob() { return st.bob; },
    ready: true,

    /** a one-shot; re-pressing the same one restarts it, which is what a button
        you can hit twice should do */
    play(name) {
      const a = ACTIONS[name];
      if (!a) return false;
      st.act = { name, t: 0, dur: a[0] };
      return true;
    },
    get action() { return st.act ? st.act.name : null; },

    /* A room has exactly two ways in to her, and they are the two the 2D version
       had. `rim` / `rimOp` drive the aura — the same numbers, the same meaning,
       a different machine (see the header). `tint` lands on the *leaf* accents
       only, at a whisper: it is what stops her green reading as a sticker on a
       white plate in 晴室 and as a lamp in 夜巢, without recolouring the
       character herself. Nothing else about her is per-room, and that is
       deliberate — a figure whose skin changes colour with the wallpaper is a
       swatch, not a person. */
    setRoom(rim, rimOpacity, tint, k) {
      auraUniforms.uColor.value.lerp(rim, k);
      auraUniforms.uOpacity.value = lerp(auraUniforms.uOpacity.value, rimOpacity, k);
      for (const m of leafMats) m.emissive.lerp(tint, k);
    },

    /* `aimX` / `aimY` are the pointer's offset from her on screen, -1..1;
       `beat` is the audio envelope, 0..1; `beatOn` gates it so a silent page
       does not sway to a level that happens to be non-zero. */
    update(dt, { singing = false, hovered = false, aimX = 0, aimY = 0, beat = 0, beatOn = false } = {}) {
      st.t += dt;
      st.sing = damp(st.sing, singing ? 1 : 0, 3.0, dt);
      st.hover = damp(st.hover, hovered ? 1 : 0, 9.0, dt);
      st.lift = damp(st.lift, hovered ? 0.24 : 0, 7.0, dt);
      // the pointer is followed at a speed that makes her look *interested*
      // rather than wired to the mouse
      st.aim = damp(st.aim, (aimX || aimY) ? 1 : 0, 4.0, dt);
      st.aimX = damp(st.aimX, clamp(aimX, -1, 1), 5.5, dt);
      st.aimY = damp(st.aimY, clamp(aimY, -1, 1), 5.5, dt);
      st.beat = damp(st.beat, beatOn ? clamp(beat, 0, 1) : 0, 12.0, dt);

      const s = st.sing;

      /* ---- the one-shot, resolved into offsets ---- */
      let o = {};
      if (st.act) {
        st.act.t += dt;
        const p = clamp(st.act.t / st.act.dur, 0, 1);
        o = ACTIONS[st.act.name][1](p) || {};
        if (p >= 1) st.act = null;
      }

      /* ---- blinking: on a timer, and skipped while singing, because a singer
         with her eyes shut mid-phrase reads as asleep ---- */
      st.nextBlink -= dt;
      if (st.nextBlink <= 0) { st.blink = 0.13; st.nextBlink = 2.4 + Math.random() * 3.6; }
      if (st.blink > 0) {
        st.blink -= dt;
        const shut = st.blink > 0 && st.blink < 0.13;
        for (const e of eyes) e.mat.map = shut ? eyeTexShut : eyeTexOpen;
      }

      /* ---- the mouth: cross-faded on the beat while singing, shut otherwise.
         Two patches rather than a texture swap, because an open mouth has to
         *open* — a hard swap on every beat frame is a stutter, not a singer. --- */
      const openAmt = s * (0.20 + 0.80 * st.beat);
      mouthMatOpen.opacity = openAmt;
      mouthMatShut.opacity = 1 - openAmt * 0.72;
      mouth.visible = mouthMatShut.opacity > 0.02;

      /* ---- pose ---- */
      const speed = 1.05 + s * 1.45;
      const bob = Math.sin(st.t * speed) * (0.075 + s * 0.20) + (o.hop || 0);
      // kept on the state as well as used: it is the cleanest "is she moving
      // more because she is singing" signal, and the probe reads it (see below)
      st.bob = bob;
      const breath = 1 + Math.sin(st.t * speed * 1.34) * (0.014 + s * 0.030);
      const idleLean = Math.sin(st.t * speed * 0.61) * (0.5 + s * 1.6);

      // the pointer turns her head, and the body follows at a third of it —
      // a head that turns alone looks like a surveillance camera
      const headYaw = st.aimX * 0.42 * st.aim + (o.headYaw || 0);
      const headPitch = -st.aimY * 0.24 * st.aim + (o.headPitch || 0)
        + st.beat * 0.085 + (o.bow || 0);
      const bodyYaw = st.aimX * 0.20 * st.aim + (o.spin || 0);

      head.rotation.y = headYaw;
      head.rotation.x = headPitch;
      head.rotation.z = (idleLean + (o.headTilt || 0)) * Math.PI / 180;
      body.rotation.y = bodyYaw;
      body.scale.set(breath, 1 + (breath - 1) * 0.5, breath);

      root.position.y = y + bob + st.lift;

      /* ---- the ponytail: a spring, not a copy. It is driven by the *rate* of
         the body's motion, so it swings when she moves and settles when she
         stops — which is the whole difference between hair and a stick. ---- */
      const drive = (o.spin ? 1.6 : 0) + st.aimX * st.aim * 0.5 + Math.sin(st.t * speed) * 0.22;
      st.tailSwayV += (drive - st.tailSway) * 9.0 * dt;
      st.tailSwayV *= Math.exp(-3.2 * dt);
      st.tailSway += st.tailSwayV * dt * 6.0;
      tailPivot.rotation.z = st.tailSway * 0.42;
      tailPivot.rotation.x = -st.tailSway * 0.24 + st.beat * 0.06;

      /* ---- arms: idle hangs, singing opens, an action overrides ---- */
      for (const a of arms) {
        const isR = a.side > 0;
        /* Positive, so the arm swings *away* from the body: rotating a limb that
           hangs down -Y about +Z by a positive angle takes it toward +X, and the
           right arm is the one at +X. The first pass had this negative and both
           arms hung inside the skirt. */
        const idle = 0.16 + s * 0.30;
        const up = isR ? (o.armR || 0) : 0;
        a.pivot.rotation.z = a.side * (idle + up * 2.0);
        a.pivot.rotation.x = -s * 0.16 + (o.armsUp || 0) * -0.9;
        a.fore.rotation.z = a.side * (-0.22 - s * 0.20)
          + (isR ? (o.armRWave || 0) * 0.5 + (o.armRBend || 0) * 0.4 : 0);
        a.fore.rotation.x = -0.30 - s * 0.30;
      }

      /* ---- legs: tucked when floating, kicked when hopping ---- */
      for (const l of legs) {
        l.pivot.rotation.x = 0.12 - s * 0.10 + (o.hop ? clamp(o.hop, -1, 1) * -0.5 : 0);
      }

      // the ornament trembles on the beat, and the whole aura breathes with her
      crown.rotation.z = Math.sin(st.t * 6.2) * 0.02 + st.beat * 0.07 + st.aimX * 0.06;
      crown.rotation.x = -st.beat * 0.06;
      aura.scale.set(breath * 1.0, 1.10 * breath, breath);
      aura.position.y = HEAD_Y + bob * 0.4;
    },

    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      for (const m of materials) m.dispose();
      aura.material.dispose();
      hit.geometry.dispose();
      hit.material.dispose();
      eyeTexOpen.dispose(); eyeTexShut.dispose();
    },
  };
}
