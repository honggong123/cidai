import * as THREE from 'three';
import { createEnvironments } from './env.js';
import { createProbe } from './probe.js';
import { createRig, buildRigPanels, RIG } from './lights.js';
import { createRelic, DIM } from './relic.js';
import { createSoftFloor } from './floor.js';
import { createComposer } from './post.js';
import { createCastle } from './castle.js';
import { Orbit } from './controls.js';
import { clamp, damp, ease, Timeline } from './anim.js';
import * as TX from './textures.js';
import { TapeAudio } from './audio.js';
import { readTags, looksLikeAudio } from './tags.js';
import { SIDES, loadSide as ensureSide, sideOf, trackAt } from './playlist.js';
import { createViz } from './viz.js';
import { createGhost } from './ghost.js';

const $ = (s) => document.querySelector(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = $('#gl');

/* ============================== the tape is off ==========================
   The subject of this page is 小幽灵 now, and the cassette is kept rather than
   deleted: every part of it, its materials, its two reels' worth of animation
   and its two hundred lines of assembly are still here, one flag away. Nothing
   downstream has to be told the difference beyond this constant, which is why
   it is a constant and not a scattering of `false`s.

   What it switches off, and why each one has to be switched off at all:
   - the shell itself (`cas.root.visible`), which takes the ghost materials with
     it — a ghost is the *same* mesh wearing a different material, not a second
     mesh, so there is nothing left over to hide;
   - the five part labels (ANNOS), which name parts of a shell nobody can see;
   - the ghost walk (embrace/release), which would otherwise go on swapping
     materials on invisible meshes and re-compiling shaders for a fade with no
     audience;
   - 拆解 and 翻面, whose only referent is the shell's own assembly.
   The audio, the playlist, the counter, the seek bar and the whole archive are
   untouched: they never belonged to the tape in the first place. */
const TAPE_ON = false;

/* She occupies the space the shell lay in, and is sized against it rather than
   picked: `DIM.H` is how deep the cassette was, and a character who overtopped
   the object she replaced would read as a change of scale rather than a change
   of subject. `ghost.js` reads this as the *whole envelope* — hem to hat tip —
   and hangs the hem `FLOAT` above the floor so the hat tip lands on the same
   ceiling the old crown did. That is what keeps the five camera vantages
   framed without touching a single one of them. */
const SPIRIT_H = DIM.H;

/* ============================== the buttons that are gone =================
   Six of the transport's controls wrote their state to a button: 拆解 and 翻面
   pressed `on`/`aria-pressed` onto themselves. Those two buttons are out of the
   markup now (see TAPE_ON), and the state they wrote is still worth writing —
   `exploded` and `flipped` are read by the render pass, by `live()` and by the
   vantages — so the calls stay and only the button lookup has to survive coming
   back null. One helper rather than six `?.` chains, because two of the six
   also write `aria-pressed` and a chain that guards the classList but not the
   attribute is the kind of half-guard that only shows up on the one path nobody
   clicks. */
const setPressed = (sel, on) => {
  const el = $(sel);
  if (!el) return;
  el.classList.toggle('on', on);
  el.setAttribute('aria-pressed', String(on));
};

/* ============================== nothing changes in one frame ==============
   Two helpers, and between them every read-out on this page changes the way
   everything else does — by moving. Both are here, at the top, because the boot
   sequence writes labels before the rest of the module exists.

   swapText is for words: 走带 ／ 暂停, 读取整机 ／ 读取磁带, the vantage's name, the
   model plate on the masthead, the track in the chip. Assigning textContent
   replaces the glyphs between two frames, which is a cut; so the outgoing word
   leaves upward, the incoming one arrives from below, and a swap that arrives
   mid-flight only moves the target — holding — walks the read-out without it
   flickering. Falls through to a plain write for the very first value and under
   prefers-reduced-motion.

   setRoll is for numbers: the counter, the clock, the deck's numeral, the volume
   readout, the dial. The text is built once as one cell per character and only
   the characters that changed move — the old digit rises out of the cell while
   the new one rises in from underneath, which is what a tape counter does. The
   cells are right-aligned, so a read-out that gains a digit (`0%` → `100%`) gains
   a cell rather than being rebuilt, and the ones place never moves. Tabular
   figures mean the cell is the same width before and after anyway.

   Both drive the Web Animations API rather than CSS classes: replaying a class
   animation needs the class removed, a reflow forced and the class re-added, and
   this runs once a second for the life of the page. */
const RISE = { duration: 300, easing: 'cubic-bezier(.16, 1, .3, 1)' };
const LEAVE = { duration: 150, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' };
const FROM_ABOVE = [{ opacity: 0, transform: 'translateY(.5em)' }, { opacity: 1, transform: 'none' }];
const TO_ABOVE = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-.5em)' }];
const FROM_BELOW = [{ opacity: 0, transform: 'translateY(.72em)' }, { opacity: 1, transform: 'none' }];
const TO_ABOVE_CELL = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-.72em)' }];

function swapText(el, text) {
  if (!el) return;
  text = String(text);
  if (el.__t === text) return;
  const seed = el.__t === undefined;
  el.__t = text;
  if (seed || reduce) { el.textContent = text; return; }
  if (el.__leaving) return;             // already on its way out; __t holds the latest
  el.__leaving = true;
  const out = el.animate(TO_ABOVE, LEAVE);
  /* Arriving is a timer's job, not the animation's `finish` event. A stalled or
     throttled animation clock — a backgrounded tab, a machine in low-power mode,
     a headless renderer — would otherwise leave the label showing its old word
     for good, and a read-out that lies is worse than one that cuts. The
     movement is decoration; the arrival is the contract. */
  clearTimeout(el.__swapT);
  el.__swapT = setTimeout(() => {
    el.__leaving = false;
    // the fill has to go before the new text is written, or its forwards fill
    // would still be holding opacity 0 under the incoming animation
    out.cancel();
    el.textContent = el.__t;
    el.animate(FROM_ABOVE, RISE);
  }, LEAVE.duration);
}

/** The in-only variant, for a read-out that is rewritten faster than a two-part
    swap can finish — the loader's status line, which changes once per boot step.
    Every value arrives with motion and none of them is ever dark, which is the
    one case where a two-part swap would be worse than useless: with steps a frame
    apart the outgoing half never gets to finish, and the line would sit at
    opacity 0 for the whole load. */
function riseText(el, text) {
  if (!el) return;
  text = String(text);
  if (el.__r === text) return;
  const seed = el.__r === undefined;
  el.__r = text;
  el.textContent = text;
  if (seed || reduce) return;
  el.animate(FROM_ABOVE, RISE);
}

function setRoll(el, text) {
  if (!el) return;
  text = String(text);
  if (el.__v === text) return;
  const seed = el.__v === undefined;
  el.__v = text;
  let cells = el.__cells;
  if (!cells) {
    el.textContent = '';
    cells = el.__cells = [];
  }
  while (cells.length < text.length) {
    const c = document.createElement('span');
    c.className = 'od';
    c.append(document.createElement('b'), document.createElement('b'));
    el.append(c);
    cells.push(c);
  }
  // right-aligned: growing a digit adds a cell on the left, so the ones place —
  // and everything to the right of it — never moves
  const off = cells.length - text.length;
  for (let i = 0; i < cells.length; i++) {
    const ch = i < off ? '' : text[i - off];
    const c = cells[i];
    if (c.__c === ch) continue;
    const old = c.__c ?? '';
    c.__c = ch;
    c.lastElementChild.textContent = old;
    c.firstElementChild.textContent = ch;
    if (seed || reduce || !old || !ch) continue;
    c.lastElementChild.animate(TO_ABOVE_CELL, RISE);
    c.firstElementChild.animate(FROM_BELOW, RISE);
  }
}

/* ============================== theme presets ============================ */
const THEMES = {
  noir: {
    env: 'noir', dust: 0.40, hal: 0.072, ao: 1.0,
    grade: {
      bloom: 0.32, ca: 0.85, grain: 0.040, vig: 0.85, sat: 1.0, edge: 1.0, focus: 0.26,
      halTint: [1.0, 0.86, 0.62],          // the gold of the room's one spot
    },    bg: {
      stops: [[0, '#120e1c'], [0.44, '#1e1733'], [0.64, '#0d0a17'], [1, '#050309']],
      spot: { u: 0.849, v: 0.48, r: 0.40, color: 'rgba(226,196,150,0.58)' },
    },
    floor2: 0x1c1626, floorMix: 0.22, shadowOp: 0.44,
    pool: 0xb98cff, poolOp: 0.03,
    /* 房间能改幽灵的只有两样：光环的颜色/浓度、体内青光的色偏。
       暗房里光环取金带那个金 —— 它替掉了原来那身叶子发饰在房间里的作用。 */
    spirit: { tint: 0xe8dcff, rim: 0xc9a24e, rimOp: 0.30 },
    glare: { tint: [0.94, 0.86, 1.0], strength: 0.16, stride: 0.010, threshold: 0.58 },
  },
  studio: {
    env: 'studio', dust: 0.10, hal: 0.012, ao: 0.92,
    grade: {
      bloom: 0.32, ca: 0.85, grain: 0.035, vig: 0.85, sat: 1.0, edge: 1.0, focus: 0.26,
      // a hair violet rather than neutral: the hall's white is now a cold one
      // (see lights.js), and a neutral bleed on a violet-white highlight is the
      // one thing that would give the whole room away as a filter
      halTint: [0.96, 0.96, 1.0],
    },
    bg: {
      stops: [[0, '#b6bac8'], [0.46, '#d5d9e4'], [0.78, '#eaecf2'], [1, '#f5f6fa']],
      spot: { u: 0.849, v: 0.48, r: 0.44, color: 'rgba(246,244,255,0.42)' },
    },
    floor2: 0x8b8a96, floorMix: 0.12, shadowOp: 0.18,
    pool: 0xcfc4ff, poolOp: 0.0,
    spirit: { tint: 0xe0e2f2, rim: 0x6a4fa8, rimOp: 0.26 },
    // the room the page opens in, so this is the one glare nobody should be
    // able to notice: a hint of a streak on the speculars and nothing else
    glare: { tint: [0.92, 0.95, 1.0], strength: 0.06, stride: 0.008, threshold: 0.66 },
  },
  /* 蓝厅 — north light, and the one room where the *colour of the light* is the
     whole story. Nothing that arrives at the subject is neutral: it has been
     through a roof that never sees the sun. So the halation is cold, the defocus
     is wide (a daylight hall is a big space), and the glare is the bluest of the
     three, because a streak is what a bright surface looks like under a roof. */
  abyss: {
    env: 'abyss', dust: 0.18, hal: 0.026, ao: 1.05,
    grade: {
      bloom: 0.34, ca: 0.75, grain: 0.040, vig: 0.92, sat: 1.0, edge: 1.05, focus: 0.24,
      halTint: [0.62, 0.92, 1.0],
    },
    bg: {
      stops: [[0, '#93b6c4'], [0.46, '#c2dae2'], [0.74, '#dcebf0'], [1, '#eef6f8']],
      spot: { u: 0.849, v: 0.48, r: 0.42, color: 'rgba(150,225,245,0.48)' },
    },
    floor2: 0x7e8f96, floorMix: 0.14, shadowOp: 0.22,
    pool: 0x5fe0f0, poolOp: 0.02,
    spirit: { tint: 0xd8f0f5, rim: 0x1f8fa0, rimOp: 0.26 },
    glare: { tint: [0.58, 0.92, 1.0], strength: 0.22, stride: 0.011, threshold: 0.55 },
  },
};
for (const T of Object.values(THEMES)) {
  T.cFloor2 = new THREE.Color(T.floor2);
  T.cPool = new THREE.Color(T.pool);
  T.cHalTint = new THREE.Vector3(...T.grade.halTint);
  T.cGlare = new THREE.Vector3(...T.glare.tint);
  T.cTint = new THREE.Color(T.spirit.tint);
  T.cRim = new THREE.Color(T.spirit.rim);
}
let themeName = 'studio';

/* ============================== renderer ================================= */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.body.innerHTML = '<p style="color:#eee;font:14px/1.6 system-ui;padding:3rem">当前浏览器无法初始化 WebGL，请使用 Chrome / Edge 打开。</p>';
  throw err;
}
/* The render scale. A 2× display is four times the pixels of a 1× one, and this
   scene charges for that four times over: a 4×-MSAA half-float target, a
   96-sample AO at the same size, five bloom mips and a 27-tap grade. 1.5× is
   where a picture this soft — bloom, grain, chromatic aberration and a real
   defocus — stops looking different from 2×, and only the canvas scales: the
   interface is DOM and stays crisp at any device ratio. `性能模式` in the
   settings sheet drops it to 1.1×. */
const DPR_CAP = 1.5;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DPR_CAP));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 220);

/* ============================== studio set =============================== */
const backdropMaps = {};
let backdrop, backdropIn;
{
  const g = new THREE.SphereGeometry(70, 32, 24);
  backdrop = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false }));
  backdrop.frustumCulled = false;
  scene.add(backdrop);
  /* The room's background is a baked texture with no in-between, and it is the
     largest single surface in the frame — 黑盒 is near black and 白厅 pale grey,
     so cutting the map was the loudest thing in the whole transition. This
     second shell carries the incoming room across instead. Both are BackSide
     with depthWrite off, so the depth buffer never distinguishes them and only
     the draw order matters: the base is opaque (opaque pass), this one is
     transparent (transparent pass, after it). It sits at the same radius —
     nothing depends on which is nearer. */
  backdropIn = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    side: THREE.BackSide, depthWrite: false, transparent: true, opacity: 0,
  }));
  backdropIn.frustumCulled = false;
  backdropIn.visible = false;
  scene.add(backdropIn);
}
/* `interval: 2` is the mirror's documented behaviour — the reflection is
   blurred by design and the floor under it is dark, so on a still camera an
   alternate-frame refresh is invisible and halves a whole extra scene render.
   A moving camera forces every frame (see the loop's camMoved), and anything
   the mirror actually shows moving — the drift, the reels — is either slower
   than a texel a frame or behind the smoke glass. */
const floorBase = createSoftFloor({ base: 0xd6d8da, mix: 0.30, y: -1.62, interval: 2 });
scene.add(floorBase.mesh);
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(46, 46),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.18, transparent: true, depthWrite: false })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = -1.612;
shadowCatcher.receiveShadow = true;
shadowCatcher.renderOrder = 2;
scene.add(shadowCatcher);
const poolMat = new THREE.MeshBasicMaterial({
  map: TX.radialTexture(512, { inner: 'rgba(255,255,255,1)', color: '255,255,255', p: 0.18 }),
  color: 0xff8a3c, transparent: true, opacity: 0.2,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const pool = new THREE.Mesh(new THREE.CircleGeometry(9, 48), poolMat);
pool.rotation.x = -Math.PI / 2;
pool.renderOrder = 3;
scene.add(pool);

/* the stage sinks as the shell opens, so the lower layers never fall through
   the floor — the exploded stack is ~7.4 units tall, the floor has to get out
   of its way */
const FLOOR_Y = -1.62;
function setFloorDrop(d) {
  floorBase.mesh.position.y = FLOOR_Y - d;
  shadowCatcher.position.y = FLOOR_Y + 0.008 - d;
  pool.position.y = FLOOR_Y + 0.02 - d;
}
setFloorDrop(0);
/* 城堡内部（2026-10-02：不要摄影房，改到西欧城堡）—— 石墙/拱窗/木门/挂毯/
   火把/吊灯/横梁/石板地全在 castle.js。她的实用灯与雾随主题走（applyTheme 里
   setTheme(name, k)），火光闪烁在主循环的 castle.update(t)。 */
const castle = createCastle({ floorY: FLOOR_Y });
scene.add(castle.group);
scene.fog = castle.fog;                // 雾只雾墙（near ≥ 34），她永远在雾外
/* ============================== dust ==================================== */
const dustLayers = [
  { n: 220, size: 0.055, color: 0xffe6c8, opacity: 0.5, spread: 26, rise: 0.09 },
  { n: 70, size: 0.34, color: 0xffc79a, opacity: 0.16, spread: 20, rise: 0.045 },  // out-of-focus bokeh motes
].map((cfg) => {
  const { n } = cfg;
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), seed = new Float32Array(n);
  // per-mote brightness, so a mote can fade out before it is recycled to the
  // bottom of the volume. Additive blending means scaling the vertex colour
  // *is* fading it — the material colour still carries the layer's tint.
  const tint = new Float32Array(n * 3).fill(1);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * cfg.spread;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 15;
    pos[i * 3 + 2] = (Math.random() - 0.5) * cfg.spread;
    vel[i * 3] = (Math.random() - 0.5) * 0.05;
    vel[i * 3 + 1] = cfg.rise * (0.5 + Math.random());
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    seed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(tint, 3));
  const mat = new THREE.PointsMaterial({
    size: cfg.size, map: TX.dustSprite(), color: cfg.color, transparent: true,
    opacity: cfg.opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    vertexColors: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return { ...cfg, pts, pos, vel, seed, tint, geo, mat };
});
const dust = dustLayers[0];
/* both ends of the column are on screen, and a mote is recycled from the top of
   one to the bottom of the other at a new x/z — so it has to be at zero
   brightness at *both* ends or you watch it blink out of one place and into
   another. */
const DUST_TOP = 8.5, DUST_BOT = -7.5, DUST_FADE = 1.6;
const dustFade = (v, a, b) => { const f = clamp((v - a) / b, 0, 1); return f * f * (3 - 2 * f); };
function driftDust(dt, t) {
  for (const L of dustLayers) {
    const p = L.pos, c = L.tint;
    for (let i = 0; i < L.n; i++) {
      const j = i * 3;
      p[j] += (L.vel[j] + Math.sin(t * 0.5 + L.seed[i]) * 0.02) * dt;
      p[j + 1] += L.vel[j + 1] * dt;
      p[j + 2] += (L.vel[j + 2] + Math.cos(t * 0.42 + L.seed[i]) * 0.02) * dt;
      if (p[j + 1] > DUST_TOP) {
        p[j + 1] = DUST_BOT;
        p[j] = (Math.random() - 0.5) * L.spread;
        p[j + 2] = (Math.random() - 0.5) * L.spread;
      }
      // out over the last stretch below the top wrap, in over the first stretch
      // above the bottom one: zero at both wraps, so the recycle is invisible
      const y = p[j + 1];
      const k = dustFade(DUST_TOP - 0.2, -DUST_FADE, y) * dustFade(DUST_BOT + 0.1, DUST_FADE, y);
      c[j] = c[j + 1] = c[j + 2] = k;
    }
    L.geo.attributes.position.needsUpdate = true;
    L.geo.attributes.color.needsUpdate = true;
  }
}

/* ============================== model =================================== */
let cas = null, spirit = null, envs = null, rig = null, composer = null, grade = null, bloom = null, glarePass = null;
let probe = null, rigPanels = null, probeDirty = false, probeBound = false;

/* Handling the model is a detour, not a destination: five seconds after the last
   drag or zoom the camera eases back to the framing the panel says it is on —
   the vantage you last chose, or the record's own view if one is open. Without
   it a stray drag leaves the tape at whatever three-quarter angle you let go of,
   and the read-out down the side keeps naming a vantage the lens has left. The
   timer is armed only by *manual* handling; anything the app does itself (arrows,
   a record, 拆解) already ends on a framing, so it disarms instead. 巡览 beats
   it: with the model turning by itself there is nothing to return to.
   ★ 双击**不在**这张名单里：它现在什么都不做（见 controls.js）。原来它也是一个
   "自己走到某个取景"的动作，所以既会调 `onReset` 让面板改回 01，又不 arm 计时器
   —— 2026-10-02 用户要求双击别再把镜头拉回默认机位，整个口子跟着拆了。 */
const HOME_DELAY = 5.0;
let homeArmed = false;
function armHome() { if (!autoRotate) homeArmed = true; }
function goHome() {
  homeArmed = false;
  orbit.setPreset((vi >= 0 ? VANTAGES[vi] : VANTAGES[0]).v, false);
  if (orbit.tween) orbit.tween.dur = 1.6;
}
const orbit = new Orbit(canvas, camera, {
  theta: 1.18, phi: 1.34, radius: 40, target: new THREE.Vector3(0, 1.30, 0),
  minR: 11, maxR: 40, minPhi: 0.16, maxPhi: 1.52,   // 城堡墙在 44 —— 镜头最远 40，留在厅内
  auto: false,
  reduce,
  onInteract: (dragging) => {
    document.body.classList.toggle('dragging', dragging);
    document.body.classList.add('moved');
    // the countdown starts when the hand comes off, not when it lands
    if (!dragging) armHome();
  },
  onManual: armHome,
});

/* the camera's four filed vantages, independent of whatever record is open.
   ★★ 01 就是**默认机位**：开场推轨的收尾、`reset()`、以及"没带查询串/关掉开场
   动画"时的回位，三处都落在 `orbit.home` 上，所以"01"和"home"必须是同一份数字。
   以前这两处各写一遍（都写 iso），分头改一次就会得到"镜头停在 front、面板报 01
   等轴机位"。现在 home 直接指向 `VANTAGES[0].v`，只有一份。
   2026-10-02 用户要求把默认从 等轴(iso) 换成 正视(front)：iso 是 31° 俯角，
   看下去帽檐占满画幅；front 的 15.5° 才是一张肖像。 */
const VANTAGES = [
  { k: 'front', cn: '正视机位', en: '正立面', v: { theta: 0.06, phi: 1.30, radius: 23 } },
  { k: 'iso', cn: '等轴机位', en: '等角投影', v: { theta: 0.62, phi: 1.03, radius: 33 } },
  { k: 'top', cn: '俯视机位', en: '平面', v: { theta: 0.34, phi: 0.30, radius: 34 } },
  { k: 'detail', cn: '细节特写', en: '微距', v: { theta: 0.95, phi: 1.14, radius: 21 } },
];
/* 镜头拉得比旧的产品机位远：18 单位时主体自己占满画幅，右侧那列面板没有地方
   站。数字只有 `VANTAGES[0]` 这一份 —— 上面那张表在 Orbit 旁边，就是为这个。
   2026-10-04 用户："还有很多背景留白" → 31 缩到 23，并把 `Orbit` 的 `target`
   从 0.05 抬到 1.30。`target` 是上游留下的（那时主体是磁带，中心在 0 附近），
   换成角色之后没跟着改，于是镜头一直在看她的**脚下** —— 她浮在画面上半、
   下面空出一大片地板。抬到 1.30 之后她才落在画面中央。 */
orbit.home = VANTAGES[0].v;

const audio = new TapeAudio();

/* ============================== the tape's music ========================= */
/* What is inside the shell is whatever was put there last: the page boots with
   the record it shipped with, and ADD MUSIC (or a file dropped on the page, or
   O) hands it another one. The three lines the README used to ask for by hand —
   title, artist, album — come off the file's own ID3 tags instead, and the label
   on the cassette is rewritten to match (see applyTrack). */
/* The record this page shipped with is a commercial release and cannot travel
   with the repository, so these are placeholders: boot() overwrites them with
   the demo tape's own first side before anything reads them (see playlist.js).
   `minutes` is what the label prints and belongs to whichever side is loaded. */
const TRACK_DEFAULT = {
  title: 'Sacred Play Secret Place',
  artist: 'Matryoshka',
  album: 'Laideronnette',
  src: 'assets/sacred-play-secret-place.mp3',
  file: null,
  minutes: '05',
};
const TRACK = { ...TRACK_DEFAULT };
/* the blob URL of the track the user added, so the next one can let it go */
let objUrl = null;
/* ...and the ones the demo tape made for itself. These are never revoked: a
   side costs half a second to render, a blob URL is how it gets back into the
   audio element, and side B is only rendered the first time it is asked for —
   so dropping one on a swap would mean paying for it again on the next flip. */
const DEMO_URLS = new Set();
const releaseUrl = (u) => { if (u && !DEMO_URLS.has(u)) URL.revokeObjectURL(u); };
const audioEl = $('#tape-audio');
/* The four bars beside the track name, and with them the one envelope the whole
   picture follows — the bars, the dust's drift and the bloom all read it, so
   they can never disagree about where the beat is (see viz.js). */
const viz = createViz([...document.querySelectorAll('#now .eq i')]);
/* How hard the bloom is pushed this frame. 1 is the room's own value: the music
   rides on top of it rather than replacing it, and applyTheme() damps toward the
   product, so the two never fight over the same number. */
let bloomGain = 1;
let mode = 'idle';          // idle | play | rew
let muted = false;
/* The music's own level, and the only thing the wheel over the speaker changes.
   It used to be whatever the <audio> element defaults to — 1.0 — with the tape
   bed ducked to 0.30 to compensate; now the music sits at 0.10 to begin with and
   the bed keeps its own mix, which is what a transport actually does. */
let volume = 0.10;
const VOL_STEP = 0.05;
/* The tape bed is mixed *against* the music — 0.30 against a full-scale track is
   the balance that was tuned by ear — so it has to follow the wheel as well, or
   turning the music down would leave the hiss sitting on top of it. Muting still
   leaves the machine audible: that is the point of that state, and the one place
   the bed is set on its own. (Declared up here because ?p=1 reaches togglePlay
   during module evaluation, long before the rest of the volume wiring exists.) */
const bedLevel = () => (prefs.hiss ? (muted ? 0.45 : 0.30 * volume) : 0);
const audioOk = () => audioEl.readyState >= 2 && isFinite(audioEl.duration) && audioEl.duration > 0;

/* ============================== putting a track in =======================
   ★★ 这一段描述的是**老走带台**的换曲：纸标是一张烤好的贴图，换曲就是重写它 ——
   写头把新印样搬过去，用 SWAP_DUR 横过卡片，然后纸标才换图。磁带收起来之后没有
   纸标了（`relic.js` 的 `sweepLabel` / `stepHead` / `warmLabel` 是**有意的空操作**），
   换曲的可见过渡改归面板的雾涌；`setLabel()` 的返回值也不再存在（见 `applyTrack`）。
   留下来的只有**时刻**：`swap` 状态机仍然决定"页面从哪一帧开始说新曲目" ——
   `settleSwap()` 那一帧才写 `TRACK`、`st.duration`、芯片与标题。

   Everything the page says about the track changes on that last frame and not
   one frame sooner — the handwriting on the label, its MINUTES caption, the
   badge on the masthead, the chip in the middle, the two counters down in the
   corner, the tab's own title. That is why the new duration is held here rather
   than going straight to the cassette: it is the one piece of the change the
   browser hands over several hundred milliseconds *before* the print does.
   ======================================================================== */
const SWAP_DUR = 1.2;
const swap = { state: 'idle', p: 0, press: 0, dur: 0, play: false, seek: null, meta: null };
/* Every load carries a ticket. A load spends a few hundred milliseconds waiting
   on the media element, and REINITIALIZE can land inside that window — without
   this the load would come back from the await and print itself over the reset
   that just cancelled it. */
let loadSeq = 0;
const brandCode = $('#brand-code');
/* what the transport is actually holding, for the failure message: TRACK only
   catches up at the end of a swap, and by then the error has been reported */
let currentName = TRACK_DEFAULT.src;
let audioFailed = false;

const tapeMinutes = (dur) => String(clamp(Math.round(dur / 60), 1, 99)).padStart(2, '0');

/** the transport's read-out: the total is however long the loaded audio is */
function setDur() {
  const d = audioEl.duration;
  if (!isFinite(d) || d <= 0) return;
  // mid-swap the plate still reads the old length; land the new one with the print
  if (swap.state !== 'idle') { swap.dur = d; return; }
  cas.st.duration = d;
}
function setNowChip() {
  swapText($('#now-title'), TRACK.title);
  const credits = [TRACK.artist, TRACK.album].filter(Boolean).join(' · ');
  swapText($('#now-sub'), audioFailed ? '音频加载失败 · 她只做口型' : (credits || '未知曲目'));
}

/** the file's own length as a promise — the media element is the only thing that
    knows it. 2.5 s is generous for a local blob and short enough that a file the
    browser cannot decode does not leave the button stuck. */
function whenPlayable() {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(ok, 2500);
    function cleanup() {
      clearTimeout(timer);
      audioEl.removeEventListener('loadedmetadata', ok);
      audioEl.removeEventListener('durationchange', ok);
      audioEl.removeEventListener('error', bad);
    }
    function finish(v) { if (done) return; done = true; cleanup(); resolve(v); }
    function ok() { finish(isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0); }
    function bad() { finish(0); }
    audioEl.addEventListener('loadedmetadata', ok);
    audioEl.addEventListener('durationchange', ok);
    audioEl.addEventListener('error', bad);
    if (audioEl.readyState >= 1) ok();
  });
}

