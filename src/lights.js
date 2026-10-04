import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { damp } from './anim.js';

/* A photographic rig rather than a "3D scene" rig.

   RectAreaLight is the only three.js light that behaves like a softbox: the
   rectangle is the emitter, so a glossy surface shows the softbox itself as a
   soft rectangular highlight, and falloff across the subject reads like real
   inverse-square + size falloff. It cannot cast shadows, so one directional
   light sits in the key's position purely to drop the cast/contact shadow.

   The five positions are the classic ones:
     key    45° off the camera axis, ~35° up, warm (the only "hard" source)
     fill   opposite side, close to the camera axis, big and dim, cool
     rim    narrow strip behind, tracing the silhouette
     bounce white card on the table in front-left, warm, lifts the underside
     top    wide overhead wash so the label face stays readable
   ======================================================================= */

export const RIG = {
  /* 紫夜 — the dark room, keyed to the character: a gold key (the hat band is
     the only saturated thing on her), a violet fill (the hat's own colour
     bounced back off the walls) and an ice rim (the glow inside the sheet).
     The three hues are the three colours of the model, which is what makes a
     one-lamp room read as *her* room rather than a generic black box. */
  noir: {
    exposure: 0.95, envInt: 0.45,
    key: { c: 0xffdfae, i: 1.90, w: 9.0, h: 6.0, p: [-6.4, 5.2, 6.6] },
    fill: { c: 0xbfa8ff, i: 0.45, w: 12, h: 8.0, p: [8.6, 1.8, 5.2] },
    rim: { c: 0x9fe4ff, i: 1.60, w: 1.3, h: 13, p: [4.2, 4.6, -8.6] },
    bounce: { c: 0xc9a8ff, i: 0.40, w: 12, h: 12, p: [0.5, -3.4, 3.8] },
    top: { c: 0xe6dcff, i: 0.22, w: 12, h: 12, p: [-0.8, 8.8, 1.2] },
    shadow: { i: 0.75, p: [-6.4, 5.2, 6.6] },
  },
  /* 霜厅 — the same five positions as the black box; what changed is the
     *ratios*.

     A room where every lamp is nearly as strong as the key is a room with no
     key. Measured off the render at the old numbers, the crown came back
     (248,244,238), the shirt (248,246,240), and the groove between two fringe
     locks (247,243,239) — a surface facing the key and a surface turned away
     from it were lit by two different softboxes of the same size and the same
     brightness, so the model had three levels of shading across its whole head.
     Nothing about a solid can be seen in that light: the fringe read as one
     smooth white shell no matter how many locks it was built from, and the
     first diagnosis blamed the geometry and rewrote it.

     So the fill, the top and the bounce come down and the key goes up. The hall
     is still bright — the exposure carries that, and it went up with them — but
     it now has a direction, and a direction is what makes a crease a crease.
     `envInt` comes down for the same reason: an IBL is the most directionless
     light there is. */
  studio: {
    exposure: 0.86, envInt: 0.46,
    /* Only the *hue* moved here — the ratios are the ones the shading analysis
       settled on (see below), and they are what makes the fringe read as locks
       rather than as one shell. The hall's white goes cold and faintly violet
       so the sheet does not disappear into the wall it is standing in front of;
       the bounce is the one warm lamp left, because a room with no warm source
       at all reads as a colour cast rather than as a room. */
    key: { c: 0xf8f6ff, i: 1.72, w: 14, h: 10, p: [-7.6, 6.6, 7.6] },
    fill: { c: 0xe4e8ff, i: 0.46, w: 15, h: 11, p: [9.4, 2.6, 5.8] },
    rim: { c: 0xd0f0ff, i: 1.00, w: 1.8, h: 16, p: [0.8, 6.2, -10.5] },
    bounce: { c: 0xfff4e4, i: 0.34, w: 13, h: 13, p: [0.4, -3.2, 4.2] },
    top: { c: 0xf0f2ff, i: 0.26, w: 15, h: 15, p: [0, 10.5, 1.0] },
    shadow: { i: 0.40, p: [-7.6, 6.6, 7.6] },
  },
  /* 蓝厅 — the same five positions as the hall next door, with the colour of
     north light on every one of them: nothing here is warm, and the fill is
     large and bright because a daylight hall bounces off all four walls. The
     shadow is the lightest of the three, for the same reason. */
  abyss: {
    exposure: 0.80, envInt: 0.54,
    /* 冰渊 — the room lit the way the ghost is lit from inside. Every lamp is
       pushed toward the cyan of the sheet's own glow, and the rim is the most
       saturated one in the whole rig: in a room this cold the contour is the
       only place a warm object could hide, and there is no warm object. */
    key: { c: 0xecf9ff, i: 1.45, w: 12, h: 8.5, p: [-6.2, 7.8, 5.6] },
    fill: { c: 0xa6cfdd, i: 0.80, w: 14, h: 10, p: [9.0, 1.6, 5.4] },
    rim: { c: 0x9fe8ff, i: 1.30, w: 1.2, h: 15, p: [3.6, 5.4, -9.6] },
    bounce: { c: 0x8ab6c4, i: 0.45, w: 12, h: 12, p: [0.4, -3.6, 4.0] },
    top: { c: 0xd6f0ff, i: 0.48, w: 14, h: 14, p: [-0.6, 9.8, 1.0] },
    shadow: { i: 0.40, p: [-6.2, 7.8, 5.6] },
  },
};

