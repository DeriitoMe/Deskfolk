"""Model the open Morning Brief newspaper for the reading action, bake its shading
into vertex colours, then save the editable source, a GLB and preview renders.

Run: blender --background --factory-startup --python scripts/build-morning-paper.py
Coordinates here are Blender Z-up with the viewer on -Y; the GLB is Y-up.

The sheet leans back so its reading side faces Mutsumi's face. The desk pet
uses an orthographic camera, so depth is carried by the shape itself: the two
pages fold into a V around the centre crease, and with the lean the top and
bottom edges read as a shallow V from the front. The printed spread is painted
at runtime and multiplied by the baked light and shadow.
"""
import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/characters/wakaba-mutsumi/newspaper-20261021"
for sub in ("runtime", "source", "preview"):
    (DEST / sub).mkdir(parents=True, exist_ok=True)

P = {
    "width": 2.1,        # open spread, edge to edge before folding
    "height": 1.45,
    "fold": .38,         # each page turns back this far (rad) from the crease
    "lean": .52,         # top leans toward the viewer so the inside faces her
    "bulge": .06,        # pages bow out between crease and edge
    "droop": .07,        # outer top corners sag under their own weight
    "belly": 0.,        # lower half bows toward the viewer, clear of the body
    "grip_v": .48,       # grip height on the side edges, 0 bottom .. 1 top
    "pages": 2,          # inner sheets peeking out behind the outer one
}
P.update(json.loads(os.environ.get("MORNING_PAPER_PARAMS", "{}")))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 64
scene.cycles.device = "CPU"
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"

COLS, ROWS = 28, 20
HALF = P["width"] / 2


def page_point(side, s, v, inset=0., depth=0., drop=0.):
    """Point on one page; s runs crease (0) to outer edge (1), v bottom (0) to top (1)."""
    r = s * (HALF - inset)
    x = side * r * math.cos(P["fold"])
    y = r * math.sin(P["fold"]) - P["bulge"] * math.sin(math.pi * s) + depth
    z = (v - P["grip_v"]) * (P["height"] - inset * 2) - drop
    # Outer corners sag; the lower half bows forward between the hands so the
    # leaning sheet clears her dress, while the bottom corners curl back a little.
    z -= P["droop"] * s * s * v ** 3
    y += .04 * s * s * (1 - v) ** 3 - P["belly"] * (1 - v) ** 2.2
    return Vector((x, y, z))


def sheet(name, inset=0., depth=0., drop=0., uv=True):
    verts, faces, uvs = [], [], []
    for side in (-1, 1):
        base = len(verts)
        for j in range(ROWS + 1):
            for i in range(COLS + 1):
                s, v = i / COLS, j / ROWS
                verts.append(page_point(side, s, v, inset, depth, drop))
                uvs.append((.5 - .5 * s if side < 0 else .5 + .5 * s, v))
        for j in range(ROWS):
            for i in range(COLS):
                a = base + j * (COLS + 1) + i
                quad = (a, a + 1, a + COLS + 2, a + COLS + 1)
                # Keep the printed outside facing the viewer (-Y) on both pages.
                faces.append(quad if side > 0 else quad[::-1])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    if uv:
        layer = mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                layer.data[li].uv = uvs[mesh.loops[li].vertex_index]
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


outer = sheet("Paper.Outer")
inner = [sheet(f"Paper.Inner{k + 1}", inset=.008 * (k + 1), depth=.02 * (k + 1), drop=.04 * (k + 1), uv=False) for k in range(P["pages"])]
paper = [outer, *inner]

# Lean the whole spread so the reading side faces up toward her eyes.
lean = Matrix.Rotation(P["lean"], 4, "X")
for obj in paper:
    obj.data.transform(lean)

white = bpy.data.materials.new("Paper")
white.use_nodes = True
bsdf = white.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = .9
for obj in paper:
    obj.data.materials.append(white)