/** The one way a track gets into the shell. The audio element is switched first,
    so the metadata is already on its way while the tags are read; the rewrite
    then waits for a length, because a card printed with the previous track's
    minutes is a lie for exactly as long as the browser takes to answer. */
async function applyTrack({ title, artist, album, src, file }) {
  const seq = ++loadSeq;
  const stale = objUrl;
  objUrl = src.startsWith('blob:') ? src : null;
  const short = file?.name || src;
  currentName = short;

  if (cas.st.playing) togglePlay(false);      // the tape that was playing is gone
  mode = 'idle';
  document.body.classList.remove('rewinding');
  audioEl.pause();
  audioEl.src = src;
  audioEl.load();
  audioEl.currentTime = 0;
  /* A file the visitor brought was not synthesised here, so the picture has to
     listen to it — which needs a MediaElementSource, which file:// refuses. One
     attempt, and its failure is the keyframe animation (see viz.js). A side of
     the demo tape needs none of this: its bands were computed when it was. */
  if (!sideOf(src)) viz.listen(audioEl, audio);
  cas.setProgress(0);                         // and it sits at the head again
  document.body.classList.remove('no-audio');
  audioFailed = false;
  if (stale && stale !== src) releaseUrl(stale);

  swap.meta = { title, artist, album, src, file };
  swap.state = 'arming';
  swap.dur = 0;
  const dur = await whenPlayable();
  if (seq !== loadSeq) return;                // a reset overtook this load

  /* ★★ 这里原来是 `const staged = cas.setLabel(...)` 再 `swap.neu = staged.neu`。
     `setLabel()` 的返回值是老走带台的**纸标交接** —— `{ neu, old }`，写头扫过的
     那两张 2048px 画布。`relic.js` 的 `setLabel()` 没有返回值，于是 `staged.neu`
     读的是 `undefined` 的属性，抛 TypeError。
     **这个异常完全没有声音**：`applyTrack` 是**不被 await** 调用的（`playTrack` /
     `playSide` / 文件选择器），所以它只变成一条 `unhandledrejection`，而
     `showError()` 写的是**早就消失的 loader**（`if (loaderLbl.parentElement)`）。
     症状：点总目录里的曲子，音响照旧、面板照旧、芯片照旧 —— 只是那一首永远不装
     进来（实测 `tools/_swap.mjs`：`TypeError: … reading 'neu'`，芯片停在「静水」）。
     交接的下游（`swap.neu/old`）只服务 `ghosts`，而 `ghosts` 只由 `embrace()` 填，
     `embrace()` 只在 `TAPE_ON` 的遍历里被调用（`TAPE_ON = false`）→ **恒空**。
     所以整套交接随纸标一起拆掉；`setLabel()` 本身要留着 —— 它在音频元数据到来
     之前用 `minutes` 预告 `st.duration`。 */
  cas.setLabel({ title, artist, album, minutes: dur > 0 ? tapeMinutes(dur) : '--' });
  cas.sweepLabel(0);                          // parked off the leading edge
  audio.clunk(0.9);                           // the head comes down on the tape
  swap.p = 0;
  swap.state = 'sweep';
}

/** the write head crossing the card — cassette.js owns what the numbers mean */
function updateLabelSwap(dt) {
  // the light runs on its own clock and outlives the sweep, so this is ticked
  // before the state check rather than under it
  cas.stepHead(dt);
  if (swap.state !== 'sweep') return;
  swap.p = Math.min(1, swap.p + dt / SWAP_DUR);
  const k = ease.inOut(swap.p);
  cas.sweepLabel(k);
  // the machine takes the load: pressed down under the head, up again after it
  /* ★ 只写通道（同 intro.y）：写它的那三处都还在，读它的那一行
     （`cas.root.position.y = … - swap.press`）随磁带删了。换曲的可见过渡
     现在归面板的雾涌（relic.js 的 sweepLabel 是空操作）。 */
  swap.press = Math.sin(Math.PI * k) * 0.10;
  if (swap.p >= 1) settleSwap();
}

function settleSwap() {
  swap.state = 'idle';
  swap.press = 0;
  cas.commitLabel();
  /* ★★ 这里原来是"把纸标的幽灵副本挪到新贴图上，再 dispose 旧贴图"两行，
     第一行在 `ghosts` 里找、第二行**无条件** `for (const t of swap.old)`。
     `ghosts` 恒空、`swap.old` 从来不存在（见 `applyTrack`），所以第二行必抛
     TypeError —— 而它抛在**函数中段**，后面这一整串全部不执行：

       Object.assign(TRACK, swap.meta) · cas.st.duration · setNowChip()
       · swap.seek 的落位 · syncNowTrack() · swap.play 的延迟播放

     也就是"换曲永远不落地、换曲时按下的播放永远丢失"。实测
     `tools/_swap.mjs`：点目录里的曲目 → `TypeError: … reading 'old'`。
     纸标没了，这两行一起没了。 */

  Object.assign(TRACK, swap.meta);
  swap.meta = null;
  // no duration (a file the browser cannot decode) leaves the total where it
  // was, and the card keeps the '--' it was printed with
  if (swap.dur > 0) {
    cas.st.duration = swap.dur;
    swapText(brandCode, 'GH—' + tapeMinutes(swap.dur));
  }
  setNowChip();
  flashAdd(null);
  // a track picked out of the programme lands on its own head once the print has
  // committed — the same "wait for the tape, not the tape bed" rule the play
  // flag follows. seekTo() is the one path a position is ever set through, so
  // the rail and the counter come along without being told separately.
  if (swap.seek != null) { const f = swap.seek; swap.seek = null; seekTo(f); }
  // ...and the chip is re-read against where the tape actually ended up. The
  // loop may have already written it while this load was still arming (the
  // element carries the new src from the first await, the label only from
  // here), so the cache is dropped rather than trusted.
  shownTrack = null;
  syncNowTrack();
  // a play pressed while the head was moving waits for the tape, not the tape bed
  if (swap.play) { swap.play = false; togglePlay(true); }
}

/** the track that was loading is dropped without being read: nothing was ever
    printed with it, so there is nothing to put back */
function cancelSwap() {
  loadSeq++;                                  // ...and any load still waiting bails
  swap.state = 'idle';
  swap.press = 0;
  swap.meta = null;
  swap.dur = 0;
  swap.play = false;
  cas.warmLabel(false);
}

/** REINITIALIZE puts the shipped record back, print and all. No sweep: this
    button *is* the reset, and a reset that eases into place is not a reset. */
function reinitTrack() {
  if (swap.state !== 'idle') cancelSwap();
  if (objUrl) { releaseUrl(objUrl); objUrl = null; }
  const T = TRACK_DEFAULT;
  currentName = T.src;
  audioEl.pause();
  audioEl.src = T.src;
  audioEl.load();
  audioEl.currentTime = 0;
  cas.setProgress(0);
  audioFailed = false;
  Object.assign(TRACK, T);
  /* ★★ 同 `applyTrack`：`cas.setLabel()` 没有返回值，`staged.old` 必抛 TypeError。
     这一处比那一处**更重**，因为 `reinitTrack()` 是被 `reinit()` **同步**调用的
     （`main.js` 的 `#btn-reinit` 处理器），异常直接抛穿到点击处理器里，`reinit()`
     后半截的 `setTheme('studio')` / `orbit.setPreset(VANTAGES[0].v)` / `render()`
     全部不执行 —— 也就是**「重置」按下去什么也不重置**。
     实测 `tools/_swap.mjs`：`TypeError: … reading 'old'`，页面停在原地。 */
  cas.setLabel({ title: T.title, artist: T.artist, album: T.album, minutes: T.minutes });
  cas.commitLabel();
  cas.warmLabel(false);
  swapText(brandCode, 'GH—' + T.minutes);
  setNowChip();
  swap.dur = 0;
}

/* ---------- the demo tape's two sides -------------------------------------
   A side is one continuous piece of audio and a track is a region of it, so
   loading a side is applyTrack() with the side's own blob URL and nothing else:
   the duration, the rail, the counter, the label bake and the chip all follow a
   side for free, because they already follow a track.

   ensureSide() renders on demand — side A during boot, side B the first time it
   is asked for — and hands the same blob URL back every time after that, which
   is why the whitelist above exists. */

/** put side `i` in the shell, rewound to its head */
async function playSide(i) {
  const s = await ensureSide(i);
  if (!s) return;
  applyTrack({ title: s.label.title, artist: s.label.artist, album: s.label.album, src: s.url, file: null });
}

/** F is 翻面: the shell turns over *and* the tape changes with it — the one
    thing a real cassette cannot do and a rendered one can. setFlip() itself is
    left alone: the ?f=1 deep link and 重置 both call it, and neither wants a
    load. A face is the front, B face is the back.

    Unreachable while the shell is off — the F key and the button it mirrored are
    both gone — and kept because it is the *only* caller of playSide, which is the
    only thing that would put a side in by flipping. Nothing is locked away by
    that: side B is not behind 翻面, it is in the track list, which has always
    listed both sides (`buildIndex` walks SIDES) and always played them through
    playTrack. */
function flipSide() {
  setFlip(!flipped);
  playSide(flipped ? 1 : 0);
}

/** a track out of the programme: its side first, then its own head */
async function playTrack(si, ti) {
  const s = SIDES[si];
  if (!s) return;
  const k = s.tracks[ti];
  await ensureSide(si);
  // applyTrack runs synchronously as far as its first await, so `swap` is
  // already armed here and the position can be handed over before the sweep
  applyTrack({ title: s.label.title, artist: s.label.artist, album: s.label.album, src: s.url, file: null });
  swap.seek = k.start / s.dur;
}

/* deep-linkable state:  ?v=front&x=1&f=1&t=studio&p=1&ui=0&intro=0 */
const Q = new URLSearchParams(location.search);
/* `camera` is false while the intro is going to play. The intro *is* a camera
   move, so landing the URL's vantage on top of it cancels the whole thing —
   ?intro=1&r=03 should still open record 03, it just shouldn't grab the lens.
   Everything else in the query applies either way. */
function applyQuery(camera = true) {
  if (Q.get('ui') === '0') document.querySelector('.ui').style.display = 'none';
  if (Q.get('fps') === '1') {
    perfEl = document.createElement('div');
    perfEl.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:99;font:11px/1.4 Consolas,monospace;letter-spacing:.08em;color:#8dffb0;background:rgba(0,0,0,.55);padding:3px 10px;border-radius:99px';
    document.body.appendChild(perfEl);
  }
  if (Q.has('t')) setTheme(Q.get('t'), true);
  // through VANTAGES rather than a private table, so ?v=detail lands in the
  // same state as clicking there — including the panel narrowing itself
  const vk = camera && Q.has('v') ? VANTAGES.findIndex((x) => x.k === Q.get('v')) : -1;
  if (vk >= 0) { vi = vk; orbit.setPreset(VANTAGES[vk].v, true); }
  /* ★ 这里原来还有一个 `&& !Q.has('x')`。它当年是对的：`?x=1` 要带着**拆解态
     自己的取景**打开，所以它必须跳过"回位到 home"这一句，否则刚摆好的取景
     会被推回默认机位。拆解随磁带一起没有了（下面 TAPE_ON 里两个 flag 都被
     读掉、不报错），可这个例外留了下来 —— 于是 `?x=1` 成了一个**什么都不
     做、却改变取景**的 flag：它让镜头停在 Orbit 的初始值 (1.18, 1.34, 40)，
     而 `?x=0`、`?f=1` 以及任何别的单 flag 都回 home (0.62, 1.03, 33)。
     40 与 33 的半径差在画面上是一眼的事。一个已经不存在的功能不该再改变
     任何东西，所以例外去掉：flag 被读掉，取景照常。 */
  /* ★ 这一句原来是 `else if (camera && [...Q.keys()].length)` —— 只有"URL 带
     查询串"时才回位。零查询串那一支靠的是开场推轨**自己收尾在 home 上**，可
     是关掉「开场动画」之后这条腿就断了：`wantsIntro` 为假 → 不走 `runIntro()`
     → `applyQuery(true)` 里键数为 0 → 三处都不设镜头，页面就停在
     `new Orbit(...)` 的初始值 (theta 1.18, phi 1.34, **radius 40**)，而右侧
     面板报的是 01。40 与 31 差着一整档，症状就是"一打开镜头拉得特别远"。
     回位不该有条件。 */
  else if (camera) orbit.setPreset(orbit.home, true);
  // instant, like x=1 and r=: this URL exists to be screenshotted, and a flip
  // that eases over a second gets caught mid-turn. Both flags name a pose of the
  // shell, so with the shell off they are read and dropped rather than left to
  // open a thing nobody can see — the link still opens the room.
  if (TAPE_ON) {
    if (Q.get('f') === '1') setFlip(true, true);
    if (Q.get('x') === '1') setExplode(true, true);
  }
  // ?m=03 opens on that move: the id, not the index, so a link keeps working
  if (Q.has('m')) {
    const r = MOVES.findIndex((x) => x.no === Q.get('m').padStart(2, '0'));
    if (r >= 0) { ri = r; doMove(true); }
  }
  if (Q.get('p') === '1') togglePlay(true);
  if (Q.get('spin') === '1') setAuto(true);
  else if (Q.get('spin') === '0') setAuto(false);
  render();          // 'v' and 'm' both move state the panel has to reflect
}

/* ============================== annotations ============================= */
/* Every leader runs to the left edge: the right half of the frame belongs to the
   dossier, and a callout landing on top of the spec table is unreadable.
 *
 *  The order of this list *is* the order of the five rows down the left edge —
 *  `slot` is handed out as they are built, and the label's height is
 *  `0.20 + slot * 0.125` of the frame — so it is sorted by where each part has
 *  been lifted to *when the machine is open*, which is the only pose these appear
 *  in: the window goes up furthest (+3.05), then the top plate (+2.25), while the
 *  tape and its reels drop (−1.10) and the screws drop with the bottom plate
 *  (−2.25). Rows and leaders therefore travel together and stay out of each
 *  other's way, and the numbers run out of order down the column as a result:
 *  02 观察窗 over 01 象牙上壳, 05 轮毂与带盘 over 03 自攻螺钉. Those numbers are
 *  the dossier's file numbers — they name the part, and stay with it. Only the
 *  rows move. */
/* Empty, and that is the whole edit: every consumer below iterates this list —
   the DOM build, the width measure, the per-frame leader update — so a list with
   nothing in it leaves all three with nothing to do, and no `if` has to be added
   anywhere. The five labels name five parts of a shell nobody can see (TAPE_ON),
   and a leader is a line drawn to a thing: with the thing gone there is nothing
   for the line to point at. The rows are kept rather than deleted because they
   are the only written record of the numbers the exploded drawing used. */
const ANNOS = TAPE_ON ? [
  { key: 'glass', side: 'left', n: '02', t: '观察窗', s: 'PC 玻璃 · 透射 1.0' },
  { key: 'shell', side: 'left', n: '01', t: '象牙上壳', s: '聚碳酸酯 · 1.1 mm' },
  { key: 'hub', side: 'left', n: '05', t: '轮毂与带盘', s: 'POM · 六齿 · ⌀12' },
  { key: 'tape', side: 'left', n: '04', t: '磁带', s: 'γ-Fe₂O₃ · 3.81 mm' },
  { key: 'screw', side: 'left', n: '03', t: '自攻螺钉', s: '钢 · M2 × 5 · ×5' },
] : [];
const ui = document.querySelector('.ui');
const lines = $('#lines');
const slots = { left: 0, right: 0 };
for (const a of ANNOS) {
  const el = document.createElement('div');
  el.className = 'anno';
  el.dataset.side = a.side;
  el.innerHTML = `<u>${a.n}</u><b>${a.t}</b><i>${a.s}</i>`;
  ui.appendChild(el);
  a.el = el;
  a.slot = slots[a.side]++;
  const ns = 'http://www.w3.org/2000/svg';
  a.line = document.createElementNS(ns, 'line');
  a.dot = document.createElementNS(ns, 'circle');
  a.dot.setAttribute('r', '3');
  lines.append(a.line, a.dot);
  // the label's own transform depends on nothing but which side it hangs on,
  // so it is written once here rather than every frame out in the update
  el.style.transform = a.side === 'right' ? 'translate(-100%,-50%)' : 'translate(0,-50%)';
}
const measure = () => {
  for (const a of ANNOS) a.w = a.el.getBoundingClientRect().width;
};