/** the rig as geometry on a hidden layer: a reflection probe that enables the
    layer sees the softboxes and the subject in the same capture */
export function buildRigPanels(themeName, layer = 2) {
  const preset = RIG[themeName] || RIG.noir;
  const group = new THREE.Group();
  group.name = 'rigPanels';
  for (const name of ['key', 'fill', 'rim', 'bounce', 'top']) {
    const p = preset[name];
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(p.w, p.h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(p.c).multiplyScalar(p.i), side: THREE.DoubleSide })
    );
    m.position.set(p.p[0], p.p[1], p.p[2]);
    m.lookAt(0, 0, 0);
    m.layers.set(layer);
    group.add(m);
  }
  return group;
}

export function createRig(scene) {
  RectAreaLightUniformsLib.init();

  const lights = {};
  for (const name of ['key', 'fill', 'rim', 'bounce', 'top']) {
    const l = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
    l.position.set(0, 1, 0);
    l.lookAt(0, 0, 0);
    scene.add(l);
    lights[name] = l;
  }

  // shadow twin of the key
  const shadow = new THREE.DirectionalLight(0xffffff, 1);
  shadow.castShadow = true;
  // 2048 over a ±8.5 unit ortho box is ~0.8 mm per texel — far finer than this
  // object needs, and a quarter of the fill of 4096
  shadow.shadow.mapSize.set(2048, 2048);
  shadow.shadow.camera.near = 1;
  shadow.shadow.camera.far = 40;
  const d = 8.5;
  Object.assign(shadow.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
  shadow.shadow.bias = -0.0004;
  shadow.shadow.normalBias = 0.018;
  shadow.shadow.radius = 7;
  scene.add(shadow);

  // bake the colour strings into Color objects once — apply() runs every frame
  for (const preset of Object.values(RIG)) {
    for (const name of ['key', 'fill', 'rim', 'bounce', 'top']) preset[name].col = new THREE.Color(preset[name].c);
  }

  const target = RIG.noir;
  /* `rate` is the owner's to choose: a room change walks its lamps on the same
     clock as everything else, and that clock is not a fixed decay (see
     themeRate in main.js). 2.6 is what a caller that does not care gets. */
  const apply = (preset, dt, instant = false, rate = 2.6) => {
    const k = instant ? 1 : 1 - Math.exp(-rate * dt);
    for (const name of ['key', 'fill', 'rim', 'bounce', 'top']) {
      const p = preset[name], l = lights[name];
      l.color.lerp(p.col, k);
      l.intensity += (p.i - l.intensity) * k;
      l.width += (p.w - l.width) * k;
      l.height += (p.h - l.height) * k;
      l.position.x += (p.p[0] - l.position.x) * k;
      l.position.y += (p.p[1] - l.position.y) * k;
      l.position.z += (p.p[2] - l.position.z) * k;
      l.lookAt(0, 0, 0);
    }
    shadow.color.lerp(preset.key.col, k);
    shadow.intensity += (preset.shadow.i - shadow.intensity) * k;
    shadow.position.x += (preset.shadow.p[0] - shadow.position.x) * k;
    shadow.position.y += (preset.shadow.p[1] - shadow.position.y) * k;
    shadow.position.z += (preset.shadow.p[2] - shadow.position.z) * k;
  };

  apply(target, 0, true);
  return { lights, shadow, apply, dump: () => target };
}
