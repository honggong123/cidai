# Before/after sheet for the broom fix.
#
#   "D:/Program Files/Python313/python.exe" tools/_ba.py
#
# Both columns come from `tools/_moves.mjs` with **identical arguments** --
# same url, same cdp port, same dpr 0.7, same viewport 1180x740, same frames.
# The only variable is the six broom numbers in `src/ghost.js` (and the
# candelabra's `stand.position`), which were temporarily reverted to their
# pre-fix values for the left column and then restored.
#
# ★ Do NOT build this sheet out of the older `_shots/mv-*.png`. Those are from
#   a different run whose camera did not match (its `mv-00-idle` is visibly
#   mid-fade), so a side-by-side made from them silently compares two cameras
#   as if it compared two code versions. That is the whole reason the left
#   column was re-shot rather than reused.
from PIL import Image, ImageDraw, ImageFont
import os

SHOTS = '_shots'
BOX = (30, 0, 630, 590)          # model half; the panel is identical in both
PAD, LABEL_H = 14, 62
BG = (24, 20, 32)
INK = (240, 236, 246)
DIM = (166, 158, 184)
BAD = (226, 106, 106)
GOOD = (118, 206, 148)

ROWS = [
    ('before-mv-00-idle.png', 'fix-mv-00-idle.png', '静息 / rest', '帚穗已在地板下 0.19'),
    ('before-mv-02c.png', 'fix-mv-02c.png', '晃一晃 · 0.82 / wave', '帚穗甩到地板下 4.5 个单位'),
]
COLS = ['修复前 / before', '修复后 / after']

font = fontS = None
for p in ('C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/msyh.ttc',
          'C:/Windows/Fonts/simhei.ttf'):
    if os.path.exists(p):
        font = ImageFont.truetype(p, 28)
        fontS = ImageFont.truetype(p, 22)
        break


def load(name):
    im = Image.open(os.path.join(SHOTS, name)).convert('RGB')
    return im.crop(BOX)


cw, ch = BOX[2] - BOX[0], BOX[3] - BOX[1]
W = PAD + 2 * cw + PAD * 2 + PAD
H = PAD + LABEL_H + 2 * (ch + LABEL_H) + PAD * 2

out = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(out)

for i, c in enumerate(COLS):
    x = PAD + i * (cw + PAD)
    d.text((x + 8, PAD + 6), c, font=font, fill=BAD if i == 0 else GOOD)

for r, (old, new, title, note) in enumerate(ROWS):
    y = PAD + LABEL_H + r * (ch + LABEL_H)
    d.text((PAD + 4, y + 4), title, font=font, fill=INK)
    d.text((PAD + 300, y + 12), note, font=fontS, fill=DIM)
    for i, name in enumerate((old, new)):
        out.paste(load(name), (PAD + i * (cw + PAD), y + LABEL_H))
        d.rectangle([PAD + i * (cw + PAD) - 1, y + LABEL_H - 1,
                     PAD + i * (cw + PAD) + cw, y + LABEL_H + ch],
                    outline=(70, 62, 92))

dest = os.path.join(SHOTS, 'compare-broom.png')
out.save(dest)
print(f'{dest}  {out.size[0]}x{out.size[1]}')