const annoVec = new THREE.Vector3();
/* An SVG attribute written only when it has actually moved. This runs every
   frame, and a settled exploded view is a still diagram: sixty times a second
   it was writing five style strings, ten attributes and two opacities to values
   nothing had changed, which is a style recalculation and a layout of the label
   subtree per frame, plus a fresh string per value for the collector. The last
   value is kept on the annotation and compared first — as a number, so the
   string is only ever built when it is going to be used. */
const wAttr = (a, k, el, v) => { if (a[k] === v) return; a[k] = v; el.setAttribute(k, v); };
let explodedShown = null;
function updateAnnotations() {
  const e = cas.st.explode;
  const on = e > 0.02;
  if (explodedShown !== on) {
    explodedShown = on;
    document.body.classList.toggle('exploded', on);
    lines.style.opacity = on ? '1' : '0';
  }
  // shut, nothing is named: forgetting here is what keeps a later 拆解 from
  // resurrecting the name of whatever was read a while ago
  if (!on) { lastFocus = null; return; }
  // Which labels belong to this moment. A settled exploded view is the diagram,
  // so all five are named; a record names only its own part. Coming back together
  // is the third case and needs its own answer: the part you were reading keeps
  // its name while the shell closes and fades out with it, rather than the whole
  // diagram appearing for the length of the animation and fading afterwards.
  const closing = cas.st.explodeTarget < e - 1e-4;
  const solo = closing ? lastFocus : focusKey;
  const v = annoVec;
  const narrow = innerWidth < 900;
  for (const a of ANNOS) {
    // while a record is open, only its part keeps a leader line — the label is
    // hidden by CSS, but the line and dot are SVG and need telling separately
    const shown = (!solo && !closing) || a.key === solo;
    // The class is written here rather than in render() because which labels
    // belong on screen now depends on how far the shell has come back, and that
    // is a per-frame question. Style, not attribute: the labels these belong to
    // fade over 0.6 s, and a line that blinks out under a label that is still
    // fading reads as the annotation tearing in half. All three move together,
    // so one guard covers them.
    if (a.muted !== !shown) {
      a.muted = !shown;
      a.el.classList.toggle('mute', !shown);
      a.line.style.opacity = shown ? 1 : 0;
      a.dot.style.opacity = shown ? 1 : 0;
    }
    if (!shown) continue;
    cas.anchors[a.key].getWorldPosition(v).project(camera);
    const x = (v.x * 0.5 + 0.5) * innerWidth;
    const y = (-v.y * 0.5 + 0.5) * innerHeight;
    const lx = a.side === 'right' ? innerWidth - (narrow ? 24 : 56) : (narrow ? 24 : 56);
    // five callouts have to fit between the masthead and the deck, so the
    // spacing is set by that band rather than by the frame
    const ly = innerHeight * (0.20 + a.slot * 0.125);
    const lxr = lx + (a.side === 'right' ? (1 - e) * 40 : -(1 - e) * 40);
    if (a.lx !== lxr) { a.lx = lxr; a.el.style.left = lxr + 'px'; }
    if (a.ly !== ly) { a.ly = ly; a.el.style.top = ly + 'px'; }
    const ex = a.side === 'right' ? lxr - a.w - 12 : lxr + a.w + 12;
    wAttr(a, 'x1', a.line, ex); wAttr(a, 'y1', a.line, ly);
    wAttr(a, 'x2', a.line, x); wAttr(a, 'y2', a.line, y);
    wAttr(a, 'cx', a.dot, x); wAttr(a, 'cy', a.dot, y);
  }
}

/* ============================== theme =================================== */
function setTheme(name, first = false) {
  // a bad ?t= used to reach THEMES[name].env as undefined and take the whole
  // boot down with it
  if (!THEMES[name]) name = 'studio';
  const prev = themeName;
  themeName = name;
  // the whole room walks from here: one clock for the lamps, the exposure, the
  // grade, the floor and the background (see themeRate)
  if (!first) {
    themeP = 0;
    themeProbe = true;
    iblFrom = roomSrgb(THEMES[prev]);   // the room being left
    iblTo = roomSrgb(THEMES[name]);     // and the one being entered
  } else {
    iblFrom = iblTo = iblRef = roomSrgb(THEMES[name]);   // laid, not walked
  }
  document.documentElement.dataset.theme = name;
  // the segmented control is styled off a class, not off [data-theme], so it
  // has to be told. Without this the highlight sits on 白厅 no matter which
  // room you are actually standing in.
  for (const b of document.querySelectorAll('#theme button')) {
    b.classList.toggle('on', b.dataset.theme === name);
    b.setAttribute('aria-pressed', String(b.dataset.theme === name));
  }
  render();                               // the illumination column marks the live one
  scene.environment = envs[THEMES[name].env];
  setBackdrop(name, first);
  /* A deep link opens *in* a room; it does not walk into it. `first` already
     means "laid, not walked" for the IBL and the backdrop, and every other
     ?-flag lands settled for the same reason (`?x=1`, `?f=1`: the URL exists to
     be screenshotted, and anything that eases gets caught mid-move). The rig,
     the exposure and the grade were the one part of a theme that still eased in
     from whatever room the page happened to boot in — so `?t=noir` opened as a
     studio and spent the next second and a half becoming a darkroom. */
  if (first && rig && composer) applyTheme(0, true);
  if (rigPanels) {
    scene.remove(rigPanels);
    rigPanels.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    rigPanels = buildRigPanels(name, 2);
    scene.add(rigPanels);
    markProbeDirty();
  }
}

/** hand the incoming room to the second shell; `fadeBackdrop` walks it in */
function setBackdrop(name, first = false) {
  const map = backdropMaps[name];
  if (!map) return;
  if (first) {                                  // boot and deep links land settled
    backdrop.material.map = map;
    backdrop.material.needsUpdate = true;
    return;
  }
  // a fade already in flight: if it is more than half there, the room it is
  // carrying is the one the eye is in — promote it first, so the next room
  // fades in over what is actually on screen rather than over the one before it
  if (backdropIn.visible && backdropIn.material.opacity >= 0.5) {
    backdrop.material.map = backdropIn.material.map;
    backdrop.material.needsUpdate = true;
    backdropIn.material.opacity = 0;
  }
  backdropIn.material.map = map;
  backdropIn.material.needsUpdate = true;
  backdropIn.visible = true;
}

/* The room change runs on a clock, not on an exponential decay. A decay drops
   most of its range in the first third of a second: going brighter that is
   barely noticeable, and going darker it reads as the lights being cut — 白厅
   to 黑盒 came back as "突然变暗" for exactly that reason. This walks the
   transition linearly instead, eased at both ends, so the room gets dark at a
   rate the eye can follow.

   A rate cannot be written down in advance the way a decay can, because the
   distance each value has to cover differs; what is shared is the *progress*.
   For dx/dt = rate·(target − x) with rate = p′/(1 − q), the solution is
   x = x₀ + (target − x₀)·q — the damper every value here already uses, driven
   by a rate that turns it into a linear walk in q. Each value therefore lands
   exactly on q(p), which is what keeps a colour, a light *and* an opacity in
   step with each other no matter how far each has to travel. */
const THEME_DUR = 1.6;
let themeP = 1;                        // 0 → 1 while a room change is walking
function themeQ() {                    // eased progress, the shape every value lands on
  const p = themeP;
  return p * p * (3 - 2 * p);
}
function themeRate() {
  if (themeP >= 1) return 2.8;         // settled: back to an ordinary ease
  const s = themeQ();
  return (6 * themeP * (1 - themeP)) / (THEME_DUR * Math.max(1e-3, 1 - s));
}

function applyTheme(dt, instant = false) {
  const T = THEMES[themeName];
  themeP = Math.min(1, themeP + dt / THEME_DUR);
  const l = themeRate();
  rig.apply(RIG[themeName], dt, instant, l);
  const k = instant ? 1 : 1 - Math.exp(-l * dt);
  /* `instant` is documented at the boot call site as "land the whole preset
     before the first frame" — but damp(x, y, l, 0) is a *no-op*, not a snap, so
     everything that eases through damp() was staying on its default and then
     drifting into the preset over the first second of the page. k-scaled values
     snap; damped ones need telling. */
  const to = (cur, tgt) => (instant ? tgt : damp(cur, tgt, l, dt));
  /* 城堡的实用灯（窗光/火把/吊灯）、墙色、石板色与雾跟着同一个 k 走 ——
     换房时它和灯、地板一个步频，深链 (?t=) 快照落位也一样。 */
  castle.setTheme(themeName, k);
  renderer.toneMappingExposure += ((RIG[themeName].exposure ?? 1) - renderer.toneMappingExposure) * k;
  scene.environmentIntensity += ((RIG[themeName].envInt ?? 1) - (scene.environmentIntensity ?? 1)) * k;
  dust.mat.opacity = to(dust.mat.opacity, T.dust);
  floorBase.uniforms.color.value.lerp(T.cFloor2, k);
  floorBase.uniforms.uMix.value = to(floorBase.uniforms.uMix.value, T.floorMix);
  shadowCatcher.material.opacity = to(shadowCatcher.material.opacity, T.shadowOp);
  grade.uniforms.uHal.value = to(grade.uniforms.uHal.value, T.hal);
  const G = T.grade ?? {};
  // the bleed's colour walks with the room, because a warm halo on a cold
  // highlight is what makes a "cold" theme look like a filter
  if (T.cHalTint) grade.uniforms.uHalTint.value.lerp(T.cHalTint, k);
  grade.uniforms.uGrain.value = to(grade.uniforms.uGrain.value, G.grain ?? 0.05);
  grade.uniforms.uCA.value = to(grade.uniforms.uCA.value, G.ca ?? 0.85);
  // the vignette is the one grade value a setting owns: the dial scales whatever
  // depth the room asks for, so each theme keeps its own (see RIG) and 0 is the
  // off it used to be a switch for. The damping above walks it rather than
  // cutting it, which is also what makes the dial feel like it is turning
  // something rather than setting a number.
  grade.uniforms.uVig.value = to(grade.uniforms.uVig.value, (G.vig ?? 0.85) * prefs.vig);
  grade.uniforms.uSat.value = to(grade.uniforms.uSat.value, G.sat ?? 1);
  // the lens' own defocus is here so a room *can* own it; both rooms are at the
  // same numbers today
  grade.uniforms.uEdge.value = to(grade.uniforms.uEdge.value, G.edge ?? 1);
  grade.uniforms.uFocus.value = to(grade.uniforms.uFocus.value, G.focus ?? 0.26);
  if (bloom) bloom.strength = to(bloom.strength, (G.bloom ?? 0.32) * bloomGain);
  /* the glare is a lens, so it belongs to the room like the lamps do: each has
     its own colour, its own reach and its own threshold. Switching rooms walks
     all three rather than cutting them. */
  if (glarePass && T.glare) {
    glarePass.uniforms.uTint.value.lerp(T.cGlare, k);
    glarePass.uniforms.uStrength.value = to(glarePass.uniforms.uStrength.value, T.glare.strength);
    glarePass.uniforms.uStride.value = to(glarePass.uniforms.uStride.value, T.glare.stride);
    glarePass.uniforms.uThreshold.value = to(glarePass.uniforms.uThreshold.value, T.glare.threshold);
  }
  if (composer?.ao) composer.ao.strength = to(composer.ao.strength, T.ao ?? 1);
  poolMat.color.lerp(T.cPool, k);
  poolMat.opacity = to(poolMat.opacity, T.poolOp);
  /* Her grade, and the only one a room has over her. Two numbers, and they mean
     what they meant when she was a billboard: how much edge this room needs her
     to have. What changed is the machine. A SpriteMaterial samples no light and
     no environment — she was a photograph of a drawing — so a multiply into
     `material.color` was the whole of it. A 3D figure is *lit* by the rig, so
     tinting her body would be a filter over a photograph of a lit object, which
     is the one thing this page's lighting is careful never to do. Instead the
     rim goes where an edge actually belongs on a solid: a fresnel shell around
     her (`setRoom` in ghost.js), and the `tint` goes onto the sheet's own glow
     alone, at a whisper. */
  if (spirit) spirit.setRoom(T.cRim, T.spirit.rimOp, T.cTint, k);
  // the background crosses over on the same clock as everything else, and once
  // it has arrived the incoming room simply becomes the base. This replaces the
  // shutter dip that used to cover the map swap: there is nothing left to hide,
  // and a full-frame brightness drop is a flash the page should not be adding.
  if (backdropIn.visible) {
    const bm = backdropIn.material;
    bm.opacity = to(bm.opacity, 1);
    if (bm.opacity > 0.999) {
      backdrop.material.map = bm.map;
      backdrop.material.needsUpdate = true;
      bm.opacity = 0;
      backdropIn.visible = false;
    }
  }
  intro.fade = reduce ? 1 : damp(intro.fade, 1, 1.6, dt);
  grade.uniforms.uFade.value = intro.fade;
  applyIblFade(dt);
}

/* ============================== reflection probe ======================== */
/** the probe is captured from the subject's centre and filtered through PMREM;
    every cassette material reflects the rig *and* the cassette itself */
function bindProbe(tex) {
  if (!tex || !cas) return;
  for (const m of Object.values(cas.materials)) {
    if (!m || !m.isMaterial) continue;
    m.envMap = tex;
    if (!probeBound) m.needsUpdate = true;   // one recompile, then just swap
  }
  // the travelling ghost copies are not in `materials`; without this a part
  // caught mid-ghost when the theme changes keeps the old probe and goes flat
  for (const e of ghosts) {
    e.m.envMap = tex;
    if (!probeBound) e.m.needsUpdate = true;
  }
  // And neither are the write head's layers, which is worse: they are *meant* to
  // be invisible stand-ins for the label plates, so a layer outside this pipeline
  // is lit by a different room than the plate it covers. The reveal then reads as
  // a brightness band crossing the card — bright or dark depending on which way
  // the two rooms differ — and the frame the head is taken off it, the whole
  // label snaps back to the plate's shading. That snap is what looked like a
  // white light being switched off at the end of the sweep.
  for (const m of cas.headMaterials) {
    m.envMap = tex;
    if (!probeBound) m.needsUpdate = true;
  }
  probeBound = true;
}

/** A capture produces a whole new texture, and pointing every material at it is
    one uniform write — there is no gradual version of that. Blending two IBLs
    in the shader is a lot of machinery, so instead the tape's grip on the probe
    is walked down to nothing, the capture is taken there, and the new room's
    reflections come back up over the rest of the change (see applyIblFade).
    The capture is a step either way; this only decides whether anyone is
    looking at the frame it happens in. */
function markProbeDirty() { probeDirty = true; }

/* A room change always leaves the probe stale, and pointing every material at
   the new one is a single assignment — so the tape cannot be *faded* through a
   re-take. It is *matched* instead: whatever the room's brightness is at this
   moment, the tape holds that much light. The probe it is holding may be the
   outgoing room's or the incoming one's; `envMapIntensity` makes up the
   difference either way. That is what keeps the shell from going dark in the
   middle of a room change — a fade to nothing put the tape in the dark half a
   second before the room got there, which is a thing the eye reads
   immediately — and it also means the capture can land on any frame without the
   shell changing brightness. What does change at that moment is which room the
   reflections *are*, which is why the capture waits for the darker of the two
   rooms (see the loop).

   The room's own brightness is the backdrop's: two rooms crossing is an alpha
   blend of sRGB values, so that is the space this walks in, and the one
   conversion to light is the 2.2. */
let themeProbe = false;
let iblFrom = 1, iblTo = 1;              // the two rooms' sRGB luminances
let iblSrgb = 1, iblRef = 1;             // the room now, and the room the bound probe is
let iblK = 1, iblWritten = 1;            // the cassette's envMapIntensity, tracked

function writeIbl(k) {
  if (!cas) return;
  for (const m of Object.values(cas.materials)) if (m?.isMaterial) m.envMapIntensity = k;
  for (const e of ghosts) e.m.envMapIntensity = k;
  // ...and the write head's layers, which hold the same brightness as the plate
  for (const m of cas.headMaterials) m.envMapIntensity = k;
}
/** the backdrop's average luminance, in the sRGB the stops are written in */
function roomSrgb(T) {
  const l = T.bg.stops.reduce((a, [, hex]) => {
    const v = parseInt(hex.slice(1), 16);
    return a + 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
  }, 0);
  return l / T.bg.stops.length / 255;
}
iblSrgb = iblRef = roomSrgb(THEMES.studio);
iblFrom = iblTo = iblSrgb;

/** hold as much light as the room currently has, whichever room's probe is in
    hand. `iblWritten` makes this a writer only while it has something to say,
    which is also what keeps it away from the ghost list before that list
    exists. */
function applyIblFade(dt) {
  iblSrgb = themeProbe ? iblFrom + (iblTo - iblFrom) * themeQ() : iblTo;
  const want = Math.pow(iblSrgb / iblRef, 2.2);
  const next = damp(iblK, want, 11, dt);
  iblK = Math.abs(next - want) < 0.002 ? want : next;
  if (iblK === iblWritten) return;
  iblWritten = iblK;
  writeIbl(iblK);
}

/** Capture as if the room had already finished changing. The probe photographs
    the backdrop along with everything else, and for the first second of a theme
    change that backdrop is still crossing over — a capture taken then bakes the
    room we are leaving into the reflections for the rest of the session. Six
    cube faces render synchronously, so nothing but the probe sees this. */
function captureProbe() {
  const fading = backdropIn.visible;
  const held = backdrop.material.map;
  if (fading) {
    backdrop.material.map = backdropIn.material.map;
    backdrop.material.needsUpdate = true;
    backdropIn.visible = false;
  }
  // and the tape is mid-fade for the same reason — it is being captured
  // reflecting the room, and a cassette with its IBL switched off reflects
  // nothing, so the probe would bake a matte body into every later reflection
  // of itself
  const heldK = iblK;
  if (heldK !== 1) writeIbl(1);
  const tex = probe.capture();
  if (heldK !== 1) writeIbl(heldK);
  themeProbe = false;                    // whichever room asked for it, it is fresh now
  iblRef = iblTo;                        // and it is this room's light the tape is holding
  if (fading) {
    backdrop.material.map = held;
    backdrop.material.needsUpdate = true;
    backdropIn.visible = true;
  }
  bindProbe(tex);
}

/* ============================== boot ==================================== */
const loaderBar = $('#lbar'), loaderLbl = $('#llbl'), loaderPct = $('#lpct');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
function showError(msg) {
  console.error(msg);
  if (loaderLbl.parentElement) {
    setRoll(loaderPct, '错误');
    riseText(loaderLbl, String(msg).slice(0, 160));
    loaderLbl.style.color = '#e0684a';
  }
}
addEventListener('error', (e) => showError(e.error?.stack || e.message));
addEventListener('unhandledrejection', (e) => showError(e.reason?.stack || e.reason?.message || String(e.reason)));
async function step(label, pct, fn) {
  riseText(loaderLbl, label);
  loaderBar.style.width = pct + '%';
  setRoll(loaderPct, pct + '%');
  await nextFrame();
  await fn?.();
  await nextFrame();
}

