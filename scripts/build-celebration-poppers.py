"""Create the small celebration props in Blender, then save editable source and GLB.

Run: blender --background --factory-startup --python scripts/build-celebration-poppers.py
All coordinates in this source are Blender Z-up. The exported GLB is Y-up.
"""
import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/characters/wakaba-mutsumi/celebration-20261002"
for sub in ("runtime", "source", "preview"):
    (DEST / sub).mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
scene.render.resolution_x = 640
scene.render.resolution_y = 480
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1

props = bpy.data.collections.new("Editable mini party poppers")
scene.collection.children.link(props)
preview = bpy.data.collections.new("Preview camera only / excluded from GLB")
scene.collection.children.link(preview)


def linear(value):
    return value / 12.92 if value < .04045 else ((value + .055) / 1.055) ** 2.4


def material(name, hex_color):
    values = [linear(int(hex_color[i:i+2], 16) / 255) for i in (0, 2, 4)]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*values, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (*values, 1)
    emission.inputs["Strength"].default_value = 1
    output = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    mat["runtime_note"] = "Unlit pastel material, no scene lights required"
    return mat


cream = material("Popper / warm ivory", "F5EBD5")
gold = material("Popper / soft gold rim", "D9B566")
ink = material("Popper / recessed aperture", "A98D62")
mint = material("Popper L / muted leaf green", "A7C7A0")
rose = material("Popper R / muted petal pink", "DCACB5")
white = material("Popper / tiny glint", "FFF7E8")


def link_prop(obj, root, name, mat):
    obj.name = name
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    props.objects.link(obj)
    obj.parent = root
    obj.data.materials.append(mat)
    return obj


def cylinder(root, name, radius, depth, z, mat, radius_bottom=None):
    if radius_bottom is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=depth, location=(0, 0, z))
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=radius_bottom, radius2=radius, depth=depth, location=(0, 0, z))
    obj = link_prop(bpy.context.object, root, name, mat)
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return obj


def ring(root, name, radius, thickness, z, mat):
    bpy.ops.mesh.primitive_torus_add(major_segments=32, minor_segments=8, major_radius=radius, minor_radius=thickness, location=(0, 0, z))
    obj = link_prop(bpy.context.object, root, name, mat)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def badge(root, name, z):
    # A small four-point star on the front of the wrapping, facing the viewer.
    points = [(0, .028), (.009, .009), (.026, 0), (.009, -.009), (0, -.028), (-.009, -.009), (-.026, 0), (-.009, .009)]
    verts = [(x, -.0913, z + dz) for x, dz in points]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [tuple(range(8))])
    obj = bpy.data.objects.new(name, mesh)
    props.objects.link(obj)
    obj.parent = root
    mesh.materials.append(white)
    return obj


roots = []
for side, band_mat in (("L", mint), ("R", rose)):
    root = bpy.data.objects.new("MiniPopper_" + side, None)
    root.empty_display_type = "CIRCLE"
    root.empty_display_size = .045
    props.objects.link(root)
    root["grip_origin"] = "0,0,0; runtime GLB axis +Y"
    root["aperture_local_glb"] = [0, .24, 0]
    root["diameter"] = .18
    root["length"] = .40
    root["purpose"] = "Tiny upward confetti popper for the existing character's hand"
    roots.append(root)
    cylinder(root, side + " / ivory tube", .087, .352, .024, cream)
    cylinder(root, side + " / pastel wrapper", .090, .190, .028, band_mat)
    cylinder(root, side + " / lower twist cap", .085, .040, -.140, gold)
    ring(root, side + " / base highlight", .080, .005, -.118, white)
    ring(root, side + " / wrapper hem top", .086, .003, .124, cream)
    ring(root, side + " / wrapper hem bottom", .086, .003, -.069, cream)
    cylinder(root, side + " / upper ivory neck", .083, .036, .213, cream)
    ring(root, side + " / open gold rim", .074, .009, .230, gold)
    cylinder(root, side + " / recessed inner aperture", .066, .004, .233, ink)
    badge(root, side + " / wrapping star", .028)
    # A tiny inset glint makes the gold collar read at the desktop's small size.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=1, location=(-.026, -.076, .230))
    glint = link_prop(bpy.context.object, root, side + " / rim glint", white)
    glint.scale = (.015, .004, .004)

