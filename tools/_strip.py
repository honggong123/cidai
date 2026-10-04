# Build the five-pose contact sheet used in the hand-off note.
#
#   "D:/Program Files/Python313/python.exe" tools/_strip.py
#
# Sources are the mid-clip frames `tools/_moves.mjs` photographs (0.58 of each
# clip, the point where the pose is at its extreme). Only the model half of the
# page is kept: the panel is the same in all five and would just be five copies
# of the same column, while the whole point of the sheet is what *she* does.
from PIL import Image, ImageDraw, ImageFont
import os

SHOTS = '_shots'
# Wide enough for the widest pose, not just the rest pose: 05 doffs the hat
# 1.23 units up and 03 swings the broom out, so a box fitted to her standing
# still clips both.
BOX = (40, 0, 640, 580)           # model + broom + aura, panel excluded
PANEL = 480, 464
PAD, LABEL_H = 16, 78

MOVES = [
    ('mv-01b.png', '01  点头', 'Nod', '整只下沉两次，帽子反向迟滞'),
    ('mv-02b.png', '02  晃一晃', 'Sway', '以地板为轴左右摆，扫帚同向甩'),
    ('mv-03b.png', '03  转个圈', 'Twirl', '绕竖直轴一整圈，帽子扫帚甩出'),
    ('mv-04b.png', '04  跳一跳', 'Hop', '升起 + 体积守恒的挤压拉伸'),
    ('mv-05b.png', '05  掀帽', 'Tip the hat', '帽子离头升起并倒向一侧'),
]

BG = (26, 22, 36)
INK = (240, 236, 246)
DIM = (168, 160, 186)
ACC = (214, 178, 106)

font = None
for p in ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc',
          'C:/Windows/Fonts/simhei.ttf'):
    if os.path.exists(p):
        font = ImageFont.truetype(p, 26)
        fontS = ImageFont.truetype(p, 20)
        break
if font is None:
    font = fontS = ImageFont.load_default()

W = PAD + len(MOVES) * (PANEL[0] + PAD)
H = PAD + PANEL[1] + LABEL_H + PAD
sheet = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(sheet)

for i, (fn, cn, en, note) in enumerate(MOVES):
    src = Image.open(os.path.join(SHOTS, fn)).convert('RGB').crop(BOX)
    src = src.resize(PANEL, Image.LANCZOS)
    x = PAD + i * (PANEL[0] + PAD)
    sheet.paste(src, (x, PAD))
    d.rectangle([x, PAD, x + PANEL[0] - 1, PAD + PANEL[1] - 1], outline=(70, 62, 92))
    ty = PAD + PANEL[1] + 10
    d.text((x + 2, ty), cn, font=font, fill=INK)
    d.text((x + 2, ty + 34), f'{en} · {note}', font=fontS, fill=DIM)

out = os.path.join(SHOTS, 'moves-strip.png')
sheet.save(out)
print(out, sheet.size)
