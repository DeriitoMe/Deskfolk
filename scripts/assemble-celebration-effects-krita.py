"""Assemble the native Aseprite layer exports into a layered OpenRaster document.

The accompanying PowerShell script opens this in Krita and saves a native .kra.
"""
import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/characters/wakaba-mutsumi/celebration-20261002"
records = json.loads((DEST / "source/aseprite-effects-verification.json").read_text(encoding="utf8"))["assets"]
placements = {"sweat-large": (18, 20), "sweat-small": (183, 61), "gentle-star": (323, 24), "confetti-strip": (408, 153)}
canvas = Image.new("RGBA", (512, 256))
for item in records:
    image = Image.open(DEST / ("runtime/" + item["name"] + ".png")).convert("RGBA")
    canvas.alpha_composite(image, placements[item["name"]])
canvas.save(DEST / "preview/effects-sheet.png")

doc = ET.Element("image", {"version": "0.0.3", "w": "512", "h": "256", "name": "Mutsumi celebration and touch effects"})
stack = ET.SubElement(doc, "stack")
path = DEST / "source/celebration-effects.ora"
with zipfile.ZipFile(path, "w") as archive:
    archive.writestr("mimetype", "image/openraster", compress_type=zipfile.ZIP_STORED)
    # OpenRaster stacks are listed top to bottom. Aseprite lists bottom to top.
    for item in reversed(records):
        group = ET.SubElement(stack, "stack", {"name": item["name"], "opacity": "1.0", "visibility": "visible", "composite-op": "svg:src-over"})
        x, y = placements[item["name"]]
        for index in reversed(range(len(item["layers"]))):
            filename = f"{item['name']}-{index+1}.png"
            src = "data/" + filename
            archive.write(DEST / ("source/layers/" + filename), src)
            ET.SubElement(group, "layer", {"name": item["layers"][index], "x": str(x), "y": str(y), "opacity": "1.0", "visibility": "visible", "composite-op": "svg:src-over", "src": src})
    archive.writestr("stack.xml", ET.tostring(doc, encoding="utf-8", xml_declaration=True))
    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG")
    archive.writestr("mergedimage.png", buffer.getvalue())
    thumb = canvas.copy()
    thumb.thumbnail((256, 256))
    buffer = io.BytesIO()
    thumb.save(buffer, format="PNG")
    archive.writestr("Thumbnails/thumbnail.png", buffer.getvalue())
print("LAYERED_OPENRASTER_READY", path)