async function boot() {
  /* The tape's own pressing, rendered before there is a machine to put it in.
     Side A is the one that has to exist; side B waits until it is asked for
     (see flipSide). Half a second of arithmetic — but it is the only step here
     that is pure CPU, so it goes first, while the loader is already up and the
     bar has somewhere to go. */
  await step('正在合成演示音频', 8, async () => {
    const side = await ensureSide(0);
    DEMO_URLS.add(side.url);
    Object.assign(TRACK_DEFAULT, side.label, { src: side.url, minutes: tapeMinutes(side.dur) });
    Object.assign(TRACK, TRACK_DEFAULT);
    currentName = side.url;
    // the element used to be given its src by the markup, which pointed at a
    // file the repository does not ship. Now the tape is handed to it here, and
    // setDur() in the next step is what turns the media's own length into the
    // counter's total.
    audioEl.src = TRACK.src;
    audioEl.load();
    swapText(brandCode, 'GH—' + TRACK.minutes);
  });
  await step('正在建立几何体', 12, () => {
    cas = createRelic({
      title: TRACK.title, artist: TRACK.artist, album: TRACK.album, minutes: TRACK.minutes,
      // 厅的地面。烛台的底座落在它上面，不落在 y=0 —— 见 relic.js 的 ★★
      floorY: FLOOR_Y,
    });
    scene.add(cas.root);
    /* The shell is built and then hidden, not skipped: building it is what
       defines the room's scale (the rig's reach, the floor's shadow catcher, the
       probe's capture volume all measure against it), and the sprite is sized
       against it below. Skipping the build to save the work would mean every one
       of those numbers becoming a guess. See TAPE_ON. */
    /* 幽魂烛台是磁带的继任者 —— 它是**看得见**的，不受 TAPE_ON 管辖
       （那个开关管的是磁带外壳，磁带已经不在了）。 */
    cas.root.visible = true;
    /* Her feet are on the floor, not at the room's centre: `center` is (0.5, 0),
       so this one number is where she touches down. The cassette was a flat
       object lying at y ≈ 0 and the camera still looks there, which is what
       leaves her standing in the lower half of the frame with the room's height
       above her — the composition the shell had, kept. */
    /* She is built, not loaded: no mesh file, no texture file, no font — every
       surface is a primitive or a canvas the page draws at boot (see
       ghost.js). Which is why this line takes no URL and why the single-file
       deliverable stayed single-file when she stopped being a billboard. */
    spirit = createGhost({ height: SPIRIT_H, y: FLOOR_Y });
    scene.add(spirit.root);
    /* The room she is born into. `applyTheme` already ran while the query string
       was being read, which is *before* this line, so its `setRoom` found no
       spirit and did nothing — leaving the aura on the pale placeholder colour.
       In a white hall that means she glows instead of drawing a contour, and a
       cold load would disagree with a theme switch. One call here fixes both. */
    {
      const T = THEMES[themeName];
      spirit.setRoom(T.cRim, T.spirit.rimOp, T.cTint, 1);
    }
    /* One read-only hook, for the probes. `tools/_sing.mjs` has to ask "is she
       singing, and does that move her more" from outside a closure, and every
       number it wants is inside one. It writes nothing, the page never reads it,
       and it exists because the alternative — inferring it from the picture —
       already produced one false regression report: the probe measured her hover
       footprint, which was a faithful proxy for her scale while she was a
       billboard and became meaningless the day she turned into a solid.
       `aimX` / `aimY` are here for the same reason `_sing` is: "she looks at the
       pointer" is a claim about a *sign*, and a sign is exactly the kind of
       thing that inverts in a refactor without anything on screen looking
       obviously wrong. `tools/_pick.mjs` puts the pointer left of her and then
       right of her and reads these. */
    Object.defineProperty(window, '__spirit', {
      configurable: true,
      value: {
        /* 探针的相机/场景读数口（castle 调试用；页面自己不读） */
        get cam() { return camera.position.toArray().map((n) => +n.toFixed(1)); },
        get kids() { return scene.children.map((o) => o.type + ':' + o.name + ':' + o.children.length); },
        get fogv() { return scene.fog ? [scene.fog.near, scene.fog.far, scene.fog.color.getHexString()] : null; },
        /* 城堡的实用灯与火苗可见性。火把在世界 y=4.9、锥体半径 0.15 —— 标准
           机位框不到，"火把在霜厅里熄着没有"这句话用截图是证不出来的（试过：
           两种机位都框不到那面墙的上半）。所以让页面把数字说出来。 */
        get castle() { return castle ? castle.debug() : null; },
        get sing() { return spirit ? spirit.sing : null; },
        get bob() { return spirit ? spirit.bob : null; },
        get action() { return spirit ? spirit.action : null; },
        /* `action` says which clip is running; `pose` says whether the clip is
           *doing* anything. `tools/_moves.mjs` checks the first and cannot check
           the second, which is how two action channels (`arm`, `lift`) sat in
           ghost.js for a whole round with nothing reading them. */
        get pose() { return spirit ? spirit.pose() : null; },
        get aimX() { return spiritAim.x; },
        get aimY() { return spiritAim.y; },
        get hover() { return spiritHover; },
      },
    });
    rig = createRig(scene);
    // the shell only breathes slowly, so the shadow map does not need a full
    // re-render every frame — refresh it on alternate frames instead
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    setDur();
    audioEl.addEventListener('loadedmetadata', setDur);
    audioEl.addEventListener('durationchange', setDur);
    audioEl.addEventListener('error', () => {
      // the loader is already gone by the time a late 404 lands, so the failure
      // has to say so somewhere the user can still see: the now-playing chip
      audioFailed = true;
      document.body.classList.add('no-audio');
      if (swap.state === 'idle') setNowChip();
      showError('音频加载失败（' + (audioEl.error?.code ?? '?') + '）：' + currentName);
    });
    audioEl.addEventListener('ended', () => {
      mode = 'rew';
      cas.st.driven = false;
      cas.st.playing = true;
      cas.st.dir = 1;                                    // spool back, then play again
      document.body.classList.add('rewinding');
    });
    setNowChip();
  });
  await step('正在合成材质与纹理', 42, () => {});
  await step('正在烘焙环境光照', 68, () => {
    envs = createEnvironments(renderer);
    for (const k of Object.keys(THEMES)) backdropMaps[k] = TX.backdropTexture(THEMES[k].bg);
    // softboxes as geometry on a hidden layer, so the probe sees the rig
    rigPanels = buildRigPanels('noir', 2);
    scene.add(rigPanels);
    // the probe sits outside the shell, above and in front: from there it sees
    // the lighting rig *and* the cassette's own body, so glossy and chrome parts
    // pick up the studio and their neighbouring parts in the same reflection
    probe = createProbe(renderer, scene, { size: 512, at: [0, 2.4, 3.4] });
  });
  await step('正在解算自反射', 78, () => {
    captureProbe();
  });
  await step('正在编译着色器', 88, () => {
    composer = createComposer(renderer, scene, camera);
    grade = composer.grade; bloom = composer.bloom; glarePass = composer.glare;
    setTheme(themeName, true);
    applyTheme(0, true);          // land the whole preset before the first frame
  });
  await step('准备就绪', 100, async () => {
    onResize();
    // Every ghost copy is built now and held on its mesh just long enough for
    // the compiler to see it. three keys a program on `opaque`, and a ghost is
    // transparent, so each one needs a second program — built lazily that was a
    // burst of compiles on the first frame of the first 读取, i.e. the picture
    // stopping for a beat the instant you click. Pay for it here instead.
    const restore = [];
    cas.assembly.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material)) return;
      restore.push([o, o.material]);
      o.material = ghostFor(o).m;
    });
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    for (const [o, src] of restore) o.material = src;   // parts stay real until asked

    // Compiling them is not enough on its own. three keeps a program only while
    // some material is using it, and a compile pass hands the materials back
    // straight away — so the variants that only a ghost ever asks for (the
    // transparent pass *and* the probe's cube-UV envmap sampling) are dropped
    // again, and the first 读取 of each record re-links three to eight of them on
    // the spot. Measured: 75 programs after boot, +8 the first time 轮毂 is
    // read, +3 more for 上壳, and nothing at all on the second read of the same
    // record — i.e. they survive once built. So build them here and *use* them:
    // one real frame per entry, behind the loader, and every later click is
    // free. (This walks MOVES because MOVES is what is left of the record list;
    // the count only has to be ≥ 1, since what is being kept alive is a program
    // rather than a record.)
    for (const M of MOVES) {
      applyFocus(M.key ?? null);
      composer.composer.render();
    }
    applyFocus(null);
    // and put the scene back exactly as a settled ghost fade would leave it:
    // every part on its own material, in its own draw order, painted at k = 0
    for (const e of ghosts) {
      paintGhost(e, 0);
      e.o.material = e.base;
      e.o.renderOrder = e.order;
      e.live = false;
    }
    ghosts.length = 0;
    composer.composer.render();
    // ...and the write head's two layers, which stay invisible until a track is
    // loaded. A program is built on the first frame a material is *drawn*, so
    // without this the first sweep would build two of them on the frame it
    // starts — a stutter in the middle of a move. Open the window over the print
    // that is already on the card: nothing changes on screen, and it is still
    // behind the loader.
    cas.warmLabel(true);
    composer.composer.render();
    cas.warmLabel(false);
  });
  document.body.classList.add('ready');
  measure();
  render();
  pinSoon();           // measured with a record's sheet in it, not an empty one
  applyPrefs();        // the remembered switches, now that there is a scene to apply them to
  // ?intro=1 forces it and ?intro=0 refuses it — any other query at all, which is
  // how a link meant to be photographed lands, has never played it. Otherwise the
  // setting decides.
  const qIntro = Q.get('intro');
  const wantsIntro = qIntro === '1' ? true : qIntro === '0' ? false
    : prefs.intro && ![...Q.keys()].length;
  if (!wantsIntro) intro.fade = 1;
  else runIntro();
  applyQuery(!wantsIntro);
  loop();
}

/* ============================== intro =================================== */
/* ★ `y` 与 `tilt` 现在是**只写通道**：唯一的读者是主循环里的
   `cas.root.position.y = intro.y + bob - swap.press`，那一行随磁带一起删了
   （幽魂烛台站在地上，自己的呼吸归 relic.update）。下面的 `onUpdate` 仍在
   每帧往里写，但没有任何东西会因此动 —— 想改"开场升起"的量，改这里不会有
   任何效果，得先给它一个读者。`spin` 与 `fade` 仍有读者（烛环的自转、
   grade 的 uFade），是活的。 */
const intro = { y: 0, tilt: 0, spin: 0, fade: 0 };
/* The lift starts *on* the floor, not under it. Coming up through the floor
   from below meant the tape spent the first two seconds of the page buried in
   a sheet it has no business being inside — and every frame of that was a
   slab pushing through a plane, which is the one thing this scene is otherwise
   careful never to do. It now waits on the floor for 0.7s (long enough to be
   seen resting there) and then floats up to the height it belongs at. */
const FLOOR_REST = FLOOR_Y + DIM.hd;

/* linear for most of the way and eased out into the last of it. A straight
   ease over this distance spends the whole travel braking and never reads as a
   rise; a straight line arrives like a lift. This is the shape the hover has:
   a rate, with the floor coming up to meet it. */
const LIFT = (t) => (t < 0.62 ? (t / 0.62) * 0.82 : 0.82 + 0.18 * ease.out((t - 0.62) / 0.38));

let tl = null;
function runIntro() {
  if (reduce) {
    intro.fade = 1; intro.y = 0; intro.tilt = 0;
    orbit.setPreset(orbit.home, true);
    return;
  }
  intro.y = FLOOR_REST; intro.tilt = 0; intro.spin = 2.4; intro.fade = 0;
  orbit.theta = orbit.gTheta = 1.32;
  orbit.phi = orbit.gPhi = 1.38;
  orbit.radius = orbit.gRadius = 42;
  tl = new Timeline();
  tl.add({
    delay: 0.7, dur: 2.4, ease: LIFT,
    onUpdate: (e) => { intro.y = FLOOR_REST * (1 - e); },
  });
  tl.add({ delay: 3.6, dur: 0, onDone: markProbeDirty });   // the probe was captured before the lift
  tl.play();
  orbit.setPreset(orbit.home, false);
  if (orbit.tween) orbit.tween.dur = 3.4;
}

/* ============================== the index ===============================
   Everything the page can do is a file in an index. Five columns of them:
   ←/→ walks the columns, ↑/↓ walks the files inside one, and ENTER — or the
   ACCESS FILE button, or a second click on an already-selected row — reads
   the file. Reading is what actually moves the scene, so browsing the list is
   free and nothing changes under you while you are reading it.

   The labels are functions wherever a file is a toggle, so the dossier always
   names the action it is about to perform rather than the state it is in.
   ===================================================================== */
/* The model does not turn by itself until asked to. 巡览 used to start on, and
   the same switch also gates the slow drift the camera picks up after a drag
   (controls.js scales it by the eased auto weight), so leaving it off means the
   tape simply holds still until something moves it. */
let exploded = false, flipped = false, autoRotate = false;

/* ---------- the introduction: one page, and it does not change ----------
   The plate used to file her under six headings — the whole spirit and the five
   features the drawing was made of — one record per part, each with its own
   sheet and its own framing. That was the right shape for a machine on a
   plinth. She is not a machine and she does not come apart, so the six have
   been folded back into the one thing they were all standing in for.

   THE COLOURS ARE STILL SAMPLED, NOT INVENTED. Every hex below came out of the
   reference she is keyed to — the sculpt in `BV1xRho6DEG4` (blender 新手教程·
   简单幽灵模型), whose finished look is the video's opening frame: deep violet
   witch hat with a gold band and a crimson underside, a white sheet lit from
   inside by an aqua glow, two red eyes of *different sizes*, and a red-handled
   broom. `ghost.js` builds her out of the same set, so the archive describes
   the model rather than an idea of it:
     帽面靛紫 #372370 · 檐底猩红 #C62B2B · 金带 #C9A24E
     床单白 #E8F2F3 · 体内青光 #86F0F5 · 眼 #2A1218 / #B0332A
   The numbers here are ALBEDO, not the sampled pixel. The video is a dark room
   with one strong key, so a sample comes back darker than the material is —
   the brim's underside samples at #94212E, the hat's shadow at #1E103F. Put
   those on a surface that has its own lights and the model goes black. Same
   reason the white is a hair cooler than the reference's #EFFBFC: a lit solid
   needs a base that is not already at the top of the tone curve, or every
   highlight clips and she reads as fog. */
const PROFILE = {
  no: '01',
  cn: '小幽灵',
  en: 'Little Ghost · 会唱歌的精灵',
  note: '一顶歪戴的紫色女巫帽、一条会发光的床单，和一柄比她手臂还长的红柄扫帚。'
      + '她飘在半空，帽尖被谁拧过一道弯；体内那点青光跟着歌走——唱到高处就亮一档，'
      + '停下来便慢慢暗回去。两只眼睛不一样大，右眼的那一颗高光是特意点的。',
  /* 这几行是 `ghost.js` 里 `C` 的**反照率**，不是从视频里采到的像素值 ——
     采样到的是那盏强主光下的受光色，写进图鉴会跟模型对不上。改 `C` 就得
     改这里，否则档案开始描述一个不存在的颜色。（上一轮就漏改过一次：
     `C` 里的 `hatTop` 从 0x3D2C6E 换成了 0x372370、`hatUnder` 从 0xA8202C
     换成了 0xC62B2B，这张表还停在旧值上。） */
  spec: [
    ['本体', '布灵 · 幽灵'],
    ['别称', '小幽灵'],
    ['体高', '6.38'],
    ['帽面靛紫', '#372370'],
    ['檐底猩红', '#C62B2B'],
    ['金带', '#C9A24E'],
  ],
};

/* ---------- the moves ----------
   Five things she can be asked to do, and the one new part of the page. Each is
   a pose rather than a bare button: `cn` is what the panel prints, `k` is the
   clip of the same name in `ghost.js`, and `note` is the line the 目录 card
   prints — what she does, in words. So picking one from the list, from the
   ticks, from the keyboard, or by clicking her all land in the same place, and
   there is no second code path that can drift out of agreement with the first.

   HOW CLOSE THE LENS MAY COME IS A NUMBER, NOT A TASTE — and the number lives
   in `VANTAGES` (up by Orbit) now, because the lens belongs to the visitor.
   The envelope is still 6.38 tall — the same ceiling the crown used to reach —
   but this one *hangs*: her hem floats 0.80 above the floor and the hat tip
   lands where her head did, so the four vantages frame the same box they always
   did and none of them had to move. The frame at distance r is `2·r·tan(15°)`
   tall, and the aim is the capsule's centre, so the margin is unchanged. A
   tighter close-up would need the aim itself to rise, which is a change to
   controls.js rather than to a number. */
/* ★ A MOVE DOES NOT TOUCH THE CAMERA. It used to: each of the five carried its
   own `view` — a framing picked to flatter that particular gesture — and
   choosing one swung the lens onto it over 1.6 s. Two things were wrong with
   that. The obvious one is that the visitor asked her to nod, not to be
   re-framed; the lens travelling is a *bigger* motion than the nod, it arrives
   over the same second, and it is the one you end up watching. The subtler one
   is that a move's framing was the reason `vi` could be −1 — and `vi < 0`
   already meant something else: "the shell is open, there is no vantage to
   name". One variable, two meanings, and the read-out had to guess which. The
   lens now belongs to the visitor alone (`VANTAGES`, ← →); a move is only a pose.

   `note` replaces the old 机位 / 距离 / 俯仰 read-out on the 目录 cards. With the
   framing gone those three numbers described nothing, and a card that says what
   she does is worth more than one that says where the lens used to go. */
const MOVES = [
  { no: '01', k: 'nod', cn: '点头', en: 'Nod', note: '整只下沉两次' },
  /* `k` stays `wave` — `GREETINGS`, the deep link `?m=02` and the clip's name in
     ghost.js all key off it. What she does is sway the whole sheet, because she
     has no arms to wave; the label says what actually happens, the way 05 says
     掀帽 for a clip still called `salute`. */
  { no: '02', k: 'wave', cn: '晃一晃', en: 'Sway', note: '以地板为轴左右摆，扫帚同向甩' },
  { no: '03', k: 'spin', cn: '转个圈', en: 'Twirl', note: '绕竖直轴转一圈，升起后停住' },
  { no: '04', k: 'jump', cn: '跳一跳', en: 'Hop', note: '跃起并做挤压拉伸' },
  /* `k` stays `salute` — the deep link `?m=05` and the clip's name in ghost.js
     both key off it. What she does is doff the hat, so the label says that. */
  { no: '05', k: 'salute', cn: '掀帽', en: 'Tip the hat', note: '把帽子掀起来并歪向一侧' },
];

/* What the read-out names when there is no vantage to name: the shell is open
   and the lens has pulled back off the shelf entirely. This used to be a move's
   own framing, which is why a move used to print a vantage nobody had picked.
   `VANTAGES` 不在这里 —— 它搬到上面 Orbit 旁边了，因为 `orbit.home` 必须指向
   `VANTAGES[0].v`，而 `const` 在声明之前是 TDZ，没法在下面引用。 */
const NO_VANTAGE = { cn: '拆解全览', en: 'Exploded' };

/* `vi < 0` no longer means "a move brought its own framing" — moves do not move
   the lens any more. It means the shell is open and there is no vantage to name. */
let ri = 0, vi = 0;               // move, vantage
let savedVi = 0;                  // the vantage an exploded pull-back stepped away from
const cur = () => MOVES[ri];
const MACRO = VANTAGES.findIndex((v) => v.k === 'detail');

const D = {
  colCn: $('#col-cn'), colCn2: $('#col-cn-2'), colEn: $('#col-en'),
  colI: $('#col-i'), colN: $('#col-n'),
  fileno: $('.fileno'), caret: $('.fileno .caret'),
  fileId: $('#file-id'), fileCn: $('#file-cn'), fileEn: $('#file-en'),
  fileNote: $('#file-note'), fileSpec: $('#file-spec'), doc: $('.doc'),
  selI: $('#sel-i'), selN: $('#sel-n'),
  refList: $('#ref-list'), cols: $('#cols'),
  dossier: $('#dossier'), dbody: $('#dbody'), fold: $('#btn-fold'),
  // the plate's own box, and the two pieces of furniture it has to live between
  // — see pinPanel
  sheet: $('.sheet'), mast: $('.mast'), transport: $('.transport'),
};
D.colN.textContent = String(VANTAGES.length).padStart(2, '0');
D.selN.textContent = MOVES[MOVES.length - 1].no;

/* the move list and the ticks, built once. The moves never change — only which
   of them is selected — so `render` only ever toggles their classes, and the
   markers get to slide instead of being replaced mid-stride. */
const refRows = [], ticks = [];
for (let i = 0; i < MOVES.length; i++) {
  const m = MOVES[i];
  /* ONE CLICK ASKS FOR IT. This used to take two — the first selected, the
     second fired — on the theory that browsing a list should not yank the
     camera. But this column is not an index, it is the interaction area: every
     row is one of the five things she can be asked to do, and asking has to be
     one gesture. Selection still follows the click, and it has to happen
     *before* `doMove`, because `doMove` reads `cur()` — the lit row and the
     clip that is running are the same statement. */
  const pick = () => { ri = i; doMove(); };

  const b = document.createElement('button');
  b.className = 'row';
  b.innerHTML = `<span class="rn">${m.no}</span><span class="rt">${m.cn}</span><i class="rd"></i>`;
  b.addEventListener('click', pick);
  const li = document.createElement('li');
  li.appendChild(b);
  D.refList.appendChild(li);
  refRows.push(b);

  const t = document.createElement('button');
  t.className = 'tick';
  t.title = `${m.no} · ${m.cn}`;
  t.setAttribute('aria-label', `${m.no} ${m.cn}`);
  t.addEventListener('click', pick);
  D.cols.appendChild(t);
  ticks.push(t);
}

/* ---------- ghosting: the part you are reading stays real ----------
   The parts that step aside travel to the ghost over about half a second
   rather than being swapped onto it. Everything the ghost is — its grey, its
   flatness, its transparency — is reached by animating the material's own
   uniforms: colour, roughness, metalness, clearcoat and normal scale all walk
   to the target, and the opacity follows them down. The old version cut
   straight to a translucent grey material, and next to a camera move and an
   explode that both ease, that one hard cut read as a glitch.

   The travelling copy has to be per-mesh, because the originals are shared:
   every part using `M.shell` points at the same material, so dimming one would
   dim all of them. The clone is made once, at boot, and kept — after that the
   only thing changing per frame is uniforms, so nothing recompiles. Building
   them lazily put the *first* program of each transparent variant on the first
   frame of the first read instead; see the warm-up in `boot`.

   The ghost is deliberately darker than the room, not paler: the room is
   already near-white, and a light ghost dissolves into it and turns the frame
   to mush. depthWrite stays off so a ghost never occludes the part you asked
   to see. */
const GHOST = {
  color: new THREE.Color(0x8a8375),
  opacity: 0.30, roughness: 0.92, metalness: 0, env: 0.25,
};
/* A transparent object cannot occlude anything, so whatever is drawn *after* it
   blends straight over the top — and the floor, the shadow catcher and the light
   pool are all transparent, sitting at renderOrder 1–3, i.e. after every ghost
   (they were all at 0). The floor fragment seen through the cassette is far
   beyond it, and the floor's own radial fade means that when the lens looks
   *down* at the shell, that fragment is close enough to be near full opacity.

   So look down and every ghost was painted over by the floor: a part fading
   back in never appeared to change at all. It stayed buried until the frame it
   went opaque, wrote depth, and had the floor rejected all in one go — which is
   the part snapping into existence instead of materialising. Looking from a low
   angle the floor behind the shell is past its fade radius and contributes
   nothing, which is why that view looked right.

   Ghosts therefore sort after the floor group, and in front of the window glass
   — transparent too, and it belongs on top of everything inside the shell. */
const GHOST_ORDER = 4;
const ghosts = [];

function focusSets(key) {
  const P = cas.parts;
  const reels = new Set(P.reels.map((r) => r.grp));
  switch (key) {
    case 'shell': return { keep: new Set([P.gTop]), drop: new Set([P.glass]) };
    case 'glass': return { keep: new Set([P.glass]) };
    case 'screw': return { keep: new Set([P.screwd]) };
    case 'tape': return { keep: new Set([P.gTape]), drop: reels };
    case 'hub': return { keep: reels };
    default: return null;
  }
}

let focusKey = null;
/* The part that was last named. A record names its own part, and that name has
   to outlive the record for as long as the shell takes to come back together —
   reading 整机 (or pressing E to close) clears focusKey on the first frame of the
   collapse, and without this the whole five-line diagram flashes up for the
   length of the animation and only then fades. */
let lastFocus = null;

/** the travelling copy for one mesh, created once and kept for the life of the
    page. Originals are shared — every part using `M.shell` points at the same
    material, so fading one would fade them all — hence one copy per mesh. */
function ghostFor(o) {
  let e = o.userData._g;
  if (e) return e;
  const src = o.material;
  const m = src.clone();
  m.transparent = true;
  m.depthWrite = false;
  // three renders a transparent DoubleSide material as two passes, flipping
  // `side` and setting needsUpdate each time — which re-acquires one program and
  // releases the other, and a released program is destroyed, so the next frame
  // compiles both again. Forever. The tape is DoubleSide, so every frame the
  // ghosted tape lived was two shader builds: reading 上壳 (tape ghosts) hitched
  // and reading 磁带 (tape stays real) did not, which is exactly what the
  // compile counter showed. forceSinglePass is three's own flag for this; the
  // ghost is a 30% grey stand-in, so the blend order the second pass buys is
  // not worth a shader build per frame.
  m.forceSinglePass = true;
  e = o.userData._g = {
    o, m, base: src, k: 0, t: 1, live: false, order: o.renderOrder,
    src: {
      color: src.color.clone(),
      opacity: src.opacity,
      roughness: src.roughness,
      metalness: src.metalness,
      clearcoat: src.clearcoat,
      sheen: src.sheen,
      env: src.envMapIntensity,
      ns: src.normalScale ? src.normalScale.clone() : null,
    },
  };
  return e;
}

