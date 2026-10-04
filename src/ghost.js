/* 小幽灵 —— 按 BV1xRho6DEG4（blender 新手教程·简单幽灵模型）重建的程序化替身。

   和 nahida.js 是同一份契约，换的是里面那个东西：
     createGhost({ height, x, y, z }) -> { root, hit, aura, materials, head, crown,
       ready, sing, bob, action, play(name), setRoom(rim, rimOp, tint, k), update(dt, ...) }
   `main.js` 只认这些名字，所以这台机器换脸不换壳。

   ============================ 参考是怎么读的 ============================

   视频 28 分钟，拿不到逐帧；B 站的 storyboard 接口一次给三张 10x10 的雪碧图
   （480x270，全程约每 5.6 秒一格），加上封面（1146x644，含正/侧/背三个 clay 视图
   和一张彩色渲染）与首帧（1280x720）。

   ★ **量的是最后一帧的成品彩色渲染，不是 clay 那一帧。**
   clay 那张是中性灰、没有色相，而且打在帽檐暗面的光正好落在视口背景的
   同一档亮度上 —— 中性值直方图在 56-71 是一大坨，模型的暗面就在里面，
   任何阈值都分不开（`measure3/4/5.py` 三次尝试全败，原因量出来就是这个）。
   成品那帧有色相：背景是中灰（S<0.22, V<0.42），模型要么高饱和（靛紫的帽、
   猩红的檐底、橙红的腮红）要么高亮度（发青光的床单），于是"不是背景"这个
   判据就成立，可以逐行逐列扫边缘（`measure9.py` / `measure10.py`）。

   以「帽檐宽 = 1」为单位（帽檐是全场最稳的一把尺子 —— 它的左右两个尖是
   画面里最外侧的极值点，不受姿态影响）。下面每个数都只在自己那一轴上量，
   括号里是它出自哪个脚本：

     全身高（下摆底 -> 帽冠最高点）  0.812   身体高 0.565   身体宽 0.771
     帽冠最高点高出檐面              0.283   帽高（冠顶 -> 檐底）0.446
     檐的竖直跨度 0.336   檐宽 1.0   檐倾角 17.1°
     扫帚：比檐还长（≥1.32 个檐宽），柄的半径从 0.011 B 渐细到 0.030 B
     脸：眼在身体高的 0.70 处，左眼是竖椭圆、右眼是更大的圆 —— 这个不对称是
         原模型就有的，不是误差；腮红在 0.57 处；嘴在 0.63 处

   ★ 三个曾经量错、把建模带偏过一回的数，记在这里免得再踩：
     · 「帽高 0.535」出自 `measure10.py` 的色相掩码，那个掩码膨胀过 7x7，
       它的红色分支还会吃到腮红，所以比真檐底低 90 px；真值是 0.446。
     · `measure9.py` 打印的「檐占到第 562 行」也不是檐 —— 562 是"轮廓还宽过
       檐宽 0.8 倍"的最后一行，而檐尖以下床单本身就够宽，它抓到的是**檐投在
       身上的影子**。檐自己的框是 190..535。
     · 下摆底：`measure9.py` 的 blob 到 935，但 `measure10.py` 的身体剖面到
       910 就没了（y=903 只剩 87 px 宽）——935 是扫帚的影子。

   ★ 有两件事**不能**从这一帧量，只能靠并排目视：
     · 臂展 —— 这一帧的幽灵是转着身子的（左臂伸得远、下摆偏到右边），
       横向读数被透视压过，量出来 1.02 B 明显偏小；
     · 下摆的瓣数 —— 被身体自己挡掉一半。
   所以臂展取 1.32 B（目视比对的折中值），下摆取 8 瓣（正面能数出 4-5 个）。

   ★ 这个"转着身子"不是一句猜测，是可以逐行读出来的：把身体掩码每 25 行取一次
   左右边缘（`measure10.py` 的表），**左边缘基本是竖直的**（y=403 在 531、
   y=828 在 484，425 行里只挪了 47 px），**右边缘却甩出去 383 px**
   （y=403 在 726、y=778 在 1109）。一个回转体的左右边缘必须同步，所以这一帧
   一定是被姿态拧过的 —— 也是为什么**它的身体外框宽 791 px 而任何一行的实际
   跨度只有 625 px**。拿外框当"身体宽"，我的模型就会宽出 26%，
   而我的模型是对称的静姿，外框和行跨度本来相等。
   凡是"bbox"形式的参考值都要先问一句：这是姿态量还是形状量。

   ★ 比"单轴比值"更管用的最后一道关是**叠影**（`_ref/ghost/overlay.py`）：
   把参考的剪影和我的剪影都按檐宽归一、按左檐尖对齐，红=参考多出来的、
   蓝=我多出来的。比值可以全对而形状仍然不对（"宽下摆"和"宽肩膀"可以是同一个
   总宽），叠影则直接把差在哪儿、差多少画出来。帽冠第一版就是这样发现矮了 28%
   的 —— 比值只显示 `crown cone h` 0.224 对 0.283，看不出它矮成一顶圆帽。

   颜色是从同一帧上**采样**的（7x7 中值，`_ref/ghost/palette.py`）：
     帽面靛紫 暗部 #1E103F / 亮部 #2C1A71    檐底猩红 亮部 #FF3C3C / 暗部 #94212E
     体内青光 #93FEFF   床单白 #EFF1F3   金带 #8B8538
     左眼 #9E1E2A   右眼 #220F18   腮红 #F96A37   蝴蝶结 #E42F0C   帚柄 #5F1210
   注意采样拿到的是**视频灯光下的颜色**，那是个一盏强主光的暗棚，所以暗部偏暗。
   下面 `C` 里放的是反照率（albedo），比采样到的暗部亮一档 —— 场景自己有灯。

   ============================ 建模手法 ============================

   视频讲的是"布线技巧"，成品是**纯四边形网格**：床单是一个环形分段的柱面，
   帽子是一张分片圆盘 + 一个圆锥，扫帚穗是一束独立锥条。这里照同一套做法：
   身体、帽檐都是参数化四边形网格（`grid`），帽冠是沿曲线扫的圆截面（`sweep`），
   帚穗是真的分成条。
   ——不追求顶点数一致（那是 Blender 内部的事），追求的是**同一套布线逻辑**：
   四边形、环形走向、褶皱沿环向分段、没有三角形扇。
*/

import * as THREE from 'three';
import { clamp, damp } from './anim.js';

const TAU = Math.PI * 2;

/* the envelope the page reserves for her, and the float under it. The old
   character stood on the floor and was `height` tall; this one hangs, so the
   *hem* is `FLOAT` above the floor and the hat tip lands on the same ceiling
   the old crown did — that is what keeps the five camera vantages framed. */
const NOMINAL = 6.38;
const FLOAT = 0.80;

/* every number below is the measured ratio times this, so the model can be
   re-proportioned in one place if the reference is ever re-measured.
   1.382 = 身体可见高 0.960 + 帽冠高出檐面的 0.422（都在檐宽这个单位下，
   参考量出来的）。 */
const B = (NOMINAL - FLOAT) / 1.382;      // 宽度单位：所有半径都按它给
const HEM = FLOAT;
/* ★★ 下摆这一圈的三个实测尺寸，给"地板是硬的"那两条约束用
   （`tools/_hemwho.mjs` 的单通道静音实验反解出来，不是估的）：

     `HEM_H`  静息时下摆最低点离地板 **0.465** —— 注意它不等于 `FLOAT`(0.80)：
              `FLOAT` 是**名义**下摆线，网格最低的那个顶点比它低 0.335。
              点头的 `rise` 是 −1.05，所以单靠平移就沉到地板下 0.577。
     `HEM_RX` 下摆环在**左右**方向的**有效**半径 1.32：`晃一晃` 滚 0.72 rad
              （`lean`，绕的是**地板那条线**）时下摆掉了 0.827，
              0.827 / sin 0.72 = 1.20 —— 但 1.20 还差 0.039 才够（实测），
              所以取 1.32 把这点余量一起给进去。
     `HEM_RZ` 同一个环在**前后**方向的 1.32：**2026-10-04 从 0.35 改上来的**。
              原来那个 0.35 是拿"`tip` 0.16 只把下摆压低 0.061"反推的
              （0.061 / sin 0.16 = 0.383），可那一笔是在 `nod` 身上量的 —— 而
              `nod` 的 `rise` 同时被 `SINK_LIMIT` 钳着，量到的从来不是**旋转
              单独**的账。`tools/_hemring.mjs` 直接量环本身：`max|x| = max|z|
              = 1.378` —— **它是个圆**，"她宽、不深"说的是身体，不是下摆。
              0.35 小了近 4 倍，于是 `tip` 通道的补偿一直是空的；`ACTIONS` 里
              最大的 `tip` 只有 0.16，从没把它顶出来，直到 `SING.bow` 给了 0.86
              （`_singhem.mjs` 量到下摆离地板 −0.814）。

   `HEM_KEEP` 是留的余量：约束只保证"不穿"，不留余量的话她会在边界上抖。 */
const HEM_H = 0.465, HEM_RX = 1.32, HEM_RZ = 1.32, HEM_KEEP = 0.10;
/* ★ 身体**不是** B 高。参考上"檐面到下摆底"只有檐宽的 0.563，而宽度方向
   的身体宽是檐宽的 0.77 —— 也就是身体比"宽高比 = 1"要**矮**一截。
   第一版让 v 直接从 HEM 走到 HEM+B，于是身体比参考高了 15%，
   并排一看就是个直立的坛子。 */
const BH = 0.875 * B;                     // 身体高，下摆底 -> 头顶
const TOP = HEM + BH;
/* ★ 帽檐是全场最稳的一把尺子：它的左右两个尖是画面里最外侧的极值点，
   不受姿态影响，所以下面全部以「檐宽 = 1.706 B」为基准。

   第一版错在**横向量与纵向量混着比了** —— 裁剪图 1185x870，横纵不是一个
   像素尺度，凡是"横向 ÷ 纵向"的比值都少乘了 870/1185 = 0.73。
   这一版每个比值都只在自己那一轴上量（`measure9.py` 打印时带方向标注）。 */
const ARM = 0.505 * B;                     // 臂展 1.32 B 的半径
/* ★ 帽檐是**圆盘 + 左右两个尖**，所以「檐宽」= 2·(BRIM_R + 那个尖)。
     尖给 0.055 B（`brimFn` 里的环向调制），圆盘半径就相应减掉同样的量，
     檐宽才是原来说好的 1.72 B —— 不然把尖加上去，檐一下宽了 6%，
     而所有比值都拿檐宽当分母，会一起假跌 6%（量到过：body width 掉到 0.710）。 */
const BRIM_R = 0.805 * B;                 // 圆盘半径（檐宽 2×(0.805+0.055) = 1.72 B）
const BRIM_TIP = 0.055 * B;               // 左右尖比圆盘多出去的量
const CONE_R = 0.28 * B;                  // 锥底半径（也是檐面内圈的半径）

/* ---------- 配色 ----------
   反照率，不是采样值（见文件头）。三个房间各有自己的灯，所以这里的白要留出
   明暗余地：`body` 若直接取采样到的最亮值，进了霜厅会饱和成 #ffffff，
   褶子和脸一起消失 —— nahida.js 在头发上栽过一次，教训记在 MEMORY 里。 */
