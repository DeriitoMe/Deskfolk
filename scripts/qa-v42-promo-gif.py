"""Builds docs/images/promo/deskfolk-typing.gif from qa-v42-promo-capture.cjs output.

Usage: python scripts/qa-v42-promo-gif.py .cache/promo-<time>
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

source = Path(sys.argv[1])
output = Path(__file__).resolve().parent.parent / 'docs/images/promo/deskfolk-typing.gif'
frames = sorted((source / 'gif').glob('*.png'))
timing = json.loads((source / 'gif/timing.json').read_text())
CROP = (300, 270, 730, 748)  # Same pet region as the still images.
SIZE = (360, 400)
BACKGROUND = (243, 246, 239)

def card(path):
    pet = Image.open(path).convert('RGBA').crop(CROP)
    pet = pet.resize((SIZE[0], round(SIZE[0] * pet.height / pet.width)), Image.LANCZOS)
    base = Image.new('RGBA', SIZE, BACKGROUND + (255,))
    ImageDraw.Draw(base).ellipse((70, SIZE[1] - 34, SIZE[0] - 70, SIZE[1] - 8), fill=(225, 234, 216, 255))
    base.alpha_composite(pet, (0, SIZE[1] - pet.height - 6))
    return base.convert('RGB')

images = [card(path) for path in frames]
palette = images[len(images) // 2].quantize(colors=128, method=Image.Quantize.MEDIANCUT)
images = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
durations = [max(40, b - a) for a, b in zip(timing, timing[1:])] + [70]
images[0].save(output, save_all=True, append_images=images[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(output, output.stat().st_size, len(images))