function embrace(o) {
  const e = ghostFor(o);
  // the probe can have been re-captured since this copy was made (they are all
  // made at boot now), and a stale envMap is the one thing that would show
  e.m.envMap = e.base.envMap;
  if (o.material !== e.m) o.material = e.m;
  o.renderOrder = GHOST_ORDER;      // see GHOST_ORDER: the floor draws first
  e.t = 1;
  if (!e.live) { e.live = true; ghosts.push(e); }
}

function release(o) {
  const e = o.userData._g;
  if (e) e.t = 0;
}

/** k = 0 is the part's own material, k = 1 is the ghost */
const DEFINE_FLOOR = 0.004;
function paintGhost(e, k) {
  const m = e.m, s = e.src;
  m.color.copy(s.color).lerp(GHOST.color, k);
  m.opacity = s.opacity + (GHOST.opacity - s.opacity) * k;
  /* A transparent object cannot occlude anything: whatever is drawn after it
     blends over the top, even when it is behind. The reels are the clearest
     case — the wound pack is a full disc of the reel's own radius, its top face
     sits *below* the hub's top ring, and it is the later of the two in draw
     order, so a hub fading back in stayed washed grey under the disc until the
     frame it went opaque and depth took over.

     Once a part is opaque enough that it is hiding things anyway, let it write
     depth. Whatever is genuinely in front of it still blends as it should, and
     everything behind it is rejected however the sort ordered the two. A ghost
     proper (0.30) and the 0.30 window glass never reach the line, so neither of
     them ever starts occluding. */
  m.depthWrite = m.opacity >= 0.7;
  m.roughness = s.roughness + (GHOST.roughness - s.roughness) * k;
  m.metalness = s.metalness + (GHOST.metalness - s.metalness) * k;
  // three builds a shader program per *whether* clearcoat and sheen are on
  // (`HAS_CLEARCOAT = material.clearcoat > 0`, same for sheen), so easing either
  // one down to exactly zero compiles a fresh program on that frame — a dozen of
  // them landing together as the fade ends, which is the hitch a beat after
  // 读取 on the parts that carry both. Stop a hair short instead: at 0.004 the
  // layer contributes nothing visible and the define never flips.
  if (s.clearcoat > 0) m.clearcoat = Math.max(s.clearcoat * (1 - k), DEFINE_FLOOR);
  if (s.sheen > 0) m.sheen = Math.max(s.sheen * (1 - k), DEFINE_FLOOR);
  if (s.env !== undefined) m.envMapIntensity = s.env + (GHOST.env - s.env) * k;
  if (s.ns) m.normalScale.set(s.ns.x * (1 - k), s.ns.y * (1 - k));
}

function updateGhost(dt) {
  for (let i = ghosts.length - 1; i >= 0; i--) {
    const e = ghosts[i];
    if (Math.abs(e.t - e.k) > 0.0015) {
      e.k = reduce ? e.t : damp(e.k, e.t, 5.0, dt);
      paintGhost(e, e.k);
    } else if (e.k !== e.t) {
      e.k = e.t;
      paintGhost(e, e.k);
    }
    if (e.t === 0 && e.k === 0) {
      e.o.material = e.base;          // back on the shared original
      e.o.renderOrder = e.order;
      e.live = false;
      ghosts.splice(i, 1);
    }
  }
}

function applyFocus(key) {
  focusKey = key;
  if (key) lastFocus = key;
  const sets = key ? focusSets(key) : null;
  /* With the shell hidden this walk has no audience: the meshes it swaps
     materials on are invisible, and a ghost is transparent, so every part it
     touches costs a second shader program built for a fade nobody can see (see
     TAPE_ON). It is moot on the data as well — every record's `key` is null now,
     so the only thing the walk could still do is release parts that were never
     embraced. */
  if (TAPE_ON) cas.assembly.traverse((o) => {
    // the write head's layers are a transition device rather than a part: they
    // are only on screen while a track is being loaded, and the ghost system's
    // per-frame opacity is the one thing that would fight the sweep
    if (!o.isMesh || Array.isArray(o.material) || o.userData.noGhost) return;
    let keep = !sets;
    if (sets) {
      for (let n = o; n && n !== cas.assembly; n = n.parent) {
        if (sets.drop?.has(n)) { keep = false; break; }
        if (sets.keep.has(n)) { keep = true; break; }
      }
    }
    if (keep) release(o); else embrace(o);
  });
  document.body.classList.toggle('focused', !!key);
  // the labels' own visibility is set every frame in updateAnnotations: which of
  // them belong on screen also depends on the shell coming back together, and
  // that is not something this function is called to see
}

/* a record is "live" when it is the one on screen and the scene is actually
   showing it — the unit record is live only while the shell is shut */
const live = (r, i) => i === ri && (r.key ? focusKey === r.key : !exploded && focusKey === null);

/* Changing record rewrites the sheet that is being read — its name, its note and
   its specs. Without this it reads as text being overwritten in place, and the
   eye has nothing to follow; restarting a keyframe on it gives the change a
   direction. It is only that sheet: the number has a cursor of its own to be
   written by, the breadcrumb and the counters are one line each, and the
   reference list is the thing being clicked — a whole-panel flash took all of
   them with it, including the row under the pointer. */
function swapIn(h0) {
  const el = D.doc;
  /* The sheet is re-ruled as well as rewritten: the rule under the file number
     and the one under REFERENCE AREA draw themselves in from the left, which is
     what says a fresh slip has been laid on the plate rather than the old one
     edited. A class rather than a style so the two rules can be given different
     delays in CSS; `offsetWidth` is the forced restart, and it is one read on a
     record change. */
  clearTimeout(reprintT);
  D.dossier.classList.remove('reprint');
  void D.dossier.offsetWidth;
  D.dossier.classList.add('reprint');
  reprintT = setTimeout(() => D.dossier.classList.remove('reprint'), 900);
  /* A grow from the last pick may still be in flight. Put the box back on auto
     before measuring, or this one reads the height the last one is passing
     through and walks to a height that was never the sheet's. (Nothing is painted
     in between — the layout is read and written inside one frame.) */
  clearTimeout(docT);
  el.classList.remove('grow');
  el.style.height = '';
  el.classList.remove('swap');
  void el.offsetWidth;
  el.classList.add('swap');
  /* The sheet is a different length for every record — a spec row more or less, a
     note a line longer — and rewriting it used to move everything under it in a
     single frame. Held to the height it had for one frame and walked to the one
     it needs on the same clock as the fade above, the growth is one motion: the
     button under it rides down at the speed the box grows, because it is in the
     flow of that box and nothing else has to animate. */
  const h1 = el.getBoundingClientRect().height;
  if (reduce || !(h0 > 0) || Math.abs(h1 - h0) < 0.5) return;
  el.style.height = h0 + 'px';
  el.classList.add('grow');
  void el.offsetHeight;                  // let the old height be the starting one
  el.style.height = h1 + 'px';
  clearTimeout(docT);
  docT = setTimeout(() => {
    el.classList.remove('grow');
    el.style.height = '';                // back to auto, at the height it landed on
  }, 460);
}
let docT = 0;
let reprintT = 0;

/** Where the panel hangs from, how long it may be, and whether the reader can
    scroll it. Set on resize and when the plate's own column changes width —
    never on a record change, or the panel would walk up the screen one record at
    a time.

    Three numbers, all measured:

    * `--panel-half` — half the plate's length. `top` used to be
      `50% - half`, i.e. centred on the frame.
    * `--panel-top` — where it is allowed to start. ★ Centring on the frame is
      fine until the window is short: measured at 1440x600 the plate's top lands
      11px above the masthead's bottom and its bottom 20px below the transport's
      top, and at 1100x460 that becomes 70px and 56px, with the action cells
      printing on the counter's read-out (1612px² of glyph over glyph). Half of
      the plate's length was only ever half of the question; the other half is
      where the band between the masthead and the bar actually is.
    * `--band` — how long the band is, and therefore the plate's ceiling.

    The clamp below is written so that it returns exactly the old
    `50% - h/2` at every size where the plate already fits, which is every size
    above ~600px of viewport height: nothing moves there by a pixel. It only
    engages in the band where the plate genuinely does not fit, and there it
    keeps the record on screen instead of letting it print on the furniture. */
function pinPanel() {
  const d = D.dossier;
  /* Below 900px none of the three numbers applies, and saying so is the point.
     Down there the plate is a bottom sheet — `top: auto; bottom: 20rem`, its
     length capped by the 900 block's own `max-height` — so `--panel-top` and
     `--band` are read by nothing. Left alone they kept whatever the last wide
     window had measured, and the probe printed `top=226.7px` at 900x700 for a
     plate that ignores it: a number that reads as a measurement and is not one.
     Removed rather than stale. The query is the same one the stylesheet tests,
     so the two cannot disagree about which side of 900 they are on. */
  if (matchMedia('(max-width: 900px)').matches) {
    d.style.removeProperty('--band');
    d.style.removeProperty('--panel-top');
    d.style.removeProperty('--panel-half');
    syncSheetScroll();
    return;
  }
  /* ★ Drop the overflow class before measuring anything, and this is not
     housekeeping: `.dossier.overflow .sheet` carries `scrollbar-gutter: stable`,
     so while the class is on the record is laid out in a column about fifteen
     pixels narrower than the one it is about to have. Coming back up from a
     narrow window — where the class was on — the first pin would measure that
     narrower column and store a `--panel-half` for a plate whose record then
     re-wraps when `syncSheetScroll` takes the class off at the end of this
     function. Same failure as the resize one below: a number measured on a
     layout the page never settles at. The 700ms re-pin in `pinSoon` covered for
     it, so it only ever showed up as the two readings disagreeing.
     `syncSheetScroll` at the end puts the class back if it still belongs. */
  d.classList.remove('overflow');
  /* Read the plate's *natural* length through the ceiling, or a plate that was
     capped last time reports the cap and the pin never recovers. */
  d.style.setProperty('--band', 'none');
  const nat = d.getBoundingClientRect().height;
  /* `body.ready` slides this whole layer up 14px over 1.2s and a rect taken
     during that is 14px low. `offsetTop` is transform-free, so the gap between
     the two is the slide, and taking it out makes the pin independent of when
     it is measured. */
  const slide = D.mast.getBoundingClientRect().top - D.mast.offsetTop;
  const mastB = D.mast.getBoundingClientRect().bottom - slide;
  const tt = D.transport.getBoundingClientRect().top - slide;
  const band = Math.max(0, tt - mastB);
  const h = Math.min(nat, band);
  const top = Math.min(Math.max(innerHeight / 2 - h / 2, mastB), tt - h);
  d.style.setProperty('--band', band.toFixed(1) + 'px');
  d.style.setProperty('--panel-top', top.toFixed(1) + 'px');
  if (h > 0) d.style.setProperty('--panel-half', (h / 2).toFixed(1) + 'px');
  syncSheetScroll();
}

/** A scroll container nobody can touch is not a scroll container.

    Below 900px the plate is a bottom sheet with `overflow: auto`; above it, the
    band clamp in `pinPanel` caps it. In both cases a long record is *meant* to
    be scrolled, and in both cases it never could be: `.ui` is
    `pointer-events: none`, so the wheel went straight through the plate to the
    canvas and zoomed the lens, and the scrollbar could not be grabbed at all.
    Measured at 900x700 the plate is 116px tall carrying 289px of record — nine
    of thirty-five lines on screen and no way to reach the rest. This is the same
    failure the file already documents once, where a ceiling was added, measured
    and taken back out for exactly this reason (see the note above the 900
    block); the missing half of that fix is here.

    The plate claims the pointer only while it is actually overflowing, so on
    every record that fits, a drag on the paper still turns the model. */
/* ★ Why a slack and not zero: the class is not free. Turning it on gives the
   plate the wheel, which takes the wheel *away* from the lens — the retract this
   page is built around. So it has to mean "there is a line down there you cannot
   see", not "the content box is a pixel taller than the padding box". And it
   almost never means the latter in a way that matters: the plate's own bottom
   padding is 20px and a spec row is 19px, so anything under 8px of overflow is
   padding. Measured at 1092x588 — the viewport this page is actually looked at
   in — the capped plate overflows by exactly 3px, which with a zero slack took
   the zoom away from the whole right-hand third of the frame to reveal nothing. */
const SHEET_SLACK = 8;
function syncSheetScroll() {
  D.dossier.classList.toggle('overflow', D.sheet.scrollHeight > D.sheet.clientHeight + SHEET_SLACK);
}

/* Pin now, and pin again once the layout has landed.

   A forced layout taken inside the resize handler disagrees with the same layout
   half a second later. Measured at 1092x588 by sampling the two numbers this
   function reads: the masthead's bottom is 134.6px in the handler and 117.4px at
   +0ms, then 114.5px from +400ms on — it is still moving for a third of a second
   after the resize, and the plate, pinned from the first reading, came out 17px
   short of the room it actually had (a 351.8px ceiling on a 368.9px record, with
   a scrollbar for the difference, on the one viewport this page is looked at in).

   A timer and not `requestAnimationFrame`: frames here are seconds long under
   software rendering, so two of them is anywhere between 30ms and 6s, which is
   how the same build measured 351.8px in one run and 369px in the next. 700ms
   clears the .58s margin-left retract that starts the whole thing, and does not
   care what the frame rate is. */
let pinTimer = 0;
function pinSoon() {
  pinPanel();
  clearTimeout(pinTimer);
  pinTimer = setTimeout(pinPanel, 700);
}

/* The pin is a function of the *column's* width, not of the window's. A resize
   changes the plate's width in two steps — the dossier's own width, and then the
   .58s `margin-left` retract transition on top of it — and measuring on the
   window's resize event caught the intermediate one: at 1092x588 `--panel-half`
   came out 208.7px for a plate that is 368.9px tall (half = 184.5), so the plate
   sat 23px above where the code believed it was. Watching the plate itself is
   the only way to pin it to the layout it actually has.

   Width only, and that is the whole trick: a record change alters the plate's
   *height*, which must move nothing — the same rule the window-resize pin always
   had — while a width change means the record has reflowed into a different
   column and the pin is stale.

   Two things are watched. `.sheet` for the column (its own box only changes when
   the column does), `.dbody` for the record — a taller record inside a capped
   plate does not resize the plate, so watching the plate alone would never
   notice that it now overflows. */
/* ★ Why the masthead is watched too. The band the plate is clamped into starts at
   the masthead's bottom, and that height is `.brand h1`'s — whose font-size is
   `clamp(1.625rem, 3.05vw, 3.125rem)`, i.e. a function of the viewport width.
   Anything that moves it (a width change, a face that lands late, the nav
   wrapping) changes the only number this whole function is built on, and the
   plate has to be re-pinned when it does. Watching it is cheaper than knowing
   why it moved, and there is at least one "why" this code cannot see: under
   `Emulation.setDeviceMetricsOverride` — which every probe uses — a *real*
   property like `font-size` can be one viewport behind while a custom property
   like `--pad` is already current, so `mast.b` reads 134.7px where the page's
   own layout says 114.5px. See the note in tools/_ov.mjs.

   A pixel of slack on the height: the brand block's three children settle by
   about 0.7px each after the first reading (see the noise floor in _ov.mjs), so
   an exact comparison would re-pin on rounding. */
let pinnedW = -1;
let pinnedMastH = -1;
let watchTimer = 0;
const plateWatch = new ResizeObserver(() => {
  /* ★ Deferred by one task, and that is not politeness — it is a repair. This
     callback writes `--band`, `--panel-top` and the `.overflow` class, and that
     is layout; an observer that resizes its own target inside its own callback
     is what Chrome reports as "ResizeObserver loop completed with undelivered
     notifications". That is a page error, and `_dbl.js` and `_song.mjs` both
     fail a run on page errors — every assertion in them was green and the run
     still came back red. Nothing here needs to happen inside the observer's
     frame, so it happens after it. */
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    const w = Math.round(D.sheet.getBoundingClientRect().width);
    const mh = Math.round(D.mast.getBoundingClientRect().height);
    if (w !== pinnedW || Math.abs(mh - pinnedMastH) > 1) {
      pinnedW = w; pinnedMastH = mh; pinSoon(); return;
    }
    syncSheetScroll();
  }, 0);
});
plateWatch.observe(D.sheet);
plateWatch.observe(D.dbody);
plateWatch.observe(D.mast);

/* A last pin once the faces have landed. The band is measured from the
   masthead's bottom, and the masthead's height is the brand block's — an H1, a
   rule of small caps and the file number, all in the display face — so a swap
   from fallback metrics moves the number this whole function is built on.

   Honest about what it buys: on a warm cache `fonts.ready` is already resolved
   when boot reaches here, so this changes nothing and the first pin is still up
   to 1.4px tight — measured at 1440x820, the first reading puts the masthead's
   bottom at 134.7px and every later one at 130.2..133.3 (each of the three
   children loses about 0.7px). It errs the safe way: a tighter band caps the
   plate sooner, never later. What this line is for is the cold cache, where the
   swap genuinely lands after boot and the pin would otherwise be taken against
   a font that is about to be replaced. */
if (document.fonts?.ready) document.fonts.ready.then(pinSoon);

/* Folded, the panel has vacated the middle of the frame, so the subject takes
   it; open, the subject keeps to the left half. This is the single writer for
   the view offset — explode and record framing used to set it directly, and
   three writers meant whichever ran last won. */
function syncViewShift() {
  // Folded, the panel retracts to the right and the subject takes the middle.
  // The tape is ~36% of the frame wide, so at 0.05 its right edge lands around
  // 63% — clear of the retracted panel, which starts at 80%.
  viewShiftTarget = exploded ? 0.10 : (folded ? 0.05 : 0.155);
}

/* The panel's length is not a state that gets toggled, it is a function of how
   close the lens is. It rests 20% short (the CSS default) and gives up another
   30% over the run from the home framing to the closest the wheel will come,
   linearly. The far end is clamped: pulling back out past the home framing is
   not a reason for the panel to grow into the frame. Damping is the margin-left
   transition the fold already runs on, so a wheel still turning is a target that
   keeps moving rather than a second smoothing stacked on top of the first. */
const GIVE_FROM = orbit.home.radius, GIVE_TO = orbit.minR, GIVE_MAX = 30;
/* Where the shortening stops being a shorter panel and becomes no panel.

   A notch and a half short of the closest framing: 让出 45%, the column down to
   55% of its length. Pushed all the way to the stop it was too late — the fold
   only arrived once the lens had nothing left to do — and a third of the way in
   (30%, then 33%) was too early, so the line sits just inside the end of the
   travel now, and 收起详情 is still there for folding a readable panel by hand at
   any framing. Pushing it deeper is one number: 让出 40% is FOLD_AT 20.

   One line, crossed both ways. It used to fold at ten points of give but only
   unfold back at zero — the framing right in at the home radius — so pulling the
   wheel out to where it had just left from left the panel away, and it took
   another two thirds of a retreat to bring it back. The wheel's own position is
   the thing the eye is holding while it scrolls, so that is the thing the fold
   follows: the same line in both directions.

   What it is *not* is a pure function of where the wheel is. The decision is
   taken on the crossing, not on the side the wheel happens to be on: otherwise
   收起详情 could not be used at all — every frame would put the panel straight
   back the way the wheel wants it — and that button is the one way to fold a
   perfectly readable panel out of the way. Between crossings, whatever it is
   stays what it is. Nothing flaps on the line either: a notch is about five
   points of give at this end of the range, so there is no landing on it. */
const FOLD_AT = 25;
let lastGive = 0;              // where the wheel stood when the fold last looked
const giveFor = (r) => clamp((GIVE_FROM - r) / (GIVE_FROM - GIVE_TO), 0, 1) * GIVE_MAX;

let given = -1;
function syncPanelGive() {
  const give = giveFor(orbit.radius);
  // this lands on an element that is already animating, every frame; a tenth of
  // a percent is well under anything the transition can show
  if (Math.abs(give - given) < 0.1) return;
  given = give;
  D.dossier.style.setProperty('--give', give.toFixed(1));
}

/* One writer for the fold, and two reasons to want it. 细节特写 is one: that
   vantage puts the lens in close enough that the tape runs under this column, so
   the vantage folds the panel itself, deliberately and at once — it used to be
   asked to shorten 34% and ended up folding anyway, two beats late, because the
   distance mapping had already taken more off it than that. The wheel is the
   other, once the shortening has gone past 30% (FOLD_AT above).
   Both read the wheel's *target*, not the damped radius: the camera eases in
   asymptotically and would never quite arrive at the clamp, and the fold has to
   fire on the notch that asks for it rather than a second later. The latch is
   what keeps the two from arguing over the panel — whatever it is between the
   lines stays, so one unfolded by hand stays unfolded. */
let wantFold = false;
function syncPanelFold() {
  const give = giveFor(orbit.gRadius);
  const over = give >= FOLD_AT;
  const wasOver = lastGive >= FOLD_AT;
  lastGive = give;
  let want = wantFold;
  if (vi === MACRO) want = true;
  else if (over !== wasOver) want = over;      // the wheel crossed the line
  if (want === wantFold) return;
  wantFold = want;
  setFold(want);
}

let folded = false, foldCamT = 0;
function setFold(on) {
  folded = on;
  D.dossier.classList.toggle('folded', on);
  D.fold.setAttribute('aria-expanded', String(!on));
  D.fold.textContent = on ? '展开详情' : '收起详情';
  // the camera moves on the second beat: it waits for the body to finish
  // collapsing, then travels in with the retract. Unfolding is the reverse —
  // the camera comes back first, while the body is still shut.
  // the delay exists to wait out the panel's own two-beat collapse; with the
  // transitions off there is nothing to wait for
  clearTimeout(foldCamT);
  if (on && !reduce) foldCamT = setTimeout(syncViewShift, 400);
  else syncViewShift();
}
D.fold.addEventListener('click', () => {
  setFold(!folded);
  audio.tick();
  document.body.classList.add('moved');
});

