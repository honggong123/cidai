/* 城堡内部 —— 场景的家（2026-10-02 用户要求「不要摄影房，改到西欧城堡内部」）。
   取代渐变背景球读出来的"摄影棚"感：一间八角石厅，砌石墙、哥特拱窗、木门、
   挂毯、火把、铁环吊灯、横梁天花、石板地。全部程序化，零外部资产。

   尺度（第一版 44 半径的教训：相机在 39、对面墙在 73 开外，厅读成一个空场）：
   墙半径 18.5、墙高 16 —— 她站在正中，机位（21~40）正好把对面的墙、窗、
   挂毯当背景。镜头拉到 21~40 时在墙外，单面墙从背面自动消失（玩具屋）；
   但方柱/踢脚这类**实心盒**不会自己消失 —— 所以每面墙是一个组件，
   update(t, camPos) 里按"相机在这面墙的内侧还是外侧"整组显隐。

   与房间主题（内部键仍是 studio/noir/abyss，一个不改）的关系：
   · 石墙/地板/挂毯接收现有 RIG 的灯 —— 晴厅亮、夜厅暗是白拿的；
   · 每间房自己的"实用灯"（窗光、火把、吊灯）在本文件 PRESETS 里，随
     applyTheme 的同一个 k 走（setTheme(name, k)），换房时和灯一起过渡；
   · 雾（scene.fog）也归这里管：只雾墙，她站的位置永远在雾外。 */
import * as THREE from 'three';
import { fbm, grain } from './textures.js';

/* mulberry32 —— 本文件只要几处带种子的随机，不值得再开一个依赖 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

/* ============================ 石材纹理 ============================ */
/* 砌石墙：一行行界石，砖缝是底色，每块石头明度抖一点，
   上缘一道亮棱、下缘一道暗棱（假斜面），最后铺一层 fbm 污渍与颗粒。 */
function ashlarCanvas(w, h, base, seed) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgb(56,50,42)';
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  const rows = 7, rh = h / rows, n = 5, bw = w / n;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * bw * 0.5;
    for (let i = -1; i <= n; i++) {
      const x = i * bw + off, y = row * rh;
      const j = (r() - 0.5) * 26;
      g.fillStyle = `rgb(${base[0] + j | 0},${base[1] + j * 0.9 | 0},${base[2] + j * 0.8 | 0})`;
      g.fillRect(x + 3, y + 3, bw - 6, rh - 6);
      g.fillStyle = 'rgba(255,250,238,0.16)';
      g.fillRect(x + 3, y + 3, bw - 6, 3.5);
      g.fillStyle = 'rgba(20,16,10,0.22)';
      g.fillRect(x + 3, y + rh - 6.5, bw - 6, 3.5);
    }
  }
  const n256 = fbm(64, 4, seed + 7, 0.55);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = n256[y * 64 + x];
      if (v > 0.62) {
        g.fillStyle = `rgba(28,24,18,${((v - 0.62) * 0.55).toFixed(3)})`;
        g.fillRect(x * (w / 64), y * (h / 64), w / 64 + 1, h / 64 + 1);
      }
    }
  }
  grain(g, w, h, 0.05, seed + 3);
  return cv;
}

/* 石板地：大块石板，缝深、板面有磨损 */
function flagstoneCanvas(size, base, seed) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgb(40,36,30)';
  g.fillRect(0, 0, size, size);
  const r = rng(seed);
  const n = 4, cell = size / n;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const j = (r() - 0.5) * 22;
      g.fillStyle = `rgb(${base[0] + j | 0},${base[1] + j * 0.9 | 0},${base[2] + j * 0.8 | 0})`;
      const inset = 3 + r() * 3;
      g.fillRect(col * cell + inset, row * cell + inset, cell - inset * 2, cell - inset * 2);
      g.fillStyle = 'rgba(255,250,238,0.10)';
      g.fillRect(col * cell + inset, row * cell + inset, cell - inset * 2, 3);
    }
  }
  const n256 = fbm(64, 4, seed + 11, 0.55);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = n256[y * 64 + x];
      if (v > 0.60) {
        g.fillStyle = `rgba(24,20,16,${((v - 0.60) * 0.5).toFixed(3)})`;
        g.fillRect(x * (size / 64), y * (size / 64), size / 64 + 1, size / 64 + 1);
      }
    }
  }
  grain(g, size, size, 0.05, seed + 5);
  return cv;
}

