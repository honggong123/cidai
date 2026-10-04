/* dev: 扫帚要挪多少才既不出地板、也不蹭烛台、也不顶到下摆。

   `_broomgap.mjs` 说的是**现在**离多近。这个说的是**应该改成什么**。

   做法：把扫帚的顶点退回它自己那一层的局部坐标（broom 那个 Group 的坐标系），
   然后对每一组候选的 (抬高 dy, 俯仰 rz, 偏航 ry) 重新拼出世界空间，
   和两个不动的对象比三个间隙。

   ★★ 静态读数不是最低点。`ghost.js` 每帧写
        broom.position.y = BROOM_Y + sin(...)·floatAmp·0.42 + rise·0.72 + dRise·0.5
      而 `floatAmp = 0.085 + 0.20·s`（s = 唱歌强度）。所以**开口唱的时候**
      帚柄会自己沉到 BROOM_Y − 0.12。静息时只沉 0.036。
      拿静息姿态的最低点去和地板比，会低估 0.12 个单位 —— 而 0.12 在这个
      尺度上正好是"擦过去"和"扎进去"的差别。三个间隙全部按**最坏相位**报。

   Run:  node tools/_broomfix.mjs
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
const { createRelic } = await import('../src/relic.js');

const FLOOR_Y = -1.62;
/* 最坏相位的下沉量：floatAmp 的最大值 × 0.42 */
const BOB_WORST = (0.085 + 0.20) * 0.42;      // = 0.1197
/* 上面那个是"只算浮沉"的粗估。第 5 节会把它换成**实测**的动画下沉量，
   因为 `tip` / `rise` / `dance` 三项加起来比浮沉大得多。 */
let ANIM_SINK = BOB_WORST;

const g = createGhost({ height: 6.38, y: FLOOR_Y });
const r = createRelic({ floorY: FLOOR_Y });
g.root.updateMatrixWorld(true);
r.root.updateMatrixWorld(true);

/* ---------- 1. 扫帚顶点退回 broom 局部坐标 ---------- */
const inGroup = (o, top) => { for (let p = o; p; p = p.parent) if (p === top) return true; return false; };
const broomInv = new THREE.Matrix4().copy(g.broom.matrixWorld).invert();
const local = [];                             // [{a,b,c}] in broom-local space
g.broom.traverse((o) => {
  if (!o.isMesh) return;
  const geo = o.geometry, pos = geo.getAttribute('position'), idx = geo.index;
  const n = idx ? idx.count : pos.count;
  const m = new THREE.Matrix4().multiplyMatrices(broomInv, o.matrixWorld);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    const t = [];
    for (let k = 0; k < 3; k++) t.push(v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m).clone());
    local.push(t);
  }
});

/* ---------- 2. 两个不动的东西，世界空间 ---------- */
const worldTris = (top, skip) => {
  const out = [];
  top.traverse((o) => {
    if (!o.isMesh || (skip && skip(o))) return;
    const geo = o.geometry, pos = geo.getAttribute('position'), idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      const t = [];
      for (let k = 0; k < 3; k++) t.push(v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld).clone());
      out.push(t);
    }
  });
  return out;
};
const relicTris = worldTris(r.root, (o) => o.geometry.type === 'RingGeometry');
const bodyTrisAll = worldTris(g.root, (o) => inGroup(o, g.broom) || inGroup(o, g.crown) || o === g.hit || o === g.aura);
/* ★ 身体是 4 万个三角形，扫帚是 700 个 —— 直接两两算是 8800 万次，
   每次 `closestOnTri` 还要 new 六个 Vector3，于是这个脚本第一次跑就
   无声无息地死了（退出码 1，屏幕上什么都没有）。所以给身体先建一层
   包围盒索引，每个候选只跟扫帚附近那几百个三角形比。 */
const boxOf = (t) => {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const v of t) {
    if (v.x < b.x0) b.x0 = v.x; if (v.x > b.x1) b.x1 = v.x;
    if (v.y < b.y0) b.y0 = v.y; if (v.y > b.y1) b.y1 = v.y;
    if (v.z < b.z0) b.z0 = v.z; if (v.z > b.z1) b.z1 = v.z;
  }
  return b;
};
const bodyIndex = bodyTrisAll.map((t) => ({ t, b: boxOf(t) }));
console.log(`local broom tris ${local.length}   relic tris ${relicTris.length}   body tris ${bodyTrisAll.length}`);

