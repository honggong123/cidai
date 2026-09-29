import * as THREE from 'three';
import { gradientTexture } from './textures.js';

/* Softbox panels are plain emissive planes with HDR colours (>1) — they give
   the glossy shell its long specular streaks. Rendered into a PMREM cube. */
function panel(w, h, c, p) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(c[0], c[1], c[2]), side: THREE.DoubleSide })
  );
  m.position.set(p[0], p[1], p[2]);
  m.lookAt(0, 0, 0);
  return m;
}

/* Three galleries, three lighting environments. 白厅 and 蓝厅 are both white
   rooms — the difference between them is the *temperature of the daylight*, and
   that is the whole point: a hall lit from a roof that never sees the sun is not
   a hall with a blue filter over it. */
const PRESET = {
  studio: {
    sigma: 0.028,
    /* A white room has to be *dim* in HDR terms or an ivory body blows out
       against it — the dome tops out well below white, and the key panel is
       only 2.9. A gallery wall reads as white because of its surroundings, not
       because it emits. */
    dome: [[0, '#e4e7ea'], [0.35, '#c9ced3'], [0.62, '#a2a8ae'], [1, '#32363b']],
    panels: [
      { w: 20, h: 13, c: [2.9, 2.9, 2.9], p: [-7.5, 10.5, 8] },      // key
      { w: 13, h: 10, c: [1.1, 1.2, 1.3], p: [11, 2.5, 6] },         // cool fill
      { w: 1.5, h: 30, c: [2.1, 2.2, 2.4], p: [0, 7, -13] },         // rim strip
      { w: 1.2, h: 22, c: [1.7, 1.7, 1.7], p: [-13, 3.5, -1] },      // left streak
      { w: 1.2, h: 22, c: [1.4, 1.5, 1.6], p: [13, 3.5, -1] },       // right streak
      { w: 22, h: 22, c: [1.7, 1.7, 1.7], p: [0, 14, 0] },           // top wash
      { w: 3.2, h: 3.2, c: [2.8, 2.8, 2.8], p: [-9, 7.5, 9] },       // kicker (crisp dot)
      { w: 2.6, h: 2.6, c: [1.5, 1.6, 1.8], p: [8, 6, -8] },         // cool kicker
      { w: 18, h: 18, c: [0.26, 0.26, 0.26], p: [0, -9, 2] },        // bounce
    ],
  },
  noir: {
    sigma: 0.032,
    dome: [[0, '#1c1d20'], [0.45, '#101114'], [1, '#040405']],
    panels: [
      { w: 1.6, h: 26, c: [6.0, 4.6, 3.0], p: [-11, 7, 5] },         // warm strip
      { w: 1.2, h: 26, c: [2.0, 2.6, 3.8], p: [6, 8, -11] },         // cool rim
      { w: 7, h: 5, c: [1.7, 1.2, 0.7], p: [10, 1.5, 4] },           // gold accent
      { w: 20, h: 20, c: [0.55, 0.55, 0.60], p: [0, 13, 0] },        // top wash
      { w: 2.4, h: 2.4, c: [4.6, 4.1, 3.4], p: [-6, 9, 9] },         // kicker
      { w: 1.8, h: 1.8, c: [1.7, 2.0, 3.0], p: [9, 5.5, -6] },       // cool kicker
      { w: 22, h: 22, c: [0.10, 0.09, 0.08], p: [0, -9, 0] },        // bounce
    ],
  },
  /* 蓝厅 — a north-lit hall. Every emitter is daylight that has been through a
     roof: neutral to cool, never warm, and the dome is a gradient of depth
     rather than a tint. The two thin panels are the roof glazing seen edge-on —
     a surface a long way up, which is why they are strips and not squares. */
  abyss: {
    sigma: 0.030,
    dome: [[0, '#ccd8e0'], [0.38, '#b0c0cb'], [0.72, '#8497a5'], [1, '#3e4c57']],
    panels: [
      { w: 26, h: 18, c: [1.7, 1.9, 2.1], p: [0, 14, 1] },           // the roof light
      { w: 1.0, h: 34, c: [1.5, 1.7, 1.9], p: [-4.6, 7, -11] },      // a shaft
      { w: 0.9, h: 30, c: [0.9, 1.2, 1.5], p: [5.2, 7, -12] },       // ...and a dimmer one
      { w: 15, h: 11, c: [0.9, 1.2, 1.5], p: [10, 1.4, 6] },         // cool fill
      { w: 13, h: 13, c: [0.7, 1.0, 1.3], p: [-9, 2.4, 7] },         // ...from the other side
      { w: 2.4, h: 2.4, c: [2.0, 2.3, 2.6], p: [-6.4, 10.5, 8] },    // a mote of roof light
      { w: 1.6, h: 1.6, c: [0.9, 1.2, 1.5], p: [8.5, 5, -7] },       // cool kicker
      { w: 20, h: 20, c: [0.18, 0.24, 0.30], p: [0, -9, 1] },        // the floor of it
    ],
  },
};

export function createEnvironments(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const out = {};
  for (const [name, cfg] of Object.entries(PRESET)) {
    const s = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(42, 32, 24),
      new THREE.MeshBasicMaterial({ map: gradientTexture(cfg.dome), side: THREE.BackSide, depthWrite: false })
    );
    s.add(dome);
    const panels = cfg.panels.map((p) => { const m = panel(p.w, p.h, p.c, p.p); s.add(m); return m; });
    out[name] = pmrem.fromScene(s, cfg.sigma).texture;
    dome.geometry.dispose(); dome.material.map.dispose(); dome.material.dispose();
    panels.forEach((p) => { p.geometry.dispose(); p.material.dispose(); });
  }
  pmrem.dispose();
  return out;
}