/* 木门板：竖板 + 两道铁箍 + 门环 */
function plankCanvas(w, h, seed) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const r = rng(seed);
  const boards = 6, bw = w / boards;
  for (let i = 0; i < boards; i++) {
    const j = (r() - 0.5) * 20;
    g.fillStyle = `rgb(${96 + j | 0},${68 + j * 0.8 | 0},${44 + j * 0.6 | 0})`;
    g.fillRect(i * bw, 0, bw, h);
    g.strokeStyle = 'rgba(30,20,12,0.55)';
    g.lineWidth = 2.5;
    g.strokeRect(i * bw + 1, -4, bw - 2, h + 8);
    g.strokeStyle = 'rgba(50,34,20,0.28)';
    g.lineWidth = 1.2;
    for (let k = 0; k < 5; k++) {
      const x = i * bw + 4 + r() * (bw - 8);
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + 3, h * 0.33, x - 3, h * 0.66, x + 2, h);
      g.stroke();
    }
  }
  for (const y of [h * 0.22, h * 0.72]) {
    g.fillStyle = 'rgb(52,50,54)';
    g.fillRect(0, y, w, h * 0.055);
    g.fillStyle = 'rgb(88,86,92)';
    for (let x = w * 0.06; x < w; x += w / 9) {
      g.beginPath();
      g.arc(x, y + h * 0.027, h * 0.011, 0, TAU);
      g.fill();
    }
  }
  grain(g, w, h, 0.05, seed + 9);
  return cv;
}

/* 挂毯：底色 + 斜带 + 三枚圆章（纹章的"形"，不画具体的纹章） */
function bannerCanvas(w, h, c1, c2, seed) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const A = '#' + c1.toString(16).padStart(6, '0');
  const Bc = '#' + c2.toString(16).padStart(6, '0');
  g.fillStyle = A;
  g.fillRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  g.strokeStyle = Bc;
  g.lineWidth = w * 0.30;
  g.beginPath();
  g.moveTo(-w * 0.1, h * 1.05);
  g.lineTo(w * 1.1, -h * 0.05);
  g.stroke();
  g.restore();
  g.fillStyle = Bc;
  for (const t of [0.26, 0.52, 0.78]) {
    g.beginPath();
    g.arc(w * t, h * (1.02 - t * 1.05), w * 0.115, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = w * 0.02;
    g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = w * 0.06;
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  grain(g, w, h, 0.07, seed);
  return cv;
}

/* 尖拱（哥特）：两侧各一条二次曲线在顶点相交，天然带一个尖 */
function pointedArchShape(w, h, ys) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, ys);
  s.quadraticCurveTo(-w / 2, ys + (h - ys) * 0.42, 0, h);
  s.quadraticCurveTo(w / 2, ys + (h - ys) * 0.42, w / 2, ys);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}

/* 圆拱（罗曼）：门用。`x0` / `y0` 是可选的原点偏移，给**挖洞**用 ——
   墙板上的壁炉口要在墙的局部坐标里偏移到指定位置，而且底边要抬离外轮廓
   的底边（见 wall 那一段的注释）。默认 0，门与窗的调用一个字不改。 */
function roundArchShape(w, h, ys, x0 = 0, y0 = 0) {
  const s = new THREE.Shape();
  s.moveTo(x0 - w / 2, y0);
  s.lineTo(x0 - w / 2, ys);
  s.absarc(x0, ys, w / 2, Math.PI, 0, true);
  s.lineTo(x0 + w / 2, y0);
  s.closePath();
  return s;
}

/* 挂毯形状：矩形 + 底部 V 口 */
function bannerShape(w, h, v) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, -h);
  s.lineTo(0, -h + v);
  s.lineTo(w / 2, -h);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}

/* 把 ShapeGeometry 的本地坐标 uv 归一到 0..1（按包围盒），贴图才铺得满 */
function fitUV(geo, w) {
  const uv = geo.attributes.uv, pos = geo.attributes.position;
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    yMin = Math.min(yMin, pos.getY(i));
    yMax = Math.max(yMax, pos.getY(i));
  }
  const span = Math.max(1e-6, yMax - yMin);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / w + 0.5, (uv.getY(i) - yMin) / span);
  }
  uv.needsUpdate = true;
}