/* ---------- the number, written rather than switched ----------
   The bar beside the file number is a nib, not a cursor (it does not blink — see
   .caret), and it works the number over the way a hand would: a stroke to the
   left laying a mask down behind it, a beat with the whole number covered, then a
   stroke back to the right taking the mask away again.

   The mask is what does the erasing. The nib does not delete digits one at a
   time, which pops a glyph out of the line every time it moves — it covers them:
   the digits to its right are hidden under a clip whose edge *is* the nib, so the
   number is wiped away rather than eaten. Nothing is removed until all of it is
   under the mask, and that is where the old digits trade places with the new ones
   — where nobody can see it happen. The clip is on the number alone: the label
   beside it, the rule under it, the panel and the scene are all untouched.

   Three things have to line up for this to read, and only the first is obvious:
   the nib's edge has to be on the mask's edge (it is the nib that hides the hard
   cut, so it is centred on it); the nib has to travel *past* the number, not stop
   at it (its stroke is twice the number's width, which carries it out into the
   gap and leaves it standing just short of the label); and the stroke has to
   arrive — fast off the mark, slowing, stopped — because a nib that slides in at
   a constant speed and reverses reads as a wipe rather than as a hand.

   Driven from the main loop's clock like everything else in the scene: a CSS
   animation would run in wall-clock time, and the mask would drift out from under
   the nib the moment a frame cost more than the last. */
/* Off the mark, slowing, stopped — the shape a hand has. A stroke spends most of
   its deceleration on the overrun past the number (the mask is already across
   before the nib has finished travelling), so the phases are kept short: the wipe
   is the first half of a stroke and the rest of it is the nib settling. */
const NO_ERASE = 0.30, NO_HOLD = 0.12, NO_TYPE = 0.36;
/* How far one stroke runs, as a multiple of the number's own width. Past 1 the
   nib clears the far end of the number and comes to rest just outside it; at
   exactly 1 it stops on the last digit, which reads as being cut short. */
const NO_TRAVEL = 1.75;
const no = {
  on: false, phase: 0, p: 0, d: 0, d0: 0, lead: 0, w: 0, travel: 0, cap: 2, from: '', to: '',
};
let noText = D.fileId.textContent;        // the value, not whatever is painted
const NO_STROKE = (t) => ease.out(t);     // fast, then slowing, then stopped

/** one instant of the stroke.
    `d` is how far the nib has travelled from where it stands at rest, `lead` is
    the distance between that rest and the near end of the number, so the mask
    only starts to cover once the nib has crossed the lead and it is full — for
    the rest of the stroke — at the far end of the number. */
function paintNo() {
  const m = clamp(no.d - no.lead, 0, no.w);       // how much of the number is under it
  D.fileId.textContent = no.phase === 0 ? no.from : no.to;
  D.fileId.style.clipPath = m <= 0.02 ? '' : `inset(0 ${m.toFixed(2)}px 0 0)`;
  D.caret.style.transform = `translate(${(-no.d).toFixed(2)}px, .06em)`;
}

function endNo() {
  no.on = false;
  no.d = 0;
  D.fileId.textContent = noText;
  D.fileId.style.minWidth = '';
  D.fileId.style.clipPath = '';
  D.caret.style.transform = '';
}

/** the one writer of the number. `animate: false` is how a deep link lands — that
    URL exists to be photographed, and a nib caught mid-stroke is not it. */
function setFileNo(text, animate = true) {
  if (text === noText) return;
  noText = text;
  if (!animate || reduce) { endNo(); return; }
  /* A browse that lands mid-stroke carries on from where the nib is. An erase or
     a beat that is interrupted only retargets — the mask is already where it is,
     and `to` is the whole of what changes. A *return* that is interrupted turns
     the nib around: it goes back over the digits it had been revealing, which is
     what a hand does when it changes its mind halfway through a line. */
  if (!no.on) { no.from = D.fileId.textContent; no.d = 0; no.phase = 0; no.p = 0; }
  else if (no.phase === 2) { no.from = no.to; no.phase = 0; no.p = 0; }
  /* phase 0 (mid-erase): the stroke carries on — same clock, same mask, and only
     the destination changed. phase 1 (the beat): the mask is already across, so
     the beat finishes and the new number is revealed under it. */
  no.d0 = no.d;
  no.to = text;
  no.cap = Math.max(no.from.length, no.to.length, 1);
  no.on = true;
  D.fileId.style.minWidth = no.cap + 'ch';   // the reserve has to be in place first
  no.w = D.fileId.getBoundingClientRect().width;   // so this reads the box, not the text
  // the nib's rest sits one flex gap clear of the number, so the mask cannot
  // start until it has crossed that gap; and it is centred on the mask's edge,
  // because a 6px nib is the only thing hiding that cut
  const gap = parseFloat(getComputedStyle(D.fileno).columnGap) || 0;
  no.lead = gap + D.caret.offsetWidth / 2;
  no.travel = no.w * NO_TRAVEL;
  paintNo();
}

/** land it settled (deep links, reduced motion, a reset) */
function snapFileNo() {
  if (no.on) endNo();
  else D.fileId.textContent = noText;
}

function updateFileNo(dt) {
  if (!no.on) return;
  no.p += dt / (no.phase === 0 ? NO_ERASE : no.phase === 1 ? NO_HOLD : NO_TYPE);
  if (no.p >= 1) {
    if (no.phase === 0) {
      no.phase = 1;                       // the mask is across: now the beat, and the
      no.p = 0;                           // two numbers trade places inside it, where
      no.d = no.travel;                   // nothing of either of them can be seen
      paintNo();
      return;
    }
    if (no.phase === 1) {
      no.phase = 2;
      no.p = 0;
      no.d = no.travel;
      paintNo();
      return;
    }
    endNo();
    return;
  }
  // The beat stands still — nib and mask both. (Falling through to the stroke
  // below was the bug: the beat has no travel of its own, so it recomputed the
  // position from the erase's starting point and threw the nib back to the right
  // for a tenth of a second before the return began.)
  if (no.phase === 1) return;
  no.d = no.phase === 2
    ? no.travel * (1 - NO_STROKE(no.p))    // ...and the return is a stroke too: fast
    : no.d0 + (no.travel - no.d0) * NO_STROKE(no.p);   // off the mark, then stopped
  paintNo();
}

/* One function writes the plate, and it now has two sources rather than one.
   `PROFILE` is the half that does not change — who she is, printed once — and
   `MOVES[ri]` is the half that says what the page is about to do. The profile
   half is stamped with `dataset.no` the way the spec rows always were, because
   `render` runs on every arrow press and theme switch and a rebuild would drop
   hover state; the move half is pure class toggling, so it costs nothing. */
function render(bump = false) {
  const M = cur();
  // measured before the sheet is rewritten: swapIn() walks the box from this
  const docH = D.doc.getBoundingClientRect().height;
  swapText(D.colCn, PROFILE.cn);
  setFileNo(PROFILE.no);
  D.fileCn.textContent = PROFILE.cn;
  D.fileEn.textContent = PROFILE.en;
  D.fileNote.textContent = PROFILE.note;
  setRoll(D.selI, M.no);
  /* ★ 那句「让她X」的按钮没了（2026-10-04）。它曾经是"当前选中"唯一的显式回显；
     现在回显落在五个格子上：`.row.sel` 是面板显示的那一个、`.row.done` 是场景
     正在显示的那一个、`.row.playing` 是此刻真的在动的那一个 —— 见下面的循环。 */
  // only rebuild the spec rows once — render runs on every arrow press and
  // theme switch, and a rebuild drops hover state
  if (D.fileSpec.dataset.no !== PROFILE.no) {
    D.fileSpec.dataset.no = PROFILE.no;
    D.fileSpec.replaceChildren(...PROFILE.spec.map(([k, v], i) => {
      const li = document.createElement('li');
      // the row's index, for the cascade in styles.css: the table arrives in
      // order rather than as one block
      li.style.setProperty('--i', i);
      li.innerHTML = `<span>${k}</span><b>${v}</b>`;
      return li;
    }));
  }

  // 细节特写 folds the panel (see syncPanelFold). This is the state it falls
  // back into if that fold is undone by hand: still narrowed, because the tape
  // is still running under the column, but with the spec table back on screen
  D.dossier.classList.toggle('tight', vi === MACRO);

  // the vantage read-out falls back to the move's own framing, and says so
  const V = vi >= 0 ? VANTAGES[vi] : null;
  setRoll(D.colI, V ? String(vi + 1).padStart(2, '0') : '--');
  swapText(D.colCn2, V ? V.cn : NO_VANTAGE.cn);
  swapText(D.colEn, V ? V.en : NO_VANTAGE.en);

  // the move list and the ticks are the same five moves at two sizes. Both
  // were built once, further up — rebuilding them here would replace the
  // elements, and a fresh element starts already in its final state, so the
  // marker would jump instead of sliding
  for (let i = 0; i < MOVES.length; i++) {
    const l = live(MOVES[i], i);
    /* Toggled one class at a time, and that is not style. `className = ...` is
       shorter and it is exactly what this line used to be — back when a row had
       two states. It has three now, and this function owns two of them, so
       writing the whole attribute wipes the third: `.playing`, which belongs to
       `syncMoveButtons` and is the only one that changes on its own clock.
       Symptom, measured: `?m=02` opened on the right move, she waved, and the
       row never lit — `render()` runs on the same frame as, and after,
       `syncMoveButtons()`, so the class was applied and erased 60 times a
       second. */
    refRows[i].classList.toggle('sel', i === ri);
    refRows[i].classList.toggle('done', l);
    ticks[i].className = 'tick' + (i === ri ? ' on' : '') + (l ? ' done' : '');
  }
  syncIndexSel();
  if (bump) swapIn(docH);
}

/* Doing a move is the one action that changes the scene: she plays the clip and
   the lens goes to the framing that clip was staged for. Browsing with the
   arrows only moves the cursor, so nothing jumps under you while you read.

   Every way in — this button, a row, a tick, the index, ENTER — comes through
   here, so the clip and the camera can never disagree about which move is
   running. */
/* Ask her for a pose. That is the whole job — see MOVES for why the lens is not
   part of it. `vi` is deliberately left exactly where the visitor put it. */
function doMove(instant = false) {
  const M = cur();
  /* It does not move the lens, and it does not want the lens moving: a row click
     cancels any pending return-to-vantage so nothing drifts across the frame
     while she performs. */
  homeArmed = false;
  if (spirit) spirit.play(M.k);
  syncMoveButtons();
  /* The shell is hidden, so there is nothing left to isolate and nothing to
     explode: `applyFocus(null)` is a no-op and `exploded` stays false, which is
     what `live()` reads. The calls are kept rather than deleted so a move and a
     record leave the page in the same state. */
  applyFocus(null);
  exploded = false;
  cas.setExplode(false);
  setPressed('#btn-explode', false);
  syncViewShift();
  measure();
  audio.tick();
  document.body.classList.add('moved');
  render(true);
  if (instant) snapFileNo();               // a deep link lands settled, cursor included
}
function stepMove(d) { ri = (ri + d + MOVES.length) % MOVES.length; audio.tick(); render(true); }

/* ★★ 双击走这里（用户 2026-10-03：「双击时的做动作要从上到下一个一个切换」）：
   每双击一次，**选中的动作往下走一个**，走到底回到 01，并且立刻做出来。
   和点列表一行是同一件事，所以选中同样必须写在 `doMove()` **之前** ——
   `doMove` 读的是 `cur()`，晚一步就会"点亮的是 02、做出来的是 01"。 */
function nextMove() {
  ri = (ri + 1) % MOVES.length;
  doMove();
}
function setVantage(i) {
  // `vi = -1` is a record's own framing: there is no vantage to count from, so
  // the first step lands on the end it is stepping toward — ← goes to the last
  // vantage, → to the first. Wrapping from -1 lands on 03 instead, which is
  // neither the previous nor the last one.
  vi = vi < 0 ? (i < 0 ? VANTAGES.length - 1 : 0) : (i + VANTAGES.length) % VANTAGES.length;
  homeArmed = false;                  // this *is* a framing, not a detour from one
  orbit.setPreset(VANTAGES[vi].v, false);
  if (orbit.tween) orbit.tween.dur = 1.2;
  audio.tick();
  document.body.classList.add('moved');
  render();
}

function setAuto(on) {
  autoRotate = on;
  if (on) homeArmed = false;          // the model turning itself beats returning
  orbit.setAuto(on);
  $('#btn-auto').classList.toggle('on', on);
  $('#btn-auto').setAttribute('aria-pressed', String(on));
}
function setMute(on) {
  muted = on;
  audioEl.muted = on;
  document.body.classList.toggle('muted', on);
  $('#btn-mute').setAttribute('aria-pressed', String(on));
  audio.setLevel(bedLevel());
}


/* the speaker is a knob as well as a switch: wheel over it to set the level,
   click (or M) to cut the music. Turning it all the way down *is* muted, so the
   icon can never claim to be playing something it is not; turning it back up
   lifts the mute, which is what a hand on a knob expects. */
const volRead = $('#vol-read');
const muteBtn = $('#btn-mute');
let volFlash = 0;
function showVolume() {
  swapText(volRead, muted ? '静音' : `${Math.round(volume * 100)}%`);
  muteBtn.classList.add('show-vol');
  clearTimeout(volFlash);
  volFlash = setTimeout(() => muteBtn.classList.remove('show-vol'), 1100);
}
function setVolume(v, { unmute = false, flash = true } = {}) {
  // snapping through the 5% grid in one step rather than v/0.05*0.05, which
  // lands on 0.30000000000000004 and prints as "30%" only by luck of rounding
  volume = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
  audioEl.volume = volume;
  // the arcs follow the level too: one below half, two above, none when silent
  muteBtn.classList.toggle('vol-lo', volume < 0.5);
  if (volume === 0 && !muted) setMute(true);
  else if (unmute && muted && volume > 0) setMute(false);
  audio.setLevel(bedLevel());
  if (flash) showVolume();
}
/* ---------- the full index, for when five columns do not fit on screen ----
   One card per move rather than one per part. The card's table is the shot's
   own numbers — where the lens stands and how far — which is the same language
   the deck's read-out already uses, so the 目录 is a list of shots rather than a
   second copy of the names. */
const indexEl = $('#index'), indexCols = $('#index-cols');
let indexOpen = false;
function buildIndex() {
  indexCols.replaceChildren(...MOVES.map((M, x) => {
    const d = document.createElement('div');
    d.className = 'icol' + (x === ri ? ' on' : '');
    // the card's index, for the cascade in styles.css
    d.style.setProperty('--i', x);
    const h = document.createElement('button');
    h.className = 'icol-h';
    h.innerHTML = `<span>${M.no} ${M.cn}</span><em>${M.en}</em>`;
    h.addEventListener('click', () => { ri = x; closeIndex(); doMove(); });
    d.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'spec';
    /* The card used to print 机位 / 距离 / 俯仰 — the framing that move would
       swing the lens onto. Moves no longer own a framing, so those three numbers
       would be three copies of the same lie. What she does is the useful thing. */
    ul.replaceChildren(...[
      ['编号', M.no],
      ['表现', M.note],
    ].map(([k, v]) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${k}</span><b>${v}</b>`;
      return li;
    }));
    d.appendChild(ul);
    return d;
  }));
  syncIndexSel();
  buildTracks();               // the programme is filed under the same cover
}
function syncIndexSel() {
  if (!indexOpen) return;
  indexCols.querySelectorAll('.icol').forEach((c, x) => c.classList.toggle('on', x === ri));
}

/* ---------- the programme, filed in the same overlay ----------------------
   A cassette's own label *is* a track list, so this is a second rack in 目录
   rather than a panel of its own: no new button, no new key, no new overlay —
   the same cards the index already draws, one per track. */
const trackCols = $('#track-cols'), trackSub = $('#track-sub');
let shownTrack = null;                 // the track the chip is currently reading

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function buildTracks() {
  const cards = [];
  for (let si = 0; si < SIDES.length; si++) {
    const s = SIDES[si];
    for (let ti = 0; ti < s.tracks.length; ti++) {
      const k = s.tracks[ti];
      const d = document.createElement('div');
      d.className = 'icol';
      d.dataset.track = `${s.id}${ti}`;
      d.style.setProperty('--i', cards.length);       // the same cascade the records get
      const h = document.createElement('button');
      h.className = 'icol-h';
      h.innerHTML = `<span>${k.no} ${k.title}</span><em>${mmss(k.len)}</em>`;
      h.addEventListener('click', () => { closeIndex(); playTrack(si, ti); });
      d.appendChild(h);
      const ul = document.createElement('ul');
      ul.className = 'spec';
      ul.replaceChildren(...[
        ['所在面', `${s.cn} · ${s.label.title}`],
        ['起始', mmss(k.start)],
        ['时长', mmss(k.len)],
      ].map(([a, b]) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${a}</span><b>${b}</b>`;
        return li;
      }));
      d.appendChild(ul);
      cards.push(d);
    }
  }
  trackCols.replaceChildren(...cards);
  trackSub.textContent = `${SIDES.length} 面 · ${cards.length} 首`;
  syncTrackSel();
}

/** which card is lit: the side the audio element is holding, and the track the
    tape is standing on inside it */
function syncTrackSel() {
  const side = sideOf(audioEl.currentSrc || audioEl.src);
  const cur = side && shownTrack ? `${side.id}${side.tracks.indexOf(shownTrack)}` : null;
  trackCols.querySelectorAll('.icol').forEach((c) => c.classList.toggle('on', c.dataset.track === cur));
}

/* The chip follows the tape's own position rather than whatever was last
   loaded: a side is one continuous piece of audio, so "which track is playing"
   is a question only currentTime can answer. It writes DOM only — TRACK belongs
   to settleSwap, and two writers for one value is how the label ends up
   disagreeing with the chip. */
function syncNowTrack() {
  const side = sideOf(audioEl.currentSrc || audioEl.src);
  const k = side ? trackAt(side, audioEl.currentTime) : null;
  if (k === shownTrack) return;
  shownTrack = k;
  if (!k) return;
  swapText($('#now-title'), k.title);
  // the side's own label, not TRACK's: applyTrack() arms the element long before
  // settleSwap() commits the new TRACK, and this runs on the loop's clock in
  // between — reading TRACK here would print the side being left behind
  swapText($('#now-sub'), [side.label.artist, side.label.album].filter(Boolean).join(' · '));
  syncTrackSel();
}
function openIndex() {
  indexOpen = true;
  buildIndex();
  indexEl.hidden = false;
  /* ★★ The class goes on one frame late on purpose — the browser needs a frame
     between `hidden = false` and the class to have anything to transition *from*
     — but the callback has to re-check `indexOpen` before it writes.
     `buildTracks()`'s row handler is `closeIndex(); playTrack(...)`, so opening
     the panel and picking a track inside the same task closes it while this
     callback is still queued; without the guard the queued frame puts `.open`
     back on a panel whose `indexOpen` is already `false`, and `closeIndex()`'s
     `if (!indexOpen) return;` can never take it off again — the panel is up and
     重置 cannot put it down. Measured with tools/_swap.mjs step 6. */
  requestAnimationFrame(() => { if (indexOpen) indexEl.classList.add('open'); });
  document.body.classList.add('moved');
}
function closeIndex() {
  if (!indexOpen) return;
  indexOpen = false;
  indexEl.classList.remove('open');
  setTimeout(() => { if (!indexOpen) indexEl.hidden = true; }, 600);
}
const toggleIndex = () => (indexOpen ? closeIndex() : openIndex());

/* ---------- settings ----------
   Five switches for the things a visitor to a tape deck would actually reach for,
   and every one of them is a knob the page already had: the opening move, what
   happens when the tape runs out, whether the machine hisses, whether the key
   legend is in the way, and whether the floor keeps its mirror. Nothing here
   needed new machinery — it needed a handle on machinery that was already there.
   The sheet is the ARCHIVE INDEX overlay with five rows in it, because the page
   has exactly one way of putting a sheet over itself and this is it.

   The switches are remembered (localStorage, guarded: a blocked store just means
   the page boots as it shipped). They are the one thing here that is *supposed*
   to outlive a reload — the music deliberately is not (see 音乐 in the README). */
const PREF_KEY = 'ohmtape.prefs';
/* `vig` is the sheet's one dial rather than a switch: 0 to 1 (50% out of the box),
   scaling whatever strength the room itself asks for (see applyTheme).
   `v` is the generation those defaults belong to, and it is here because a stored
   value outranks a new default: the dial shipped at 0, every browser that had ever
   touched a setting was holding that 0, and changing the default would have been
   invisible to exactly the people who had used the page. So a `vig` written under
   an older generation is not read back — once — while every other switch is still
   whatever the visitor left it at. */
const PREF_V = 2;
const prefs = { intro: true, loop: true, hiss: true, keys: true, mirror: true, fast: false, viz: true, glare: true, vig: 0.5 };
try {
  const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
  const stale = saved.v !== PREF_V;
  for (const k of Object.keys(prefs)) {
    if (stale && k === 'vig') continue;
    if (typeof saved[k] === typeof prefs[k]) prefs[k] = saved[k];
  }
  prefs.vig = clamp(prefs.vig, 0, 1);
} catch { /* no store: the defaults are the page */ }
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ v: PREF_V, ...prefs })); } catch { /* nothing to do */ } };

const SETTINGS = [
  { k: 'intro', cn: '开场动画', en: '入场推轨', note: '打开时那 3.4 秒的推轨，下次打开生效。' },
  { k: 'loop', cn: '循环播放', en: '自动换向', note: '放完自动从头重放；关掉则退回开头停住。' },
  { k: 'hiss', cn: '房间底噪', en: '底声', note: '唱歌时的嘶声与低鸣，不含换向声与旋钮声。' },
  { k: 'keys', cn: '按键提示', en: '快捷键说明', note: '底部那行快捷键说明。' },
  { k: 'mirror', cn: '地面镜像', en: '地面反射', note: '地面实时反射，关掉可省一整遍场景渲染。' },
  { k: 'viz', cn: '音频联动', en: '声画同步', note: '演唱时频谱柱、浮尘与辉光跟随音乐起伏。关掉画面回到匀速，柱条仍会自己动。' },
  { k: 'glare', cn: '镜头眩光', en: '横向光条', note: '亮处被镜头拉成的那道横条，三套灯光各留自己的色与长短。关掉画面更干净。' },
  { k: 'fast', cn: '性能模式', en: '降一档渲染', note: '渲染分辨率 1.5× → 1.1×，并关掉超采样与地面反射。帧率不够时打开，画面会软一点。' },
  { k: 'vig', cn: '暗角', en: '四周压暗', dial: true, note: '画面四周压暗，像镜头前的遮光罩。滑条调的是强度，三套灯光各留自己的深浅。' },
];