# Soft key from the upper front-left, a weak fill and a light grey sky.
key = bpy.data.objects.new("Key", bpy.data.lights.new("Key", "SUN"))
key.data.energy, key.data.angle = 3.4, math.radians(12)
key.rotation_euler = (math.radians(58), 0, math.radians(-38))
scene.collection.objects.link(key)
world = bpy.data.worlds.new("Sky"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (.85, .86, .82, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = .35

# Bake diffuse light and shadow into a colour attribute on every sheet.
scene.render.bake.target = "VERTEX_COLORS"
for obj in paper:
    attr = obj.data.color_attributes.new("Shade", "FLOAT_COLOR", "POINT")
    obj.data.color_attributes.active_color = attr
bpy.ops.object.select_all(action="DESELECT")
for obj in paper:
    obj.select_set(True)
bpy.context.view_layer.objects.active = outer
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_selected_to_active=False)

# Remap the bake from the outer sheet's own range: the lit page stays nearly
# white, the turned-away page and the pages behind fall to about 70 %. The
# crease and the curled bottom get a little extra shade so the fold reads at
# desktop size.
values = sorted(c.color[0] for c in outer.data.color_attributes["Shade"].data)
lo, hi = values[int(len(values) * .03)], values[int(len(values) * .98)]
per_side = (ROWS + 1) * (COLS + 1)
for depth, obj in enumerate(paper):
    for k, c in enumerate(obj.data.color_attributes["Shade"].data):
        i, j = (k % per_side) % (COLS + 1), (k % per_side) // (COLS + 1)
        s, v = i / COLS, j / ROWS
        g = .68 + .32 * min(1., max(0., (c.color[0] - lo) / max(hi - lo, 1e-6))) ** .9
        g *= 1 - .2 * math.exp(-s / .07) - .08 * (1 - v) ** 4 - .07 * depth
        c.color = (g, g, g, 1)

# Grip markers on the side edges let the runtime place the sheet between the mittens.
for side, name in ((1, "Grip.L"), (-1, "Grip.R")):
    marker = bpy.data.objects.new(name, None)
    marker.location = lean @ page_point(side, 1, P["grip_v"])
    scene.collection.objects.link(marker)

# Previews: the desk pet's front view and a three-quarter view showing the fold.
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
scene.collection.objects.link(cam); scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = 720, 560
for obj in paper:
    obj.data.materials.clear()
preview = bpy.data.materials.new("Preview")
preview.use_nodes = True
nodes, links = preview.node_tree.nodes, preview.node_tree.links
for n in list(nodes):
    nodes.remove(n)
out = nodes.new("ShaderNodeOutputMaterial"); emit = nodes.new("ShaderNodeEmission"); col = nodes.new("ShaderNodeVertexColor")
col.layer_name = "Shade"; links.new(col.outputs["Color"], emit.inputs["Color"]); links.new(emit.outputs[0], out.inputs["Surface"])
for obj in paper:
    obj.data.materials.append(preview)
key.hide_render = True
target = bpy.data.objects.new("PreviewTarget", None); scene.collection.objects.link(target)
track = cam.constraints.new("TRACK_TO"); track.target = target
track.track_axis, track.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
for name, loc, ortho in (("front", (0, -8, 0), True), ("side", (8, 0, 0), True), ("three-quarter", (-4.4, -4.8, 1.6), False), ("reader", (0, 3.2, 2.6), False)):
    cam.location = loc
    cam.data.type = "ORTHO" if ortho else "PERSP"
    cam.data.ortho_scale = 3.0; cam.data.lens = 40
    scene.render.filepath = str(DEST / "preview" / f"{name}.png")
    bpy.ops.render.render(write_still=True)

# Export only the sheets and grip markers; save the editable source alongside.
for obj in paper:
    obj.data.materials.clear(); obj.data.materials.append(white)
bpy.ops.object.select_all(action="DESELECT")
for obj in scene.objects:
    obj.select_set(obj.name.startswith(("Paper.", "Grip.")))
bpy.ops.export_scene.gltf(filepath=str(DEST / "runtime" / "morning-paper.glb"), export_format="GLB", use_selection=True,
                          export_extras=False, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_cameras=False, export_lights=False, export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=str(DEST / "source" / "Morning_Paper.blend"))
(DEST / "source" / "paper-params.json").write_text(json.dumps(P, indent=2) + "\n", encoding="utf-8")
print("MORNING_PAPER_DONE", json.dumps(P))
