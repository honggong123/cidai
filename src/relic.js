/* 幽魂烛台 —— 磁带的继任者（2026-10-02 用户要求「磁带的部分舍弃，换成给小幽灵
   新设计的东西」）。

   上一任是一台藏在 TAPE_ON 后面的磁带机：mesh 不画了，但每帧还在算走带。
   这一任把「它」换成了「她」的东西 —— 一座铁艺幽烛台，立在厅里**看得见**：
   五支蜡烛围成一环，安眠时只余烛芯的一点幽光；她一开口，五簇**青色的幽火**
   依次醒来，烛环随歌缓缓旋转，头顶的光环按演唱进度慢慢合拢（旧的计数器
   数字之外，多了一眼能读的"烧到哪了"）。

   接口与磁带机逐一同名（main.js 的六十余处引用原地换芯，一个不必改）：
     root / assembly / materials / headMaterials / anchors / parts.reels[i].spin
     st { playing, time, duration, dir, driven, explodeTarget, flipTarget }
     update(dt) → st   · setProgress(f)   · setLabel / commitLabel / sweepLabel /
     stepHead / warmLabel / setExplode
   磁带语义的部分（拆解、翻面、写头）是有意的空操作 —— 它们的调用点留着，
   是为了让"一次点击把页面送进同一个状态"这句话继续成立。

   她站的位置：磁带当年站在厅心，如今那里是**她**。烛台退到她的右手边
   （+4.3, 0, +2.0），与壁炉一左一右，是这个房间新的两盏火。 */
import * as THREE from 'three';

export const DIM = { H: 6.38, hd: 0.60 };

const TAU = Math.PI * 2;