/* ---------- 3. 点到三角形（Ericson） ---------- */
const closestOnTri = (p, a, b, c) => {
  const ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return a.clone();
  const bp = p.clone().sub(b);
  const d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return b.clone();
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.clone().addScaledVector(ab, d1 / (d1 - d3));
  const cp = p.clone().sub(c);
  const d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return c.clone();
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.clone().addScaledVector(ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    return b.clone().addScaledVector(c.clone().sub(b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  }
  const den = 1 / (va + vb + vc);
  return a.clone().addScaledVector(ab, vb * den).addScaledVector(ac, vc * den);
};
const nearest = (tris, others) => {
  let best = Infinity;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const p = t[k];
    for (const o of others) {
      const d = closestOnTri(p, o[0], o[1], o[2]).distanceTo(p);
      if (d < best) best = d;
    }
  }
  return best;
};
/* 只在扫帚那一块附近的身体三角形里找 —— 真要是最近的也在 2 个单位以外，
   那这个数对"会不会顶到下摆"这个判断已经没有意义了，报 2.0 就够。 */
const NEAR = 2.0;
const nearBody = (tris) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const t of tris) for (const v of t) {
    if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
    if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y;
    if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
  }
  const hit = [];
  for (const e of bodyIndex) {
    const b = e.b;
    if (b.x1 < x0 - NEAR || b.x0 > x1 + NEAR) continue;
    if (b.y1 < y0 - NEAR || b.y0 > y1 + NEAR) continue;
    if (b.z1 < z0 - NEAR || b.z0 > z1 + NEAR) continue;
    hit.push(e.t);
  }
  return hit;
};

/* ---------- 4. 候选 ---------- */
const B = 4.03755;
const BASE_POS = new THREE.Vector3(-0.29 * B, 0.80 + 0.15 * B, 0.62 * B);
const BASE_R = { x: 0, y: -0.24, z: -0.10 };