const C = {
  body: 0xe8f2f3,          // 床单：冷白，留一档给明暗
  bodyDeep: 0xd6e4e7,      // 下摆内侧/背面，让波浪边读得出来
  glow: 0x86f0f5,          // 体内青光（成品图最亮处 #93FEFF，这里收一档当反照率）
  /* 帽面靛紫：成品图上暗部 #1E103F、亮部 #2C1A71，反照率取中间偏亮一点。
     上一版 0x3d2c6e 偏红偏亮，渲染出来是"紫帽子"而不是参考那种发蓝的靛。 */
  hatTop: 0x372370,
  /* 檐底那抹红：成品图亮部直接顶到 #FF3C3C（纯红，很扎眼），暗部 #94212E。
     反照率取 #C62B2B —— 再暗就沉成砖红，参考上它是一眼能看见的鲜红。 */
  hatUnder: 0xc62b2b,
  hatRim: 0xcf3030,        // 檐口包边
  band: 0xc9a24e,          // 金带（成品图上偏橄榄金 #8B8538，那是暗棚里的读数）
  /* 两只眼睛**不是一个颜色**：观众左边那只是亮红，右边那只是更暗的酒褐
     （参考的彩色渲染里右眼几乎读成黑褐色）。第一版给了同一个色，
     右眼就失去了"更大更沉"的层次。 */
  eye: 0x2a1218,           // 右眼：近黑的酒褐（成品图 #220F18）
  eyeL: 0xb0332a,          // 左眼：亮红（成品图 #9E1E2A / 亮部 #A73950）
  eyeHi: 0xfff2ea,
  blush: 0xf96a37,         // 腮红：橙红（成品图 #F96A37）
  mouth: 0x8e2320,
  handle: 0x7a2422,        // 帚柄红（成品图柄身 #5F1210，很暗）
  bristle: 0x5a2420,       // 帚穗深红
  bristleLo: 0x431a18,
  ribbon: 0xd82a12,        // 蝴蝶结（成品图 #E42F0C）
};

/* ---------- 一张参数化四边形网格 ----------
   `fn(u, v)` 返回一个点，u 环向 0..1，v 从下到上 0..1。绕序 `(a, b, c, b, d, c)`
   配 `u` 沿 +θ、`v` 沿 +y 的切向，算出来正好朝外 —— 反过来写就是全朝内，
   外表面会被背面剔除掉，渲染的是管子内壁（nahida.js 的 `lock` 栽过这个坑）。 */
