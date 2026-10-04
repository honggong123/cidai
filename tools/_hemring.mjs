/* dev: 下摆那个环，前后到底有多深？—— 量 `HEM_RZ` 该给多少
 *
 *   node tools/_hemring.mjs
 *
 * WHY
 * `ghost.js` 里 `rideUp` 的 `sag` 是
 *     `HEM_RX·|sin roll| + HEM_RZ·|sin tip|`
 * 配 `HEM_RX = 1.32` / `HEM_RZ = 0.35`，注释说"她宽、不深，差 3.8 倍"。
 * 滚转那条（`roll`）被 `_hemwho.mjs` 验过 —— `wave` 的 0.72 rad 原来是穿
 * −2.059，补完 +0.020。**前倾那条从来没被验过**：`ACTIONS` 五个里最大的 `tip`
 * 是 `nod` 的 0.16，`salute` 的 −0.32，都小到 `HEM_RZ·|sin tip|` 那项几乎为 0，
 * 于是 `HEM_RZ` 对不对，一直没人问。
 *
 * 2026-10-04 加 `SING.bow`（tip 0.86）第一次把这条通道开大，`_singhem.mjs`
 * 立刻量到下摆离地板 −0.814。所以这里把环量出来：**别猜，量**。
 * ★ 量的是"下摆边缘那一圈顶点在 root 局部坐标里的 x/z 跨度" —— `sag` 要的正是
 *   这两个半径，不是整个身体的包围盒（帽子与扫帚在 5 个单位以外）。
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

const gg = createGhost({ height: 6.38, y: -1.62 });
gg.root.updateMatrixWorld(true);

const inGroup = (o, top) => { for (let p = o; p; p = p.parent) if (p === top) return true; return false; };
const v = new THREE.Vector3();

/* 先把每个网格的世界最低点找出来，再取"离自己最低点 0.25 以内"的那一圈 ——
   那才是下摆边缘，不是整张床单。 */
const rows = [];
gg.root.traverse((o) => {
  if (!o.isMesh) return;
  if (inGroup(o, gg.broom) || inGroup(o, gg.crown) || o === gg.hit || o === gg.aura) return;
  const pos = o.geometry.getAttribute('position');
  let lo = Infinity;
  for (let i = 0; i < pos.count; i++) lo = Math.min(lo, pos.getY(i));
  const ring = [];
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > lo + 0.25) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    ring.push({ x: v.x, y: v.y, z: v.z });
  }
  if (ring.length < 8) return;
  const ax = ring.reduce((m, p) => Math.max(m, Math.abs(p.x)), 0);
  const az = ring.reduce((m, p) => Math.max(m, Math.abs(p.z)), 0);
  const yl = Math.min(...ring.map((p) => p.y));
  const yh = Math.max(...ring.map((p) => p.y));
  rows.push({ name: o.name || o.type, n: ring.length, ax, az, yl, yh });
});

console.log('\n下摆边缘那一圈（离各自最低点 0.25 以内）的 root 局部跨度\n');
console.log('  网格              顶点    max|x|    max|z|   最低 y    最高 y');
for (const r of rows.sort((a, b) => a.yl - b.yl)) {
  console.log(`  ${r.name.padEnd(16)} ${String(r.n).padStart(5)} ${r.ax.toFixed(3).padStart(8)} ${r.az.toFixed(3).padStart(8)}`
    + ` ${r.yl.toFixed(3).padStart(9)} ${r.yh.toFixed(3).padStart(9)}`);
}
const AX = Math.max(...rows.map((r) => r.ax));
const AZ = Math.max(...rows.map((r) => r.az));
console.log(`\n  环的左右半宽 max|x| = ${AX.toFixed(3)}   (ghost.js 里 HEM_RX = 1.32)`);
console.log(`  环的前后半宽 max|z| = ${AZ.toFixed(3)}   (ghost.js 里 HEM_RZ = 0.35)`);
console.log(`\n  比值 |x|/|z| = ${(AX / AZ).toFixed(2)}  (注释说 3.8)`);
console.log(AZ > 0.35 * 1.5
  ? `\n  ⚠ 前后半宽比 HEM_RZ 大 ${(AZ / 0.35).toFixed(1)} 倍 —— 前倾通道的补偿一直不够。`
  : '\n  HEM_RZ 够用。');
