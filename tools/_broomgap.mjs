/* dev: 扫帚到底和谁"穿"了 —— 离线几何判定，不开浏览器。

   用户报「那个扫把穿模了」。截图里它和烛台的铁腿叠在一起，但"叠在一起"
   有两种：3D 里真的互穿，还是只是投影重叠。眼睛分不开，所以让几何说话。

   这个脚本 import 源码模块本身（和 `_sil.mjs` 同一套做法），把两件东西
   各自 updateMatrixWorld 之后，逐三角形算**最近距离**，并报出这一对最近
   的三角形分别属于哪个网格、在世界空间的哪个位置。

   离线的意义：不开 GL、不开相机、不设灯光、不做阈值 —— 没有一处可以出错。

   ★ 记住 FLOOR_Y：扫帚的 root 挂在它上面（ghost.js 的 `root.position.y = y`），
   烛台的 `stand` 也挂在它上面（relic.js 的 `baseY = floorY`）。少了这一项，
   两边都会算错 1.62 个单位，而错得"很合理"。

   Run:  node tools/_broomgap.mjs
*/
/* `ghost.js` 在建模期会拿 `document.createElement('canvas')` 画一张自发光贴图
   （`glowMap`）。这里只关心几何，那张贴图的内容与形状无关，所以给一个空桩子
   就够了 —— 和 `_sil.mjs` 用的是同一个。 */
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

const g = createGhost({ height: 6.38, y: FLOOR_Y });
const r = createRelic({ floorY: FLOOR_Y });
g.root.updateMatrixWorld(true);
r.root.updateMatrixWorld(true);

/* ---------- 1. 收集世界空间三角形 ---------- */
const trisOf = (top, skip = () => false) => {
  const out = [];
  top.traverse((o) => {
    if (!o.isMesh || skip(o)) return;
    const geo = o.geometry;
    const pos = geo.getAttribute('position');
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const w = o.matrixWorld;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const geoName = geo.type.replace('Geometry', '')
      + (geo.parameters ? `(${Object.values(geo.parameters).slice(0, 3).join(',')})` : '');
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(w);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(w);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(w);
      out.push([a.clone(), b.clone(), c.clone(), geoName, o]);
    }
  });
  return out;
};

const broomTris = trisOf(g.broom);
/* 烛台：整个 root 就是那一件东西（光环 halo 是 RingGeometry，是"进度条"，
   不是实体，排掉；火苗是 Basic 材质的锥体，也算实体，但它在 2.85 高处，
   离扫帚最远，留着不碍事） */
const relicTris = trisOf(r.root, (o) => o.geometry.type === 'RingGeometry');

const aabb = (tris) => {
  const b = new THREE.Box3();
  for (const t of tris) { b.expandByPoint(t[0]); b.expandByPoint(t[1]); b.expandByPoint(t[2]); }
  return b;
};
const AB = aabb(broomTris), AR = aabb(relicTris);
const fmt = (b) => `x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}  `
  + `y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}  `
  + `z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)}`;

console.log(`broom  n=${broomTris.length}  ${fmt(AB)}`);
console.log(`relic  n=${relicTris.length}  ${fmt(AR)}`);
console.log(`floor  y = ${FLOOR_Y}`);
console.log(`AABB overlap: x ${AB.min.x <= AR.max.x && AB.max.x >= AR.min.x}`
  + `  y ${AB.min.y <= AR.max.y && AB.max.y >= AR.min.y}`
  + `  z ${AB.min.z <= AR.max.z && AB.max.z >= AR.min.z}`);
console.log(`broom lowest point is ${(AB.min.y - FLOOR_Y).toFixed(3)} above the floor`
  + (AB.min.y < FLOOR_Y ? '   ** BELOW THE FLOOR' : ''));

/* ---------- 2. 点到三角形的真距离（Ericson, RTCD §5.1.5） ---------- */
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

let best = Infinity, bp = null, bq = null, bt = null, br = null;
const verts = (tris) => {
  const out = [];
  for (const t of tris) out.push(t[0], t[1], t[2]);
  return out;
};
const check = (pts, others, ptsFrom, othersFrom) => {
  for (const p of pts) {
    for (const t of others) {
      const q = closestOnTri(p, t[0], t[1], t[2]);
      const d = q.distanceTo(p);
      if (d < best) { best = d; bp = p.clone(); bq = q; bt = ptsFrom; br = othersFrom; }
    }
  }
};
check(verts(broomTris), relicTris, 'broom', 'relic');
check(verts(relicTris), broomTris, 'relic', 'broom');

