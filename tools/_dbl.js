(async () => {
  /* 双击 = 动作从上到下一个一个往下换（用户 2026-10-03）。
     `main.js` 的 canvas `pointerup` 里那条分支被考察的就是这里。

     ★ 用真的 `pointerdown` / `pointerup` 事件对，而不是 `el.click()`：`click`
       是浏览器合成的一个独立事件，根本不经过"两次快速点击读成一个手势"那段
       代码，用它测出来的"通过"没有任何意义。
     ★ 两次点击之间必须**小于 320 ms**，那是手势窗口本身。
     ★ 轨道控制器在 pointerdown 上就会 `setPointerCapture`，而合成的 pointerId
       它不认，会直接抛 —— 先把它和 release 一起换成空函数（`_shots/_drag-cam.js`
       踩过同一个坑）。 */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const bad = [];
  const ok = (cond, msg) => { (cond ? log : bad).push(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };

  /* ★ loader 消失不等于页面落定：`pinSoon` 在第一次钉之后 700ms 还会再钉一次，
     开机上滑跑 1.2s —— 而那次重钉是一整轮真实的布局。把第一对合成点击落在那里面
     正是这支探针以前会失败的原因（见下面 `pair` 的注释）。轮询也收紧到 250ms，
     免得相位随机。 */
  for (let i = 0; i < 480; i++) {
    const l = document.getElementById('loader');
    if (l && getComputedStyle(l).opacity === '0') break;
    await sleep(250);
  }
  await sleep(1400);

  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};

  const cv = document.querySelector('canvas#gl');
  const rows = () => [...document.querySelectorAll('#ref-list .row')];
  const sel = () => rows().findIndex((b) => b.classList.contains('sel'));
  const tap = (x, y) => {
    for (const type of ['pointerdown', 'pointerup']) {
      cv.dispatchEvent(new PointerEvent(type, {
        clientX: x, clientY: y, button: 0, buttons: type === 'pointerdown' ? 1 : 0,
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }));
    }
  };
  /* 远离她，也远离任何控件：`pointerup` 里那条分支排在 `overSpirit()` **之前**，
     所以点在哪里都该生效 —— 这里点空地，顺便证明"不必正好点中她"。 */
  const X = 40, Y = 40;

  /* ★★ 一对点击，连同**它实际交付的间隔**。

     页面把双击读成 `performance.now() - lastTap < 320` —— 页面**自己的**钟，在
     处理函数里读。这支探针必须把两次点击送进那个窗口，而 `await sleep(90)` 不足
     以保证它：软件渲染下一页可以有一秒长，90ms 的计时器于是排在那帧之后才跑，
     页面就**合法地**看到 1000ms 的间隔。这是"把两个事件分派在两个不同的任务里"
     的产物 —— 真实的双击是两个排队事件、被背靠背处理，读者永远不会受它影响 ——
     但它让这支探针大约每三跑失败一次，而且总在第一对上。

     所以探针改为**为自己的间隔作保**：量出自己交付的间隔，被帧吃掉就重试。只有
     当间隔确实落在窗口内、选中项却仍然没动，那才是关于页面的一句话。重试前先等
     过窗口，免得上一次的第二击和这一次的第一击配成一对。 */
  const pair = async () => {
    for (let k = 0; k < 20; k++) {
      const before = sel();
      const t0 = performance.now();
      tap(X, Y);
      await sleep(90);
      const gap = performance.now() - t0;
      tap(X, Y);
      await sleep(900);
      if (gap < 300) return { gap, moved: sel() !== before, tries: k + 1 };
      await sleep(400);
    }
    return { gap: Infinity, moved: false, tries: 20 };
  };

  const start = sel();
  log.push(`start     selected = ${start + 1}/5`);
  const names = rows().map((b) => (b.querySelector('.rt') || {}).textContent);

  /* --- 阳性对照：单击不该动它 -------------------------------------------- */
  tap(X, Y);
  await sleep(600);
  ok(sel() === start, `a single tap leaves the selection alone (${sel() + 1}/5)`);

  /* --- 双击：往下走一个 --------------------------------------------------- */
  const walk = [];
  let retries = 0;
  for (let i = 0; i < 6; i++) {
    const r = await pair();
    retries += r.tries - 1;
    const s = sel();
    const lit = (document.querySelector('#ref-list .row.playing') || {}).textContent || null;
    walk.push(s + 1);
    const gapTxt = Number.isFinite(r.gap) ? `${r.gap.toFixed(0)}ms` : 'never inside the window';
    ok(r.moved, `double-click ${i + 1} moves the selection (gap ${gapTxt}, ${r.tries} attempt${r.tries > 1 ? 's' : ''})`);
    log.push(`dbl ${i + 1}     selected = ${s + 1}/5 (${names[s]})   playing = ${lit}`);
  }
  const expect = [];
  for (let i = 1; i <= 6; i++) expect.push(((start + i) % 5) + 1);
  ok(JSON.stringify(walk) === JSON.stringify(expect),
    `six double-clicks walk top-to-bottom and wrap: ${walk.join(' → ')} (expected ${expect.join(' → ')})`
    + (retries ? ` — ${retries} retr${retries > 1 ? 'ies' : 'y'} for a frame that ate the gap` : ''));

  /* --- 双击必须**做**出来，不只是选中 ------------------------------------ */
  const last = await pair();
  const a = window.__spirit ? window.__spirit.action : null;
  ok(a !== null, `the double-click also performs it (action = ${a}${last.tries > 1 ? `, ${last.tries} attempts` : ''})`);

  return [...log, ...bad].join('\n');
})()