const evalCand = (dx, dy, rz, ry) => {
  const pos = BASE_POS.clone(); pos.x += dx; pos.y += dy;
  /* ★★ broom 的父节点是幽灵的 root，而 root 自己挂在 y = FLOOR_Y 上
     （`root.position.set(x, y, z)` / `root.position.y = y`）。`BASE_POS` 是
     broom 在 **root 空间**里的位置，所以拼世界坐标必须再乘一层 root 的
     world 矩阵 —— 第一版漏了它，于是整张表的 y 全部高了 1.62，
     而且高得"很合理"（地板间隙一片大好，全是正的）。 */
  const M = new THREE.Matrix4().multiplyMatrices(
    g.root.matrixWorld,
    new THREE.Matrix4().compose(
      pos,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(BASE_R.x, ry, rz, 'XYZ')),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  const tris = local.map((t) => t.map((v) => v.clone().applyMatrix4(M)));
  let lo = Infinity, hi = -Infinity;
  for (const t of tris) for (let k = 0; k < 3; k++) { const y = t[k].y; if (y < lo) lo = y; if (y > hi) hi = y; }
  return {
    dx, dy, rz, ry,
    lo, hi,
    /* 最坏相位：歌唱时的下沉 */
    loWorst: lo - BOB_WORST,
    floor: lo - ANIM_SINK - FLOOR_Y,
    relic: nearest(tris, relicTris),
    body: nearest(tris, nearBody(tris)),
  };
};

/* ---------- 5. 动画包络：静态读数根本不是最低点 ----------
   ★★ 上面那张表用的是**静息姿态**的顶点。但扫帚是挂在 root 下面的，
   `root.rotation` 每帧都在动，而帚穗那一头离 root 原点有 3 个单位：

     · `tip`（绕 x 前倾）把 z>0 的东西往下压 —— 帚穗在 z≈3.0，
       所以她一"看向上方"（aimY=1 → tip≈0.10）帚穗就再低 0.30；
     · 点头的 `rise` 是 −1.05（身体下沉），扫帚跟着吃 `rise·0.72`；
     · 唱歌时的 `dance` 还给她加了 ±0.045 的 tip 和 ±0.12 的帚摆。

   所以"扫帚的最低点"必须**在跑起来的画面里量**。这一节把五个动作、
   唱歌、悬停、上下看，全部各跑一遍，取帚穗顶点在世界空间的最小 y。

   这一节跑的是**当前 ghost.js** 里的数，不是候选 —— 候选的影响是
   平移量，直接在线性上加上去即可。 */
console.log('\n--- animated envelope (current ghost.js) ---');
{
  const v = new THREE.Vector3();
  /* 身体（床单）自己的最低点。判"滚转要不要一起收"用 —— 她的下摆离地板
     只有 0.56，而晃一晃的 `lean` 是 0.72 rad，绕的还是**地板那条线**。
     只取每个网格自己最低 1.2 个单位以内那一带顶点：下摆在局部 0.3..0.9，
     手臂在 1.5 以上，带外的不可能成为最低点。
     ★★ 必须**按每一台机器各取一份**：第一版从 `g` 上取了网格存进 `bodyBand`，
     然后在 `gg` 上跑动画、却读 `g` 的 `matrixWorld` —— 于是"下摆"在整个包络里
     一动不动，稳稳停在静态值 −1.061，而那一栏看起来完全合理。 */
  const bandOf = (gh) => {
    const out = [];
    const tmp = new THREE.Vector3();
    gh.root.traverse((o) => {
      if (!o.isMesh) return;
      if (inGroup(o, gh.broom) || inGroup(o, gh.crown) || o === gh.hit || o === gh.aura) return;
      const pos = o.geometry.getAttribute('position');
      let lo = Infinity;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < lo) lo = y; }
      const list = [];
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < lo + 1.2) list.push(tmp.fromBufferAttribute(pos, i).clone());
      }
      if (list.length) out.push({ mesh: o, list });
    });
    return out;
  };
  const bodyLowOf = (band) => {
    let lo = Infinity;
    for (const e of band) for (const p of e.list) {
      const y = v.copy(p).applyMatrix4(e.mesh.matrixWorld).y;
      if (y < lo) lo = y;
    }
    return lo;
  };
  void bodyLowOf;

  const lowOf = () => {
    g.root.updateMatrixWorld(true);
    const M = g.broom.matrixWorld;
    let lo = Infinity;
    for (const t of local) for (let k = 0; k < 3; k++) {
      const y = v.copy(t[k]).applyMatrix4(M).y;
      if (y < lo) lo = y;
    }
    return lo;
  };
  const staticLow = (() => { g.root.updateMatrixWorld(true); return lowOf(); })();

  const scenarios = [
    ['rest', {}],
    ['singing', { singing: true, beat: 0.7, beatOn: true }],
    ['look up', { aimY: 1 }],
    ['look down', { aimY: -1 }],
    ['hovered', { hovered: true }],
    /* 更狠的组合：全拍 + 看向上下左右 + 悬停，单独的组合会互相抵消，
       叠起来才试得出余量够不够。 */
    ['sing + beat1 + up', { singing: true, beat: 1, beatOn: true, aimY: 1 }],
    ['sing + beat1 + down', { singing: true, beat: 1, beatOn: true, aimY: -1 }],
    ['sing + beat1 + side', { singing: true, beat: 1, beatOn: true, aimX: 1 }],
    ['sing + beat1 + hover', { singing: true, beat: 1, beatOn: true, hovered: true }],
  ];
  const acts = ['nod', 'wave', 'spin', 'jump', 'salute'];
  for (const a of acts) {
    scenarios.push([`act ${a}`, {}], [`act ${a} + singing`, { singing: true, beat: 0.7, beatOn: true }]);
  }

  const DT = 1 / 60;
  const results = [];
  for (const [name, opts] of scenarios) {
    /* 每个场景都要一台新机器：`st` 是有状态的，共用一台就会把上一个
       场景的 `st.act` / `st.aim` 带进来。 */
    const gg = createGhost({ height: 6.38, y: FLOOR_Y });
    gg.root.updateMatrixWorld(true);
    const band = bandOf(gg);
    if (name.startsWith('act ')) {
      const key = name.split(' ')[1];
      gg.play(key);
    }
    let lo = Infinity, at = 0, bodyLo = Infinity;
    const N = name.startsWith('act ') ? Math.round(3.0 / DT) : Math.round(6.0 / DT);
    for (let i = 0; i < N; i++) {
      gg.update(DT, opts);
      gg.root.updateMatrixWorld(true);
      const M = gg.broom.matrixWorld;
      for (const t of local) for (let k = 0; k < 3; k++) {
        const y = v.copy(t[k]).applyMatrix4(M).y;
        if (y < lo) { lo = y; at = i * DT; }
      }
      const bl = bodyLowOf(band);
      if (bl < bodyLo) bodyLo = bl;
    }
    results.push([name, lo, at, bodyLo]);
    console.log(`  ${name.padEnd(22)} broom ${lo.toFixed(3)}`
      + ` (${(lo - FLOOR_Y >= 0 ? '+' : '') + (lo - FLOOR_Y).toFixed(3)})`
      + `   hem ${bodyLo.toFixed(3)}`
      + ` (${(bodyLo - FLOOR_Y >= 0 ? '+' : '') + (bodyLo - FLOOR_Y).toFixed(3)})`
      + `   at t=${at.toFixed(2)}s`);
  }
  const worst = results.reduce((a, b) => (b[1] < a[1] ? b : a));
  const worstHem = results.reduce((a, b) => (b[3] < a[3] ? b : a));
  ANIM_SINK = staticLow - worst[1];
  console.log(`\n  WORST broom: ${worst[0]}  y ${worst[1].toFixed(3)}`
    + `  = ${(worst[1] - FLOOR_Y).toFixed(3)} below the floor`);
  console.log(`  WORST hem  : ${worstHem[0]}  y ${worstHem[3].toFixed(3)}`
    + `  = ${(worstHem[3] - FLOOR_Y).toFixed(3)} below the floor`);
  console.log(`  static-rest low was ${staticLow.toFixed(3)}`
    + `  ->  the animation adds ${ANIM_SINK.toFixed(3)} below it`);
  console.log(`  =>  ANIM_SINK = ${ANIM_SINK.toFixed(3)} replaces the ${BOB_WORST.toFixed(3)}`
    + ` guess in the table below.`);
}