/** what a switch does. `intro` is read once by the boot flow and `loop` where the
    tape runs out, so neither has anything to do here — and `vig` needs nothing
    either: applyTheme() reads it every frame, so the vignette walks itself out
    on the next one. `viz` is the same story, read by vizOn() on the loop's
    clock. `fast` changes what the GPU is asked for, so it re-runs the
    resize — that is the one path that actually re-sizes the buffers — and then
    settles the mirror, which it also takes away. */
function applyPref(k) {
  if (k === 'hiss') audio.setLevel(bedLevel());
  else if (k === 'keys') document.body.classList.toggle('keys-off', !prefs.keys);
  else if (k === 'mirror') floorBase.setEnabled(mirrorOn());
  else if (k === 'glare') { if (glarePass) glarePass.enabled = glareOn(); }
  else if (k === 'fast') { onResize(); floorBase.setEnabled(mirrorOn()); if (glarePass) glarePass.enabled = glareOn(); }
}
/* the mirror is a whole extra scene render every frame, so it is the first thing
   to go — and the first thing to come back, but only when nothing else is asking
   for headroom: the render scale is at full and 性能模式 is off. */
const mirrorOn = () => prefs.mirror && !prefs.fast && quality > 0.8;
/* The picture's own switch. It is deliberately *not* tied to `quality`: what it
   costs is four inline heights and a four-byte read, and pulling the beat out of
   the frame is a much bigger change than the frame being soft. 性能模式 still
   takes it away, because that switch means "stop adding things". */
const vizOn = () => prefs.viz && !prefs.fast;
/* The glare's own switch. Twelve texture taps across the whole frame is not
   nothing, so 性能模式 takes it away with everything else — but `quality` does
   not, because quality already scales the buffer this pass reads, which scales
   the pass with it. Switching the pass off outright (rather than setting its
   strength to zero) is what actually saves the taps: EffectComposer skips a
   disabled pass entirely. */
const glareOn = () => prefs.glare && !prefs.fast;
function applyPrefs() { for (const k of Object.keys(prefs)) applyPref(k); }

const settingsEl = $('#settings'), setList = $('#set-list'), settingsBtn = $('#btn-settings');
let setOpen = false;

/* The dial's rail: `--fill` is how much of the hairline is ink, which is the same
   language the segmented control speaks — ink for what is set. It is a style
   property rather than a class because it moves continuously. */
const DIAL_STEPS = 20;                 // one detent per 5%, and one click with it
function paintDial(s) {
  const v = prefs[s.k];
  s.dialEl.value = String(v);
  // the same `--p` the transport's rail reads: the fill is an element that
  // scales, so a click on the rail slides instead of jumping. It lives on the
  // track's wrapper so the fill and the input share one number.
  s.dialEl.parentElement.style.setProperty('--p', v.toFixed(3));
  // 0 is the switch it used to be, and 关 is what this sheet says for off
  const label = v > 0 ? Math.round(v * 100) + '%' : '关';
  setRoll(s.valEl, label);
  // read from the label rather than from the element: a rolled read-out's
  // textContent is the live cells *plus* whatever ghost is mid-flight
  s.dialEl.setAttribute('aria-valuetext', label);
}
function syncSettings() {
  for (const s of SETTINGS) {
    if (s.dial) { paintDial(s); continue; }
    for (const b of s.seg.children) {
      const on = (b.dataset.v === '1') === prefs[s.k];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
}
function setPref(s, v) {
  if (prefs[s.k] === v) return;
  prefs[s.k] = v;
  savePrefs();
  applyPref(s.k);
  syncSettings();
  // a switch ticks once per press; the dial ticks per detent, from its own
  // handler, or a drag would fire a burst of them
  if (!s.dial) audio.tick();
  document.body.classList.add('moved');
}
/* built when the sheet is opened, like the index's cards, and rebuilt each time:
   the state can only have changed from in here */
function buildSettings() {
  setList.replaceChildren(...SETTINGS.map((s, i) => {
    const li = document.createElement('li');
    li.className = 'set-row';
    // the row's index, for the cascade in styles.css
    li.style.setProperty('--i', i);
    const t = document.createElement('div');
    t.className = 'set-t';
    t.innerHTML = `<b>${s.cn}</b><i>${s.en}</i><em>${s.note}</em>`;
    if (s.dial) {
      const box = document.createElement('div');
      box.className = 'set-dial';
      // the same parts as the transport's rail: a track, an ink fill that scales,
      // and the native range above them. Two rails on one page, one language.
      const track = document.createElement('div');
      track.className = 'dial-track';
      const fill = document.createElement('i');
      fill.className = 'rail-fill';
      fill.setAttribute('aria-hidden', 'true');
      const r = document.createElement('input');
      r.type = 'range'; r.min = '0'; r.max = '1'; r.step = String(1 / DIAL_STEPS);
      r.className = 'ui-hit';
      r.setAttribute('aria-label', `${s.cn}强度`);
      track.append(fill, r);
      const out = document.createElement('b');
      out.className = 'set-val';      // the vignette is damped in applyTheme, so the picture follows the thumb
      // a beat behind it — which is what a knob on a machine does
      let detent = Math.round(prefs.vig * DIAL_STEPS);
      r.addEventListener('input', () => {
        const v = Number(r.value);
        const k = Math.round(v * DIAL_STEPS);
        if (k !== detent) { detent = k; audio.tick(); }
        setPref(s, v);
      });
      box.append(track, out);
      s.dialEl = r; s.valEl = out;
      li.append(t, box);
      return li;
    }
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const v of [true, false]) {
      const b = document.createElement('button');
      b.className = 'ui-hit';
      b.textContent = v ? '开' : '关';
      b.dataset.v = v ? '1' : '0';
      b.addEventListener('click', () => setPref(s, v));
      seg.appendChild(b);
    }
    s.seg = seg;
    li.append(t, seg);
    return li;
  }));
  syncSettings();
}
function openSettings() {
  setOpen = true;
  buildSettings();
  settingsEl.hidden = false;
  /* ★★ same guard as `openIndex()`, for the same reason: the class lands a frame
     late, so the callback must not write over a panel that a same-task close has
     already put away. Nothing reaches this today — `buildSettings()`'s rows write
     prefs and nothing in the sheet closes it — but the sheet is exactly where a
     "pick one and get out of the way" row would go next, and that row would hit
     the same wall the programme's rows hit. */
  requestAnimationFrame(() => { if (setOpen) settingsEl.classList.add('open'); });
  // the gear stays turned while the sheet is up, so the button reads as open
  settingsBtn.classList.add('open');
  settingsBtn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('moved');
}
function closeSettings() {
  if (!setOpen) return;
  setOpen = false;
  settingsEl.classList.remove('open');
  settingsBtn.classList.remove('open');
  settingsBtn.setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!setOpen) settingsEl.hidden = true; }, 600);
}
const toggleSettings = () => (setOpen ? closeSettings() : openSettings());

settingsBtn.addEventListener('click', () => { toggleSettings(); audio.tick(); });
$('#settings-close').addEventListener('click', () => { closeSettings(); audio.tick(); });
settingsEl.addEventListener('click', (e) => { if (e.target === settingsEl) closeSettings(); });

function reinit() {
  ri = 0; vi = 0; savedVi = 0;
  // the intro owns the lens *and* the cassette's lift for its first three
  // seconds. Left running, it keeps writing intro.y every frame and the shell
  // floats on up out of a reset that was supposed to put it back on the table.
  tl = null;
  intro.y = 0; intro.tilt = 0; intro.spin = 0; intro.fade = 1;
  setFold(false);
  closeIndex();
  closeSettings();
  applyFocus(null);
  setMute(false);
  setAuto(false);
  setFlip(false);
  exploded = false;
  cas.setExplode(false);
  setPressed('#btn-explode', false);
  syncViewShift();
  if (cas.st.playing) togglePlay(false);
  audioEl.currentTime = 0;
  mode = 'idle';
  document.body.classList.remove('rewinding');
  reinitTrack();                      // ...and the record it shipped with
  setTheme('studio');
  orbit.setPreset(VANTAGES[0].v, false);
  if (orbit.tween) orbit.tween.dur = 1.4;
  audio.clunk(0.7);
  render();
}

/* ---------- wiring ---------- */
$('#btn-auto').addEventListener('click', () => { setAuto(!autoRotate); audio.tick(); render(); });
$('#btn-auto').classList.toggle('on', autoRotate);
$('#btn-auto').setAttribute('aria-pressed', String(autoRotate));
$('#btn-play').addEventListener('click', () => { togglePlay(); audio.tick(); render(); });
$('#btn-mute').addEventListener('click', () => { setMute(!muted); showVolume(); audio.tick(); render(); });
/* The wheel is captured on the button itself and stopped there: the orbit
   control listens on `window`, so without stopPropagation the same notch would
   set the volume *and* push the lens. preventDefault keeps the page from
   scrolling behind it. */
$('#btn-mute').addEventListener('wheel', (e) => {
  e.preventDefault();
  e.stopPropagation();
  // one notch is one step, however coarse the device's delta is; and scrolling
  // up out of a mute lifts the mute rather than sitting there doing nothing
  const up = e.deltaY < 0;
  setVolume(volume + (up ? VOL_STEP : -VOL_STEP), { unmute: up });
  audio.tick();
}, { passive: false });
setVolume(volume, { flash: false });
/* `?.` rather than an `if`: with TAPE_ON the two buttons are in the markup and
   these two lines are the only thing that makes them do anything, so the wiring
   is kept whole and only the lookup is allowed to come back empty. */
$('#btn-explode')?.addEventListener('click', () => { setExplode(!exploded); audio.tick(); render(); });
$('#btn-flip')?.addEventListener('click', () => { flipSide(); audio.tick(); render(); });
$('#theme').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) { setTheme(b.dataset.theme); audio.tick(); document.body.classList.add('moved'); }
});
/* ★ 「让她X」那个按钮删掉了（2026-10-04）：五个动作现在是一行格子，一格一击。
   `doMove` 剩下的入口是格子本身（见上面的 `pick`）、键盘 ENTER、双击和深链接。 */
$('#btn-index').addEventListener('click', toggleIndex);
$('#index-close').addEventListener('click', closeIndex);
$('#btn-reinit').addEventListener('click', reinit);

/* ---------- picking her up ------------------------------------------------
   There was no raycasting anywhere on this page before her: the only 3D input
   was the orbit, and every orbit gesture is a drag. A tap is therefore a new
   kind of event, and the hard part is not the intersection — it is telling a tap
   apart from the first frames of a drag, because both arrive as
   pointerdown → pointerup on the same element, and the orbit has already
   claimed the pointer (`setPointerCapture`) by the time these run. Two
   thresholds, and the reason for each:

   - 6 px of travel. A hand-held click wanders one or two pixels; the orbit's own
     dead zone is nothing at all, so anything past a few pixels is somebody
     turning the room, and pressing play on the way out of a camera move would be
     the worst kind of accidental input.
   - 500 ms. A press that is held is a press being thought about. (The browser's
     own long-press answer on a canvas is the context menu, which controls.js
     already suppresses.)

   The double-click is **not** a reset any more (the reset gesture went with the
   shell), and it is not swallowed either: it steps the move list. Two taps in
   quick succession used to be collapsed into one — correct while the second tap
   would have been a duplicate transport command, wrong once the gesture has to
   *mean* something. So the second tap of a double-click advances the selection
   by one row and performs it, top to bottom, wrapping at 05.

   A double-click anywhere on the canvas counts, not only on her: this is the
   page's own "next" gesture, and requiring the pointer to be over a moving
   target would make it a gesture you can only perform by luck. Clicking *her* is
   still the greeting, so a double-click that starts on her greets once and then
   steps — which reads as her answering and then doing the next thing.

   Hover is a raycast too, but against her alone, so it is one intersection test
   per pointermove and the cursor is the whole feedback. The cursor goes through
   a class rather than `canvas.style.cursor`, because an inline style would beat
   `body.dragging canvas#gl { cursor: grabbing }` and a drag that starts on her
   would keep pointing. */
const raycaster = new THREE.Raycaster();
const pickNdc = new THREE.Vector2();
const headNdc = new THREE.Vector3();
let spiritHover = false;
let tapFrom = null;
let lastTap = 0;

/* Where the pointer is *relative to her*, -1..1 on each axis. Deliberately not
   the pointer's place on the screen: she is not at the screen's centre — the
   lens looks at y ≈ 0 while she stands on the floor, and orbiting the room
   slides her sideways — so a fixed centre-to-edge mapping would have her
   looking the wrong way from three of the four vantages. Projecting her head
   and taking the difference costs one `project()` per pointermove and is
   correct from all of them. */
const spiritAim = { x: 0, y: 0 };
const AIM_GAIN = 1.45;

/* the canvas is fixed and full-viewport (`canvas#gl`), so the pointer maps to NDC
   without a rect read — and by the same arithmetic controls.js uses for parallax */
function overSpirit(e) {
  if (!spirit) return false;
  pickNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pickNdc, camera);
  /* one capsule, not twenty meshes: a thin forearm is a patchy target and the
     real meshes move every frame, so the hit region would wobble under the
     cursor. See the proxy's note in ghost.js. */
  return raycaster.intersectObject(spirit.hit, false).length > 0;
}

function aimAt(e) {
  if (!spirit) return;
  pickNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  spirit.head.getWorldPosition(headNdc);
  headNdc.project(camera);
  spiritAim.x = clamp((pickNdc.x - headNdc.x) * AIM_GAIN, -1, 1);
  spiritAim.y = clamp((pickNdc.y - headNdc.y) * AIM_GAIN, -1, 1);
}

canvas.addEventListener('pointermove', (e) => {
  aimAt(e);
  const hit = overSpirit(e);
  if (hit === spiritHover) return;
  spiritHover = hit;
  document.body.classList.toggle('over-spirit', hit);
});

/* The pointer leaving the page is not the pointer resting on her. Without this
   she holds her head turned toward wherever the cursor was last seen, which
   reads as a bug rather than as attention. */
canvas.addEventListener('pointerleave', () => {
  spiritAim.x = 0;
  spiritAim.y = 0;
  if (!spiritHover) return;
  spiritHover = false;
  document.body.classList.remove('over-spirit');
});

/* ---------- greeting her, and the interaction panel ----------------------
   She can be asked to do something from three places — the move list, the ticks
   in the deck, or by being clicked — so the panel and the model have to agree
   about what she is doing. They agree by asking *her*: `action` is read back off
   the model rather than remembered here, so a clip that is interrupted — by
   another, by a re-press, or by the page losing the clock — cannot leave a row
   lit for a motion that is over.

   `playing` is a second highlight, not the selection one. Clicking her picks
   from GREETINGS without touching which move the panel is showing, so the lit
   row and the selected row are allowed to be different rows. */
const GREETINGS = ['nod', 'wave', 'salute'];
let greetI = 0;

function greet() {
  if (!spirit) return;
  spirit.play(GREETINGS[greetI++ % GREETINGS.length]);
  syncMoveButtons();
}

let litMove = null;
function syncMoveButtons() {
  const a = spirit ? spirit.action : null;
  if (a === litMove) return;            // called every frame; only the edge costs
  litMove = a;
  for (let i = 0; i < MOVES.length; i++) refRows[i].classList.toggle('playing', MOVES[i].k === a);
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;                 // right-drag and middle-drag are not taps
  tapFrom = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  const from = tapFrom;
  tapFrom = null;
  if (!from) return;
  if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 6) return;    // a drag
  if (performance.now() - from.t > 500) return;                        // a hold
  const now = performance.now();
  if (now - lastTap < 320) {                                           // a double-click
    lastTap = now;
    /* ★★ 第二次点击不再被吞掉：它 = 「下一个动作」。放在 `overSpirit` 之前是
       故意的 —— 这是页面级的"下一个"手势，不要求指针正好落在她身上（她还在
       慢慢浮，要求命中一个会动的目标等于让这个手势只能靠运气触发）。 */
    nextMove();
    render();
    return;
  }
  lastTap = now;
  if (!overSpirit(e)) return;
  /* Clicking her is a greeting, not a transport command. It used to toggle
     play, which made the one object on the page you would instinctively poke
     the one object that did not answer — and it gave the transport two controls
     (this and the button) with no way to tell which you had meant. The tap is
     still a user gesture, so the WebAudio graph is unlocked here exactly as it
     was before. */
  audio.tick();
  greet();
  render();
});
// a pointercancel is the browser taking the gesture back — a pinch, a scroll, a
// system gesture. There is no tap in it, so the pending one has to be dropped
// rather than left to pair with the next pointerup.
canvas.addEventListener('pointercancel', () => { tapFrom = null; });

/* ---------- the seek rail -------------------------------------------------
   A real <input type="range">, not a div with a pointer handler: the drag, the
   click-to-jump, the arrow keys, Home/End and the slider role all arrive
   already working, and the settings sheet already styles one of these — so the
   rail under the counter and the dial in the sheet are visibly the same part.
   The filled part of the rail is its own element (`.rail-fill`), sized by `--p`
   as a fraction of the rail: a gradient stop could not be interpolated, so a
   click on the rail teleported the ink. `--p` is written on the *track*, so the
   fill, the tick scale and the input all read one number.

   Two things the loop may not do to it. It may not write the value back while a
   hand is on it — `scrubbing` is that lock, and without it the thumb is dragged
   one way and pushed the other. And it may not decide where the tape is after a
   seek: `cas.setProgress()` is the picture's opinion of the same number the
   audio element was just given, so tape and sound land together. */
const seekEl = $('#seek');
const railEl = seekEl.parentElement;
let scrubbing = false;
let railShown = -1;                     // what the fill currently shows, so the
                                        // loop only writes when it moves

/** put the tape where the hand put the rail, and the read-out with it */
function seekTo(frac) {
  if (!cas) return;
  const dur = audioOk() ? audioEl.duration : cas.st.duration;
  if (!(dur > 0)) return;
  const f = clamp(frac, 0, 1);
  // A seek is a positioning action, so it ends a spool-back rather than
  // interrupting one: the reel is taken, the run is abandoned, and the
  // transport is left standing at the point it was dropped on. `dir` has to be
  // set back to forward by hand — left on the rewind it would spool to the end
  // the moment play was pressed again.
  if (mode === 'rew') togglePlay(false);
  cas.st.dir = -1;
  if (audioOk()) audioEl.currentTime = f * dur;
  cas.setProgress(f);
  // the loop's counter tick is a fifth of a second behind a hand; this is the
  // one place the two clocks are told to agree now
  const tc = $('#tc');
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  setRoll(tc, fmt(f * dur));
  seekEl.value = String(f);
  railShown = f;
  railEl.style.setProperty('--p', f.toFixed(4));
  document.body.classList.add('moved');
}
seekEl.addEventListener('pointerdown', () => { scrubbing = true; });
seekEl.addEventListener('input', () => { scrubbing = true; seekTo(+seekEl.value); });
seekEl.addEventListener('change', () => { scrubbing = false; seekTo(+seekEl.value); });
seekEl.addEventListener('pointerup', () => { scrubbing = false; });
seekEl.addEventListener('keyup', () => { scrubbing = false; });
/* the native range only steps, so the two ends of the tape are asked for by
   name — a listener here cannot reach the global one, which already hands the
   arrows to a focused range and would otherwise step the vantage instead */
seekEl.addEventListener('keydown', (e) => {
  if (e.key === 'Home') { e.preventDefault(); seekTo(0); }
  else if (e.key === 'End') { e.preventDefault(); seekTo(1); }
});

/* ---------- the key legend is a read-out, not a caption -------------------
   Each chip carries the key it names (data-k), and the chip lights for as long
   as the key is held. One querySelector per keystroke; it is the only place the
   page admits out loud which keys it is listening for, and a legend that
   answers back stops being furniture. */
const keyChips = [...document.querySelectorAll('#keys .kg')];
const chipFor = (k) => keyChips.find((c) => (c.dataset.k || '').split(' ').includes(k));
const chipKey = (e) => (e.key === ' ' ? 'space' : String(e.key || '').toLowerCase());
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const c = chipFor(chipKey(e));
  if (c) c.classList.add('hit');
});
addEventListener('keyup', (e) => {
  const c = chipFor(chipKey(e));
  if (c) c.classList.remove('hit');
});
// a key still held when the window loses focus never sends its keyup
addEventListener('blur', () => { for (const c of keyChips) c.classList.remove('hit'); });

/* ---------- ADD MUSIC ----------
   One file, and it replaces what is in the shell — the page is a single tape,
   and the ARCHIVE INDEX is a list of parts rather than of tracks. Whatever the
   user picks is named by its own tags where it has them and by its file name
   where it does not (src/tags.js), and the plate is rewritten to say so. */