export function createRelic({ title = '', artist = '', album = '', minutes = '', floorY = 0 } = {}) {
  const root = new THREE.Group();

  /* ★★ `dir` 的初值是 **−1**（前进），不是 1。老走带台的初值就是 −1，这一版
     写成了 1 —— 单独看无所谓（`st.playing` 是 false，两支都不跑），但它和下面
     `update` 里丢掉的那一支合起来就成了一个**静默的陷阱**：没有音频可驱动时
     （`driven` 恒 false，见 README「音频加载失败 · 她只做口型」）`dir > 0` 会让
     画面自己的钟**往倒带那一支走**。 */
  const st = {
    playing: false, time: 0, duration: 0, dir: -1, driven: false,
    explode: 0, explodeTarget: 0, flip: 0, flipTarget: 0,
    label: { title, artist, album, minutes },
    progress: 0, flare: 0,
  };

  const materials = [];
  const M = (opt) => { const m = new THREE.MeshStandardMaterial({ toneMapped: true, ...opt }); materials.push(m); return m; };
  const iron = M({ color: 0x2b2730, roughness: 0.55, metalness: 0.72 });
  const wax = M({ color: 0xe9dfca, roughness: 0.62 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x9ff2ec, toneMapped: false });
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x8fe8f0, toneMapped: false,
    transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
  });

  /* 幽火：青色，和她体内那盏光同族。安眠时只剩烛芯的一点（0.16），
     演唱时长到 1，随节拍再抖。 */
  const flameOf = (h) => {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.10, h, 8), flameMat);
    outer.position.y = h / 2;
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.05, h * 0.55, 8),
      new THREE.MeshBasicMaterial({ color: 0xeafffd, toneMapped: false }));
    core.position.y = h * 0.3;
    g.add(outer, core);
    return g;
  };

  /* 铁艺座：三足 + 细柱 + 环托。**这些是承重的实心件，要投影** ——
     上一版整份文件没有一处 `castShadow`（旧 cassette.js 有
     `o.castShadow = o.receiveShadow = true` 的整树遍历），于是烛台落在
     厅里是"贴"在地上的：没有接触阴影，再怎么摆都读成一个贴纸。
     火苗与光环**不投影** —— 一簇 MeshBasicMaterial 的锥体投出来的是一根
     黑色的锥影，比没有影子更假。 */
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3 + 0.5;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 1.05), iron);
    foot.position.set(Math.sin(a) * 0.42, 0.05, Math.cos(a) * 0.42);
    foot.rotation.y = a + Math.PI / 2;
    foot.castShadow = true;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.85, 6), iron);
    strut.position.set(Math.sin(a) * 0.26, 0.45, Math.cos(a) * 0.26);
    strut.rotation.x = Math.sin(a) * 0.18;
    strut.rotation.z = -Math.cos(a) * 0.18;
    strut.castShadow = true;
    root.add(foot, strut);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 2.6, 8), iron);
  pole.position.y = 1.3;
  pole.castShadow = true;
  root.add(pole);

  /* 烛环：iron 环 + 五支蜡烛，整个环随歌旋转（parts.reels[0] —— 名字留给调用点） */
  const ringPivot = new THREE.Group();
  ringPivot.position.y = 2.85;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.075, 10, 40), iron);
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  ringPivot.add(rim);
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5;
    const h = 0.42 + 0.13 * ((i * 7) % 3);
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, h, 10), wax);
    candle.position.set(Math.sin(a) * 0.92, h / 2 + 0.06, Math.cos(a) * 0.92);
    candle.castShadow = true;
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 5), iron);
    wick.position.set(Math.sin(a) * 0.92, h + 0.1, Math.cos(a) * 0.92);
    const fl = flameOf(0.55);
    fl.position.set(Math.sin(a) * 0.92, h + 0.12, Math.cos(a) * 0.92);
    fl.scale.setScalar(0.16);                 // 安眠：只剩烛芯的一点
    ringPivot.add(candle, wick, fl);
    flames.push(fl);
  }
  root.add(ringPivot);

  /* 进度光环：RingGeometry 按 thetaLength 重建（0.2s 节流的那次），烧到哪合到哪 */
  const haloPivot = new THREE.Group();
  haloPivot.position.y = 2.85;
  haloPivot.rotation.x = -Math.PI / 2;
  let haloMesh = null, haloAt = -1;
  function rebuildHalo(f) {
    if (Math.abs(f - haloAt) < 0.004 && haloMesh) return;
    haloAt = f;
    if (haloMesh) { haloPivot.remove(haloMesh); haloMesh.geometry.dispose(); }
    const geo = new THREE.RingGeometry(1.14, 1.26, 48, 1, Math.PI / 2, Math.max(0.001, f * TAU));
    haloMesh = new THREE.Mesh(geo, haloMat);
    haloPivot.add(haloMesh);
  }
  rebuildHalo(0);
  root.add(haloPivot);

  /* 幽火的光：演唱时亮起，随节拍呼吸 */
  const glow = new THREE.PointLight(0x8fe8f0, 0.12, 9, 2);
  glow.position.y = 3.15;
  root.add(glow);

  /* 站位：她的右手边。root 本体留在厅心（历来的变换管线指着它），
     烛台整体在这里偏移出去。

     ★★ 底座必须落在**厅的地面**上，不是 y=0。厅的地面在 FLOOR_Y（main.js
     里 −1.62：旧磁带的悬浮高度是 0，地板在 −1.62，`cas.root.position.y`
     由主循环的 `intro.y + bob − swap.press` 写 —— 那三行随磁带一起删了，
     而"root 在 0"这个假设留了下来）。于是烛台**悬在地面上方 1.62 个单位**
     处：她的小腿比它还低，三只脚下面是空的地砖、没有接触阴影，整件东西
     读成挂在半空的贴纸。`createCastle` 和 `createGhost` 都是这样把地面
     递进来的（`{ floorY }` / `{ y }`），烛台照同一个规矩收 `floorY`。
     悬浮归"极轻的浮沉"（下面 ±0.05）负责，不归 1.62 负责。

     ★★ (4.3, 2.0) 曾经是这里。用户 2026-10-02 报「那个扫把穿模了」，量下来
     **真正互穿的只有地板**（扫帚最低点沉到 −1.81，地板 −1.62），但正面机位
     上还有第二件事：扫帚的帚穗那一头（参考量出来的右端 = 身体轴右边 0.93 B
     ≈ 3.75）和烛台的三足**在屏幕上叠在一起**。三足互成 120°，无论怎么绕 y
     总有一只指着扫帚，所以这不是角度问题 —— 是烛台**本来就站在她的帚穗上**：
     它作为磁带机的继任者被放到 (4.3, ·, 2.0) 时，没人拿它和扫帚量过。
     扫帚那一头的位置有参考兜着，烛台没有，所以动的是烛台。
     移到 (5.6, ·, 2.2) 之后三足的最左端投到帚穗右边 0.6 个单位
     （正面机位约 19 px）。厅是八边形、墙心距 17.1，半径 6.0 还在厅里。 */
  const baseY = floorY;
  const stand = new THREE.Group();
  stand.position.set(5.6, baseY, 2.2);
  root.add(stand);
  for (const child of [...root.children]) {
    if (child !== stand) stand.add(child);
  }

  const assembly = root;
  const parts = { reels: [{ spin: ringPivot }, { spin: haloPivot }] };

  /* 烛台自己的呼吸：极轻的摇曳，安眠时几乎不可见 */
  let t = 0;

  /* ★★ 一次倒带固定走这么久。这句话连同这个数原样来自老走带台
     （`cassette.js`：「一台走带机倒一面带的时间约是放一面的四十分之一，
     这一面放 5:17，所以八秒半。4.2 秒那会儿盘缘在倒带开头一秒转十圈、末尾
     五十圈 —— 那是糊，不是倒带。」）。数字没有理由变：倒带是一段**动作**，
     它的长度归它自己，不归歌有多长。 */
  const REW_SECONDS = 8.5;

  function update(dt) {
    t += dt;
    /* ---- 走带台 ----
       ★★ 这一支曾经是两支：`dir < 0` 前进、`dir > 0` 倒带，倒带把带子按
       `REW_SECONDS` 卷回带首，卷到了才把 `dir` 翻回 −1。翻回 −1 是**唯一**
       能让主循环那一句出口认出来的信号：

         if (mode === 'rew') { … if (cas.st.dir === -1) { 倒完了 } }

       `cassette.js` 随磁带收起来的时候，倒带那一支一起没了，而**写 `dir` 的
       地方只剩两处**：`ended` 写 +1、`seekTo` 写 −1 —— 没有一处会把 +1 走回
       −1。于是 `mode = 'rew'` 成了一条**走不出去的路**，后果实测如下
       （`tools/_singtrace.mjs`，2026-10-03，60 秒的曲子放到尾）：

         t=60  paused=true  ended=true   body=…playing rewinding
         sing 0.115 → 0.086 → 0（衰减到零后停住）

       也就是：**歌一放完她就永远不再唱**，`body.rewinding` 一直挂着，而按钮
       还写着「暂停」（`st.playing` 还是 true）。README 302 / 1104 行把
       「放完自动快速倒带（REW_SECONDS = 8.5），倒完从头再放，循环」写成了
       现行行为 —— 所以这不是取舍，是回归。补回来就是把那一支照原样搬回：
       `st.time` 就是老式的 `(1 − areaL/A_TOTAL)·duration`，所以按老速率往回
       扫一遍，等于把带子卷回带首；扫到 0 就把 `dir` 交还给前进。 */
    if (st.playing && !st.driven) {
      /* ★ `duration` 可能是 0（音频还没到），也可能是 **NaN** —— `<audio>` 在
         元数据到来之前读 `.duration` 就是 NaN。老代码把 `st.duration > 0` 写在
         **外层**，顺手把 NaN 一起挡在了两支之外；这里它退进内层，所以两支各自
         要把非有限值当成 0。少这一步，`NaN <= 0` 是 false，倒带会和修之前一样
         走不出去 —— `tools/_rew.mjs` 的 D 组就是这个用例。 */
      const dur = Number.isFinite(st.duration) && st.duration > 0 ? st.duration : 0;
      const at = Number.isFinite(st.time) ? st.time : 0;
      if (st.dir < 0) {
        /* 前进：没有音频来驱动，就走画面自己的钟，一整面走 `dur` 秒 */
        if (dur > 0) st.time = Math.min(dur, at + dt);
      } else {
        /* 倒带：一整面走 `REW_SECONDS` 秒，与歌有多长无关 */
        st.time = Math.max(0, at - (dur / REW_SECONDS) * dt);
        if (st.time <= 0) { st.time = 0; st.dir = -1; }
      }
    }
    /* ★ 拆解与翻面这两个标量必须**跟上目标**，哪怕没有网格听它们的。
       `main.js` 的 `updateAnnotations` 读 `cas.st.explode` 决定 `body.exploded`
       类与标注的显隐，而 `setExplode(on, instant)` 只在 instant / reduce 分支里
       直接赋值。这里不推进的话，用 `?x=1` 打开、再按 Escape 关掉，`st.explode`
       会永远停在 1 —— `body` 一直挂着 `exploded` 类，而 JS 里的 `exploded`
       已经是 false：两套状态打架，`viewShiftTarget` 也跟着错。
       没有网格可动，不代表这个数可以不收敛。 */
    st.explode += (st.explodeTarget - st.explode) * Math.min(1, dt * 3.2);
    st.flip += (st.flipTarget - st.flip) * Math.min(1, dt * 3.2);
    const target = st.playing ? 1 : 0.16;
    for (const f of flames) {
      const cur = f.scale.x;
      const next = cur + (target - cur) * Math.min(1, dt * 2.2);
      const n = 0.9 + 0.1 * Math.sin(t * 9.1 + f.position.x * 5.3)
        + 0.06 * Math.sin(t * 17.3 + f.position.z * 4.1);
      const s = next * n * (1 + st.flare * 0.5);
      f.scale.set(s, Math.max(0.05, s) * (0.92 + 0.16 * n), s);
    }
    st.flare = Math.max(0, st.flare - dt * 1.4);
    ringPivot.rotation.y += (st.playing ? 0.22 : 0.02) * dt
      * (1 + st.flare * 2);
    glow.intensity = 0.12 + (st.playing ? 1.15 : 0) + st.flare * 0.8;
    /* 悬浮：烛台是幽魂的东西，不落在地上 —— 极轻的浮沉与烛环同拍。
       浮沉是**绕着地面**的 ±0.05（`baseY` = floorY），不是绕着 y=0。 */
    stand.position.y = baseY + Math.sin(t * 0.8) * 0.05;
    return st;
  }

  return {
    root, assembly, materials, headMaterials: [], anchors: {}, parts,
    ready: true,
    get st() { return st; },

    update,
    setProgress(f) {
      st.progress = f;
      if (st.duration > 0) st.time = f * st.duration;   // 被音频驱动时，钟就是音频的钟
      rebuildHalo(f);
    },
    setLabel(label) {
      st.label = { ...st.label, ...label };
      if (label.minutes) {
        const d = parseFloat(label.minutes);
        if (isFinite(d) && d > 0 && st.duration <= 0) st.duration = d;   // 音频元数据到来前的预告
      }
      st.flare = Math.min(1, st.flare + 0.5);
    },
    commitLabel() { st.flare = 1; },
    sweepLabel() {},                       // 写头的差事没有了：换曲的可见过渡归面板的雾涌
    stepHead() {},
    warmLabel() {},
    setExplode(b) { st.explodeTarget = b ? 1 : 0; },
    setFlip(b) { st.flipTarget = b ? 1 : 0; },
  };
}