console.log(`\n=== candidates (floor column already has ANIM_SINK = ${ANIM_SINK.toFixed(3)} in it) ===`);

/* ★ 基准行必须用 `BASE_R`，不能硬写 `-0.10, -0.10`：偏航 `ry` 在 2026-10-03 从
   -0.10 改成了 -0.24（由参考图的投影宽度反解出来），硬写旧值会让打印出来的
   `now` 行**看起来是当前配置、其实是上一版** —— 而 `relic-gap` 恰恰是随 `ry`
   变的，于是"现在离烛台多远"这一栏会给出一个不存在的读数。 */
const base = evalCand(0, 0, BASE_R.z, BASE_R.y);
const show = (c) => `dx ${c.dx.toFixed(2)} dy ${c.dy.toFixed(2)} rz ${c.rz.toFixed(2)} ry ${c.ry.toFixed(2)}`
  + `   y ${c.lo.toFixed(3)}..${c.hi.toFixed(3)}`
  + `   floor ${(c.floor >= 0 ? '+' : '') + c.floor.toFixed(3)}`
  + `   relic ${c.relic.toFixed(3)}   body ${c.body.toFixed(3)}`;
console.log(`now      ${show(base)}`);
/* ★ 参考里量出来的是「帚柄左端伸到身体轴左边 1.33 B，帚穗右端只到 0.93 B」。
   当时这一支是 -1.27B / +1.04B —— **整支偏右 0.09 B**，于是帚穗那一头正好
   戳进烛台那一圈。所以 dx 不是"为了躲开烛台而挪"，是**挪回参考量出来的位置**，
   躲开只是顺带的。
   烛台本身也一起挪过：`relic.js` 的 `stand.position` 从 (4.3, ·, 2.0) 改到
   (5.6, ·, 2.2)，因为三只脚互成 120°，正面机位下**转多少都有一只脚指着帚穗**，
   只能挪宿主。下表里的 `relic-gap` 读的就是挪完之后的 `relic.js`。 */
const BX = 4.03755;
console.log(`\n  dx(B)  dy     rz     ry  |  floor-gap  relic-gap  body-gap   tail(x)  tip(x)`);
for (const dxb of [0, -0.06, -0.09, -0.12, -0.16]) {
  for (const dy of [0, 0.12, 0.24, 0.34]) {
    const c = evalCand(dxb * BX, dy, BASE_R.z, BASE_R.y);
    const bad = c.floor < 0.10 || c.relic < 0.30 || c.body < 0.60;
    console.log(`  ${dxb.toFixed(2)}  ${dy.toFixed(2)}  ${c.rz.toFixed(2)}  ${c.ry.toFixed(2)}  |`
      + `  ${(c.floor >= 0 ? '+' : '') + c.floor.toFixed(3)}`
      + `     ${c.relic.toFixed(3)}     ${c.body.toFixed(3)}`
      + `    ${(c.lo).toFixed(2)}  ${(c.hi).toFixed(2)}`
      + (bad ? '   <- fails' : ''));
  }
}