/* ============================ 房间主题 ============================ */
const PRESETS = {
  /* 日光大厅：暖砂岩、高窗灌进白昼、火把熄着、挂毯红金。
     `amb` 是厅自己的石壁漫射（HemisphereLight）—— RIG 在上一轮为救头发的
     明暗范围调得很低，墙靠它读不出来；厅里的漫反射归城堡自己管。 */
  studio: {
    wall: 0xd8ccb2, floor: 0xbdb29a, glow: 0xfff3d6, glowI: 1.35,
    torch: 0.0, chand: 0.30, fire: 0.9, amb: 0.80, shaft: 0.13, shaftC: 0xfff0d2,
    fog: 0xcfc6b0, fogN: 46, fogF: 145,
    bannerI: 1.0,
  },
  /* 烛光夜厅：冷石浸在夜里，月亮从高窗进来一线，火把、壁炉与吊灯当家 */
  noir: {
    wall: 0x6a6274, floor: 0x575062, glow: 0x93a5e6, glowI: 0.55,
    torch: 2.4, chand: 1.1, fire: 2.8, amb: 0.30, shaft: 0.055, shaftC: 0x9fb2ff,
    fog: 0x0d0b13, fogN: 30, fogF: 98,
    bannerI: 0.5,
  },
  /* 冰渊晨雾：冷灰石、雾从窗缝里漫进来、火把只剩一点 */
  abyss: {
    wall: 0xb2bcbf, floor: 0x9ca6a6, glow: 0xd9ecf4, glowI: 1.0,
    torch: 0.5, chand: 0.15, fire: 1.0, amb: 0.55, shaft: 0.15, shaftC: 0xdcecf4,
    fog: 0xb4c0c6, fogN: 38, fogF: 128,
    bannerI: 0.85,
  },
};

