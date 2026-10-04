/* dev: 纯旋转把下摆压低多少？—— 给 `HEM_RZ` 定值用
 *
 *   node tools/_hemsweep.mjs
 *
 * WHY
 * `_singhem.mjs` 报 `bow`（tip 0.86）下摆离地板 −0.331，`HEM_RZ` 从 0.35 提到
 * 1.32 只把 −0.814 收回到 −0.331，还不够。分析式推不下去：`rideUp` 是
 * `sag − HEM_H·cos θ + KEEP`，而几何上真正的账是"支点在地板线上，下摆离支点
 * 有 h 高、有 R 远"—— 两笔账不同形，θ 一大就分家。
 *
 * 所以这里**绕过 `update()`**，直接摆一个姿态量：
 *   `root.rotation.x = θ`、`body.position.y = 0`，然后量下摆最低点的世界 y。
 * 得到的 `D(θ)` 就是"纯旋转"的下沉量，不含 `rise`、不含 `rideUp`、不含 `bob`。
 * 需要的抬升就是 `D(θ) − HEM_H`（把离地间隙还回 0）。
 *
 * ★ 不能走 `update()`：它每帧都重写 `root.rotation` 与 `body.position.y`，
 *   摆好的姿态下一帧就没了。
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

const FLOOR_Y = -1.62, HEM_H = 0.465, KEEP = 0.10;
const gg = createGhost({ height: 6.38, y: FLOOR_Y });
const inGroup = (o, top) => { for (let p = o; p; p = p.parent) if (p === top) return true; return false; };

/* 下摆那一圈：**按世界最低点**挑网格，再取离它自己最低点 0.25 以内的顶点。
   ★ 不能按**局部**最低点挑 —— 她的局部坐标是模型自己的单位，`root` 上还挂着
     缩放与平移，局部最低的那个网格是手臂或帽子，不是下摆。第一版就是这么错的，
     量出来"静息下摆离地板 3.028"，比地板还高一整个身体。 */
const v = new THREE.Vector3();
let bandMesh = null, bandLo = Infinity;
gg.root.updateMatrixWorld(true);
gg.root.traverse((o) => {
  if (!o.isMesh) return;
  if (inGroup(o, gg.broom) || inGroup(o, gg.crown) || o === gg.hit || o === gg.aura) return;
  const pos = o.geometry.getAttribute('position');
  let lo = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).y;
    if (y < lo) lo = y;
  }
  if (lo < bandLo) { bandLo = lo; bandMesh = o; }
});
const pos = bandMesh.geometry.getAttribute('position');
const localLo = (() => {
  let lo = Infinity;
  for (let i = 0; i < pos.count; i++) lo = Math.min(lo, pos.getY(i));
  return lo;
})();
const ring = [];
for (let i = 0; i < pos.count; i++) {
  if (pos.getY(i) > localLo + 0.25) continue;
  ring.push(v.fromBufferAttribute(pos, i).clone());
}
console.log(`\n下摆环 ${ring.length} 个顶点（网格 ${bandMesh.name || bandMesh.type}）`);

const lowOf = () => {
  gg.root.updateMatrixWorld(true);
  let lo = Infinity;
  for (const p of ring) {
    const y = v.copy(p).applyMatrix4(bandMesh.matrixWorld).y;
    if (y < lo) lo = y;
  }
  return lo;
};

/* 静息 */
gg.root.rotation.set(0, 0, 0);
gg.root.position.y = FLOOR_Y;
const rest = lowOf();
console.log(`  静息最低 y = ${rest.toFixed(3)}   离地板 ${(rest - FLOOR_Y).toFixed(3)}\n`);

console.log('  θ(rad)   θ(°)   纯旋转最低 y   下沉 D     需要抬升 D−HEM_H');
const thetas = [0.16, 0.32, 0.50, 0.72, 0.86, 1.00];
const D = {};
for (const t of thetas) {
  gg.root.rotation.set(t, 0, 0);
  const lo = lowOf();
  D[t] = rest - lo;
  console.log(`  ${t.toFixed(2)}   ${(t * 180 / Math.PI).toFixed(1).padStart(5)}   ${lo.toFixed(3).padStart(11)}`
    + `   ${D[t].toFixed(3).padStart(8)}   ${(D[t] - HEM_H).toFixed(3).padStart(10)}`);
}

/* 现在的公式给多少，差多少。`sag = RZ·sin θ`，`rideUp = sag − HEM_H·cos θ + KEEP` */
console.log('\n  现在 HEM_RZ = 1.32 的公式 vs 需要的抬升：');
console.log('  θ     公式给     需要      差');
for (const t of thetas) {
  const formula = Math.max(0, 1.32 * Math.sin(t) - HEM_H * Math.cos(t) + KEEP);
  const need = Math.max(0, D[t] - HEM_H);
  console.log(`  ${t.toFixed(2)}  ${formula.toFixed(3).padStart(7)}  ${need.toFixed(3).padStart(7)}  ${(formula - need).toFixed(3).padStart(7)}`
    + (formula < need - 0.001 ? '   <- 不够' : ''));
}

/* 反解：要让公式在每个 θ 都不短，HEM_RZ 至少要多少 */
let needRZ = 0;
for (const t of thetas) {
  const need = Math.max(0, D[t] - HEM_H);
  const rz = (need + HEM_H * Math.cos(t) - KEEP) / Math.sin(t);
  needRZ = Math.max(needRZ, rz);
}
console.log(`\n  反解 HEM_RZ >= ${needRZ.toFixed(3)}  （现在 1.32，原来 0.35）`);
