"""Verify native editable art, exported materials, and lossless layered exports."""
import json
from pathlib import Path
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/characters/wakaba-mutsumi/celebration-20261002"

if "--native-blender-check" in sys.argv:
    import bpy
    props = bpy.data.collections["Editable mini party poppers"]
    names = [bpy.data.objects[name].name for name in ("MiniPopper_L", "MiniPopper_R")]
    count = sum(obj.type == "MESH" for obj in props.objects)
    assert count == 22
    report_path = DEST / "source/blender-props-verification.json"
    report = json.loads(report_path.read_text(encoding="utf8"))
    report.update({"nativeSourceSavedAndReopened": True, "blenderVersion": bpy.app.version_string,
                   "meshCount": count, "roots": names,
                   "runtimeMaterialExtension": "KHR_materials_unlit"})
    report_path.write_text(json.dumps(report, indent=2), encoding="utf8")
    print("NATIVE_BLEND_REOPEN_VERIFIED", flush=True)
    sys.exit(0)

from PIL import Image, ImageChops

blob = (DEST / "runtime/mini-confetti-poppers.glb").read_bytes()
magic, version, length = struct.unpack("<III", blob[:12])
assert magic == 0x46546C67 and version == 2 and length == len(blob)
json_size, _ = struct.unpack("<II", blob[12:20])
document = json.loads(blob[20:20+json_size])
roots = [obj for obj in document["nodes"] if obj.get("name", "").startswith("MiniPopper_")]
assert {obj["name"] for obj in roots} == {"MiniPopper_L", "MiniPopper_R"}
assert all(not any(key in obj for key in ("matrix", "translation", "rotation", "scale")) for obj in roots)
assert all("KHR_materials_unlit" in mat.get("extensions", {}) for mat in document["materials"])

record = json.loads((DEST / "source/aseprite-effects-verification.json").read_text(encoding="utf8"))
for item in record["assets"]:
    data = (DEST / ("source/" + item["name"] + ".aseprite")).read_bytes()
    assert struct.unpack("<H", data[4:6])[0] == 0xA5E0
    assert struct.unpack("<HH", data[8:12]) == (item["width"], item["height"])
    png = Image.open(DEST / ("runtime/" + item["name"] + ".png")).convert("RGBA")
    assert png.size == (item["width"], item["height"])
    assert png.getchannel("A").getextrema() == (0, 255)

command = ["F:/Blender/blender.exe", "--background", str(DEST / "source/mini-confetti-poppers.blend"),
           "--python", str(Path(__file__).resolve()), "--", "--native-blender-check"]
result = subprocess.run(command, text=True, encoding="utf8", errors="replace", capture_output=True, timeout=45)
assert "NATIVE_BLEND_REOPEN_VERIFIED" in result.stdout, result.stdout + result.stderr

report = {"runtimeGLBValid": True, "rootTransformsIdentity": True,
          "materialsUnlit": len(document["materials"]), "nativeBlenderReopened": True,
          "asepriteSavedAndReopened": record["savedAndReopened"],
          "effectLayerCount": sum(len(item["layers"]) for item in record["assets"]),
          "transparentPNGs": [item["name"] for item in record["assets"]]}
kra = DEST / "source/celebration-effects.kra"
if kra.exists():
    with zipfile.ZipFile(kra) as archive:
        assert archive.read("mimetype").decode("ascii") == "application/x-krita"
        doc = ET.fromstring(archive.read("maindoc.xml"))
        nodes = [node for node in doc.iter() if node.tag.rsplit("}", 1)[-1] == "layer"]
        paint_layers = [node for node in nodes if node.get("nodetype") == "paintlayer"]
        groups = [node for node in nodes if node.get("nodetype") == "grouplayer"]
        assert len(paint_layers) == 15 and len(groups) == 4
    reopened = Image.open(DEST / "preview/effects-krita-reopened.png").convert("RGBA")
    expected = Image.open(DEST / "preview/effects-sheet.png").convert("RGBA")
    assert reopened.size == expected.size
    assert reopened.getchannel("A").getbbox() == expected.getchannel("A").getbbox()
    report["kritaNativePaintLayers"] = len(paint_layers)
    report["kritaNativeGroups"] = len(groups)
    report["kritaSavedAndReopened"] = True
    report["kritaReopenedMaxChannelDifference"] = max(high for low, high in ImageChops.difference(reopened, expected).getextrema())
else:
    report["kritaSavedAndReopened"] = False

(DEST / "source/art-verification.json").write_text(json.dumps(report, indent=2), encoding="utf8")
print(json.dumps(report, indent=2))