/* ============================ 搭建 ============================ */
export function createCastle({ floorY = 0 } = {}) {
  const group = new THREE.Group();
  const RW = 18.5;                     // 八角外接半径
  const AP = RW * Math.cos(Math.PI / 8);   // 边心距（墙到中心 17.1）
  const WW = 2 * RW * Math.sin(Math.PI / 8) + 0.5; // 每面墙宽（多留一点防缝）
  /* 墙高 21 的下限来自等轴机位：相机高 33·cos(1.03) ≈ 17 —— 墙矮了它就从
     墙头看进去（上一版 16 正是如此，厅读成一面半墙）。21 之后标准机位全部
     被墙+天花包住（全覆盖），只有拉远+抬视角才回到玩具屋。 */
  const WH = 21;
  const N_WALL = 8;
  /* 壁炉的尺寸与位置。提到墙循环之前，是因为**墙板要在它这里挖一个洞** ——
     膛在墙平面的外侧（见壁炉那一段），只有墙上有洞才看得见它。
     `x` / `y` 是膛口在墙局部坐标里的位置，`iw` / `ih` 是膛口宽高（也就是
     拱环内轮廓），`ys` 是拱环的起拱线高度。 */
  const FP = { wi: 5, x: -2.8, y: 0.05, z: 0.3, ow: 4.6, oh: 3.6, iw: 2.6, ih: 2.4, ys: 1.5 };
  const lerpable = [];                 // setTheme 每帧 lerp 的条目
  /* 火苗按**种类**分装。可见性必须逐类判，不能聚合 —— 上一版把火把、吊灯、
     壁炉三处的火苗塞进一个 `flames` 数组，用一个
     `P.torch + P.chand + P.fire > 0.05` 的总开关。霜厅的 `torch` 是 0.0
     （预设的注释就写着"火把熄着"），可吊灯 0.30 加壁炉 0.9 让总和大过阈值，
     于是**三支火把在明亮的日光厅里照画不误**，只是不发光：墙上挂着三簇亮橙色
     的锥体，与"熄着"自相矛盾。 */
  const flameKinds = { torch: [], chand: [], fire: [] };
  const torches = [];
  const flicker = [];
  const segs = [];                     // 每面墙一个组件：{ group, n, p }
  const C = (hex) => new THREE.Color(hex);
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

  /* 共享材质 */
  const wallTex = new THREE.CanvasTexture(ashlarCanvas(1024, 576, [206, 196, 172], 5));
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.anisotropy = 8;
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(1, 1.45);         // 墙 14.8×21：竖向多铺一遍，石块别被拉成长条
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.96, metalness: 0 });
  lerpable.push({ color: wallMat.color, key: 'wall' });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8a8068, roughness: 0.97 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 0.95 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x27242a, roughness: 0.6, metalness: 0.6 });
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb45c, toneMapped: false });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff3d6, toneMapped: false });
  lerpable.push({ color: glowMat.color, key: 'glow', mul: 'glowI' });
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xfff0d2, transparent: true, opacity: 0.12,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  lerpable.push({ color: shaftMat.color, key: 'shaftC' });
  lerpable.push({ scalar: shaftMat, key: 'shaft', prop: 'opacity' });

  function wallAngle(i) { return i * TAU / N_WALL; }
  /* 墙面对准机位：默认/等轴机位的视线中心在 215°附近 —— 墙心不偏 22.5°，
     相机就正对墙角（两堵墙的夹缝最没信息量）。转过来之后墙 5（225°）是
     默认机位的正后方，壁炉安在这里。 */

  /* 每面墙一个组件：墙板 + 一根角柱 + 踢脚 + 檐口；装饰件挂进对应组件，
     显隐跟着整组走（玩具屋：相机在墙外侧就整组藏掉）。 */
  for (let i = 0; i < N_WALL; i++) {
    const a = wallAngle(i);
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * AP, floorY, Math.cos(a) * AP);
    g.rotation.y = a + Math.PI;        // 局部 +Z 指向厅心
    /* ★★ 壁炉那面墙（墙 5）不是一块平板：膛在墙平面的**外侧**，墙上必须真的
       有一个洞，才看得见它。上一版八面墙一律 PlaneGeometry，于是壁炉在画面
       上只剩三样东西：一根壁炉架横条、一块地沿石板、三簇浮在平整墙面上的小
       火苗 —— 因为①拱环 mesh 造好、摆好位置之后**从没被 add 进任何父节点**
       （一个孤儿，见壁炉那一段），②膛的五块炭黑内壁整片被墙板挡住，③火焰
       锥体的 z 恰好落在墙平面上（0.3 − 0.3 = 0），与墙共面。
       洞必须**严格**落在外轮廓里面：底边抬 0.05，否则和外轮廓的底边共线，
       earcut 拿到的是一段重合边界，三角化要么不挖洞要么出碎面。 */
    let wallGeo;
    if (i === FP.wi) {
      /* ★★ 坐标系：`ShapeGeometry` 的原点在**几何中心**，和 `PlaneGeometry`
         一样 —— 而膛口的位置是"离地多高"。所以这里整块墙按 ±WH/2 画、膛口
         也减掉半个墙高，下面那句 `wall.position.y = WH / 2` 才对两种几何同时
         成立。第一版按 y ∈ [0, WH] 画：整面墙被抬高了 10.5 个单位，墙的下半
         截连同贴图一起跑出画面，看上去就是"壁炉那面墙没有砌石纹理"。 */
      const rect = new THREE.Shape();
      rect.moveTo(-WW / 2, -WH / 2);
      rect.lineTo(WW / 2, -WH / 2);
      rect.lineTo(WW / 2, WH / 2);
      rect.lineTo(-WW / 2, WH / 2);
      rect.closePath();
      rect.holes.push(roundArchShape(
        FP.iw, FP.ih, FP.y + 1.1 - WH / 2, FP.x, FP.y + 0.05 - WH / 2));
      wallGeo = new THREE.ShapeGeometry(rect, 24);
      /* ShapeGeometry 的 uv 是**局部单位**、不是 0..1（door / banner 用
         `fitUV` 也是这个原因）；不归一化的话贴图会被拉成一条。 */
      fitUV(wallGeo, WW);
    } else {
      wallGeo = new THREE.PlaneGeometry(WW, WH);
    }
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = WH / 2;
    g.add(wall);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.0, WH + 0.3, 1.0), pillarMat);
    pillar.position.set(-WW / 2 + 0.2, (WH + 0.3) / 2 - 0.15, -0.1);
    g.add(pillar);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(WW - 0.6, 1.0, 0.55), pillarMat);
    plinth.position.set(0, 0.5, 0.1);
    g.add(plinth);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(WW - 0.6, 0.6, 0.55), pillarMat);
    cornice.position.set(0, WH - 0.3, 0.1);
    g.add(cornice);
    group.add(g);
    segs.push({
      group: g,
      n: v3(-Math.sin(a), 0, -Math.cos(a)),            // 指向厅心的内法线
      p: v3(Math.sin(a) * AP, floorY + WH / 2, Math.cos(a) * AP),
    });
  }

  /* ---------- 天花与横梁（相机飞到天花之上就整组藏掉） ---------- */
  const above = new THREE.Group();
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x241f1a, roughness: 1 })
  );
  ceil.rotation.x = Math.PI / 2;       // 面朝下
  ceil.position.y = WH + 0.2;
  above.add(ceil);
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.92 });
  for (const ry of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(64, 0.8, 1.0), beamMat);
    beam.position.y = WH - 0.4;
    beam.rotation.y = ry;
    above.add(beam);
  }
  above.position.y = floorY;
  group.add(above);

  /* ---------- 石板地 ---------- */
  const floorTex = new THREE.CanvasTexture(flagstoneCanvas(1024, [148, 140, 124], 9));
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(3, 3);
  floorTex.anisotropy = 8;
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0 });
  lerpable.push({ color: floorMat.color, key: 'floor' });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(RW + 2, 64), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY + 0.02;
  floor.receiveShadow = true;
  group.add(floor);

  /* ---------- 拱窗（2 扇，墙 4 / 6）+ 光柱 ---------- */
  const winW = 4.6, winH = 8.8, winY = floorY + 4.4;
  for (const wi of [4, 6]) {
    const a = wallAngle(wi);
    const g = new THREE.Group();
    const arch = pointedArchShape(winW, winH, winH * 0.52);
    const frame = new THREE.Mesh(new THREE.ShapeGeometry(arch), frameMat);
    const pane = new THREE.Mesh(new THREE.ShapeGeometry(arch), glowMat);
    pane.scale.set(0.84, 0.88, 1);
    pane.position.set(0, 0.25, 0.05);  // 比框面高 0.05，不然共面 z-fighting
    const mull = new THREE.Group();
    for (const x of [-winW * 0.15, winW * 0.15]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, winH * 0.95, 0.1), ironMat);
      bar.position.set(x, winH / 2, 0.11);
      mull.add(bar);
    }
    for (const y of [winH * 0.32, winH * 0.56]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(winW * 0.6, 0.13, 0.1), ironMat);
      bar.position.set(0, y, 0.11);
      mull.add(bar);
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(winW + 1.2, 0.42, 0.6), frameMat);
    sill.position.set(0, -0.22, 0.15);
    g.add(frame, pane, mull, sill);
    g.position.set(winW * 0.18, winY - floorY, 0.4);
    /* 光柱：从窗口斜落到石板上的一片加色面（体积光的替身） */
    const bw = winW * 0.78, by = winH * 0.42;
    const dy = floorY + 0.1 - winY - by;   // 光柱底边落在石板上（上一版忘了扣 by，悬空 3.7）
    const quad = new THREE.BufferGeometry();
    const hw0 = bw / 2, hw1 = bw * 1.9 / 2;
    quad.setAttribute('position', new THREE.Float32BufferAttribute([
      -hw0, 0, 0, hw0, 0, 0, hw1, dy, 7.0, -hw1, dy, 7.0,
    ], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    quad.computeVertexNormals();
    const shaft = new THREE.Mesh(quad, shaftMat);
    shaft.position.set(0, by, 0.5);
    g.add(shaft);
    segs[wi].group.add(g);
  }

  /* ---------- 木门（墙 0） ---------- */
  {
    const g = new THREE.Group();
    const dw = 3.4, dh = 6.6, ys = dh - dw / 2;
    const frame = new THREE.Mesh(new THREE.ShapeGeometry(roundArchShape(dw + 1.0, dh + 0.5, ys + 0.3)), frameMat);
    const doorGeo = new THREE.ShapeGeometry(roundArchShape(dw, dh, ys));
    const doorTex = new THREE.CanvasTexture(plankCanvas(512, 880, 13));
    doorTex.colorSpace = THREE.SRGBColorSpace;
    const door = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.85 }));
    fitUV(doorGeo, dw);
    door.position.z = 0.14;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.045, 8, 24), ironMat);
    ring.position.set(dw * 0.28, dh * 0.42, 0.24);
    g.add(frame, door, ring);
    g.position.set(0, 0.02, 0.4);
    segs[0].group.add(g);
  }

  /* ---------- 挂毯（墙 3 / 7） ---------- */
  const banMat = new THREE.MeshStandardMaterial({ roughness: 0.94 });
  lerpable.push({ color: banMat.color, key: 'banner', isMulti: true });
  {
    const texBanner = new THREE.CanvasTexture(bannerCanvas(256, 580, 0x8e2f2f, 0xd8b45a, 17));
    texBanner.colorSpace = THREE.SRGBColorSpace;
    banMat.map = texBanner;
    banMat.color.set(0xffffff);
  }
  const bannerGeo = new THREE.ShapeGeometry(bannerShape(2.2, 5.2, 1.0));
  fitUV(bannerGeo, 2.2);
  for (const wi of [3, 7]) {
    const b = new THREE.Mesh(bannerGeo, banMat);
    b.position.set(0, 11.6 - floorY, 0.45);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.8, 10), ironMat);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 11.7 - floorY, 0.45);
    segs[wi].group.add(b, rod);
  }

  /* ---------- 火把（墙 4 / 墙 0 的侧位） ---------- */
  for (const [wi, xoff] of [[5, -3.4], [5, 3.4], [0, WW * 0.30]]) {
    const g = new THREE.Group();
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.55, 0.3), ironMat);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.95, 8), stickMat);
    stick.position.set(0, 0.55, 0.24);
    stick.rotation.x = -0.26;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 8), flameMat);
    flame.position.set(0, 1.2, 0.38);
    const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.27, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, toneMapped: false }));
    flame2.position.set(0, 1.15, 0.38);
    const light = new THREE.PointLight(0xff9a4a, 0, 15, 2);
    light.position.set(0, 1.45, 0.6);
    g.add(bracket, stick, flame, flame2, light);
    g.position.set(xoff, 4.9 - floorY, 0.5);
    segs[wi].group.add(g);
    flameKinds.torch.push(flame, flame2);
    /* ★ 不往 `lerpable` 里塞 `light.intensity`：`update` 每帧用
       `baseT × 闪烁` 覆盖它，这个通道没有读者。强度由 `baseT` 一个人缓动
       （见 setTheme 末尾）。 */
    torches.push({ light, ph: wi * 3.1 });
    flicker.push({ flame, ph: wi * 3.1 });
  }

  /* ---------- 吊灯：铁环 + 六支蜡烛 + 垂链 ---------- */
  const chand = new THREE.Group();
  const chandLight = new THREE.PointLight(0xffc07a, 0, 20, 2);
  chandLight.position.y = -0.4;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.10, 10, 40), ironMat);
  ring.rotation.x = Math.PI / 2;
  chand.add(ring, chandLight);
  lerpable.push({ scalar: chandLight, key: 'chand', prop: 'intensity' });
  for (let i = 0; i < 6; i++) {
    const a2 = i * TAU / 6;
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8dcc2, roughness: 0.7 }));
    candle.position.set(Math.sin(a2) * 1.7, 0.32, Math.cos(a2) * 1.7);
    const cf = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 8), flameMat);
    cf.position.set(Math.sin(a2) * 1.7, 0.76, Math.cos(a2) * 1.7);
    chand.add(candle, cf);
    flameKinds.chand.push(cf);
    flicker.push({ flame: cf, ph: a2 * 3 });
  }
  for (const dz of [-0.55, 0.55]) {
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), ironMat);
    chain.position.set(dz, 1.4, 0);
    chand.add(chain);
  }
  chand.position.set(0, floorY + WH - 2.4, 0);
  group.add(chand);

  /* ---------- 雾 ---------- */
  const fog = new THREE.Fog(0xcfc6b0, 46, 145);

  /* ---------- 厅内石壁漫射 ---------- */
  /* RIG 的摄影灯只够照亮她（上一轮特意调低救头发的明暗层次），墙靠它们读成
     黑窟窿。厅内的石头漫反射归城堡自己：一盏半球光，上暖下暗，随主题走。
     她也会被它抬一点点 —— 石头房间里本来就有这层反弹，不是滤镜。 */
  const hemi = new THREE.HemisphereLight(0xfff4e0, 0x6a5f4e, 0.8);
  group.add(hemi);
  lerpable.push({ scalar: hemi, key: 'amb', prop: 'intensity' });

  /* ---------- 壁炉（墙 5：默认机位的正后方，偏一侧） ---------- */
  /* 石作拱环（外圈挖掉内拱 = 真的镂空）、炭黑的膛、柴与火、余烬的光。
     `fire` 是它的主题强度：白天小火，夜里是整间厅的主光源。 */
  {
    const a = wallAngle(FP.wi);
    const g = new THREE.Group();
    const { ow, oh, iw, ih, ys } = FP;
    /* 石作拱环：外拱挖内拱。内轮廓的底边抬 0.05 —— 和墙板上那个洞同一个理由
       （与外轮廓底边共线时 earcut 拿到的是一段重合边界），也顺便在膛口下沿
       留一道 0.05 的石唇。 */
    const outer = roundArchShape(ow, oh, ys);
    outer.holes.push(roundArchShape(iw, ih, 1.1, 0, 0.05));
    const ring = new THREE.Mesh(new THREE.ShapeGeometry(outer, 24), pillarMat);
    ring.position.z = 0.42;
    /* ★★ `g.add(ring)` 这一句以前没有 —— 环造好、摆好位置，然后**从没进过
       任何父节点**：壁炉的石作外框整个不存在，墙上只有一个洞的轮廓在画面上
       找不到（洞也是后补的，见上面墙板那一段）。一个只被 new 出来的 Mesh
       不进场景图，比删掉它更难发现：代码读起来是"有的"。 */
    g.add(ring);
    /* 膛：五块炭黑内壁（藏在墙平面的外侧，只有从开口看得见） */
    const charMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(iw, ih + 0.6), charMat);
    back.position.set(0, (ih + 0.6) / 2, -1.05);
    const sideL = new THREE.Mesh(new THREE.PlaneGeometry(1.1, ih), charMat);
    sideL.position.set(-iw / 2, ih / 2, -0.5);
    sideL.rotation.y = Math.PI / 2;
    const sideR = sideL.clone();
    sideR.position.x = iw / 2;
    const topIn = new THREE.Mesh(new THREE.PlaneGeometry(iw, 1.1), charMat);
    topIn.position.set(0, ih, -0.5);
    topIn.rotation.x = Math.PI / 2;
    const hearth = new THREE.Mesh(new THREE.BoxGeometry(iw, 0.22, 1.1), charMat);
    hearth.position.set(0, 0.11, -0.5);
    g.add(back, sideL, sideR, topIn, hearth);
    /* 余烬：一小片发亮的床 */
    const ember = new THREE.Mesh(new THREE.PlaneGeometry(iw * 0.7, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false }));
    ember.rotation.x = -Math.PI / 2;
    ember.position.set(0, 0.24, -0.6);
    g.add(ember);
    /* 柴两根 + 火三簇。★ z 从 −0.3 退到 −0.55：−0.3 加上 `g.position.z = 0.3`
       恰好等于 0，也就是**正好落在墙平面上** —— 墙上有洞之后那里仍然是膛口的
       前沿，柴与火会读成贴在洞口上而不是生在膛里。 */
    const logMat = new THREE.MeshStandardMaterial({ color: 0x2e2018, roughness: 0.95 });
    for (const [lx, lr] of [[-0.35, 0.13], [0.3, 0.11]]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(lr, lr, 1.5, 7), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = lx > 0 ? 0.35 : -0.3;
      log.position.set(lx, 0.35, -0.55);
      g.add(log);
    }
    const fireGroup = new THREE.Group();
    for (const [fx, fh] of [[-0.32, 0.9], [0.05, 1.25], [0.4, 0.8]]) {
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.22, fh, 8), flameMat);
      fl.position.set(fx, 0.5 + fh / 2, -0.55);
      fireGroup.add(fl);
      flameKinds.fire.push(fl);
      flicker.push({ flame: fl, ph: fx * 7 + 2 });
    }
    g.add(fireGroup);
    const fireLight = new THREE.PointLight(0xff8a3c, 0, 13, 2);
    fireLight.position.set(0, 1.1, 0.1);
    g.add(fireLight);
    torches.push({ light: fireLight, ph: 9.7, isFire: true });
    /* 石作地沿：伸进厅里的一块石板，火前的那块地 */
    const slab = new THREE.Mesh(new THREE.BoxGeometry(ow + 1.2, 0.16, 1.6), pillarMat);
    slab.position.set(0, 0.08, 0.9);
    g.add(slab);
    /* 壁炉架：木沿 */
    const mantel = new THREE.Mesh(new THREE.BoxGeometry(ow + 0.8, 0.32, 0.8), beamMat);
    mantel.position.set(0, oh + 0.5, 0.3);
    g.add(mantel);
    g.position.set(FP.x, FP.y, FP.z);
    segs[FP.wi].group.add(g);
  }

  /* ---------- 主题过渡 ---------- */
  /* lerpable 条目在 setTheme 里逐帧 lerp：k=1 快照落位（深链/首次），
     k<1 跟着 applyTheme 的房间钟走 —— 和灯、地板一个步频。 */
  const targets = new Map();
  let themeName = 'studio';            // 只为 debug() 记住现在是哪个房间
  function setTheme(name, k = 1) {
    const P = PRESETS[name] || PRESETS.studio;
    themeName = PRESETS[name] ? name : 'studio';
    for (const e of lerpable) {
      if (e.scalar) {
        const t = P[e.key];
        e.scalar[e.prop] += (t - e.scalar[e.prop]) * k;
      } else if (e.isMulti) {
        /* 挂毯：贴图已画死红金，color 当明暗旋钮（夜厅压暗） */
        const t = P.bannerI;
        e.color.r += (t - e.color.r) * k;
        e.color.g += (t - e.color.g) * k;
        e.color.b += (t - e.color.b) * k;
      } else {
        if (!targets.has(e.key + (e.mul || ''))) targets.set(e.key + (e.mul || ''), new THREE.Color());
        const tC = targets.get(e.key + (e.mul || ''));
        tC.set(P[e.key]);
        if (e.mul) tC.multiplyScalar(P[e.mul]);
        e.color.lerp(tC, k);
      }
    }
    /* 火把与壁炉的**点光**：`update` 每帧写 `intensity = baseT × 闪烁`，
       所以强度的缓动必须落在 `baseT` 上。上一版把 `light.intensity` 塞进
       `lerpable` 的 scalar 分支 —— 每帧刚缓动完就被 `update` 覆盖，是个
       没有读者的通道；同时 `baseT` 被直接赋成预设目标值。结果是换主题时
       墙色/雾/地板走 1.6s 缓动，火把光却**啪地跳过去**。一个值一个写者。 */
    for (const tor of torches) {
      const t = P[tor.isFire ? 'fire' : 'torch'];
      tor.baseT = tor.baseT === undefined ? t : tor.baseT + (t - tor.baseT) * k;
    }
    /* 火苗：逐类判可见性 —— 火把熄了就只灭火把，吊灯与壁炉各判各的。 */
    for (const kind of ['torch', 'chand', 'fire']) {
      const lit = P[kind] > 0.05;
      for (const f of flameKinds[kind]) f.visible = lit;
    }
    fog.color.lerp(C(P.fog), k);
    fog.near += (P.fogN - fog.near) * k;
    fog.far += (P.fogF - fog.far) * k;
  }

  /* ---------- 每帧：火光闪烁 + 玩具屋显隐 ---------- */
  function update(t, camPos) {
    for (const f of flicker) {
      const n = 0.72 + 0.28 * Math.sin(t * 11.3 + f.ph)
        * Math.sin(t * 6.1 + f.ph * 2.7)
        + 0.10 * Math.sin(t * 23.7 + f.ph * 5.1);
      if (f.flame) f.flame.scale.y = 0.85 + 0.35 * n;
    }
    /* 火把点光 = 主题目标强度 × 闪烁系数（不逐帧自乘，免得越烧越暗） */
    for (const tor of torches) {
      const n = 0.5 + 0.5 * Math.sin(t * 12.7 + tor.ph) * Math.sin(t * 5.3 + tor.ph * 1.9);
      tor.light.intensity = (tor.baseT ?? 0) * (0.72 + 0.5 * n);
    }
    /* 玩具屋：相机在哪面墙的外侧，那面墙整组藏掉（含实心盒与装饰件）。
       dot(内法线, 相机−墙心) < 0 = 相机在墙外；−0.6 的偏置防贴墙时抖。 */
    if (camPos) {
      for (const s of segs) {
        const d = (camPos.x - s.p.x) * s.n.x + (camPos.z - s.p.z) * s.n.z;
        s.group.visible = d > -0.6;
      }
      above.visible = camPos.y < floorY + WH - 0.8;
    }
  }

  setTheme('studio', 1);               // 首帧先落一个房间，applyTheme 马上会再校一次

  /* 只读读数口（探针用，页面自己不读）—— 和 main.js 的 `__spirit` 同一规矩：
     把数字说出来，而不是让人去截图里数橙色的点。火苗的**可见性**是一条
     最容易"改对了却看不出来"的通道：霜厅的三支火把本来就又高又小（世界
     y=4.9，锥体半径 0.15），标准机位根本框不到它们，于是"火把熄着"这句话
     既没法用眼睛证伪、也没法用像素证明。这里一次把三类火苗的 visible 与
     三支点光的强度报出来。 */
  const debug = () => ({
    preset: Object.fromEntries(
      ['torch', 'chand', 'fire'].map((k) => [k, PRESETS[themeName]?.[k] ?? null])),
    flameVisible: Object.fromEntries(
      ['torch', 'chand', 'fire'].map((k) => [k, flameKinds[k].filter((f) => f.visible).length])),
    flameTotal: Object.fromEntries(
      ['torch', 'chand', 'fire'].map((k) => [k, flameKinds[k].length])),
    light: torches.map((t) => +((t.baseT ?? 0) * 0.72).toFixed(3)),
    wallVisible: segs.filter((s) => s.group.visible).length,
    above: above.visible,
    fog: [+fog.near.toFixed(1), +fog.far.toFixed(1), fog.color.getHexString()],
  });

  return { group, setTheme, update, fog, debug };
}