# Runtime roots are at the grip origin, with no extra scaling or orientation.
bpy.ops.object.select_all(action="DESELECT")
for obj in props.objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = roots[0]
runtime = DEST / "runtime/mini-confetti-poppers.glb"
bpy.ops.export_scene.gltf(filepath=str(runtime), export_format="GLB", use_selection=True,
                          export_apply=True, export_yup=True, export_extras=True,
                          export_animations=False, export_cameras=False, export_lights=False)

# Blender's emission shader is exported as an emissive PBR surface. Explicitly
# mark these flat prop colors unlit so Three.js loads MeshBasicMaterial and the
# runtime can animate opacity without requiring scene lights.
blob = runtime.read_bytes()
json_size, json_kind = struct.unpack("<II", blob[12:20])
document = json.loads(blob[20:20+json_size])
for mat in document.get("materials", []):
    color = mat.pop("emissiveFactor", [1, 1, 1])
    mat["pbrMetallicRoughness"] = {"baseColorFactor": color + [1]}
    mat.setdefault("extensions", {})["KHR_materials_unlit"] = {}
document.setdefault("extensionsUsed", []).append("KHR_materials_unlit")
encoded = json.dumps(document, separators=(",", ":")).encode("utf8")
encoded += b" " * ((-len(encoded)) % 4)
remaining_chunks = blob[20+json_size:]
runtime.write_bytes(struct.pack("<III", 0x46546C67, 2, 20+len(encoded)+len(remaining_chunks)) +
                    struct.pack("<II", len(encoded), json_kind) + encoded + remaining_chunks)

# Spread the editable pair for a clean source view. Child geometry and grip
# origins are identical to the runtime export above.
roots[0].location.x = -.16
roots[1].location.x = .16
cam_data = bpy.data.cameras.new("Popper reference camera")
cam = bpy.data.objects.new("Popper reference camera", cam_data)
preview.objects.link(cam)
cam.location = (0, -1.25, .67)
direction = Vector((0, 0, .045)) - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
cam_data.type = "ORTHO"
cam_data.ortho_scale = .75
scene.camera = cam
scene["runtime_contract"] = "MiniPopper_L/R grip origin 0,0,0; GLB +Y-up, aperture y=.24, diameter=.18, length=.40"
scene["source_display"] = "Pair spread .16 units left/right for editing; export resets root translations to zero"
scene["character_source"] = "Existing character is unchanged; this source contains props only"
scene["art_palette"] = "Muted mint, petal rose, ivory, soft gold"
scene.render.filepath = str(DEST / "preview/mini-poppers.png")
bpy.ops.render.render(write_still=True)
source = DEST / "source/mini-confetti-poppers.blend"
bpy.ops.wm.save_as_mainfile(filepath=str(source))
bpy.ops.wm.open_mainfile(filepath=str(source))
props = bpy.data.collections["Editable mini party poppers"]
roots = [bpy.data.objects["MiniPopper_L"], bpy.data.objects["MiniPopper_R"]]

report = {
    "generator": "scripts/build-celebration-poppers.py",
    "blenderVersion": bpy.app.version_string,
    "source": "source/mini-confetti-poppers.blend",
    "runtime": "runtime/mini-confetti-poppers.glb",
    "roots": [o.name for o in roots],
    "rootTransformsInGLB": "identity; grip origin (0,0,0)",
    "glbAxis": "+Y",
    "diameter": .18,
    "length": .40,
    "aperture": [0, .24, 0],
    "meshCount": sum(o.type == "MESH" for o in props.objects),
    "materialCount": len(bpy.data.materials),
    "oldCharacterSourceModified": False,
    "nativeSourceSavedAndReopened": True,
    "runtimeMaterialExtension": "KHR_materials_unlit",
}
(DEST / "source/blender-props-verification.json").write_text(json.dumps(report, indent=2), encoding="utf8")
print("CELEBRATION_POPPERS_SAVED", json.dumps(report), flush=True)
