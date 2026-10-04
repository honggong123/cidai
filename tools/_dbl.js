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

  for (let i = 0; i < 120; i++) {
    const l = document.getElementById('loader');
    if (l && getComputedStyle(l).opacity === '0') break;
    await sleep(1000);
  }

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

  const start = sel();
  log.push(`start     selected = ${start + 1}/5`);
  const names = rows().map((b) => (b.querySelector('.rt') || {}).textContent);

  /* --- 阳性对照：单击不该动它 -------------------------------------------- */
  tap(X, Y);
  await sleep(600);
  ok(sel() === start, `a single tap leaves the selection alone (${sel() + 1}/5)`);

  /* --- 双击：往下走一个 --------------------------------------------------- */
  const walk = [];
  for (let i = 0; i < 6; i++) {
    tap(X, Y);
    await sleep(90);
    tap(X, Y);
    await sleep(900);
    const s = sel();
    const lit = (document.querySelector('#ref-list .row.playing') || {}).textContent || null;
    walk.push(s + 1);
    log.push(`dbl ${i + 1}     selected = ${s + 1}/5 (${names[s]})   playing = ${lit}`);
  }
  const expect = [];
  for (let i = 1; i <= 6; i++) expect.push(((start + i) % 5) + 1);
  ok(JSON.stringify(walk) === JSON.stringify(expect), `six double-clicks walk top-to-bottom and wrap: ${walk.join(' → ')} (expected ${expect.join(' → ')})`);

  /* --- 双击必须**做**出来，不只是选中 ------------------------------------ */
  tap(X, Y);
  await sleep(90);
  tap(X, Y);
  const a = window.__spirit ? window.__spirit.action : null;
  ok(a !== null, `the double-click also performs it (action = ${a})`);

  return [...log, ...bad].join('\n');
})()