const addBtn = $('#btn-add'), addRead = $('#add-read'), fileInput = $('#tape-file');
let addFlash = 0;
function flashAdd(msg) {
  clearTimeout(addFlash);
  if (!msg) { addBtn.classList.remove('show-vol'); return; }
  addRead.textContent = msg;
  addBtn.classList.add('show-vol');
  addFlash = setTimeout(() => addBtn.classList.remove('show-vol'), 1400);
}
function openPicker() {
  // clearing first, so re-picking the file that is already in there still fires
  fileInput.value = '';
  fileInput.click();
  audio.tick();
}
async function addFiles(files) {
  const file = [...files].find(looksLikeAudio);
  if (!file) { flashAdd('不是音频文件'); return; }
  if (swap.state !== 'idle') { flashAdd('正在装入'); return; }
  flashAdd('正在装入');
  const tags = await readTags(file);          // guarded inside: always an object
  applyTrack({ ...tags, src: URL.createObjectURL(file), file });
}
addBtn.addEventListener('click', openPicker);
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) addFiles(fileInput.files);
});
/* and one dropped anywhere on the page does the same. `dragover` has to be
   cancelled or the browser navigates away to the file instead of handing it
   over — and the canvas' own drag is pointer-based, so the two never meet. */
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});
indexEl.addEventListener('click', (e) => { if (e.target === indexEl) closeIndex(); });
for (const b of document.querySelectorAll('.pk')) {
  b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'prev-file') stepMove(-1);
    else if (a === 'next-file') stepMove(1);
    else if (a === 'prev-col') setVantage(vi - 1);
    else setVantage(vi + 1);
    b.classList.add('flash');
    setTimeout(() => b.classList.remove('flash'), 240);
  });
}

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  // a focused control owns Space and Enter; intercepting them here would make
  // Tab-to-the-fold-button then Enter read a record instead of folding
  const tag = e.target?.tagName;
  if ((k === ' ' || k === 'Enter') && (tag === 'BUTTON' || tag === 'INPUT')) return;
  // one layer at a time: the overlay, then the shell, then the panel
  if (k === 'Escape') {
    if (setOpen) closeSettings();           // the sheet on top closes first
    else if (indexOpen) closeIndex();
    else if (exploded) { setExplode(false); audio.tick(); render(); }
    else if (folded) { setFold(false); audio.tick(); render(); }
    return;
  }
  if (k === 'Enter') {
    e.preventDefault();
    // do it with the index still up and the whole scene changes behind an
    // opaque panel. Close first, exactly like the cards do.
    if (indexOpen) closeIndex();
    doMove();
    return;
  }
  // a focused dial owns its arrows, or the panel would step the vantage out
  // from under the thumb. Escape above still reaches the sheet.
  if (e.target?.type === 'range') return;
  if (k === 'ArrowUp') { e.preventDefault(); stepMove(-1); return; }
  if (k === 'ArrowDown') { e.preventDefault(); stepMove(1); return; }
  if (k === 'ArrowLeft') { e.preventDefault(); setVantage(vi - 1); return; }
  if (k === 'ArrowRight') { e.preventDefault(); setVantage(vi + 1); return; }
  if (k === ' ') { e.preventDefault(); togglePlay(); render(); return; }
  const l = k.toLowerCase();
  /* E and F are gone from the table along with the two buttons they mirrored:
     both keyed the shell's own assembly — 拆解 the parts, 翻面 the face — and the
     shell is off (TAPE_ON). Left in, E would open a shell nobody can see and set
     `exploded`, which `live()` and the panel both read. */
  if (l === 'a') setAuto(!autoRotate);
  else if (l === 'm') { setMute(!muted); showVolume(); }
  else if (l === 'i') toggleIndex();
  else if (l === ',') toggleSettings();
  else if (l === 'o') { openPicker(); return; }      // the picker is the feedback
  else return;
  document.body.classList.add('moved');
  render();
});

function togglePlay(force) {
  const st = cas.st;
  const on = force ?? !st.playing;
  if (on && mode === 'rew') return;               // wait for the spool-back
  // The write head is crossing the card: the duration the reels would be driven
  // from is about to be replaced, so the press is held until the print lands.
  if (swap.state !== 'idle') {
    if (on) { swap.play = true; document.body.classList.add('moved'); }
    return;
  }
  st.playing = on;
  document.body.classList.toggle('playing', on);
  // the label always names what pressing it does next, so the idling state
  // says 演唱 — the same word it says before the first press
  swapText($('#play-label'), on ? '暂停' : '演唱');
  if (on) {
    mode = 'play';
    if (audioOk()) {
      if (audioEl.ended || audioEl.currentTime > audioEl.duration - 0.08) audioEl.currentTime = 0;
      audioEl.play().catch(() => {});             // autoplay guard: silently ignore
    }
    audio.setLevel(bedLevel());
    audio.start();
  } else {
    audioEl.pause();
    audio.stop();
    // Pausing mid spool-back has to leave 'rew' behind as well. Left in it, the
    // guard at the top of this function ("wait for the spool-back") refuses the
    // *next* press too, and the transport is dead until a reinitialize. dir
    // stays +1, so pressing play again finishes the rewind and carries on.
    if (mode === 'rew') {
      mode = 'idle';
      document.body.classList.remove('rewinding');
    }
  }
  document.body.classList.add('moved');
}

function setExplode(on, instant = false) {
  exploded = on;
  homeArmed = false;                  // the pull-back is itself a framing
  cas.setExplode(on);
  if (instant || reduce) cas.st.explode = cas.st.explodeTarget;
  // the lit state belongs to the explode, not to reading a record — pressing E
  // or the button itself used to leave the trigger unlit, while reading a part
  // record lit it. Same writer, both paths.
  setPressed('#btn-explode', on);
  if (!on) applyFocus(null);          // shutting the shell releases the part
  const a = orbit.theta;
  syncViewShift();
  // no probe re-capture here: the capture lands as one discrete jump ~1.5 s
  // later, which reads as the shell abruptly changing colour mid-explode.
  // The probe is a world-space radiance field, so the stale capture is still
  // directionally right; only the theme switch re-captures, and that one is now
  // held back until the rig has finished moving (see markProbeDirty).
  //
  // Both ends of the toggle have to leave the camera somewhere the read-out can
  // name. Closing used to drop you on the default iso pose while the panel went
  // on showing the vantage you had picked — 选 04 → 拆解 → 收回来 landed at 等轴
  // with "04 MACRO" still on screen. It now comes back to that vantage. A
  // record's own framing (vi < 0) belongs to the open shell, so that one lands
  // on the first vantage, which is where the double-click reset lands too.
  let shot;
  if (on) {
    // the pull-back leaves the vantage behind, so the read-out stops naming it —
    // which also releases the panel: 细节特写 used to stay narrowed 34% for a
    // lens that had already retreated to 44
    //
    // What gets remembered is where to come *back* to. A record's own framing
    // (vi < 0) belongs to the open shell and is gone once the shell shuts, so
    // that end falls back to the first vantage — where a double-click lands —
    // instead of leaving savedVi on whatever vantage happened to be standing
    // there from several actions ago.
    savedVi = vi >= 0 ? vi : 0;
    vi = -1;
    shot = { theta: Math.max(a, 0.45), phi: 1.17, radius: 44 };
  } else {
    if (vi < 0) vi = savedVi;           // closing comes back to where it left
    shot = VANTAGES[vi].v;
  }
  if (instant) orbit.setPreset(shot, true);
  else { orbit.setPreset(shot, false); if (orbit.tween) orbit.tween.dur = 1.5; }
  measure();
  document.body.classList.add('moved');
}
function setFlip(on, instant = false) {
  flipped = on;
  cas.setFlip(on);
  if (instant || reduce) cas.st.flip = cas.st.flipTarget;
  setPressed('#btn-flip', on);
  audio.clunk(on ? 0.8 : 1.2);
  document.body.classList.add('moved');
}

/* ============================== resize ================================== */
let quality = 1, perfAcc = 0, perfN = 0, fps = 0, jsMs = 0;
/* The render scale only ever ratcheted down. One sustained bad window — a
   window that was briefly huge, another app holding the GPU — and the page sat
   at 0.6× for the rest of the session with the floor mirror, the first thing
   dropped, never coming back. Recovery is slow and capped on purpose: two good
   windows in a row to climb one step, never above `qualityCeil` (the level last
   *measured* as too slow, so the climb cannot become the mirror switching
   itself on and off every few seconds), and only a real window resize clears
   the ceiling — that is the one event where the GPU budget has actually
   changed. */
let qualityCeil = 1, goodWindows = 0, perfSkip = 0;
let perfEl = null;
function watchPerf(dt) {
  perfAcc += dt; perfN++;
  fps = fps ? fps * 0.94 + (1 / Math.max(dt, 1e-3)) * 0.06 : 1 / Math.max(dt, 1e-3);
  if (perfEl && (perfN & 3) === 0) {
    perfEl.textContent = `${fps.toFixed(0)} 帧/秒 · JS ${jsMs.toFixed(2)} 毫秒 · 像素比×${quality.toFixed(1)} · `
      + `${floorBase ? (floorBase.mesh.visible ? '镜像开' : '镜像关') : ''} `
      + `· 位移 ${viewShift.toFixed(3)}→${viewShiftTarget.toFixed(3)}`;
  }
  if (perfAcc < 2.5) return;
  const avg = perfAcc / perfN;
  perfAcc = 0; perfN = 0;
  // the window right after a change measures the change, not the machine
  if (perfSkip > 0) { perfSkip--; return; }
  if (avg > 0.030) {
    goodWindows = 0;
    if (quality > 0.6) {
      quality = Math.max(0.6, quality - 0.2);
      qualityCeil = Math.min(qualityCeil, quality);
      onResize();
    }
    if (!mirrorOn()) floorBase.setEnabled(false);   // the mirror goes first
    perfSkip = 1;
  } else if (avg < 0.018 && quality < qualityCeil) {
    if (++goodWindows >= 2) {
      goodWindows = 0;
      quality = Math.min(qualityCeil, quality + 0.2);
      onResize();
      perfSkip = 1;
      // the mirror is a whole extra scene render every frame: only the full
      // rate can be asked to pay for it
      if (quality >= 1) floorBase.setEnabled(mirrorOn());
    }
  } else {
    goodWindows = 0;
  }
}
function onResize() {
  const w = innerWidth, h = innerHeight;
  const cap = prefs.fast ? 1.1 : DPR_CAP;
  const dpr = Math.min(devicePixelRatio || 1, cap) * quality;
  camera.aspect = w / h;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.updateProjectionMatrix();
  /* Supersample only when the buffer is genuinely small. A 2× display already
     has four times the pixels of a 1× one, and asking 1.25× on top of that put
     an ordinary 1080p laptop panel at thirteen megapixels with 4× MSAA and a
     96-sample AO over it. Three megapixels is the line: a 1× 1080p window
     (2.1 Mpx) still gets its supersample, a 2× one (3.9 Mpx) does not. */
  const px = w * dpr * h * dpr;
  const ss = (prefs.fast || px > 3.0e6) ? 1 : 1.25;
  const bw = Math.round(w * dpr * ss), bh = Math.round(h * dpr * ss);
  if (composer) {
    /* EffectComposer.setSize() multiplies whatever it is handed by its own
       `_pixelRatio`, and the ratio it captured at boot is the *device's*, not
       the render scale. `bw`/`bh` below are already device pixels, so passing
       them through scaled the whole chain a second time: on a 2× panel at 1080p
       the 4×-MSAA beauty target, the 96-sample AO, the five bloom mips and the
       grade were all running over thirteen megapixels — and that, not the
       geometry, is where the frame rate went. Pin the ratio to 1 and `bw × bh`
       is the real buffer, which is also what `uTexel` below assumes. */
    composer.composer.setPixelRatio(1);
    composer.composer.setSize(bw, bh);
  }
  if (bloom) bloom.setSize(bw, bh);
  floorBase.setSize(w, h);
  if (grade) grade.uniforms.uTexel.value.set(1 / bw, 1 / bh);
  applyViewOffset();
  measure();
  pinSoon();
}
/* the subject sits left of centre and the dossier takes the right half, so the
   offset is positive: the render window slides left and the scene follows */
let viewShift = 0.155, viewShiftTarget = 0.155;
function applyViewOffset() {
  const w = innerWidth, h = innerHeight;
  camera.clearViewOffset();
  if (w >= 900) camera.setViewOffset(w, h, w * viewShift, h * 0.025, w, h);
  camera.updateProjectionMatrix();
}
// a resize is the one event that changes what the GPU has to push, so it is
// also the only thing that re-opens the render-scale ceiling
addEventListener('resize', () => {
  qualityCeil = 1;
  goodWindows = 0;
  onResize();
});

/* ============================== loop ==================================== */
const tcEl = $('#tc'), tdEl = $('#td'), clockEl = $('#clock'), counterEl = $('.counter');
const p2 = (n) => String(n).padStart(2, '0');
const subjectPos = new THREE.Vector3();
const lastCamPos = new THREE.Vector3(0, 0, 1e9);
let last = performance.now(), t = 0, counterAcc = 0, lastTitle = '';

function loop() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  t += dt;
  const jsStart = now;

  tl?.update(dt);
  // the tape is driven by the music itself, so picture and sound never drift
  if (mode === 'rew') {
    cas.st.driven = false;
    if (cas.st.dir === -1) {                      // spooled back, at the head again
      document.body.classList.remove('rewinding');
      audioEl.currentTime = 0;
      // 循环 off: the tape still spools back, it just stands there afterwards —
      // the same state a pause leaves it in, which is what togglePlay is for
      if (prefs.loop) { mode = 'play'; audioEl.play().catch(() => {}); }
      else togglePlay(false);
    }
  } else if (audioOk() && !audioEl.paused && !audioEl.ended) {
    cas.st.driven = true;
    cas.setProgress(audioEl.currentTime / audioEl.duration);
  } else {
    // paused, blocked by autoplay policy, or no audio at all → simulate locally
    cas.st.driven = false;
  }
  // Every frame, not every other. The shell only breathes slowly, which is what
  // the half rate was for — but the *lamp* moves on a theme change, and so do
  // the shell (explode, flip) and the whole cassette (intro). A shadow map that
  // alternates between two light positions 30 times a second is a flicker along
  // every shadow edge, and no amount of easing elsewhere covers it up.
  renderer.shadowMap.needsUpdate = true;
  const st = cas.update(dt);
  updateGhost(dt);
  updateLabelSwap(dt);
  updateFileNo(dt);
  // What changes hands at a re-take is which room the reflections *are* — the
  // brightness is held level either side of it (see applyIblFade) — so the
  // frame to hand them over on is the one where they are dimmest. Going darker,
  // that is the far end of the change; coming up, it is already here, and there
  // is nothing to wait for.
  const probeReady = !themeProbe || iblTo >= iblFrom || themeP >= 1;
  if (probeDirty && probeReady && !orbit.tween && !orbit.dragging
      && Math.abs(st.explode - st.explodeTarget) < 0.004
      && Math.abs(st.flip - st.flipTarget) < 0.004) {
    probeDirty = false;
    captureProbe();
  }
  setFloorDrop(st.explode * 4.4);
  if (intro.spin > 0) {
    const k = 16 * dt;
    cas.parts.reels[0].spin.rotation.y += k;
    cas.parts.reels[1].spin.rotation.y += k * 0.72;
    intro.spin -= dt;
  }

  /* The picture follows the sound. One read a frame, before the dust moves, so
     the drift and the bars are looking at the same beat — and it is taken even
     when there is nothing to follow, because the envelope has to be allowed to
     fall back to rest rather than freezing where it was. A rewind is excluded
     the same way a stopped tape is: the bars are flat on purpose there.

     `musicLive` is split out from the third argument rather than written twice,
     because it answers two different questions. The visualiser also wants the
     user's 频谱 switch and the reduced-motion flag; *she* does not — with the
     equaliser switched off the music is still playing, and a spirit who stops
     singing when you hide the bars has misunderstood the setting.

     She and the bars then part company once more, and it is worth being explicit
     about why, because the obvious thing to do is hand them the same flag. The
     bars are a *measurement*: they can only follow a signal, so they need the
     audio element to be genuinely producing one. She is a *performance*: all she
     has to know is that the transport is rolling. Those two come apart exactly
     when there is no audio to load — the reels still turn from the local clock
     (see the `driven` branch above), and a spirit standing perfectly still while
     the machine plays her song contradicts the chip printed beside her, which
     says 她只做口型. `st.playing` is the transport's own state, so it is the one
     to ask; `mode !== 'rew'` keeps her out of the rewind, where the bars are
     flat on purpose and so is she. */
  const musicLive = mode !== 'rew' && audioOk() && !audioEl.paused && !audioEl.ended;
  const sheSings = mode !== 'rew' && cas.st.playing;
  const lv = viz.update(dt, audioEl, vizOn() && !reduce && musicLive);
  bloomGain = viz.beat;

  // idle life
  /* ★ 这一行现在是**空转**：`bob` 唯一的读者也是被删掉的
     `cas.root.position.y = intro.y + bob - swap.press`。留着是为了让下一位
     读者看得见它已经被摘掉，而不是以为她还在上下浮 —— 烛台自己的浮沉在
     `relic.update` 里（`stand.position.y`），且是以地面为基准的 ±0.05。 */
  const bob = reduce ? 0 : Math.sin(t * 0.62) * 0.055 + Math.sin(t * 1.71) * 0.012;
  /* 磁带的悬浮/压下/歪斜编舞随磁带一起舍弃 —— 幽魂烛台站在地上，
     自己的呼吸归 relic.update 管。 */

  /* Her clock is `dt` — but under reduced motion it is stopped rather than
     slowed. Slowing would still be a moving thing on a page that asked for
     none, and she has a rest pose worth landing on: t = 0 is exactly the frame
     she was modelled at, so the reduced-motion page shows her still, at rest,
     with nothing to catch mid-motion.

     ★ One exception, and it is the whole interaction area: an **action**. The
     rule above is about *ambient* motion — a page that asked for none should not
     have something bobbing away in the corner of it. An action is the opposite:
     it is the one motion here the visitor asked for *by name*, and a button that
     answers with a perfectly still character is not calm, it is broken. So her
     clock runs while a clip is playing, and is stopped the rest of the time.

     Everything she needs arrives in one object rather than as a fourth and
     fifth positional argument: she has six inputs now (singing, hover, the
     pointer's two axes, the beat, and whether she may improvise) and a signature
     of bare booleans would be unreadable at the call site, which is the only
     place it is ever read.

     `routine` is the singing improvisation. Under reduced motion it used to be
     `!reduce` outright, on the same reasoning as the ambient clock — but that
     made the one state the visitor *did* ask for the one state with nothing in
     it: press play and she stands there frozen while the tape rolls and the
     music plays. Singing is the same kind of exception as a button press (it is
     asked for, by name, and the whole page is built around it), so the
     improvisation is allowed whenever the transport is rolling, reduce or not.
     It cannot be inferred from `dt` alone — under reduce `dt` comes back to
     life for the duration of an *action*, and the improvisation's own countdown
     would ride along with it and fire the moment that action ended.

     `pos` is the *song's* clock (`audioEl.currentTime`), not the page's. The
     improvisation lands its gestures on phrase boundaries derived from it, so
     they follow the track instead of a stopwatch — and it keeps working on a
     slow machine, where page seconds and wall seconds are nowhere near each
     other. It reads 0 when there is no source, and ghost.js falls back to its
     own timer in that case. */
  spirit.update(reduce && !spirit.action && !sheSings ? 0 : dt, {
    singing: sheSings,
    hovered: spiritHover,
    aimX: spiritAim.x,
    aimY: spiritAim.y,
    beat: viz.pulse,
    beatOn: !reduce && vizOn() && musicLive,
    routine: !reduce || sheSings,
    pos: audioEl.currentTime || 0,
  });
  syncMoveButtons();
  if (!reduce) {
    // the same drift, with more of it while the low end is loud
    driftDust(dt * (1 + 0.6 * lv[0]), t);
  }

  // the environment drifts almost imperceptibly, so highlights crawl across
  // the shell instead of sitting frozen
  if (!reduce) {
    scene.environmentRotation.y = (scene.environmentRotation.y || 0) + 0.0055 * dt;
    scene.environmentRotation.x = Math.sin(t * 0.07) * 0.05;
  }
  orbit.update(dt);
  if (homeArmed && !autoRotate && !orbit.dragging && !orbit.tween && orbit.idle > HOME_DELAY) goHome();
  if (reduce) {
    // the subject sliding across the frame as the panel folds is motion too
    if (viewShift !== viewShiftTarget) { viewShift = viewShiftTarget; applyViewOffset(); }
  } else if (Math.abs(viewShift - viewShiftTarget) > 2e-4) {
    viewShift = damp(viewShift, viewShiftTarget, 2.6, dt);
    applyViewOffset();
  }
  syncPanelGive();
  syncPanelFold();
  /* The grade's centre — the point the vignette closes around and the defocus
     is aimed at — follows the subject, and the subject is whichever of the two
     is on screen. She bobs, so this is a live point, not a constant: the light
     has to stay on the thing that is moving.

     For her it is the *capsule*, not the root. The root sits on the floor,
     because that is where the bob is measured from and where the feet belong —
     and aiming a vignette and a defocus at a pair of ankles puts the sharpest
     part of the frame under her hem and the softest part on her face. The
     capsule is already centred on her middle (see ghost.js), so it is the
     right point and it is already being kept up to date. */
  const subject = TAPE_ON ? cas.root : spirit.hit;
  subject.getWorldPosition(subjectPos).project(camera);
  grade.uniforms.uCenter.value.set(subjectPos.x * 0.5 + 0.5, subjectPos.y * 0.5 + 0.5);
  watchPerf(dt);
  applyTheme(dt, reduce);
  updateAnnotations();
  grade.uniforms.uTime.value = t;

  // counter (throttled DOM write)
  counterAcc += dt;
  if (counterAcc > 0.2) {
    counterAcc = 0;
    const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const t1 = fmt(st.time), t2 = fmt(st.duration);
    setRoll(tcEl, t1);
    setRoll(tdEl, t2);
    // the rail rides the same clock the counter does, and is left alone while a
    // hand is on it (see the seek wiring) — one throttle for both, so the two
    // read-outs can never disagree about where the tape is
    if (!scrubbing && st.duration > 0) {
      const frac = clamp(st.time / st.duration, 0, 1);
      if (Math.abs(frac - railShown) > 2e-4) {
        railShown = frac;
        seekEl.value = String(frac);
        railEl.style.setProperty('--p', frac.toFixed(4));
        counterEl.style.setProperty('--p', frac.toFixed(4));   // 烛环：烧到哪，环合到哪
      }
    }
    const d = new Date();
    const cs = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    setRoll(clockEl, cs);
    // which of the side's tracks the tape is on — same throttle as the counter,
    // because it is the same question the counter is already asking
    syncNowTrack();
    // tab title doubles as a transport read-out
    const audioLive = audioOk() && !audioEl.paused && !audioEl.ended;
    // writing document.title re-titles the native window every time; only do it
    // when the string actually changes
    const title = audioLive ? `♪ ${fmt(audioEl.currentTime)} · ${TRACK.title}` : `${TRACK.title} — 小幽灵`;
    if (title !== lastTitle) { lastTitle = title; document.title = title; }
  }

  // refresh the mirror every frame while the camera is moving; settle to every
  // other frame once it holds still
  const camMoved = camera.position.distanceToSquared(lastCamPos) > 1e-6;
  lastCamPos.copy(camera.position);
  floorBase.update(renderer, scene, camera, camMoved);
  castle.update(t, camera.position);    // 火光闪烁 + 玩具屋显隐（相机在墙外藏那面墙）
  composer.composer.render();
  // everything above is CPU: matrix updates, culling, uniform uploads, draw
  // submission. This is the number to watch when the GPU is not the bottleneck.
  jsMs = jsMs * 0.92 + (performance.now() - jsStart) * 0.08;
  requestAnimationFrame(loop);
}

boot().catch((e) => showError(e?.stack || e));
