/* dev: 下摆穿地板，到底是哪个通道干的？

   `_broomfix.mjs` 报了 `act wave` 的下摆在世界 y −2.059（地板下 0.439），
   可 `wave` 的 `rise` 只有 ±0.20 —— 那么大的下沉不可能来自平移。
   嫌疑落在 `lean`：`root.rotation.z` 是 0.72 rad，而且绕的是**地板那条线**
   （`root` 挂在 y = FLOOR_Y 上）。下摆是个半径 ~2.7 的环，离地板只有 0.465，
   绕地板线滚 41° 必然把一侧甩下去。

   猜没用。这里做的是**单通道静音**：同一段动画，每帧在 `update()` 之后把
   `root.rotation` 的某一个分量清零，再 `updateMatrixWorld` 量下摆最低点。
   哪个分量清零后下摆就回到地板之上，罪魁就是它。

   ★ 清零必须排在 `update()` **之后**、`updateMatrixWorld()` **之前**：
     `rotation` 是 `update()` 每帧写的，提前清会被它覆盖。

   Run:  node tools/_hemwho.mjs
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

const FLOOR_Y = -1.62;
const DT = 1 / 60;
const inGroup = (o, top) => { for (let p = o; p; p = p.parent) if (p === top) return true; return false; };

/* 下摆带：每个网格自己最低 1.2 个单位以内那一带顶点（手臂在 1.5 以上）。
   ★ 必须**按每一台机器各取一份** —— 见 `_broomfix.mjs` 里同名的教训。 */
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

const v = new THREE.Vector3();
const run = (act, mute, opts = {}) => {
  const gg = createGhost({ height: 6.38, y: FLOOR_Y });
  gg.root.updateMatrixWorld(true);
  const band = bandOf(gg);
  gg.play(act);
  let lo = Infinity, at = 0;
  for (let i = 0; i < Math.round(3.0 / DT); i++) {
    gg.update(DT, opts);
    /* 单通道静音 —— 必须在 update 之后 */
    if (mute === 'roll') gg.root.rotation.z = 0;
    else if (mute === 'tip') gg.root.rotation.x = 0;
    else if (mute === 'spin') gg.root.rotation.y = 0;
    gg.root.updateMatrixWorld(true);
    for (const e of band) for (const p of e.list) {
      const y = v.copy(p).applyMatrix4(e.mesh.matrixWorld).y;
      if (y < lo) { lo = y; at = i * DT; }
    }
  }
  return { lo, at };
};

const SING = { singing: true, beat: 0.7, beatOn: true };
console.log('\n下摆最低点（世界 y，地板 = ' + FLOOR_Y + '，静息间隙 0.465）\n');
console.log('  动作    静音        最低 y     离地板     发生在');
for (const [label, opts] of [['', {}], ['+ 唱歌  ', SING]]) {
  if (label) console.log(`  --- ${label.trim()} ---`);
  for (const act of ['nod', 'wave', 'spin', 'jump', 'salute']) {
    for (const mute of [null, 'roll']) {
      const { lo, at } = run(act, mute, opts);
      const gap = lo - FLOOR_Y;
      console.log(`  ${act.padEnd(7)} ${(mute || '（原样）').padEnd(9)}  ${lo.toFixed(3).padStart(8)}`
        + `  ${((gap >= 0 ? '+' : '') + gap.toFixed(3)).padStart(8)}   t=${at.toFixed(2)}s`
        + (gap < 0 ? '   <- 穿' : ''));
    }
  }
  console.log('');
}
