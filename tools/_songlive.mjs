/* dev: 在**真实窗口尺寸**下看她的演唱即兴，时间轴按**页面秒**（不是墙钟）。
 *
 *   node tools/_songlive.mjs <url> [cdpPort] [pageSec] [reduce] [WxH]
 *
 * WHY
 * `_song.mjs` 用 300×200 换速度，它自己那条注释说得很清楚：`dt` 截到 1/20，
 * 页面钟 = fps × 0.05，**折算率还不是常数**。于是它只能断言"顺序与出现"，
 * 说不出"第一个动作离按下播放有多远"。
 *
 * 这条探针补的正是那一问，办法是**在页面里复刻同一个钟**：注入一条 rAF 累加
 * `min(realDt, 1/20)` —— 与 `main.js:3291` 逐字同式 —— 于是无论视口多大、
 * 帧率多低，都能按"页面秒"给窗口。★ 这一点不是洁癖：第一版按墙钟给 45s，
 * 在 1180×740 下报 0 个动作，而同一个页面在 300×200 下 25 秒就出动作 ——
 * 那不是产品坏了，是**大视口的页面钟只走了 2 页面秒**，连 `SING_GAP[0]`=2.40
 * 都还没到。按墙钟量慢机器，得到的永远是假阴性。
 *
 * `reduce` 传 1 把 `prefers-reduced-motion` 模拟成 `reduce`。**改之前** `main.js`
 * 里是 `routine: !reduce`，且那条分支下 `dt` 被喂 0 —— 歌本整个不跑，`bob` 也是
 * 0，这就是"演唱时什么都不动"最像的成因。**现在**是 `routine: !reduce || sheSings`，
 * `dt` 只在 `reduce && !spirit.action && !sheSings` 时喂 0，所以 `reduce` 下她照旧
 * 起手势。这条探针的价值就在于把两档都跑一遍、都必须 PASS。
 */
const [url, cdpPort = '9446', pageSec = '16', reduce = '0', size = '1180x740'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_songlive.mjs <url> [cdpPort] [pageSec] [reduce] [WxH]'); process.exit(2); }
const [W, H] = size.split('x').map(Number);

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
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }).then((r) => r.result?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: +reduce ? 'reduce' : 'no-preference' }],
});
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
for (let i = 0, ok = false; i < 120 && !ok; i++) {
  await sleep(1000);
  ok = await evaluate(`(() => { const l = document.getElementById('loader'); return !!l && getComputedStyle(l).opacity === '0'; })()`).catch(() => false);
}
await sleep(3000);

/* 复刻 main.js:3291 的那个钟。注入之后 `__clk.t` 就是页面自己的秒数。 */
await evaluate(`(() => {
  if (window.__clk) return 'exists';
  window.__clk = { t: 0, n: 0 };
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    window.__clk.t += Math.min((now - last) / 1000, 1 / 20);
    last = now; window.__clk.n++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 'ok';
})()`);

console.log(`${W}x${H}  prefers-reduced-motion=${+reduce ? 'reduce' : 'no-preference'}  ` +
  `budget=${pageSec} page s`);
/* ★ 别在这里印 `routine`：页面里没有那个值可以读（它是 `main.js` 现算的
   `!reduce || sheSings`），印媒体查询的取反只会得出"reduce 时 routine=false"
   这种**改了以后就不成立**的结论。要判减动效下有没有动，看 `bob range` 与手势。 */

const sample = () => evaluate(`({
  a: window.__spirit ? window.__spirit.action : null,
  sing: window.__spirit ? +window.__spirit.sing.toFixed(2) : null,
  bob: window.__spirit ? +window.__spirit.bob.toFixed(3) : null,
  pt: window.__clk ? +window.__clk.t.toFixed(2) : null,
})`);

console.log('press play');
{
  const b = await evaluate(`(() => { const q = document.querySelector('#btn-play').getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    await sleep(80);
  }
}
const pt0 = (await sample()).pt ?? 0;

let last = null, seq = [], bobLo = 1e9, bobHi = -1e9, n = 0, pt = pt0;
const t0 = Date.now();
while (pt - pt0 < +pageSec && (Date.now() - t0) / 1000 < 900) {
  const s = await sample();
  n++;
  pt = s.pt ?? pt;
  if (s.bob !== null) { bobLo = Math.min(bobLo, s.bob); bobHi = Math.max(bobHi, s.bob); }
  if (s.a !== last) {
    last = s.a;
    if (s.a) {
      seq.push(s.a);
      console.log(`  +${(pt - pt0).toFixed(2).padStart(6)} page s  action=${s.a}  sing=${s.sing}`);
    }
  }
  await sleep(200);
}
const wall = (Date.now() - t0) / 1000;
const distinct = [...new Set(seq)];
console.log(`  ${n} samples over ${(pt - pt0).toFixed(2)} page s = ${wall.toFixed(1)} wall s ` +
  `(clock rate ${((pt - pt0) / wall).toFixed(3)} page s / wall s)`);
console.log(`  ${seq.length} gesture(s): ${seq.join(' → ') || '(none)'}`);
console.log(`  bob range ${(bobHi - bobLo).toFixed(3)}  (idle ≈ 0.17 · singing ≈ 0.57+)`);
console.log(distinct.length >= 2
  ? `PASS  ${distinct.length} distinct gestures while singing`
  : `FAIL  ${distinct.length} distinct gesture(s) — she never picked one of her own`);
if (problems.length) console.log('page errors:\n  ' + problems.join('\n  '));
ws.close();
process.exit(problems.length ? 1 : 0);
