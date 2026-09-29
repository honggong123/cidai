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

const out = path.join(root, 'dist', 'lux-tape-standalone.html');
fs.writeFileSync(out, html);
console.log(`内联 ${n} 个外部资源 → dist/lux-tape-standalone.html  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
