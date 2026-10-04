/* dev: 把演唱时她自己起的手势一张张拍下来，拼成一条。
 *
 *   node tools/_songstrip.mjs <url> [cdpPort] [outPrefix] [WxH] [n] [reduce]
 *
 * WHY
 * 数字说得出"`action` 从 null 变成了 sway"，说不出"看得出来"。用户这一轮的原话
 * 是"演唱时**呈现相应的动作表现**"，所以需要一条能看的证据。
 *
 * 触发与冷却靠**歌曲钟**（`audioEl.currentTime`），不靠页面钟 —— 这是这一轮改动的
 * 好处之一：慢机器上页面秒会被 `dt` 截断拖长，歌曲秒不会。
 * ★ 但**手势本身的播放仍走 `dt`（页面秒）**（`ghost.js:1162` `st.act.t += dt`），
 * 于是缩视口会把每条手势拖长，手势越长、下一次手势来得越晚。实测 420×300 下
 * `bounce`(dur 1.50 页面秒) → `reach` 隔了 **17.8 歌曲秒**，远不是 `SING_GAP`
 * 那个量级（1.50 页面秒 ÷ 0.182 比率 ≈ 8.2 墙钟秒 = 8.2 歌曲秒，再加冷却与等
 * 边界）。真机上 `dt ≈ dpos`，这个偏差看不见 —— **别拿无头的间隔去反推调度**。
 *
 * 拍法：每 0.6s 问一次 `action`，一变就抓一张（裁到角色那一块），最后横向拼条。
 */
const [url, cdpPort = '9446', prefix = '_shots/sing', size = '560x380', nMax = '5', reduce = '0'] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/_songstrip.mjs <url> [cdpPort] [outPrefix] [WxH] [n] [reduce]'); process.exit(2); }
const [W, H] = size.split('x').map(Number);

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickPage } from './_cdp.mjs';
const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const page = pickPage(list, url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
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

console.log('press play');
{
  const b = await evaluate(`(() => { const q = document.querySelector('#btn-play').getBoundingClientRect(); return { x: Math.round(q.x + q.width / 2), y: Math.round(q.y + q.height / 2) }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    await sleep(80);
  }
}

mkdirSync(dirname(prefix), { recursive: true });
const shots = [];
let last = null;
const t0 = Date.now();
while (shots.length < +nMax && (Date.now() - t0) / 1000 < 180) {
  const s = await evaluate(`({
    a: window.__spirit ? window.__spirit.action : null,
    pos: +document.querySelector('audio')?.currentTime?.toFixed(2),
  })`);
  if (s.a && s.a !== last) {
    last = s.a;
    /* 手势起点那一帧她还没动起来，往后等一点再拍 —— 曲线是渐入的。 */
    await sleep(700);
    const png = await send('Page.captureScreenshot', { format: 'png' });
    const f = `${prefix}-${String(shots.length + 1).padStart(2, '0')}-${s.a}.png`;
    writeFileSync(f, Buffer.from(png.result.data, 'base64'));
    shots.push({ a: s.a, f, pos: s.pos, wall: (Date.now() - t0) / 1000 });
    console.log(`  +${shots[0] ? ((Date.now() - t0) / 1000).toFixed(1) : '0'}s  ${s.a}  (song ${s.pos}s)  -> ${f}`);
  }
  await sleep(500);
}
console.log(`\n${shots.length} 张: ${shots.map((s) => s.a).join(' → ')}`);
ws.close();
process.exit(shots.length >= 2 ? 0 : 1);
