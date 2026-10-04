/* 把 index.html + styles.css + dist/app.js 内联成单文件，便于分发与预览。
   内容与原版完全一致，只是去掉外部引用。
   用法：node tools/standalone.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');
let n = 0;

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
  n++;
  return '<style>\n' + read(href) + '\n</style>';
});

html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  n++;
  return '<script>\n' + read(src) + '\n</script>';
});

/* 图也要内联，否则"单文件"在别的目录里打开就是一张破图。素材路径是 JS 里的
   字符串字面量（`url: 'assets/xxx.webp'`），不挂在任何 src 属性上，所以这里扫
   的是整个产物里的路径，而不是某个标签。找不到的文件原样留着 —— 静默换成空图
   比 404 更难查。

   现在她完全是程序化生成的（src/ghost.js：每个面都是图元或启动时自绘的
   canvas），所以这一步扫到 0 个资源是**正常**的，不是回归。留着它是因为规则
   本身与角色无关：哪天要加回一张贴图，它得在。 */
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
};
html = html.replace(/(['"])assets\/([A-Za-z0-9._-]+)\.(png|jpe?g|webp|gif|svg)\1/g,
  (m, q, name, ext) => {
    const p = path.join(root, 'assets', `${name}.${ext}`);
    if (!fs.existsSync(p)) { console.warn(`  ! 找不到 ${p}，保留原引用`); return m; }
    n++;
    const b64 = fs.readFileSync(p).toString('base64');
    return `${q}data:${MIME[ext.toLowerCase()]};base64,${b64}${q}`;
  });

/* 文件名跟着站点走，不跟着历史走：这个产物是会被 Pages 发出去的那一份，留着
   旧名字等于在交付物上留一个已经不存在的东西。改过几次名（lux-tape → lingbao
   → nahida → ghost），每次都没有页面引用旧名，所以站内链接不会断；**但站外
   分享过的旧链接会**，那是有意为之，不是事故。 */
const out = path.join(root, 'dist', 'ghost-standalone.html');
fs.writeFileSync(out, html);
console.log(`内联 ${n} 个外部资源 → dist/ghost-standalone.html  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
