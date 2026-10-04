/* dev: 整段演唱即兴跑下来，下摆有没有一秒到过地板下面？
 *
 *   node tools/_singhem.mjs [sec] [reduce?]
 *
 * WHY
 * `_hemwho.mjs` 逐条量的是 `ACTIONS` 那五个 —— 访客点的动作。`SING` 那张表
 * （2026-10-04 新加的演唱手势）有自己的幅度，`sway` 的侧倾 0.82 比 `wave` 的
 * 0.72 大、`bow` 的前倾 0.72 rad 比 `nod` 的 0.16 大四倍，两条都在往地板上
 * 甩下摆的那一侧。不能因为"公式自动补偿"就假定没事 —— 补偿是 `rideUp` 给的，
 * 而它读的是 `tip`/`roll`，正好是这两条给大的量。
 *
 * 所以这里不逐条静音，而是**把整段即兴连着跑**：`singing:true`、`routine:true`，
 * 让 `pos` 跟着模拟钟走，于是歌本自己按乐句把手势一条条放出来。跑的是用户真的
 * 会看到的那条路径，不是一条条单独 `play()`。
 * ★ 判据与 `_hemwho.mjs` 同：下摆最低点的世界 y 不许低于 `FLOOR_Y`。
 */
const SEC = +(process.argv[2] || 60);
const REDUCE = process.argv[3] === 'reduce';

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

const FLOOR_Y = -1.62;
const DT = 1 / 60;
const inGroup = (o, top) => { for (let p = o; p; p = p.parent) if (p === top) return true; return false; };

const bandOf = (gh) => {
  const out = [], tmp = new THREE.Vector3();
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

const gg = createGhost({ height: 6.38, y: FLOOR_Y });
gg.root.updateMatrixWorld(true);
const band = bandOf(gg);

const v = new THREE.Vector3();
const per = new Map();            // action -> 最低 y
let lo = Infinity, at = 0, worst = '(none)';
const seen = [];
let last = null;

for (let i = 0; i < Math.round(SEC / DT); i++) {
  const pos = i * DT;                       // 歌曲钟 = 模拟钟
  gg.update(DT, {
    singing: true, beat: 0.7, beatOn: true, routine: true, pos,
    hovered: false, aimX: 0, aimY: 0,
  });
  gg.root.updateMatrixWorld(true);
  const a = gg.action;
  if (a !== last) { last = a; if (a) seen.push(a); }
  for (const e of band) for (const p of e.list) {
    const y = v.copy(p).applyMatrix4(e.mesh.matrixWorld).y;
    if (y < lo) { lo = y; at = i * DT; worst = a || '(静息)'; }
    if (a) per.set(a, Math.min(per.get(a) ?? Infinity, y));
  }
}

const gap = lo - FLOOR_Y;
console.log(`\n整段即兴 ${SEC}s  ${REDUCE ? '(reduce)' : ''}`);
console.log(`  手势序列  ${seen.length} 个: ${seen.join(' → ') || '(none)'}`);
console.log(`\n  动作      最低 y     离地板`);
for (const [a, y] of [...per].sort((x, z) => x[1] - z[1])) {
  const g = y - FLOOR_Y;
  console.log(`  ${a.padEnd(8)} ${y.toFixed(3).padStart(8)}  ${((g >= 0 ? '+' : '') + g.toFixed(3)).padStart(8)}${g < 0 ? '   <- 穿' : ''}`);
}
console.log(`\n  整段最低  ${lo.toFixed(3)}  (${worst} @ t=${at.toFixed(2)}s)  离地板 ${(gap >= 0 ? '+' : '') + gap.toFixed(3)}`);
console.log(gap >= 0
  ? 'PASS  整段即兴没有一秒把下摆送到地板下面'
  : 'FAIL  下摆穿地板');
console.log(seen.length >= 3
  ? 'PASS  即兴确实起了多个手势（否则这条检查是空的）'
  : 'FAIL  即兴几乎没起手势，这条检查没测到东西');
process.exit(gap >= 0 && seen.length >= 3 ? 0 : 1);
