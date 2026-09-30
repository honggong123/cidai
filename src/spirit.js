import * as THREE from 'three';
import { damp } from './anim.js';

/* ============================== 灵宝 =====================================
   The spirit that stands where the tape used to. One billboard, one image, no
   geometry — which is the whole point: `assets/spirit.png` is the final look,
   and anything built in 3D around it would only be a worse drawing of the same
   character. A Sprite also gets the thing this scene most needs from it for
   free: it turns to face the lens, so orbiting the room never shows you the
   back of her head.

   WHAT IS ANIMATED, AND WHY SO LITTLE
   A billboard has no limbs, so "singing" cannot be acted — it has to be *read*
   off the silhouette. Three motions carry it, all of them amplitude rather than
   shape: she breathes (a scale pulse), she floats (a slow vertical drift), and
   she leans (a degree or two of tilt). Idle is the same three motions at a
   third of the size and half the speed, so the difference between "waiting" and
   "singing" is legible without either state looking like a different animation.
   Everything eases between the two states rather than switching, because the
   transport can be pressed at any moment and a pop would read as a glitch.

   `center` is (0.5, 0): the sprite's own origin is the point between her feet,
   so `root.position.y` is the floor and the bob is measured from it. With the
   default centre the bob would move her *through* the floor by half her height.

   depthWrite is off — she is a cut-out and must never occlude the room behind
   her, and a sprite that writes depth punches a rectangular hole in it.

   THE RIM, AND WHY SHE NEEDS ONE
   A cut-out drawn in a near-white palette, standing in a near-white room, has no
   edge to be seen against. Measured in 晴室: her dress lands within 35 levels of
   the wall behind it, and the bloom and 26% defocus then take most of that back.
   What a drawing has and a photograph of a drawing does not is a contour, so one
   is put back — the same texture, filled flat with a colour, drawn *behind* her
   and grown by `RIM_D` on every side. Her own pixels are opaque and land on top,
   so the only part of the ring that survives is where her alpha is falling: the
   contour, at the same softness she already had. It also fills the gaps *inside*
   her silhouette (between the leaves of the crown, under the hair) with the same
   tone, which is the second thing that makes her read as drawn rather than
   pasted.

   The growth is on all four sides, so the rim cannot share her `center`: its quad
   is `RIM_D` wider at each edge and `RIM_D` taller at each end, and its own centre
   is moved up by `RIM_D` so that its bottom stays on her feet with hers.

   THE FILE SHE IS LOADED FROM
   `assets/spirit-cut.webp`, not `assets/spirit.png`. The delivered art is a
   JPEG with no alpha and its transparency flattened onto pure black, so used
   as-is she would stand in the room inside a black plate. `tools/key-spirit.py`
   keys the black out (and crops to her ink box, which is what lets `center` be
   her feet) — see that file for why the key is a global luma ramp rather than a
   flood fill, and why the runtime asset is WebP. The delivered `spirit.png` is
   left exactly as it arrived. */
const RIM_D = 0.09;              // world units of growth; ~7 px at 439x475

export function createSpirit({ url, height = 6.5, x = 0, y = 0, z = 0 }) {
  const root = new THREE.Group();
  root.position.set(x, y, z);

  // declared before the loader because the load callback writes both
  const base = { w: height, h: height };
  const loaded = { ok: true };
  const st = { t: 0, sing: 0, hover: 0, lift: 0 };

  /* the one place the two quads' sizes are written, so the load callback, the
     breath and the hover lift cannot fight over them */
  const apply = (k) => {
    const w = base.w * k, h = base.h * k;
    sprite.scale.set(w, h, 1);
    const rw = w + RIM_D * 2, rh = h + RIM_D * 2;
    rim.scale.set(rw, rh, 1);
    rim.center.set(0.5, RIM_D / rh);
  };

  const texture = new THREE.TextureLoader().load(
    url,
    (t) => {
      const img = t.image;
      if (!img || !img.width) return;
      // the image is not square, and a sprite scaled by height alone would
      // stretch her. The aspect is only known once the file has decoded, so the
      // scale is written here rather than at construction.
      base.w = height * (img.width / img.height);
      base.h = height;
      apply(1);
    },
    undefined,
    () => { loaded.ok = false; },
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
  });

  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.scale.set(base.w, base.h, 1);
  root.add(sprite);

  /* `color` is the whole of the rim's look — the texture's own pixels are thrown
     away by a flat multiply — and `opacity` is set per room (see applyTheme).
     renderOrder -1 because she and the rim are the same distance from the lens:
     nothing else can decide which of the two draws first, and getting it the
     other way round hides her behind her own outline. */
  const rimMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
  });
  const rim = new THREE.Sprite(rimMaterial);
  rim.renderOrder = -1;
  root.add(rim);
  apply(1);

  return {
    root, sprite, material, texture, rim, rimMaterial,
    get ready() { return loaded.ok; },

    /** `singing` and `hovered` are the caller's states; the easing lives here */
    update(dt, singing, hovered) {
      st.t += dt;
      st.sing = damp(st.sing, singing ? 1 : 0, 3.0, dt);
      st.hover = damp(st.hover, hovered ? 1 : 0, 9.0, dt);
      st.lift = damp(st.lift, hovered ? 0.22 : 0, 7.0, dt);
      const s = st.sing;

      // one clock, three amplitudes: idle is the same motion, smaller and slower
      const speed = 1.05 + s * 1.45;
      const bob = Math.sin(st.t * speed) * (0.09 + s * 0.26);
      const breath = 1 + Math.sin(st.t * speed * 1.34) * (0.017 + s * 0.042);
      // a sprite's own rotation is in the screen plane, which is exactly a lean
      const lean = Math.sin(st.t * speed * 0.61) * (0.5 + s * 1.5);

      root.position.y = y + bob + st.lift;
      material.rotation = lean * Math.PI / 180;
      apply(breath * (1 + st.hover * 0.035));
    },

    dispose() {
      texture.dispose();
      material.dispose();
      rimMaterial.dispose();
    },
  };
}