console.log(`\nmin distance broom <-> relic = ${best.toFixed(3)} units`);
if (best < 0.35) {
  console.log(`  closest pair: ${bt} vertex ${bp.x.toFixed(2)},${bp.y.toFixed(2)},${bp.z.toFixed(2)}`
    + `  ->  ${br} surface ${bq.x.toFixed(2)},${bq.y.toFixed(2)},${bq.z.toFixed(2)}`);
  const nearB = new Set(), nearR = new Set();
  /* ★ 三角形的元组是 [a, b, c, geoName, mesh] —— 顶点只有前三项。写成
     `for (const v of t)` 会把网格名（字符串）和 Object3D 也当成向量去
     `.distanceTo()`，报的却是"没有这个函数"，看起来像 three 的 API 变了。 */
  const near = (tris, set) => {
    for (const t of tris) for (let k = 0; k < 3; k++) if (t[k].distanceTo(bq) < best + 0.30) set.add(t[3]);
  };
  near(broomTris, nearB);
  near(relicTris, nearR);
  console.log(`  broom parts there: ${[...nearB].join(', ')}`);
  console.log(`  relic parts there: ${[...nearR].join(', ')}`);
} else {
  console.log('  (nothing within 0.35 units — no contact anywhere)');
}

/* ---------- 3. 扫帚自己：各段的 y 范围，看它是不是有一截沉到地板下 ---------- */
console.log('\n--- broom parts, world y ---');
const byName = new Map();
for (const t of broomTris) {
  const k = t[3];
  if (!byName.has(k)) byName.set(k, [Infinity, -Infinity, 0]);
  const e = byName.get(k);
  for (const v of t) { if (v.y < e[0]) e[0] = v.y; if (v.y > e[1]) e[1] = v.y; }
  e[2]++;
}
for (const [k, [lo, hi, n]] of [...byName].sort((a, b) => a[1][0] - b[1][0])) {
  console.log(`  ${k.padEnd(34)} y ${lo.toFixed(3)} .. ${hi.toFixed(3)}   tris ${n}`
    + (lo < FLOOR_Y ? '   ** below floor' : ''));
}

/* ---------- 4. 身体：下摆底在哪个高度、半径多大 ---------- */
console.log('\n--- her body, at the broom\'s own heights ---');
/* ★ 排除一棵子树要按**祖先**判，不能按 `o === g.broom` —— 那个只排掉 Group
   自己，`traverse` 照样走进它的子网格。第一版就是这样把扫帚算进了"身体"，
   于是"身体最低点"和"扫帚最低点"是同一个数（-1.809），而"身体半径"读出来
   5.27（那是扫帚的柄尾伸到 x=-5.12）。看起来完全合理，因为是同一个数。 */
const inGroup = (o, top) => { for (let p = o; p; p = p.parent) if (p === top) return true; return false; };
const bodyTris = trisOf(g.root, (o) => inGroup(o, g.broom) || inGroup(o, g.crown)
  || o === g.hit || o === g.aura);

/* ---------- 4b. 扫帚 <-> 身体（床单）：同一个判据，换一个对象 ---------- */
{
  let b2 = Infinity, p2 = null, q2 = null;
  for (const p of verts(broomTris)) {
    for (const t of bodyTris) {
      const q = closestOnTri(p, t[0], t[1], t[2]);
      const d = q.distanceTo(p);
      if (d < b2) { b2 = d; p2 = p.clone(); q2 = q; }
    }
  }
  console.log(`\nmin distance broom <-> body(sheet) = ${b2.toFixed(3)} units`);
  console.log(`  closest pair: broom ${p2.x.toFixed(2)},${p2.y.toFixed(2)},${p2.z.toFixed(2)}`
    + `  ->  sheet ${q2.x.toFixed(2)},${q2.y.toFixed(2)},${q2.z.toFixed(2)}`);
}
const bA = aabb(bodyTris);
console.log(`  body world y ${bA.min.y.toFixed(3)} .. ${bA.max.y.toFixed(3)}`);
const radAt = (y) => {
  let m = 0;
  for (const t of bodyTris) for (const v of t) {
    if (Math.abs(v.y - y) < 0.12) m = Math.max(m, Math.hypot(v.x, v.z));
  }
  return m;
};
for (const y of [bA.min.y + 0.05, bA.min.y + 0.2, bA.min.y + 0.5, bA.min.y + 1.0]) {
  console.log(`  radius at y=${y.toFixed(2)}: ${radAt(y).toFixed(3)}`);
}
console.log(`  body lowest point y = ${bA.min.y.toFixed(3)}  (${(bA.min.y - FLOOR_Y).toFixed(3)} above floor)`);