function grid(nu, nv, fn) {
  const pos = [], uv = [], idx = [];
  for (let iv = 0; iv <= nv; iv++) {
    const v = iv / nv;
    for (let iu = 0; iu <= nu; iu++) {
      const u = iu / nu;
      const p = fn(u, v);
      pos.push(p[0], p[1], p[2]);
      uv.push(u, v);
    }
  }
  const W = nu + 1;
  for (let iv = 0; iv < nv; iv++) {
    for (let iu = 0; iu < nu; iu++) {
      const a = iv * W + iu, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------- 沿一条曲线扫圆截面 ----------
   帽冠必须这么做。`LatheGeometry` 只会生成绕 y 轴的回转体，想让它"勾"起来
   只能逐顶点位移，而位移出来的截面**仍然是水平的**：锥体一旦勾回来
   （参考的帽尖从最高点往下勾了 0.31 B），水平截面会在内侧自交，
   渲染出来是几层套在一起的壳。

   绕序和 `grid` 同一套：环向是 u、沿曲线是 v，`(a, b, c, b, d, c)`。
   `computeFrenetFrames` 的 (N, B, T) 是右手系（B = T×N），于是 N×B = T，
   正好满足"u 切 × v 切 = 外法线"。截面是圆的，所以 Frenet 那个"滚转是它自己
   挑的"在这里不咬人 —— 但记着这件事：`nahida.js` 的刘海就是因为信了默认帧，
   两个轴互换，一束头发渲染成一排竖鳍。 */
function sweep(curve, radiusAt, segs, rings) {
  const pts = curve.getSpacedPoints(segs);
  const fr = curve.computeFrenetFrames(segs, false);
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const r = radiusAt(i / segs);
    const N = fr.normals[i], Bn = fr.binormals[i];
    for (let j = 0; j <= rings; j++) {
      const a = (j / rings) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(pts[i].x + (N.x * ca + Bn.x * sa) * r,
               pts[i].y + (N.y * ca + Bn.y * sa) * r,
               pts[i].z + (N.z * ca + Bn.z * sa) * r);
    }
  }
  const W = rings + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < rings; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createGhost({ height = NOMINAL, x = 0, y = 0, z = 0 } = {}) {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  root.scale.setScalar(height / NOMINAL);

  const materials = [];
  const M = (opt) => {
    const m = new THREE.MeshStandardMaterial({ toneMapped: true, ...opt });
    materials.push(m);
    return m;
  };

  /* ============================ 床单 ============================
     剖面（v -> 半径）照量出来的轮廓：下摆最宽 -> 收到腰 -> 张到肩 -> 收成圆顶。
     「两臂尖」不进剖面 —— 进了就是一圈飞碟。它是**环向调制**：只在 θ=±π/2
     附近把半径顶出去，`|sin θ|` 的高次幂让它收得快，于是长成两个三角尖而不是
     一圈鼓包。下摆的波浪同理：`cos(5θ)` 只在下摆那一带生效，而且是往下**坠**，
     不只是往里收 —— 参考图上浪尖比浪谷低 0.14 个身体高，光调半径做不出来。 */
  /* ★ 这一列是**从成品彩色渲染上逐行扫出来的**（`_ref/ghost/measure10.py`），
     不是照着 clay 图"感觉"画的。做法：把身体按色相从帽子里分出来，每 25 行
     读一次左右边缘的像素跨度，除以身体高换成 B 单位。

     ★ 这一版是把那张表**整张搬过来**的，不再手工折中。上一版是"扫出来之后
     再凭感觉调一调"的产物，上半身因此错得不轻 —— 把两张剖面并排看：

        v      0.70   0.74   0.78   0.83   0.87   0.91   1.00
        参考   0.455  0.470  0.452  0.290  0.157  0.089  0.005
        上一版 0.466  0.432  0.360  0.281  0.196  0.120  0.045

     参考的肩（v≈0.78）还有 0.45 B，上一版只剩 0.36 —— 收得太早、太狠。
     后果是整件床单读成一个**圆枕头**：肩一窄，下面那段就变成了"肚子"。
     参考的形状其实很单调：从肩一路张到下摆，中间只在 v≈0.52 有一个很浅的腰
     （0.389，只比两边少 0.06），然后收到 v=0 的一个尖（0.070）——
     布是从几个点垂下来的，不是一圈荷叶边。

     扫出来的形状和更早那版差得挺远，四处：
       · 最宽处**不在下摆底**，在 v≈0.20（半径 0.496 B）—— 床单是先鼓出去
         再收口，所以最低那一圈反而是个窄瓣；
       · 腰在 **v≈0.52**（0.389 B），比更早那版的 0.30 低得多，而且没那么细；
       · 腰以上重新张开到肩（v≈0.74，0.470 B）；
       · **肩以上才收，而且收得很快**（v=0.87 只剩 0.157）。 */
  const PROFILE = [
    // v, r/B   —— 逐行扫出来的原表。下摆带（v ≤ 0.52）是用户 2026-10-02 要求
    // 「屁股变圆」后整体外扩过的：峰值 0.496 → 0.540（v 0.217），收腰位置与腰围
    // （0.389 @ 0.522）原样不动。圆 = 峰两边近乎对称地鼓出去再收回来，不是锥形。
    // ★ 峰值必须留在臂行（0.618B）之下，否则 `_sil` 的 widest row 会从手臂换到屁股。
    [0.000, 0.070], [0.043, 0.346], [0.087, 0.452], [0.130, 0.506],
    [0.174, 0.532], [0.217, 0.540], [0.261, 0.532], [0.304, 0.512],
    [0.348, 0.484], [0.391, 0.452], [0.435, 0.420], [0.478, 0.400],
    [0.522, 0.389], [0.565, 0.396], [0.609, 0.410], [0.652, 0.432],
    /* 头顶四行是用户 2026-10-02 要求「头圆一些，不要那么尖」后改的：
       原表 0.790/0.440 · 0.840/0.320 · 0.880/0.150 · 0.930/0.075 —— 从眼睛上方
       就开始猛收，读成一颗泪滴/洋葱。现在穹顶在 0.46 挂到 v 0.79 才开始收，
       收的轨迹也放缓（0.400 → 0.300 → 0.170），截面是一个球的弧不是锥的斜线。
       ★ 圆颅的截面比原来宽，檐圈（内径 0.28B）的"卡座"随之上移
       （v 0.854 → 0.888）—— `HAT_Y` 因此抬了 0.030B，否则圆颅从檐面里戳出来。
       脸那一带（v ≤ 0.739）一个数没动，眼睛/腮红/嘴的位置全部照旧。 */
    [0.696, 0.455], [0.739, 0.470], [0.790, 0.462], [0.840, 0.400],
    [0.880, 0.300], [0.930, 0.170], [1.000, 0.020],
  ];
  /* ★ 剖面必须用 **Catmull-Rom**，不能用"逐段 smoothstep"。
     smoothstep 在每个结点上导数为零 —— 于是半径在每一个结点都**停一下**，
     十六个结点就是十六个平台，侧影上读成一圈一圈的横向鼓包。
     第一版正是这么写的，渲染出来身体像一根拧过的麻花。
     Catmull-Rom 只在数据点上取值、斜率由邻居给，结点处不会停。 */
  const profAt = (v) => {
    const n = PROFILE.length;
    let i = 0;
    while (i < n - 2 && v > PROFILE[i + 1][0]) i++;
    const v0 = PROFILE[i][0], v1 = PROFILE[i + 1][0];
    const t = clamp((v - v0) / Math.max(1e-6, v1 - v0), 0, 1);
    const p0 = PROFILE[Math.max(0, i - 1)][1], p1 = PROFILE[i][1];
    const p2 = PROFILE[i + 1][1], p3 = PROFILE[Math.min(n - 1, i + 2)][1];
    const t2 = t * t, t3 = t2 * t;
    return (0.5 * (2 * p1 + (-p0 + p2) * t
                 + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)) * B;
  };
  /* 两臂尖的高度：参考图上两个尖角比眼睛**高**一档（v≈0.78，眼睛在 0.70），
     不是"肩"也不是"腰"。上一版放在 0.63 —— 正视图上手臂长在肚子两边。
     ★★ 幅度：上一轮是**拿转体帧定的，定错了**。那条注释写"参考最宽的那一行是下摆
     （0.609 檐宽），手臂那一行只有 0.579" —— 那是**姿态量**：第一帧的幽灵转着身子，
     横向的臂尖被透视缩短了（cos yaw）。同一件事在 `clay-front-tight.png`（正视图，
     臂尖正对相机）里是反的：**臂尖 669 px = 0.752 檐宽，紧邻其上只有 442 px = 0.497**
     —— 臂尖比其上缘宽 **51%**。两帧并不矛盾：0.752 × cos45° ≈ 0.53，加上下摆本身
     的投影，正是第一帧读到的 0.579。
     判据（`face.py` 同款手法）：y=354/364 时左右两段亮度只有 ~55（那是帽檐），
     y≥374 变到 133~177 —— **那两段确实是手臂，不是檐**。
     ★ 而且 `PROFILE` 在 v≈0.74~0.79 的那个鼓包**也是同一只手臂**（它来自转体帧的剪影），
     所以"剖面里的鼓包"和"这里叠的尖"是同一件事量了两遍 —— 相加才是那条剪影。
     现在 `ARM` 取 0.618 B（实测臂行 0.752 檐宽，与 clay 原始读数一致；
     0.66 B 会到 0.801，偏大 6.5%），`ARM_ADD` 由目标半径反推。 */
  const ARM = 0.618 * B;
  /* 峰在 0.78、包络要**窄**、环向要**尖**：参考上的手是两片薄三角，只在很窄的
     一段角度和高度上顶出去。上一版 `ARM_P = 6` 在 θ=60° 还剩 42% 的幅度、σ=0.055
     又让包络跨了 ±0.11 v —— 两个方向都软，做出来是"圆肩膀"而不是"尖手"。
     clay 正视图上臂尖的竖直跨度只有 ~30 px（对 890 px 檐宽 = 0.034），
     折算到 v 约 ±0.045，所以取 σ=0.040、环向 12（θ=60° 只剩 13%）。 */
  const ARM_V = 0.78, ARM_P = 12.0, ARM_SD = 0.040;
  const ARM_ADD = ARM - profAt(ARM_V);
  /* 下摆的波浪：**只拉半径不够**，参考上浪尖比浪谷低一大截。
     8 个瓣（不是 4 个）：成品图下摆正面能数出 4-5 个圆瓣，4 个瓣一圈只有 2 个
     朝前，读成"裙子破了两个洞"。取偶数是必须的 —— 奇数在环向接不上。
     ★ 逐行的读数说这里是**尖角**不是圆瓣：参考的下摆在 25 px 里从 430 px 宽
     收到 87 px（`measure10.py` 的最后三行），也就是说布是从几个点垂下去的。
     所以垂坠项要取 `w01^1.8`（集中在瓣尖）而不是 `w01`（均匀）——
     均匀地垂下来是一圈荷叶边，集中在几个点上才是垂下来的布角。 */
  const HEM_WAVE = 0.035 * B;        // 径向
  /* 垂坠：参考上"最宽那一行"到"最深那一行"只差 118 px（= 0.115 个身体高），
     而身体从 v=0 升到 v=0.20 本身就走掉了 0.20 B —— 所以**垂坠要小**。
     上一版给 0.13 B，加上剖面自己的抬升，下摆比参考多坠了一倍，
     整个身体因此高了 15%。 */
  const HEM_DROP = 0.060 * B;
  const HEM_REACH = 0.16;            // 波浪往上影响多远（v）
  /* 竖褶：参考的床单上有一圈很细的褶，它不是几何上的大瓣，是**布料**。
     ★ 这一条是**读法**问题，不是比例问题：比值全对的时候，我的身体仍然读成
     一个橡皮枕头，而参考读成一块布 —— 差别就在这些褶上。所以幅度从 0.012 B
     加到 0.020 B，条数从 20 收到 16（16 是 8 瓣的整数倍，褶和下摆的瓣不会
     互相打拍子）。再多就得把 nu 抬到 200 以上，一个褶不到 8 段会闪成锯齿。 */
  const PLEAT = 0.020 * B, PLEAT_N = 16;

  function bodyPoint(u, v) {
    const th = u * TAU;
    const up = Math.sin(th);                 // +1 朝观众右侧（她的左）
    const arm = ARM_ADD * Math.exp(-((v - ARM_V) ** 2) / (2 * ARM_SD * ARM_SD));
    // the wave lives only near the hem, and it both pulls in and hangs down
    const near = 1 - clamp(v / HEM_REACH, 0, 1);
    /* 取 −cos：正前方（θ=0）要是**凹口**不是鼓包。参考图下摆正中是一个往上
       收的缺口，两边各一个圆瓣。 */
    const wave = -Math.cos(8 * th);
    const w01 = 0.5 + 0.5 * wave;            // 0 在凹口、1 在瓣尖
    const r = profAt(v) + arm * Math.pow(Math.abs(up), ARM_P)
            + HEM_WAVE * (w01 - 0.5) * near
            + PLEAT * Math.cos(PLEAT_N * th) * near;
    const y = HEM + v * BH - HEM_DROP * near * Math.pow(w01, 1.8);
    return [Math.sin(th) * r, y, Math.cos(th) * r];
  }

  /* 体内青光：一张 8x256 的竖向渐变当 emissiveMap。
     胸口以上最亮、下摆收暗 —— 底子一亮，深红的五官就没了；下摆也压一档，
     否则波浪边会被自己的光糊平。

     ★ 渐变的强弱必须**烘进 RGB**，不能靠 alpha。`emissiveMap` 在着色器里只取
     `.rgb` 去乘发光色，alpha 从头到尾没被读过；画一张 rgba(...,0.16) 的透明
     渐变，取回来的 rgb 仍是 (150,235,242)，于是整件衣服被均匀点亮，
     渐变等于没画。写成黑到青再回黑，才是真的"胸口亮、下摆暗"。 */
  function glowMap() {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 256;
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0.00, 'rgb(70,118,126)');   // 帽檐下（v=1，头顶）
    gr.addColorStop(0.14, 'rgb(186,246,252)');  // 胸口：最亮
    gr.addColorStop(0.30, 'rgb(214,252,255)');  // 脸那一带
    gr.addColorStop(0.46, 'rgb(186,246,252)');
    gr.addColorStop(0.68, 'rgb(96,190,200)');
    gr.addColorStop(0.86, 'rgb(38,92,100)');
    gr.addColorStop(1.00, 'rgb(20,54,60)');     // 下摆：压暗
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 256);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const matBody = M({
    color: C.body, roughness: 0.66, metalness: 0,
    /* 侧面朝外的那一半要能透出光：`side: DoubleSide` 让下摆内侧也画出来，
       不然从下往上看床单是漏的。 */
    side: THREE.DoubleSide,
    emissive: new THREE.Color(C.glow), emissiveIntensity: 1.15, emissiveMap: glowMap(),
  });
  /* ★ 发光要按**朝向**再收一次，只靠那张竖向渐变是不够的：渐变只随高度变，
     于是同一高度上正对镜头的一面和转到侧面的一面一样亮，床单被自己的光
     糊成一团没有体积的色块（参考上青光集中在胸口中间、往轮廓边缘收白）。

     补一个菲涅尔权重：`|N·V|` 在正对镜头的面上是 1、在轮廓上是 0，所以
     `pow(|N·V|, 1.4)` 正好是"中间亮、边缘灭"。`vNormal` 与 `vViewPosition`
     都是视图空间的，MeshStandardMaterial 两个 varying 都已经声明了。 */
  matBody.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
       totalEmissiveRadiance *= pow(facing, 1.4);`,
    );
  };

  const body = new THREE.Mesh(grid(200, 96, bodyPoint), matBody);
  body.castShadow = true;
  root.add(body);

  /* ============================ 脸 ============================
     参考上两只眼睛**不一样大**：左眼（观众左）是竖椭圆，右眼是更大的正圆，
     还带一个高光点。这个不对称是原模型的特征，照做。
     眼/腮红是压扁的球贴在被面上，嘴是两段 torus 弧拼的 ω。 */
  /* ★ 脸的枢轴必须放在**头的中心**，不是在脚下。`face.rotation.y` 是
     "她转过来看光标"；枢轴留在原点的话那不是转头，是把整张脸横着推出去
     （脸在 y≈2.8 处、离轴 1.2 个单位，转 0.3 弧度就平移 0.36）。
     下面所有五官都按 `y - FACE_Y` 建，`face.position.y` 再补回来。 */
  const FACE_Y = HEM + (TOP - HEM) * 0.70;
  const face = new THREE.Group();
  face.position.y = FACE_Y;
  root.add(face);
  const faceAt = (u, v, out = 1) => {
    const p = bodyPoint(u, v);
    const l = Math.hypot(p[0], p[2]) || 1;
    return [p[0] * out, p[1] - FACE_Y, p[2] * out, p[0] / l, p[2] / l];
  };
  /* 朝外：球/圆环的"扁"轴与"面"法线都是 +z，所以把 +z 旋到外法线上。
     不用 `lookAt` —— 那个读的是**世界**坐标，而这里的点已经是 face 的局部
     坐标，`face.position.y` 一挪就对不上了。`setFromUnitVectors` 与父级无关。 */
  const FWD = new THREE.Vector3(0, 0, 1);
  const faceOut = (obj, nx, nz) => {
    obj.quaternion.setFromUnitVectors(FWD, new THREE.Vector3(nx, 0, nz).normalize());
  };

  /* ★ 这里的 `u` 是**环向参数**，不是"脸宽度的百分比"：`bodyPoint` 里
     `θ = u·TAU` 且 `x = sinθ·r`、`z = cosθ·r`，所以**正前方是 u=0（或 1）**，
     u=0.25 是身体的**正右侧**。第一版把眼睛写在 0.185/0.318、嘴写在 0.25，
     等于把五官贴到了右半边和正右侧 —— 正面渲染出来是一张没有脸的白布。
     下面这几个数是从"离中轴多远"反解出来的：脸在 v≈0.69 处半径 0.345 B，
     眼睛要落在 x = ±0.14 B，`asin(0.14/0.345)` = 24°，即 u = 0.067。 */
  /* 粗糙度给高一点：眼睛是很小的暗块，`roughness: 0.30` 会让它把霜厅的亮环境
     整片映回来，深褐的右眼渲染成一块灰绿玻璃珠，跟参考上那颗沉下去的暗红
     完全不是一回事。 */
  const matEyeL = M({ color: C.eyeL, roughness: 0.52, metalness: 0 });
  const matEyeR = M({ color: C.eye, roughness: 0.55, metalness: 0 });
  const matEyeHi = M({ color: C.eyeHi, roughness: 0.30, emissive: C.eyeHi, emissiveIntensity: 0.30 });
  const eyes = [];
  /* 眼距和大小也是量出来的 —— 但这一轮是**按颜色掩码量的**（`_ref/ghost/face.py`
     在 `colour-body.png` 上找连通块），不再是目测。以**眼睛那一行的身宽**为分母，
     参考的四个数：右眼 0.120、左眼 0.063、嘴 0.060、腮红 0.074。
     ★ 上一版左眼给到 0.100、嘴 0.091、腮红 0.106 —— 三样都比参考大 45~58%，
       最刺眼的是左眼：参考里它**只有右眼一半宽**（36px vs 68px），上一版却和右眼
       差不多大，两只眼睛一起读成一对圆点，丢掉"一大一小"这个特征。
     眼距也从 0.290 收到 0.236（两眼中点距 / 身宽）。 */
  for (const [u, rx, ry, hi, mat] of [[0.962, 0.028 * B, 0.052 * B, false, matEyeL],
                                      [0.038, 0.054 * B, 0.056 * B, true, matEyeR]]) {
    const [px, py, pz, nx, nz] = faceAt(u, 0.69, 1.0);
    const e = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 18), mat);
    e.scale.set(rx, ry, 0.30 * rx);
    e.position.set(px, py, pz);
    faceOut(e, nx, nz);
    e.userData.ry = ry;                        // 眨眼要用的基准高度，缓存一次
    face.add(e);
    eyes.push(e);
    if (hi) {
      /* 高光要落在**眼球的表面**上：眼球是沿法线压扁的，所以先沿法线推
         0.30·rx（半厚）+ 一点点，再在切平面里往左上偏。切向是
         `(cosθ, 0, −sinθ)`，而 `nx = sinθ, nz = cosθ`，所以就是 `(nz, 0, −nx)`。 */
      const h = new THREE.Mesh(new THREE.SphereGeometry(rx * 0.26, 12, 10), matEyeHi);
      const out = 0.30 * rx + 0.012 * B, lat = 0.020 * B;
      h.position.set(px + nx * out - nz * lat, py + ry * 0.34, pz + nz * out + nx * lat);
      face.add(h);
    }
  }

  const matBlush = M({ color: C.blush, roughness: 0.58, emissive: C.blush, emissiveIntensity: 0.28 });
  /* 腮红落在眼睛**再往外一点、再往下 0.136 B** 的位置（参考：左腮比左眼外 19px、
     低 86px，身宽 569px）。上一版只低了 0.101 B，腮红贴着下眼睑，读成一对眼袋。 */
  for (const u of [0.951, 0.049]) {
    const [px, py, pz, nx, nz] = faceAt(u, 0.535, 1.0);
    const b = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 14), matBlush);
    b.scale.set(0.040 * B, 0.032 * B, 0.016 * B);
    b.position.set(px, py, pz);
    faceOut(b, nx, nz);
    face.add(b);
  }

  /* ★ 嘴是**一道弧**，不是两道。上一版并排两个半圆环，做出来是个"ω"；
     参考（`clay-front-tight.png` 与 `colour-body.png` 都能看清）是一道小的
     ∪ 微笑，宽 0.060 身宽，位置在眼睛中点正下方 0.060 身宽处。 */
  const matMouth = M({ color: C.mouth, roughness: 0.42 });
  const mouth = new THREE.Group();
  {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.020 * B, 0.009 * B, 10, 22, Math.PI), matMouth);
    arc.rotation.z = Math.PI;                  // 开口朝上 -> ∪
    mouth.add(arc);
  }
  {
    const [px, py, pz, nx, nz] = faceAt(0.0, 0.630, 1.0);   // 正前方中轴
    mouth.position.set(px, py, pz);
    faceOut(mouth, nx, nz);
    face.add(mouth);
  }

  /* ============================ 帽子 ============================
     帽檐是这张图里最大的一件东西：直径约 1.34 个身体高，是臂展的 1.5 倍。
     草稿把它做成了大约臂展的 0.9 倍，所以整个模型读成了"小圆帽"而不是女巫帽。

     檐面是**参数化圆盘**而不是 lathe，因为参考的檐口是波浪的（`cos(3θ)`），
     而且檐面从中心往外**下垂**再微微上翘；lathe 只能给一个固定剖面，
     转出来的边是正圆。底面另做一层、半径略大 0.02、贴着下面，涂红 ——
     视频里那抹红就是檐底，不是檐面。 */
  const hat = new THREE.Group();
  root.add(hat);
  const matHat = M({ color: C.hatTop, roughness: 0.54, metalness: 0.03, side: THREE.DoubleSide });
  const matUnder = M({ color: C.hatUnder, roughness: 0.60, metalness: 0, side: THREE.DoubleSide });
  const matBand = M({ color: C.band, roughness: 0.30, metalness: 0.70 });

  /* ★ 帽子的枢轴放在**檐面中心**，不是脚下。`hat.rotation.x` 是帽子跟着点头，
     枢轴在脚下的话 4.5 个单位的力臂会把整顶帽子平移出去半米，那不是"歪"。
     所以下面每个零件都按 `y - HAT_Y` 建，`hat.position.y` 再补回来。 */
  /* 檐面中心压在头顶上，但要**压得够高**：檐口是有下垂的，中心若贴着头顶，
     前缘就会垂到眼睛上把脸切掉（第一版正是这样，眉毛以下是唯一可见的脸）。
     取 `TOP - 0.015 B`，同时保证檐的内圈高于身体在那个半径上的表面 ——
     否则头顶会从檐面里戳出一圈白边。 */
  /* ★ +0.030B：头顶改圆后（见 PROFILE），檐圈的卡座从 v≈0.854 上移到 v≈0.888，
     帽子整体抬这么多才还扣在圆颅上 —— 不抬的话圆颅从檐面里戳出来。 */
  const HAT_Y = TOP + 0.015 * B;
  hat.position.y = HAT_Y;
  /* ★ 檐面的下垂比上一版**小得多**，这是量出来的：把檐口左尖（y=210）、
     右尖（y=525）和檐面中心（y≈340）连起来，左尖比"倾斜平面"高 27 px、
     右尖低 28 px —— 也就是说檐口**几乎就躺在那个倾斜平面上**，下垂只有
     28/1026 = 0.027 个檐宽 = 0.047 B。上一版给了 0.133 B，是它的三倍，
     整顶帽子于是读成一只碗。参考上"檐子很塌"的感觉来自**整顶帽子的倾角**，
     不是檐面本身的弧度。 */
  /* ★ 檐面**几乎是平的**，这是量出来的，也是脸上那道光的关键。
     参考的檐是这样一个椭圆：左尖 (220,210)、右尖 (1246,525)，把它俩连起来
     就是整顶帽子的 17° 倾角；檐口对这条弦只偏 ±27 px，也就是**没有独立的
     弧度**。它的竖直跨度 372 px 拆开正好是 `2·R·sin17° = 352` 加檐口厚度
     24 —— 一滴弧度都不剩。

     上一版给到 0.135 B（= 94 px 的下垂），两倍还多。代价不在帽子上，在脸上：
     檐的前缘压到眼睛下面，把整张脸切掉一半。参考上脸是完整露出来的，
     因为它的前缘比檐心只低 0.04 B。 */
  const brimDrop = (v) => -(0.045 * B) * v * v;
  /* ★ 檐口的形状：参考的檐边不是正圆，是**左右两个尖**，前后反而收进去。
     注意上一版这里写错了 —— 那个 `−cos(2θ)` 是加在 **y** 上的（把两侧抬起、
     把前面压低），不是加在半径上的，所以"尖"其实从来没做出来过，做出来的
     是一个前低后高的碗。这一版把它挪到半径上：θ=±90° 是 +1 顶出去，
     θ=0/180° 是 −1 收进来。 */
  const brimFn = (u, v, dy) => {
    const th = u * TAU;
    const r0 = CONE_R + (BRIM_R - CONE_R) * Math.pow(v, 0.78);
    const r = r0 + BRIM_TIP * v * v * (-Math.cos(2 * th));
    return [Math.sin(th) * r, brimDrop(v) + dy, Math.cos(th) * r];
  };
  const brimTop = new THREE.Mesh(grid(96, 22, (u, v) => brimFn(u, v, 0)), matHat);
  brimTop.castShadow = true;
  hat.add(brimTop);
  /* ★ 檐底的偏移**不是常数**：参考上檐口有一圈看得见的红边，量出来从右檐尖的
     中心再往下还有 0.035 个檐宽 —— 也就是说檐子是**边缘更厚**的一片，不是一张
     纸。上一版给常数 0.013 B，渲染出来檐口只有一根红线。 */
  const brimBot = new THREE.Mesh(grid(96, 22, (u, v) => brimFn(u, v, -(0.008 + 0.026 * v * v) * B)), matUnder);
  hat.add(brimBot);

  /* 帽冠：一条**带弯钩的轴**上扫出来的圆截面（`sweep`）。

     ★ 轴上的点是反解出来的，不是画出来的。做法：先在成品图上把檐口左尖
     （x=220,y=210）和右尖（x=1246,y=525）连起来，得到整顶帽子的倾角
     arctan(315/1026) = 17°；再把量到的帽尖位置**逆着这 17° 转回去**，
     才得到模型空间里的形状。量出来的三个数是（都以檐宽为单位）：

       帽冠最高点高出檐面      0.247       帽尖横着偏出去 0.244
       锥底半径                0.146

     这一勾的落差是 **0.31 B**，比上一版整顶帽子还高，而上一版完全没有它。
     少了这一勾，锥体就只是一个圆顶 —— 女巫帽之所以是女巫帽，全在这个钩上。

     ★ 高度是**量出来之后再收过一轮**的：第一版按 0.247 檐宽铺轴，但忘了
     两件事 —— (a) 管子自己还有半径，轴到哪儿不等于表面到哪儿；
     (b) `CatmullRomCurve3` 在控制点之间会**过冲**。两者叠起来，帽冠实际
     比参考高了 64%（`tools/_bbox.mjs` 量出来的：0.687 B 对 0.421 B）。
     现在这一组是拿那个工具反复量着调下来的，不是再算一遍。

     轴的下段（dy < 0）是**帽筒**：锥底半径比头顶那一带的体宽大得多，
     只做到檐面为止的话，檐的内圈和脑袋之间会留一个能看进的环缝。
     往下接一段略微外张的裙把脑袋兜住，它的下端埋进头里，所以开口看不见。

     ★ 高度是**并排叠影**逼出来的。`overlay.py`（把两张剪影按檐宽归一、按左檐尖
     对齐，红=参考多、蓝=我多）第一版叠出来，帽冠正上方整整多出一顶红帽檐 ——
     参考的冠顶比我的高 0.064 个檐宽，冠的右勾也多伸出一截。
     换成单轴的数就是 `crown cone h / brim width`：我 0.224，参考 0.287，
     差了 28%。所以这一版把 dy>0 的那一段整体抬了 1.26 倍。 */
  {
    const axis = [
      [0.000, -0.190], [0.000, -0.060], [0.004, 0.057],
      [0.016, 0.155], [0.038, 0.247], [0.062, 0.310],
      [0.094, 0.345], [0.145, 0.323], [0.196, 0.264], [0.242, 0.164],
    ].map(([dx, dy]) => new THREE.Vector3(dx * B, dy * B, 0));
    const curve = new THREE.CatmullRomCurve3(axis, false, 'centripetal', 0.5);
    /* 半径按**弧长**给（`sweep` 用的是 `getSpacedPoints`，i/segs 就是弧长比例）。
       锥底那一段必须落在 `CONE_R` 上 —— 檐面的内圈就是按它开的孔，两边不一致
       会露出一圈环缝。往上是照着参考的锥面斜率（底面半径 / 高 ≈ 0.6，
       即半角 31°）收的，不是随手画的圆弧。 */
    const R_T = [
      [0.00, 0.320], [0.21, 0.280], [0.32, 0.235], [0.44, 0.190],
      [0.56, 0.145], [0.68, 0.098], [0.78, 0.062], [0.88, 0.036],
      [0.95, 0.017], [1.00, 0.006],
    ];
    const radiusAt = (t) => {
      for (let i = 1; i < R_T.length; i++) {
        if (t <= R_T[i][0]) {
          const [t0, r0] = R_T[i - 1], [t1, r1] = R_T[i];
          const u = (t - t0) / Math.max(1e-6, t1 - t0);
          return (r0 + (r1 - r0) * (u * u * (3 - 2 * u))) * B;
        }
      }
      return R_T[R_T.length - 1][1] * B;
    };
    const cone = new THREE.Mesh(sweep(curve, radiusAt, 84, 40), matHat);
    cone.castShadow = true;
    hat.add(cone);
  }
  {
    /* 金带压在锥底、紧贴檐面：往上挪它会因为锥体在收而离开表面，浮成一圈环。
       半径取锥面在 y=0.045 B 处的值（0.30 − 0.6×0.06 ≈ 0.264 B）再放一点余量。
       ★ 带子的**高**是量出来的：参考里带高 / 檐宽 ≈ 0.034~0.045，檐宽 1.72 B
       → 带高 ≈ 0.058~0.077 B。上一版给了 0.09 B（合 0.052 檐宽），做出来是一圈
       很粗的金箍，把"细金线"读成了"金腰带"。压到 0.058 B 之后底半径要相应放大：
       底面落到 y = 0.016 B，锥面在那里还有 0.281 B，所以底半径给到 0.286 B。 */
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.268 * B, 0.286 * B, 0.058 * B, 56), matBand);
    band.position.y = 0.045 * B;
    hat.add(band);
  }
  /* 帽子往**右**歪：参考上檐口的左尖明显高于右尖（210 px 对 525 px，
     倾角 arctan(315/1026) = 17°）。绕 z 的正角是把 +x 抬起来，所以这里要负的。
     上一版只给了 11.5°，帽子看着是"放歪了"而不是"歪戴着"。 */
  hat.rotation.set(-0.055, 0, -0.302);

  /* ============================ 扫帚 ============================
     参考上它横在幽灵身前、略低于下摆，比幽灵还长（约 2.1 个臂展）。
     草稿那版帚穗是一个圆锥 —— 渲染出来就是一支矛。视频里帚穗是**一束独立的
     锥条**（f121 那一帧从端面看得很清楚），所以这里真的分成 14 条，
     每条的倾角/长度/粗细都给一点随机扰动，再绑两道箍。 */
  const broom = new THREE.Group();
  root.add(broom);
  const matHandle = M({ color: C.handle, roughness: 0.48, metalness: 0.02 });
  const matBristle = M({ color: C.bristle, roughness: 0.88, metalness: 0, flatShading: true });
  const matBristleLo = M({ color: C.bristleLo, roughness: 0.90, metalness: 0, flatShading: true });
  const matRibbon = M({ color: C.ribbon, roughness: 0.52, emissive: C.ribbon, emissiveIntensity: 0.14 });

  /* 扫帚横在**下摆稍下方**，不是脚底下，也不是下摆上方。
     成品图上帚柄中心线在下摆底往下 36 px（= 0.06 B），而且是斜的：
     左端高、右端（帚穗那一头）低，落差 143 px / 1350 px = 6°。
     第一版写成 `HEM - 0.32 B`，那是地板以下 1.8 个单位，渲染出来只剩一根
     从地缝里探出来的杆子；上一版又放到 `HEM + 0.10 B`，跑到下摆上面去了。 */
  const BROOM_Y = HEM + 0.15 * B;
  /* ★★ 扫帚的摆动预算（2026-10-02 用户报「那个扫把穿模了」）。
     扫帚长 2.15 B = 8.7 个单位，帚穗那一头离它自己的支点 5 个、离 `root`
     原点 5.15 个。这个长度决定了**任何**角度的摆动都会被放大成一大段弧：

       · `broomSwing` 原来是 0.90 / −0.85 / −0.95 / 0.60 rad（约 50°）——
         写在 ACTIONS 里的时候没人量过弧长，5·sin(0.9) = 3.9 个单位，
         帚穗直接甩到地板下面 4.5 个（`_shots/mv-02c.png` 里它是一根竖杆）；
       · `root` 自己的滚转（晃一晃的 `lean: 0.72`）绕的是**地板那条线**，
         扫帚离那条线 5.15，于是她的 41° 侧倾把帚穗再甩 ±2.9。

     所以下面三件事一起做，缺一件都不够：
       ① 位置挪回参考量出来的地方（见 `broom.position`）；
       ② 抬高 `BROOM_Y`，把静息那一截从地板下拿回来；
       ③ 摆动打折、并且让扫帚**部分抵消 root 的转动** —— 她是飘着的，
          道具该有惯性、自己找平，不该像焊在她身上一样跟着滚。
     三个折扣都留在这里，改一个就能整体重新配平（`tools/_broomfix.mjs`
     会把结果算出来）。 */
  const BROOM_SWING = 0.05;    // 动作给的俯仰打几折
  const BROOM_RISE = 0.10;     // 她下沉 1 个单位时，扫帚跟多少
  const BROOM_FOLLOW = 0.04;   // root 的滚转 / 前倾，扫帚跟几成（1 = 焊在身上）
  /* 扫帚的静息位姿。`update` 每帧从它出发重算 —— 见那一段。 */
  const BROOM_HOME = new THREE.Vector3(-0.29 * B, BROOM_Y, 0.62 * B);
  const _bqRoot = new THREE.Quaternion(), _bqKeep = new THREE.Quaternion();
  const _bqFix = new THREE.Quaternion(), _bEul = new THREE.Euler(), _bVec = new THREE.Vector3();
  /* ★ 长度和粗细都是量出来的，而且上一版两样都错得不轻：
     柄在成品图上从 x=0 一直伸到 x=1350 以外，**比檐宽还长**（≥ 1.32 个檐宽
     = 2.27 B），上一版只有 1.50 B；
     柄的直径从帚穗那一头的 12 px 渐变到柄尾的 35 px，换成 B 就是
     0.011 B ~ 0.030 B 的**半径** —— 上一版给了 0.038~0.050，粗了两倍半，
     画面上是一支棒球棍而不是一根帚柄。 */
  const BROOM_LEN = 2.15 * B;
  {
    /* 绕 z 转 90° 之后 +y 落在 **−x**，所以 `radiusTop` 是柄尾（装蝴蝶结、
       比较粗）那一头，`radiusBottom` 才是帚穗那一头。上一版反着写，
       柄是越往帚穗越粗的。 */
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.030 * B, 0.011 * B, BROOM_LEN, 14), matHandle);
    handle.rotation.z = Math.PI / 2;         // 沿 x 躺平
    handle.castShadow = true;
    broom.add(handle);
  }
  /* 帚穗：绕柄一圈排开的锥条，朝 **+x**（观众右侧）张开。
     参考图上帚穗那一头在右、红蝴蝶结在左（封面彩渲和 clay 视图一致），
     第一版整个装反了，渲染出来帚穗甩在画面左外。 */
  {
    const TUFTS = 14;
    const head = BROOM_LEN / 2 - 0.20 * B;   // 帚穗根部（箍的位置）
    const UP = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < TUFTS; i++) {
      const a = (i / TUFTS) * TAU + 0.4;
      /* 两层：外圈张开、内圈收拢，端面才读成一个圆束而不是一个平面。
         束长 0.36 B、半张角 0.20 rad —— 量的是参考图上那束的**端面宽度**
         （约 0.16 B），`2·len·sin(spread)` 要落在这个量级上，不然就是一柄
         甩开的拂尘。 */
      const outer = i % 2 === 0;
      const spread = (outer ? 0.20 : 0.11) + 0.03 * Math.sin(i * 2.1);
      const len = (outer ? 0.36 : 0.29) * B * (1 + 0.10 * Math.sin(i * 1.7));
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.028 * B * (outer ? 1 : 0.78), len, 5),
                               i % 3 ? matBristle : matBristleLo);
      /* 锥体默认 +y 朝上。**不能**先 `rotation.z = π/2` 再绕世界 x/y 转 ——
         锥轴这时已经躺在 x 轴上，绕 x 轴转对它来说只是自转，十四根会全挤在
         一个平面里散不开。直接把 +y 对准目标方向，一次到位。 */
      const dir = new THREE.Vector3(1, Math.sin(a) * spread, Math.cos(a) * spread).normalize();
      t.quaternion.setFromUnitVectors(UP, dir);
      // ConeGeometry 的原点在自己的中点，所以根要往回退半个长度
      t.position.set(head, 0, 0).addScaledVector(dir, len * 0.46);
      t.castShadow = true;
      broom.add(t);
    }
    for (const dx of [0.0, 0.08 * B]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * B, 0.045 * B, 0.030 * B, 14), matBristleLo);
      b.rotation.z = Math.PI / 2;
      b.position.set(head - 0.05 * B + dx, 0, 0);
      broom.add(b);
    }
  }
  /* 柄尾的红蝴蝶结：结心 + 两片叶，装在帚穗的**反**一头。
     参考上两片叶是**都朝上**、左右张成一个小 V（不是上下对开），
     每片是压扁的锥 —— 不压扁就成了箭头尾羽。
     位置按成品图量：结在距柄尾 0.57~0.72 B 处。 */
  {
    const at = -BROOM_LEN / 2 + 0.64 * B;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.036 * B, 16, 12), matRibbon);
    knot.scale.set(0.8, 1, 1);
    knot.position.set(at, 0, 0);
    broom.add(knot);
    for (const s of [-1, 1]) {
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.055 * B, 0.22 * B, 10), matRibbon);
      flag.rotation.z = s * 0.62;                    // 两片都往上，向外张成 V
      flag.position.set(at + s * 0.062 * B, 0.075 * B, 0);
      flag.scale.set(1, 1, 0.34);
      broom.add(flag);
    }
  }
  /* 参考上扫帚是斜的：帚柄一端高、帚穗一端低，而且略往镜头前伸。
     ★ 绕 z 的**负**角才是"右端低"（正角把 +x 抬起来），上一版给的是正的，
     扫帚和参考反着翘。 */
  /* x 也不是居中：成品图上帚柄左端伸到身体轴左边 1.33 B，帚穗右端只到
     0.93 B —— 整支是往左偏的，蝴蝶结因此落在身体的左前方。 */
  broom.position.copy(BROOM_HOME);
  broom.rotation.set(0, -0.24, -0.10);

  /* ============================ 光环 ============================
     一圈菲涅尔壳：只画背面，越背对镜头越亮，所以读成"描出来的边"而不是"打的灯"。
     幽灵本来就该有这一层 —— 它替掉了原来那身叶子发饰在房间里的作用，
     也是 `setRoom` 唯一能改的两样东西之一。 */
  const auraUniforms = {
    uColor: { value: new THREE.Color(0x9fe8ff) },
    /* 0.22 在霜厅那种白墙上会糊成一团雾，把轮廓吃掉；幽灵自己已经有一层
       体内青光，光环只需要勾一条边。 */
    uOpacity: { value: 0.14 },
  };
  const auraMat = new THREE.ShaderMaterial({
    uniforms: auraUniforms,
    transparent: true, depthWrite: false, side: THREE.BackSide,
    blending: THREE.NormalBlending,
    vertexShader: `
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      varying vec3 vN; varying vec3 vP;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(-vP)));
        gl_FragColor = vec4(uColor, pow(f, 2.2) * uOpacity);
      }`,
  });
  const aura = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), auraMat);
  /* 光环要罩住**最高最宽的那一件**。最高的是帽冠（最高点高出头顶 0.40 B，
     而且因为帽子歪着，那个点还横着挪出去 0.31 B），最宽的是帽檐（1.72 B）。
     按身体给的话，帽子整顶露在光环外面 —— 上一版就是这样，只罩到檐口。 */
  const AURA_H = (TOP - HEM) + 0.55 * B;      // 下摆底 -> 帽冠最高点
  aura.scale.set(BRIM_R * 1.05, AURA_H * 0.50, BRIM_R * 1.05);
  aura.position.y = HEM + AURA_H * 0.50;
  aura.renderOrder = -1;
  root.add(aura);

  /* ============================ 射线代理 ============================
     拿真网格去 raycast 是个坏靶子：薄片会被打穿，而且网格每帧都在动，
     靶子会在光标下面抖。用一个看不见的胶囊代替 —— `material.visible = false`
     只挡住渲染，raycaster 从不看那个标志。 */
  const hit = new THREE.Mesh(
    new THREE.CapsuleGeometry(ARM * 0.95, (TOP - HEM) * 0.86, 6, 16),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.y = HEM + (TOP - HEM) * 0.48;
  hit.scale.set(1, 1, 0.72);
  root.add(hit);

  /* 视线用的头部锚点：`main.js` 拿它算"她有没有看过来" */
  const head = new THREE.Group();
  head.position.y = HEM + (TOP - HEM) * 0.70;
  root.add(head);

  /* ============================ 动作 ============================
     五个动作的 key 与 main.js 的 `MOVES[].k` 一一对应，**不能改名**：
     深链 `?m=0N`、曲目表与 `GREETINGS` 都靠它。幽灵没有手脚，所以动作全部
     由**整体姿态**表达：沉、晃、转、弹、脱帽。

     ★ 通道必须是 `update` 真读的那几个。上一版这里写着 `arm` 和 `lift` ——
       `arm` 全文件没有第二处引用，`lift` 每帧被 `st.lift = damp(...)` 覆盖，
       于是"挥手"那一栏背后只剩一个 0.10 rad 的倾角：量出来整只身体只动了
       **0.023** 个单位（体高的 0.65%），点开它和没点开一样。
       往这里加通道之前，先在 `update` 里把它读出来。

     ★★ 通道有读者还不够，还得**大得看得见**。这是同一个错的下半截，而它更
       隐蔽：上面那版把通道修好之后，探针报的每个数都"活了"（晃动 0.79、
       掀帽 1.23），可用户看了一圈说"我并没有看出动作效果"。两句话都对 ——
       `update` 里的单位是**场景单位**，而画面上 1 单位 ≈ **51 px**（近景机位
       radius 25 下量：檐宽 1.72 B = 6.94 单位占 355 px）。0.3 个单位的点头
       = **15 px**，在 1180 px 的画幅里就是没有。她的身体只有 BH = 3.53 单位高，
       所以一条曲线的量级必须按"**动不到体高的十分之一就不算动作**"来给，
       大约 **≥ 0.8 单位**起步。下面每条都按这个尺子重写过一遍。

     ★★ 正弦只在**一帧**上到达极值。`sin(p·π)` 在 p=0.5 最高，到 p=0.7 就
       走了一半回来 —— 1.3s 的片子真正"看得见"的只有 0.15s。所以凡是有
       **极值**而不是**节律**的姿态（升、掀帽、转）改用 `hold()`：前 22% 上去、
       中间 56% **停在那儿**、最后 22% 回来。停住的那一段才是用户点开要看的东西，
       进出只是礼貌。只有点头、晃一晃这类"来回"的动作才继续用正弦。

     ★ 每条曲线在 p=0 与 p=1 都必须回到 0（`sin(p·2π·k)` 或 `sin(p·π)`），
       否则动作收尾那一帧会从非零值**跳**回静息，看起来像被拽了一下。
     ★ `spin` 是唯一例外：它收在 `TAU` 上，但 2π 与 0 是同一个朝向，
       所以那一跳在画面上不存在。 */
  const smooth = (t) => t * t * (3 - 2 * t);
  /* 0 起 → 1 停 → 0 落。`a` / `b` 是"上到位"与"开始回落"的位置，
     中间那 56% 是停住的。 */
  const hold = (p, a = 0.22, b = 0.78) => {
    const t = p < a ? p / a : p > b ? (1 - p) / (1 - b) : 1;
    return smooth(t < 0 ? 0 : t > 1 ? 1 : t);
  };
  /* 两端包络：开头结尾各留 r 的时间渐入渐出。振荡乘它，起手与收手就不再有
     速度突变 —— 正弦一出生就是全速，那是机器的晃，不是布的晃。 */
  const env = (p, r = 0.16) => smooth(clamp(p / r, 0, 1)) * smooth(clamp((1 - p) / r, 0, 1));
  /* 区间鼓包：a..b 升、b..c 平、c..d 降。蓄力、落地这一类"只在一段里发生"
     的节拍用它拼。 */
  const bump = (p, a, b, c, d) =>
    smooth(clamp((p - a) / (b - a), 0, 1)) * (1 - smooth(clamp((p - c) / (d - c), 0, 1)));

  /* ====== 自然的节拍（2026-10-02 用户要求「动作更自然」后整轮重写）======
     四条规矩，五条曲线都遵守：
     · 渐入渐出 —— 振荡乘 env()，没有"一出生就是全速"的起手；
     · 蓄力与过冲 —— 转身先反向拧一点、跳跃先蹲一下、掀帽先过头顶一点再落回；
       到位即停是提线木偶，过冲再安顿才是有重量的东西；
     · 衰减的重复 —— 点头两次一深一浅，均匀的重复是机器；
     · 道具迟半拍 —— 帽子和扫帚的相位比身体晚 0.3~0.55 rad，它们是被甩着的。
     ★ 峰值幅度一个没降（上一轮"看不出动作"的教训）：点头 1.05、晃 0.72、
       跳 1.65、掀帽 2.40 原样；变的是节拍，不是大小。
     ★ 所有通道 p=0 与 p=1 都归零（spin 收在 TAU），收尾帧不从非零值跳回静息。 */
  const ACTIONS = {
    /* 点头 —— 两次下潜用两个高斯：一深一浅、二沉比一沉晚且缓。均匀的两次
       是机器；真点头的第二次只有第一次的六成。帽子滞后 0.055 像被甩着跟。 */
    nod: [1.25, (p) => {
      const d1 = Math.exp(-Math.pow((p - 0.28) / 0.125, 2));
      const d2 = 0.62 * Math.exp(-Math.pow((p - 0.74) / 0.135, 2));
      const dh1 = Math.exp(-Math.pow((p - 0.335) / 0.125, 2));
      const dh2 = 0.62 * Math.exp(-Math.pow((p - 0.795) / 0.135, 2));
      const s = d1 + d2;
      return {
        rise: -1.05 * s,
        squash: -0.55 * s,
        tip: 0.16 * s,
        hatTilt: -0.42 * (dh1 + dh2),
        eyes: -0.55 * Math.min(1, s),
      };
    }],
    /* 晃一晃 —— 一个半来回（不是一整来回）：甩出去、荡回来、再回正，
     * 乘两端包络。帽子与扫帚各迟 0.55 / 0.35 rad，布停了道具还在走。 */
    wave: [1.75, (p) => {
      const e = env(p, 0.16);
      const s = Math.sin(p * TAU * 1.5);
      return {
        lean: 0.72 * s * e,
        hatTilt: -0.90 * Math.sin(p * TAU * 1.5 - 0.55) * e,
        broomSwing: 0.90 * Math.sin(p * TAU * 1.5 - 0.35) * e,
        rise: 0.20 * Math.sin(p * TAU * 3) * e,
        eyes: 0.26 * Math.abs(s) * e,
      };
    }],
    /* 转个圈 —— 蓄力-扫-过冲-安顿：起手先反向拧 0.38 rad（重心同时下沉一点），
       0.14..0.84 平滑扫过一整圈，收尾多转 0.5 再弹回停正 —— 真正的转身
       不会正好停在刻度上。上升沿用 hold 的平台，转着的时候眼睛闭上。 */
    spin: [1.55, (p) => {
      const wind = bump(p, 0.02, 0.12, 0.12, 0.22);
      const over = Math.sin(Math.PI * clamp((p - 0.84) / 0.16, 0, 1));
      return {
        spin: -0.38 * wind + TAU * smooth(clamp((p - 0.14) / 0.70, 0, 1)) + 0.50 * over,
        rise: 0.95 * hold(p, 0.22, 0.80) - 0.28 * wind,
        lean: 0.24 * Math.sin(p * TAU) * env(p, 0.14),
        hatTilt: 0.48 * Math.sin(p * TAU) * env(p, 0.14),
        broomSwing: -0.85 * Math.sin(p * TAU) * env(p, 0.14),
        eyes: -0.70 * hold(p, 0.22, 0.80),
      };
    }],
    /* 跳一跳 —— 蹲-蹬-腾空-落地-回弹：起跳前先蹲 0.30 蓄力（挤压），
       腾空拉长，落地那一压（-1.05）比起跳的蹬还重 —— 重量是落地时读出来的，
       之后一个小回弹（settle）站定。帽子在落地时被颠得前倾。 */
    jump: [1.15, (p) => {
      const crouch = bump(p, 0.00, 0.09, 0.15, 0.26);
      const flight = Math.sin(Math.PI * clamp((p - 0.22) / 0.54, 0, 1));
      const land = bump(p, 0.72, 0.80, 0.88, 0.97);
      const settle = Math.sin(Math.PI * clamp((p - 0.88) / 0.12, 0, 1));
      return {
        rise: -0.30 * crouch + 1.65 * flight - 0.14 * land + 0.10 * settle,
        squash: -0.50 * crouch + 0.85 * flight - 1.05 * land + 0.25 * settle,
        hatTilt: 0.50 * flight - 0.45 * land,
        broomSwing: -0.95 * flight,
        eyes: 0.50 * flight - 0.35 * land,
      };
    }],
    /* 掀帽 —— 掀起时先过头顶一点（过冲 +18%）再落回拿着的高度，拿住的这段
       里帽子以 0.07 的幅度轻轻晃（她端着它，不是冻结它），放回去走 w 自己
       的缓出。身体后仰与扫帚都跟着过冲一小下。 */
    salute: [1.60, (p) => {
      const w = smooth(clamp((p - 0.04) / 0.20, 0, 1)) * (1 - smooth(clamp((p - 0.78) / 0.18, 0, 1)));
      const os = Math.sin(Math.PI * clamp((p - 0.24) / 0.26, 0, 1));
      const sway = Math.sin(p * TAU * 2.2);
      return {
        hatRise: 2.40 * w * (1 + 0.18 * os) + 0.07 * w * sway,
        hatTilt: -1.15 * w * (1 + 0.14 * os) + 0.10 * w * sway,
        tip: -0.32 * w,
        rise: 0.40 * w,
        broomSwing: 0.60 * w * (1 + 0.25 * os),
        eyes: 0.35 * w,
      };
    }],
  };

  /* ====== `SING`：演唱专属动作表（2026-10-04 用户要求）======
     用户：「为演唱状态新增一套动作模组，使其在演唱过程中能呈现相应的动作表现」。

     为什么**另起一张表**而不是继续借 `ACTIONS`（上一轮的做法）：那五个是"访客
     点一下、她做一下"的**应答**，每一条都收在自己的静息里，前后各有渐入渐出。
     演唱手势是**伴唱**：它要跟乐句走、要能和上一条接着、要能压在舞上面被看见，
     而且它不是"点一下"—— 没有点击这个上下文，就没有理由收成那五个的形状。
     两条曲线本来就不是同一件事。

     ★ 但尺子是同一把（见上面 ACTIONS 那几条 ★★）：幅度按"动不到体高的十分之一
       就不算动作"给，大约 ≥0.8 单位起步；有**极值**的姿态用 `hold()` 保住平台，
       只有来回的才用正弦；每条曲线 p=0 与 p=1 都回到 0。
     ★ 五条各自**主打一个通道**，这样它们不会被互相解释成"同一个动作做大了":
       `sway` 主侧倾 · `reach` 主掀帽 · `bow` 主前倾+下沉 · `bounce` 主弹跳 ·
       `float` 主整体升起。 */
  const SING = {
    /* 随句摇 —— 一个完整来回的侧倾。跟的是**乐句的呼吸**，不是拍：正弦只有
       一个周期，2.6 秒走完，正好是"一句"的长度。帽子反相、扫帚再迟一点。
       ★ `rise` 必须**非负**（`(1−cos)/2`，两个峰分别在 p=0.25/0.75 —— 正好是
         侧倾的两个极值）。第一版给的是 `sin(p·2·TAU)`，它在 p=0.75 取 −1，于是
         最大侧倾与最大下沉同时发生，两笔账叠一起：`_singhem.mjs` 量到下摆
         离地板 −0.269。同一个形状改成只往上呼吸，同一处变成 +0.4 以上。 */
    sway: [2.60, (p) => {
      const e = env(p, 0.20);
      const s = Math.sin(p * TAU);
      return {
        lean: 0.82 * s * e,
        hatTilt: -0.44 * Math.sin(p * TAU - 0.55) * e,
        broomSwing: 0.58 * Math.sin(p * TAU - 0.35) * e,
        rise: 0.34 * (1 - Math.cos(p * TAU * 2)) * 0.5 * e,
        eyes: 0.20 * e,
      };
    }],
    /* 跟拍弹两下 —— 两段 `bump` 拼的：第一下满、第二下七成（均匀的重复是机器）。
       全在 `rise` 的正半轴上，所以不碰地板钳。 */
    bounce: [1.50, (p) => {
      const s = bump(p, 0.00, 0.10, 0.16, 0.30) + 0.72 * bump(p, 0.34, 0.44, 0.50, 0.64);
      return {
        rise: 1.10 * s,
        squash: 0.45 * s,
        tip: 0.12 * s,
        hatTilt: -0.30 * s,
        broomSwing: -0.55 * s,
        eyes: 0.35 * s,
      };
    }],
    /* 抬手（高音那一句）—— 主打 `hatRise`：帽子相对头顶升起来。`hold` 把平台
       保在 26%~72%，因为"举着"才是这一条要看的，进出只是礼貌。 */
    reach: [1.90, (p) => {
      const w = hold(p, 0.26, 0.72);
      const os = Math.sin(Math.PI * clamp((p - 0.26) / 0.34, 0, 1));
      return {
        hatRise: 1.85 * w + 0.10 * os,
        hatTilt: -0.72 * w,
        rise: 0.92 * w,
        tip: -0.28 * w,
        broomSwing: 0.70 * w,
        eyes: 0.30 * w,
      };
    }],
    /* 俯身凑句 —— 前倾是唯一主导（0.52 rad ≈ 30°，比点头的 0.16 大三倍：那是
       "回一下"，这是"凑过去"）。★ `rise` 是**正**的（+0.26），不是负的：第一版
       写成"前倾 + 下沉"（tip 0.86 / rise −0.78），`_singhem.mjs` 量到下摆离地板
       −0.814。原因不是公式不够，是**唱歌时 `bob` 自己有 ±0.385**，钳完 `sunk`
       长期停在 −0.30 —— 旋转和下沉两笔账叠在一起，地板钳只管后一笔。所以她俯身
       的时候要**微微升起来**，把那 0.30 让回去；她是飘着的，俯身不是蹲下。
       （`_hemsweep.mjs` 量过纯旋转的下沉曲线：θ=0.52 时 0.576，现公式给 0.353，
       加上让回的 0.30 正好够。） */
    swoop: [1.70, (p) => {
      const w = hold(p, 0.24, 0.70);
      return {
        tip: 0.52 * w,
        rise: 0.26 * w,
        squash: -0.22 * w,
        hatTilt: 0.42 * w,
        broomSwing: -0.36 * w,
        eyes: -0.45 * w,
      };
    }],
    /* 高音飘起 —— 主打整体 `rise`（1.35，介于跳的 1.65 与抬手的 0.92 之间），
       而且**全程不回地面**：`hold` 的平台宽到 30%~74%，读起来是"飘着唱"，
       不是"跳了一下"。眼睛瞪大，扫帚甩得比身体多。 */
    float: [2.10, (p) => {
      const w = hold(p, 0.30, 0.74);
      return {
        rise: 1.35 * w,
        squash: 0.28 * w,
        tip: -0.20 * w,
        hatRise: 0.45 * w,
        broomSwing: 0.85 * w,
        eyes: 0.45 * w,
      };
    }],
  };
  /* `st.act.name` 可能来自 `ACTIONS`（访客点的）或 `SING`（她自己起的），
     取曲线时两处都要问。 */
  const clip = (n) => ACTIONS[n] || SING[n];

  /* ====== 歌本：唱起来之后她自己做什么（2026-10-03 用户要求）======
     用户：「当演唱歌曲的时候建议让小幽灵做一些符合唱歌的动作」。在此之前唱歌只
     加了一条 `dance` 背景层（幅度刻意小于动作，见下面那条 ★）—— 那是"跟着音乐
     在动"，不是"在唱"。这里补上另一半：**她唱的时候会自己挑动作做**。

     · 用的是**演唱自己的那张表** `SING`（见上），不再是 `ACTIONS`。上一轮借的是
       应答那五个，画面上读起来还是"她抽空点了一下按钮"；这一轮换成伴唱的手势。
     · `SONGBOOK` 是**一个乐句**，不是随机取。随机让"她下一步做什么"不可复现，
       探针就没法断言，而这里要的只是"不像节拍器"—— 固定顺序 + 长短交替的间隔
       就够了。走到底回到第一个，60 秒的一首大约走一遍半。

     ★ 触发时机（2026-10-04 从"盲钟"改成"乐句边界"）：上一版是 3.2 / 4.4 **页面
       秒**的定时器，与歌**没有任何关系** —— 用户看到的是"每隔几秒抽一下"，不是
       "她在跟着唱"。现在挂在**歌曲自己的钟**上：`main.js` 把 `audioEl.currentTime`
       传进来（`pos`），`floor(pos / SING_PHRASE)` 一变就是一个乐句边界，手势只
       在边界上起。
     ★★ **整套计时都在歌曲秒里，一个钟。** 冷却也走 `dpos`（歌曲钟这一帧走了
       多少），不走 `dt` —— 第一版触发挂歌曲钟、冷却挂页面秒，于是**帧率一低
       两者就分家**：60fps 时 `SING_GAP` 是 2.4 秒，10fps 时 `dt` 被截到 0.05
       → 同一个 `SING_GAP` 变成 4.8 秒墙钟。无头下更夸张（页面钟 ≈ 0.03×墙钟），
       取证一条手势要等 100 秒。**一个模块里的时间只能有一个来源**；歌曲钟本来
       就是真实秒，缩视口只该影响清晰度，不该影响节奏。
     ★ 第一个手势**不等乐句**，只等 `SING_FIRST`：按下播放之后干等一个乐句
       （4.5 秒）正是"按了没反应"。那一下起完之后才交给乐句。
     ★ 歌曲钟不走时（没有音源、或 `currentTime` 恒为 0）整个退回 `dt`：`pos` 传 0
       时 `phrase` 记 −1，边界恒为真，于是行为就是上一版的"每隔 SING_GAP 起一个"。
       这条回退是必须的 —— 没有它，一个 404 的音源会让她整首歌都不动。
     · 间隔是**页面秒**的下限，而且从上一个动作**结束**之后起算（`st.act` 非空时
       不倒计时），所以"一个动作 + 一段呼吸"是一组，两个动作不会叠在一起。
     · `st.act.auto = true` 标出"这是她自己起的"。它有两个用处：**访客点的动作
       把舞压到 0，她自己的手势只把舞压到 `SING_DUCK`** —— 不压的话两个层叠在
       一起，`sway` 的侧倾会被舞的摇摆解释成"只是摇得更厉害"，读不出是个手势；
       压到 0 又会每几秒断一次"她在唱"这条背景层。
     · `routine` 由 `main.js` 传 `!reduce || sheSings`：即兴是**环境动作**，静着的
       页面上不该有；但**按下播放是一次明确的请求** —— 与"动作按钮是访客按名字点
       的"是同一条规矩，所以滚带时减动效也让位（见 `main.js` 那段）。
       ★ 不能只靠 `dt === 0` 挡 —— 减动效下用户点一个动作时 `dt` 会恢复，
       计时器跟着走，那一下结束的瞬间就可能把她的即兴动作放出来。
     · 唱停了回到乐句开头：下一首从头起，而不是接着上一首的第八小节。 */
  const SONGBOOK = ['sway', 'bounce', 'reach', 'sway', 'swoop', 'float', 'sway', 'bounce'];
  const SING_PHRASE = 4.5;            // 歌曲秒 / 乐句
  const SING_FIRST = 1.40;            // 歌曲秒（无歌曲钟时退化成页面秒）：第一个手势等这么久
  const SING_GAP = [2.40, 3.40];      // 两个手势之间的下限，长短交替，同一个钟
  const SING_DUCK = 0.34;             // 手势期间舞的权重（不是 0，见上）

  const st = {
    t: 0, sing: 0, hover: 0, lift: 0, aim: 0, aimX: 0, aimY: 0, beat: 0,
    sway: 0, act: null, blink: 0, nextBlink: 2.4, glow: 0, eye: 1, dance: 0,
    song: 0, songT: 0, ph: -1, pos: -1,
  };

  function update(dt, { singing = false, hovered = false, aimX = 0, aimY = 0, beat = 0, beatOn = false, routine = true, pos = 0 } = {}) {
    st.t += dt;
    st.sing = damp(st.sing, singing ? 1 : 0, 3.0, dt);
    st.hover = damp(st.hover, hovered ? 1 : 0, 9.0, dt);
    st.aim = damp(st.aim, (aimX || aimY) ? 1 : 0, 4.0, dt);
    st.aimX = damp(st.aimX, clamp(aimX, -1, 1), 5.0, dt);
    st.aimY = damp(st.aimY, clamp(aimY, -1, 1), 5.0, dt);
    st.beat = damp(st.beat, beatOn ? clamp(beat, 0, 1) : 0, 12.0, dt);

    /* 歌本调度（见 `SONGBOOK` 那一块）。写在 `o` 之前，好让这一帧起的动作从
       p = 0 开始算，而不是白等一帧。`st.sing > 0.5` 是因为"她在唱"要先成立：
       刚按下播放的头几帧 `st.sing` 还在爬，那时候起动作会抢在歌前面。
       ★ 乐句边界每帧都要更新，**不能写在 `!st.act` 里面** —— 手势正在跑的那一帧
       边界会被白白吃掉，下一次机会要再等一整个乐句。 */
    const phrase = pos > 0 ? Math.floor(pos / SING_PHRASE) : -1;
    const edge = phrase < 0 || phrase !== st.ph;
    st.ph = phrase;
    /* 歌曲钟这一帧走了多少。夹到 1 秒是防拖进度条/换曲那一跳，负的（换曲回到
       0）当 0 —— 它只用来给冷却计时，不该被一个 seek 一次冲掉。 */
    const dpos = (pos > 0 && st.pos >= 0) ? clamp(pos - st.pos, 0, 1) : 0;
    st.pos = pos;
    if (!routine || !singing) {
      st.song = 0;
      st.songT = SING_FIRST;
      st.ph = -1;
      st.pos = -1;
    } else if (!st.act && st.sing > 0.5) {
      st.songT -= pos > 0 ? dpos : dt;      // 一个钟：有歌曲钟就用它
      /* 第一个手势只看冷却（不等乐句 —— 按下播放先干等 4.5 秒就是"没反应"），
         之后每个手势都要落在乐句边界上。`edge` 在 `pos === 0` 时恒真，于是没有
         音源时自动退回"每隔 SING_GAP 起一个"。 */
      if (st.songT <= 0 && (st.song === 0 || edge)) {
        const name = SONGBOOK[st.song % SONGBOOK.length];
        st.song++;
        st.songT = SING_GAP[st.song % SING_GAP.length];
        st.act = { name, t: 0, dur: clip(name)[0], auto: true };
      }
    }

    let o = {};
    if (st.act) {
      st.act.t += dt;
      const p = clamp(st.act.t / st.act.dur, 0, 1);
      o = clip(st.act.name)[1](p) || {};
      if (p >= 1) st.act = null;
    }
    const s = st.sing, b = st.beat;

    /* 悬浮：一条极慢的正弦，唱歌时幅度变大、频率也跟着节奏走 ——
       她"唱起来"的可见证据就是这一条，`_sing.mjs` 量的也是它。 */
    const floatAmp = 0.085 + 0.20 * s;
    const floatRate = 0.90 + 0.55 * s;
    st.bob = Math.sin(st.t * floatRate) * floatAmp * (1 + 0.5 * b);
    st.lift = damp(st.lift, hovered ? 0.26 : 0, 7.0, dt);
    /* 静息 1.15 是**这里**说了算，不是材质构造时那个值 —— `update` 每帧都会
       把它覆盖掉，改构造值而忘了这里，等于没改。 */
    st.glow = damp(st.glow, 1.15 + 0.55 * s + 0.45 * b, 8.0, dt);

    /* 唱歌时的舞（2026-10-02 用户要求「放歌的时候她会做些动作，比如跳舞」）：
       随拍左右摇 + 随鼓点向上轻踢 + 随音乐轻轻拧腰，帽子反相一点、扫帚迟一拍。
       ★ 不与**访客点的**动作抢戏：那种动作在播时 dance 归零、结束再淡回来，歌停
         也一样 —— 两个过渡都走这一个阻尼，不会跳。
       ★ 她自己的手势（`auto`）**压一半而不是熄掉**（`SING_DUCK`）：熄掉的话每
         几秒断一次"她在唱"这条背景层；不压的话两个层叠在一起 —— `sway` 的侧倾
         0.82 与舞的摇摆 0.20 同相时会互相解释成"只是摇得更厉害"，手势就白做了。
         这条是 2026-10-04 补的：上一版 auto 手势期间舞是满幅的。
       ★ 幅度刻意小于动作（lean 0.20 vs 晃一晃 0.72）：舞是背景层，动作是前景层；
         频率跟节拍能量略加速（`+0.5·b`）。`st.bob` 一个字不碰 —— `_sing.mjs`
         的 idle/singing 断言量的是它，dance 不能混进去。 */
    const danceTo = !singing ? 0
      : (st.act && !st.act.auto) ? 0            // 访客点的动作：让开
        : (st.act && st.act.auto) ? SING_DUCK   // 她自己的手势：让一半
          : 1;
    st.dance = damp(st.dance, danceTo, 2.2, dt);
    const dc = st.dance;
    const ph = st.t * (2.5 + 0.5 * b);
    const dLean = dc * (0.15 * Math.sin(ph) + 0.05 * b * Math.sin(ph * 2));
    const dRise = dc * (0.14 * b + 0.045 * Math.sin(ph * 2 + 0.6));
    const dSpin = dc * 0.06 * Math.sin(ph * 0.5 + 0.35);
    const dTip = dc * 0.045 * Math.sin(ph * 2 + 0.9);
    const dHat = dc * 0.05 * Math.sin(ph + 1.5);
    const dBroom = dc * 0.12 * Math.sin(ph + 0.9);

    /* `rise` 是**有符号**的竖直偏移：跳是正、点头是负。它和 `st.lift`
       （悬浮时的抬升，被 `damp` 追着走）是两个来源，加在一起。 */
    const rise = (o.rise || 0) * (1 + 0.35 * b);

    /* 倾：整体绕 x 轴前倾，原点在下摆，所以读成"往前扑"而不是"原地转" */
    const tip = (o.tip || 0) + st.aimY * 0.10 * st.aim + Math.sin(st.t * 0.71) * 0.035 + dTip;
    /* 侧倾有**两个来源**，而且强度不一样：看向光标带来的那点（乘 0.6，
       是要"几乎看不见"的）和动作给的（原样，是要看得见的）。上一版把两者
       合在一起再乘 0.6，于是任何写进 ACTIONS 的侧倾都会被打掉四成 ——
       晃一晃要 0.40，落到画面上只剩 0.24。舞动的摇摆加在静息项这一侧。 */
    const lean = st.aimX * 0.16 * st.aim + Math.sin(st.t * 0.53) * 0.045 + dLean;
    const roll = lean * 0.6 + (o.lean || 0);
    root.rotation.set(tip, (o.spin || 0) + dSpin, roll);
    root.position.y = y;
    /* ★ 旋转必须先落地：下面两条"地板是硬的"约束都要读 `tip` / `roll`。 */

    /* ★★ 地板是硬的（一）：向下的位移不许把她送进地板。
       `tools/_hemwho.mjs` 量出静息时下摆最低点离地板只有 0.465（= `HEM_H`），
       而点头的 `rise` 是 −1.05 —— 直接平移就沉到地板下 0.577，画面上是地板把
       她的下摆切出一条光滑圆弧（静息时那条波浪边不见了），地板网格线压在白
       床单上。单通道静音实验确认 `nod` 的穿模**全部**来自 `rise`：把
       `root.rotation.z` 清零，下摆一动不动。

       ★ 不能把越界的位移"转成压缩"：`body.scale` 的原点在**下摆之下**
       （下摆局部 y = 0.465），`sy < 1` 反而把下摆推得更低 —— 越压越沉。
       唯一能抬高下摆的就是平移本身，所以这里只钳平移。

       钳成软膝而不是硬墙：越过 `SINK_LIMIT` 的部分按指数衰减，最多再越
       `SINK_SOFT`，所以没有"撞到隐形地板"的顿挫。
       **通道峰值一个没降**（见 868 行那条规矩）—— `rise` 仍然给到 −1.05，
       变的是这段位移落到哪里。 */
    const SINK_LIMIT = -0.24, SINK_SOFT = 0.06;
    const rawY = st.bob + st.lift + rise + dRise;
    const over = SINK_LIMIT - rawY;
    const sunk = over <= 0 ? rawY
      : SINK_LIMIT - SINK_SOFT * (1 - Math.exp(-over / SINK_SOFT));

    /* ★★ 地板是硬的（二）：旋转会把下摆甩下去 —— 她只能**骑上来**。
       `root` 挂在 y = FLOOR_Y 上，所以 `tip` / `lean` 绕的都是**地板那条线**，
       而她的下摆是个半径 1.20 的环、只离地 0.465。`_hemwho.mjs` 的同一个静音
       实验：把 `root.rotation.z` 清零，`wave` 的下摆立刻从 −2.059 回到 −1.232
       —— 那 0.827 全部是滚转的账，`rise` 在 `wave` 里只有 ±0.20。

       这里不能靠平移钳（钳了就是把侧倾幅度砍掉四倍，而 868 行明文要保 0.72）。
       地板不让路，那就让她**骑上去** —— 像盘子在桌沿上晃：转到多少，就把下摆
       最低点顶回地板之上，中心自然升起。`HEM_RX`/`HEM_RZ` 分开给，因为她
       宽 3.4 倍于深，前后倾和左右滚对下摆的账完全不一样。 */
    const sag = HEM_RX * Math.abs(Math.sin(roll)) + HEM_RZ * Math.abs(Math.sin(tip));
    const rideUp = Math.max(0, sag - HEM_H * Math.cos(Math.hypot(tip, roll)) + HEM_KEEP);

    /* 0.16 而不是 0.10：挤压是**形状**变化，比位移更依赖量级才看得见 ——
       在 51 px/单位下，0.10 的系数只把 sy 推 ±5%，读不出来。 */
    const squash = (o.squash || 0) * 0.16;
    body.position.y = sunk + rideUp;
    // 挤压拉伸：跳起来拉长、落地压扁，体积大体守恒
    const sy = 1 + squash, sxz = 1 - squash * 0.55;
    body.scale.set(sxz, sy, sxz);

    /* 脸跟着光标转一点点 —— 眼睛在正面，整颗头转过去比眼珠转更像"看过来" */
    face.rotation.y = st.aimX * 0.30 * st.aim;
    face.position.y = FACE_Y + body.position.y;

    /* 帽子：比身体慢一拍（只跟 0.86），像被顶在头上而不是焊在上面。
       `hatRise` 是动作额外给的**离头**量 —— 只有掀帽用得到，因为其余动作
       想让帽子跟着头走，而"帽子相对头顶升了多少"正是掀帽要表达的东西。 */
    hat.position.y = HAT_Y + body.position.y * 0.86 + (o.hatRise || 0);
    /* 系数 0.62：`hatTilt` 是"给多少度"的**意图**，这里才是度数。上一版 0.45
       让掀帽那 −1.15 只落到 −30°，比帽子的固有倾角还小，帽子看着没歪。 */
    hat.rotation.z = -0.302 + Math.sin(st.t * 0.62 + 0.9) * 0.030 + (o.hatTilt || 0) * 0.62 - dHat;
    hat.rotation.x = -0.055 + tip * 0.42;

    /* 扫帚：跟着身体浮，但相位差 0.9 —— 同相就成了同一个刚体。
       `broomSwing` 让道具参与动作：她是飘着的，道具该比身体更"飞"。
       舞动的甩动加在这里（dBroom 比身体的摇摆迟 0.9 rad）。
       ★★ 三个折扣见 `BROOM_Y` 那一块。要点是它**只跟 root 的自转**（spin），
       滚转与前倾只跟 `BROOM_FOLLOW` 那么点 —— 她滚 0.72 rad 时，帚穗在
       5.15 个单位以外，跟着滚就是上下扫 2.9 个，整支甩到地板下面。
       `_bqFix = root⁻¹ · keep` 补的正是"跟着滚的那一份"；补完之后世界朝向
       就等于 `keep`，与 `Euler` 的合成顺序无关（这里全是四元数乘法）。
       位置同一份补：世界位置 = keep · HOME + root.position。 */
    const bobY = Math.sin(st.t * floatRate + 0.9) * floatAmp * 0.42
      + rise * BROOM_RISE + dRise * 0.5;
    _bqRoot.setFromEuler(root.rotation);
    _bqKeep.setFromEuler(_bEul.set(
      root.rotation.x * BROOM_FOLLOW, root.rotation.y,
      root.rotation.z * BROOM_FOLLOW, 'XYZ'));
    _bqFix.copy(_bqRoot).invert().multiply(_bqKeep);
    broom.position.copy(BROOM_HOME).applyQuaternion(_bqFix)
      .add(_bVec.set(0, bobY, 0).applyQuaternion(_bqFix));
    broom.quaternion.setFromEuler(_bEul.set(
      0, -0.24,
      -0.10 + Math.sin(st.t * 0.5) * 0.016
      + (o.broomSwing || 0) * BROOM_SWING + dBroom, 'XYZ'));
    broom.quaternion.premultiply(_bqFix);

    /* 体内的光：随呼吸与节拍明灭。唱歌时抬一档，这是"她在唱"的第二条证据。 */
    matBody.emissiveIntensity = st.glow;

    /* 眨眼：深红的圆眼一闭就没了，所以不是把眼睛藏起来，而是压扁它。
       基准高度存在 `userData.ry` 里 —— 拿 `e.scale.y` 自己当基准的话，
       第二帧就把"已经压扁的值"又当成原值，眼睛会一路缩到看不见。 */
    st.nextBlink -= dt;
    if (st.nextBlink <= 0) { st.blink = 0.11; st.nextBlink = 2.6 + Math.random() * 3.8; }
    st.blink = Math.max(0, st.blink - dt);
    const shut = st.blink > 0 ? 0.10 : 1;
    /* 动作自带的表情拍子：下沉时眯、跃起时瞪、转圈时闭上。
       她是一张白床单站在一间白房间里，**眼睛是全身唯一有边缘的零件** ——
       同样的位移，眼睛动了就比只动身体好认一个数量级。 */
    st.eye = clamp(1 + (o.eyes || 0), 0.12, 1.70);
    for (const e of eyes) e.scale.y = e.userData.ry * shut * st.eye;

    /* 嘴：唱的时候跟着节拍开合。两段弧往里收 = 张嘴，收多少由包络决定。
       嘴挂在 `face` 下面，位置是 face 的局部坐标 —— 这里**不能**再补一次
       `face.position.y`，那会让她每浮一次嘴就多走一倍的量。 */
    const open = s * (0.25 + 0.75 * b);
    mouth.scale.set(1 + open * 0.35, 1 - open * 0.55, 1);
    matMouth.color.setHex(open > 0.4 ? 0x6d1614 : C.mouth);

    return { sing: st.sing, bob: st.bob };
  }

  return {
    root, hit, aura, materials, head, crown: hat, broom,
    get sing() { return st.sing; },
    get bob() { return st.bob; },
    ready: true,

    /* 没有 `auto` 就是"这是访客点的"：`dance` 会因此熄掉（见 `SONGBOOK` 那块），
       而歌本的倒计时也被推回一整段休息 —— 否则访客点的那一下可能刚好撞上
       即兴动作的到期时刻，自己点的动作只演了十分之一就被接走。 */
    play(name) {
      const a = ACTIONS[name];
      if (!a) return false;
      st.act = { name, t: 0, dur: a[0] };
      st.songT = SING_GAP[st.song % SING_GAP.length];
      return true;
    },
    get action() { return st.act ? st.act.name : null; },

    /* 姿态读数。`action` 只说得出**哪一段**在跑，说不出它有没有在动 ——
       而这两件事不是同一句话。本轮就是靠它抓到两个**从没被读过**的动作通道
       （`arm` 与 `lift`）："挥手"那一栏背后只有一个 0.10 rad 的倾角，
       因为 `arm` 全文件没有第二处引用、`lift` 每帧被 `damp` 覆盖掉。
       只出数字，不把任何 Object3D 递出去 —— 钩子的读者是探针，不是渲染器。 */
    pose() {
      return {
        y: body.position.y, sx: body.scale.x, sy: body.scale.y,
        tip: root.rotation.x, spin: root.rotation.y, lean: root.rotation.z,
        hatY: hat.position.y, hatZ: hat.rotation.z, hatX: hat.rotation.x,
        broomY: broom.position.y, broomZ: broom.rotation.z,
        eye: st.eye || 1,
      };
    },

    /* 房间能改的只有两样：光环的颜色/浓度，和体内青光的色偏。
       幽灵本身的白紫红不随墙纸变 —— 一个会跟着壁纸换肤的角色是色卡不是角色。 */
    setRoom(rim, rimOpacity, tint, k) {
      auraUniforms.uColor.value.lerp(rim, k);
      auraUniforms.uOpacity.value += (rimOpacity - auraUniforms.uOpacity.value) * k;
      matBody.emissive.lerp(tint, k * 0.5);
    },

    update,
  };
}
