#!/usr/bin/env python3
"""把交付的精灵图切成真正的透明 PNG。

为什么需要这一步
----------------
`assets/spirit.png` 是**一张 JPEG**（`ff d8 ff e0 … JFIF`），不是 PNG：

    $ python tools/key-spirit.py --probe
    format JPEG   mode RGB   size 515x500
    first bytes: ff d8 ff e0 00 10 4a 46 49 46 00 01 ...

也就是说它没有 alpha 通道，而原本的透明区域被压成了**纯黑**。直接把这张图
贴成 THREE.Sprite，房间里会飘着一块黑底方板 —— 黑边不是设计，是导出时丢掉的
alpha。

做法（为什么是亮度键而不是「从边界灌水」）
------------------------------------------
从边界 flood fill 只能吃掉**与画布边缘连通**的黑，而她的叶冠、发缝、裙褶之间
有大量被主体包住的黑（本来就是"透过去的背景"）—— 那些会被留下成一粒粒黑斑。
所以用全局亮度键。它安全的前提是"主体的最暗处比背景的过渡带更亮"，这一点是
量出来的，不是猜的：

    侵蚀 1px 后，主体内部最暗像素的亮度 = 31
    背景：亮度 <10 占 6.2%，10..30 的过渡带占 3.5%
    → 阈值取 [12, 30]，主体一个像素都不会掉

颜色用 un-premultiply 还原：原图是 `rgb = 主体 × 覆盖率 + 黑 × (1−覆盖率)`，
而 three 的 NormalBlending 会再乘一次 alpha，直接用原 rgb 会在边缘压出一圈黑
边。所以过渡带里输出 `rgb / 覆盖率`，alpha 单独走。

最后按 alpha>0 的包围盒裁掉四周的黑边 —— `spirit.js` 把 `center` 设成 (0.5, 0)，
不裁的话她的脚会悬在锚点上方十几像素。

用法
----
    python tools/key-spirit.py                 # 生成 assets/spirit-cut.webp（运行时用的）
    python tools/key-spirit.py --png           # 另存一份无损 RGBA 母版（289 KB，不进仓库）
    python tools/key-spirit.py --probe         # 只打印源文件事实，不写任何文件
    python tools/key-spirit.py --preview       # 另存两张合成图供目检（浅底/深底）

为什么运行时是 WebP 而不是 PNG
-------------------------------
一个 439x475、alpha 有 19 级的 RGBA PNG 是 **289 KB**；同样内容的 WebP q88 是
**65 KB**，而 libwebp 的 alpha 通道是**逐位无损**的（实测 max delta = 0）。PNG-8
（63 KB）看着也能省，但它的调色板把 alpha 一起量化了 —— 实测边缘 0.9% 的像素
alpha 误差最大到 39，而**这个软边就是她唯一的抗锯齿**（THREE.Sprite 是透明四边形，
MSAA 管不到它的 alpha 边缘，边缘的柔度全靠贴图自己带）。所以：省体积可以，省 alpha
不行。
"""
import sys
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'assets', 'spirit.png')
OUT_PNG = os.path.join(ROOT, 'assets', 'spirit-cut.png')
OUT_WEBP = os.path.join(ROOT, 'assets', 'spirit-cut.webp')

# 量出来的：主体最暗 31，背景过渡带顶到 30 —— 两个阈值都留在带外
L0, L1 = 12, 30


def smoothstep(lo, hi, v):
    t = (v - lo) / (hi - lo)
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    return t * t * (3 - 2 * t)


def probe(im):
    print('format %s   mode %s   size %dx%d' % (im.format, im.mode, im.size[0], im.size[1]))
    raw = open(SRC, 'rb').read(12)
    print('first bytes: ' + raw.hex(' '))
    print('PNG? %s   JPEG? %s' % (raw[:8] == b'\x89PNG\r\n\x1a\n', raw[:3] == b'\xff\xd8\xff'))
    print('has alpha: %s' % ('A' in im.mode))
    px = im.convert('RGB').load()
    W, H = im.size
    lum = [[max(px[x, y]) for x in range(W)] for y in range(H)]
    bands = [(0, 10), (10, 20), (20, 30), (30, 40), (40, 60), (60, 90), (90, 150)]
    for lo, hi in bands:
        n = sum(1 for y in range(H) for x in range(W) if lo <= lum[y][x] < hi)
        print('  luma [%3d,%3d): %6d  %5.2f%%' % (lo, hi, n, 100.0 * n / (W * H)))
    # 侵蚀 1px 后主体最暗 —— 键安全的证据
    solid = [[lum[y][x] > L1 for x in range(W)] for y in range(H)]
    mn = 999
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if not solid[y][x]:
                continue
            if all(solid[y + dy][x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                mn = min(mn, lum[y][x])
    print('eroded-1px min luma of the subject: %d   (must stay above L1=%d)' % (mn, L1))


def key(im):
    im = im.convert('RGB')
    W, H = im.size
    src = im.load()
    out = Image.new('RGBA', (W, H))
    dst = out.load()
    kept = 0
    for y in range(H):
        for x in range(W):
            r, g, b = src[x, y]
            a = smoothstep(L0, L1, max(r, g, b))
            if a <= 0.0:
                dst[x, y] = (0, 0, 0, 0)
                continue
            kept += 1
            if a >= 1.0:
                dst[x, y] = (r, g, b, 255)
            else:
                # un-premultiply: the source is subject × coverage on black
                dst[x, y] = (min(255, round(r / a)), min(255, round(g / a)),
                             min(255, round(b / a)), round(a * 255))
    box = out.getbbox()
    print('opaque-ish pixels %d / %d   ink box %s' % (kept, W * H, box))
    return out.crop(box)


def main():
    im = Image.open(SRC)
    probe(im)
    if '--probe' in sys.argv:
        return
    cut = key(im)
    if '--png' in sys.argv:
        cut.save(OUT_PNG)
        print('wrote %s  %dx%d  %.1f KB' % (OUT_PNG, cut.size[0], cut.size[1],
                                            os.path.getsize(OUT_PNG) / 1024.0))
    # alpha_quality=100 is the point of choosing WebP at all: the RGB is allowed to
    # be lossy, the cut-out edge is not (see the header)
    cut.save(OUT_WEBP, quality=88, method=6, alpha_quality=100)
    print('wrote %s  %dx%d  %.1f KB' % (OUT_WEBP, cut.size[0], cut.size[1],
                                        os.path.getsize(OUT_WEBP) / 1024.0))
    if '--preview' in sys.argv:
        for name, bg in (('light', (236, 234, 228)), ('dark', (26, 26, 28))):
            plate = Image.new('RGB', cut.size, bg)
            plate.paste(cut, (0, 0), cut)
            p = os.path.join(HERE, '_key-%s.png' % name)
            plate.save(p)
            print('wrote %s' % p)


if __name__ == '__main__':
    main()
