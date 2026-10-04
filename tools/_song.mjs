/* dev: does she do anything of her own while she sings?
 *
 *   node tools/_song.mjs <url> [cdpPort] [dpr] [idleSec] [maxSec]
 *
 * WHY
 * 用户 2026-10-03：「当演唱歌曲的时候建议让小幽灵做一些符合唱歌的动作」。
 * 在这之前她唱歌时只有一条 `dance` 背景层 —— 那是"跟着音乐在动"，不是"在唱"。
 * 现在 `ghost.js` 里有一本 `SONGBOOK`：唱起来之后，她自己挑一个 `SING`/`ACTIONS`
 * 里的动作做（`st.act.auto = true`）。**时机挂在歌曲钟上** —— `main.js` 把
 * `audioEl.currentTime` 当 `pos` 传进来，`floor(pos / SING_PHRASE)` 一变就是一个
 * 乐句边界（`SING_PHRASE = 4.5` 歌曲秒），第一个手势只等 `SING_FIRST = 1.40`，
 * 冷却 `SING_GAP = [2.40, 3.40]`。触发与冷却**都走 `dpos`（歌曲钟这一帧走了多少），
 * 一个钟** —— 上一版触发挂歌曲钟、冷却挂页面秒，帧率一低两者就分家。
 *
 * 这条探针只问一个能被证伪的问题：**在 transport 滚动的那段时间里，`action`
 * 会不会自己从 null 变成至少两个不同的值**。阴性对照是反过来的那一半 ——
 * 不唱的时候它必须一直是 null。
 *
 * ★ 这条探针按**墙钟**给窗口（`Date.now()`），所以它只断言**顺序与出现**，不断言
 * 时刻。要精确到"第几秒起第一个手势"用 `_songlive.mjs` —— 那条在页面里注入
 * `window.__clk` 复刻页面钟，按页面秒给窗口。
 * ★ 为什么墙钟够用：触发与冷却都走歌曲钟（`pos = audioEl.currentTime`），而
 * 无头下音频常常不起（autoplay/无声卡）→ `pos` 不动、`edge` 恒真 → 退回 `dt`
 * 那一路，也就是**页面钟 = fps × 0.05**（`dt` 截到 1/20 s）。在 300×200（实测
 * 2.37 fps）下它走 0.118 页面秒/墙钟秒，一个 `SING_GAP`（2.40 页面秒）就是
 * ~20 秒墙钟。窗口给短了，看到的"她什么都没做"只是"还没走到第一个间隔"。
 * ★ 那个折算率**不是常数**：`watchPerf` 每 2.5 秒调一次画质，帧率会随画质降
 * 下来而上升，于是同一段墙钟里页面秒越走越快。所以别拿它反推"她应该在第几秒
 * 起动作"—— 会得到第二个假阴性。
 * ★ 缩视口是这里唯一能买到速度的东西（见 MEMORY.md 的帧率表）：采样用小尺寸，
 * **按播放按钮要用布局安全的大尺寸**（`_singtrace.mjs` 的同一套）。
 * ★ 阴性对照的窗口也必须长过一个 `SING_GAP`，否则它证明不了任何事：一个
 * 3 页面秒的窗口连"她该不该起动作"都还没走到。
 */
const [url, cdpPort = '9446', dpr = '1', idleSec = '40', maxSec = '240'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_song.mjs <url> [cdpPort] [dpr] [idleSec] [maxSec]'); process.exit(2); }

import { pickPage } from './_cdp.mjs';
const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const page = pickPage(list, url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    problems.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    problems.push(m.params.args.map((a) => a.description || a.value).join(' '));
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  const guard = setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out`)); } }, 300000);
  guard.unref?.();
  pending.set(n, { resolve: (v) => { clearTimeout(guard); resolve(v); }, reject: (e) => { clearTimeout(guard); reject(e); } });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }).then((r) => r.result?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const small = () => send('Emulation.setDeviceMetricsOverride', { width: 300, height: 200, deviceScaleFactor: +dpr, mobile: false });
const big = () => send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 740, deviceScaleFactor: +dpr, mobile: false });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url });
for (let i = 0, ok = false; i < 120 && !ok; i++) {
  await sleep(1000);
  ok = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
await sleep(3000);

const sample = () => evaluate(`({
  a: window.__spirit ? window.__spirit.action : null,
  sing: window.__spirit ? +window.__spirit.sing.toFixed(2) : null,
  playing: document.body.classList.contains('playing'),
})`);

/* ---------- negative control: she is not singing, so she must be still ----- */
console.log(`1. not singing, ${idleSec}s of wall time (≈ ${(+idleSec * 0.118).toFixed(1)} page seconds)`);
await small();
{
  const t0 = Date.now();
  const seen = [];
  let n = 0;
  while ((Date.now() - t0) / 1000 < +idleSec) {
    const s = await sample();
    n++;
    if (s.a) seen.push(s.a);
    await sleep(1500);
  }
  const idleOk = seen.length === 0;
  console.log(`  action non-null in ${seen.length}/${n} samples${seen.length ? ' → ' + [...new Set(seen)].join(', ') : ''}   ${idleOk ? 'ok' : 'FAIL'}`);
  if (!idleOk) console.log('  ⚠ she improvised while the transport was stopped — the routine is not gated on singing');
}

/* ---------- press play at the layout-safe size ---------------------------- */
console.log('2. press play');
await big();
{
  const b = await evaluate(`(() => { const q = document.querySelector('#btn-play').getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    await sleep(80);
  }
  await sleep(3000);
  console.log('  ' + JSON.stringify(await sample()));
}

/* ---------- she sings, so the songbook has to start moving ---------------- */
console.log(`3. singing, up to ${maxSec}s of wall time`);
await small();
{
  const t0 = Date.now();
  const seq = [];
  let last = null;
  while ((Date.now() - t0) / 1000 < +maxSec) {
    const s = await sample();
    if (s.a !== last) {
      last = s.a;
      if (s.a) {
        seq.push(s.a);
        console.log(`  +${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s  action=${s.a}   sing=${s.sing}`);
      }
    }
    if (seq.length >= 2) break;
    await sleep(1200);
  }
  await big();
  const distinct = [...new Set(seq)];
  const ok = distinct.length >= 2;
  console.log(`  songbook  ${seq.length} gesture(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${seq.join(' → ') || '(none)'}   ${ok ? 'ok' : 'FAIL'}`);
  console.log(ok
    ? 'PASS  she is still until the transport rolls, then picks her own actions while she sings'
    : 'FAIL  the transport rolled and she never picked an action of her own');
}

if (problems.length) console.log('page errors:\n  ' + problems.join('\n  '));
ws.close();
process.exit(problems.length ? 1 : 0);
