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

const PRESET = {
  studio: {
    sigma: 0.026,
    dome: [[0, '#d7dade'], [0.35, '#b4b9c0'], [0.62, '#878d96'], [1, '#272b31']],
    panels: [
      { w: 20, h: 13, c: [4.4, 4.2, 4.0], p: [-7.5, 10.5, 8] },      // key
      { w: 13, h: 10, c: [1.1, 1.3, 1.7], p: [11, 2.5, 6] },         // cool fill
      { w: 1.5, h: 30, c: [2.9, 3.1, 4.0], p: [0, 7, -13] },         // rim strip
      { w: 1.2, h: 22, c: [2.6, 2.4, 2.1], p: [-13, 3.5, -1] },      // left streak
      { w: 1.2, h: 22, c: [1.5, 1.8, 2.2], p: [13, 3.5, -1] },       // right streak
      { w: 22, h: 22, c: [2.1, 2.1, 2.0], p: [0, 14, 0] },           // top wash
      { w: 3.2, h: 3.2, c: [4.2, 4.1, 3.9], p: [-9, 7.5, 9] },       // kicker (crisp dot)
      { w: 2.6, h: 2.6, c: [2.0, 2.2, 2.8], p: [8, 6, -8] },         // cool kicker
      { w: 18, h: 18, c: [0.22, 0.21, 0.20], p: [0, -9, 2] },        // bounce
    ],
  },
  noir: {
    sigma: 0.032,
    dome: [[0, '#1e2126'], [0.45, '#111318'], [1, '#040507']],
    panels: [
      { w: 1.6, h: 26, c: [6.0, 4.1, 2.5], p: [-11, 7, 5] },         // warm strip
      { w: 1.2, h: 26, c: [2.0, 2.6, 3.8], p: [6, 8, -11] },         // cool rim
      { w: 7, h: 5, c: [1.5, 1.0, 0.55], p: [10, 1.5, 4] },          // amber accent
      { w: 20, h: 20, c: [0.55, 0.55, 0.60], p: [0, 13, 0] },        // top wash
      { w: 2.4, h: 2.4, c: [4.6, 4.1, 3.4], p: [-6, 9, 9] },         // kicker
      { w: 1.8, h: 1.8, c: [1.7, 2.0, 3.0], p: [9, 5.5, -6] },       // cool kicker
      { w: 22, h: 22, c: [0.10, 0.09, 0.08], p: [0, -9, 0] },        // bounce
    ],
  },
  /* Underwater, and the one room where the *colour of the light* is the whole
     story. Water takes the red end out first, so nothing that arrives at the
     subject is neutral: every emitter here is blue-green by construction, and
     the dome is a gradient of depth rather than a tint. The two thin panels are
     shafts — a surface a long way up, seen through a column of water that is
     itself lit, which is why they are strips and not squares. */
  abyss: {
    sigma: 0.032,
    dome: [[0, '#123f52'], [0.38, '#0b2836'], [0.72, '#061723'], [1, '#020910']],
    panels: [
      { w: 26, h: 18, c: [1.35, 2.55, 3.10], p: [0, 14, 1] },        // the surface itself
      { w: 1.0, h: 34, c: [1.25, 2.30, 2.85], p: [-4.6, 7, -11] },   // a shaft
      { w: 0.9, h: 30, c: [0.70, 1.35, 1.80], p: [5.2, 7, -12] },    // ...and a dimmer one
      { w: 15, h: 11, c: [0.42, 0.86, 1.16], p: [10, 1.4, 6] },      // cold fill
      { w: 13, h: 13, c: [0.30, 0.60, 0.80], p: [-9, 2.4, 7] },      // ...from the other side
      { w: 2.4, h: 2.4, c: [1.70, 2.90, 3.40], p: [-6.4, 10.5, 8] }, // a mote of surface light
      { w: 1.6, h: 1.6, c: [0.60, 1.15, 1.55], p: [8.5, 5, -7] },    // cool kicker
      { w: 20, h: 20, c: [0.06, 0.11, 0.15], p: [0, -9, 1] },        // the floor of it
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
