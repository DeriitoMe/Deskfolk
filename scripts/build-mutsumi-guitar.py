"""Model Mutsumi's pink 7-string guitar for the idle "guitar" pastime, shade it
into vertex colours, then save the editable source, a GLB and a preview.

Run: blender --background --factory-startup --python scripts/build-mutsumi-guitar.py
Coordinates: X runs from the body (butt) to the headstock, +Z is the bass
side (up when she holds it), the playing face looks toward -Y. The GLB is Y-up.

A chibi-sized super-strat after the reference: hot-pink body with a white
pearl pickguard, two black humbuckers, a black hardtail bridge and knobs, a
maple neck with dark dot inlays and a maple headstock with seven black tuners
in line. Strings are a separate object so they can shiver when plucked.
"""
import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/characters/wakaba-mutsumi/guitar-20261021"
for sub in ("runtime", "source", "preview"):
    (DEST / sub).mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"


def srgb(hex_value):
    h = hex_value.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in c]


PINK, PEARL, BLACK, MAPLE = srgb("#e8569a"), srgb("#f4f1ec"), srgb("#222226"), srgb("#e9c27c")
DOT, FRET, STRING, POLE = srgb("#2b2a2e"), srgb("#b9b6b0"), srgb("#e2dfda"), srgb("#a9a9ad")
LIGHT = Vector((-.45, -.8, .55)).normalized()
NUT_X, BRIDGE_X = .95, -.80
SCALE = NUT_X - BRIDGE_X
parts, strings = [], []


def shade(obj, colour):
    """Lambert from a soft key at the front-upper-left plus ambient, baked per corner."""
    mesh = obj.data
    attr = mesh.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    world = obj.matrix_world.to_3x3()
    for poly in mesh.polygons:
        n = (world @ poly.normal).normalized()
        k = min(1.0, .62 + .45 * max(0.0, n.dot(LIGHT)))
        for li in poly.loop_indices:
            attr.data[li].color = (colour[0] * k, colour[1] * k, colour[2] * k, 1)
    mesh.color_attributes.active_color = attr


def box(name, x0, x1, z0, z1, y0, y1, colour, into=parts):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bm.to_mesh(mesh := bpy.data.meshes.new(name)); bm.free()
    obj = bpy.data.objects.new(name, mesh); scene.collection.objects.link(obj)
    obj.matrix_world = Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ Matrix.Diagonal((abs(x1 - x0), abs(y1 - y0), abs(z1 - z0), 1))
    shade(obj, colour); into.append(obj); return obj


def cylinder(name, x, z, y_front, depth, radius, colour, axis="Y", into=parts):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=radius, radius2=radius, depth=depth)
    bm.to_mesh(mesh := bpy.data.meshes.new(name)); bm.free()
    obj = bpy.data.objects.new(name, mesh); scene.collection.objects.link(obj)
    turn = Matrix.Rotation(math.pi / 2, 4, "X") if axis == "Y" else Matrix.Identity(4)
    obj.matrix_world = Matrix.Translation((x, y_front + depth / 2, z)) @ turn
    shade(obj, colour); into.append(obj); return obj


def chaikin(points, rounds=3):
    """Corner cutting: a smooth closed outline that never overshoots its control polygon."""
    for _ in range(rounds):
        smooth = []
        for (x0, z0), (x1, z1) in zip(points, points[1:] + points[:1]):
            smooth += [(.75 * x0 + .25 * x1, .75 * z0 + .25 * z1), (.25 * x0 + .75 * x1, .25 * z0 + .75 * z1)]
        points = smooth
    return points


def outline(name, points, depth, bevel, colour, y_center):
    """Smoothed closed outline in the XZ plane, extruded along Y with rounded edges."""
    curve = bpy.data.curves.new(name, "CURVE"); curve.dimensions = "2D"
    curve.fill_mode = "BOTH"; curve.extrude = depth; curve.bevel_depth = bevel; curve.bevel_resolution = 3
    smooth = chaikin(list(points))
    spline = curve.splines.new("POLY"); spline.points.add(len(smooth) - 1); spline.use_cyclic_u = True
    for sp, (x, z) in zip(spline.points, smooth):
        sp.co = (x, z, 0, 1)
    obj = bpy.data.objects.new(name, curve); scene.collection.objects.link(obj)
    obj.matrix_world = Matrix.Translation((0, y_center, 0)) @ Matrix.Rotation(math.pi / 2, 4, "X")
    bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    shade(obj, colour); parts.append(obj); return obj


# Body: super-strat with a long bass horn, extruded and rounded.
outline("Guitar.Body", [(0.10, 0.29), (0.04, 0.35), (-0.10, 0.36), (-0.24, 0.31), (-0.42, 0.34), (-0.64, 0.40), (-0.86, 0.34),
                        (-0.98, 0.16), (-1.0, -0.02), (-0.96, -0.22), (-0.84, -0.36), (-0.64, -0.40), (-0.44, -0.35), (-0.28, -0.31),
                        (-0.14, -0.35), (-0.01, -0.34), (-0.02, -0.26), (-0.12, -0.20), (-0.20, -0.10), (-0.21, 0.0), (-0.20, 0.08),
                        (-0.10, 0.16), (0.0, 0.21)], .045, .022, PINK, 0)
outline("Guitar.Pickguard", [(-0.21, 0.06), (-0.14, 0.17), (-0.22, 0.26), (-0.42, 0.27), (-0.56, 0.14), (-0.58, -0.06),
                             (-0.50, -0.20), (-0.34, -0.24), (-0.22, -0.16), (-0.21, -0.06)], .003, 0, PEARL, -.072)
# Neck, fretboard, frets and inlays (24 frets, maple board).
box("Guitar.Neck", -0.20, NUT_X, -0.055, 0.055, -0.04, 0.01, MAPLE)
fret_x = [NUT_X - SCALE * (1 - 2 ** (-n / 12)) for n in range(25)]
board_end = fret_x[24] - .02
box("Guitar.Fretboard", board_end, NUT_X, -0.06, 0.06, -0.083, -0.04, MAPLE)
for n in range(1, 25):
    box(f"Guitar.Fret{n}", fret_x[n] - .004, fret_x[n] + .004, -0.06, 0.06, -0.089, -0.082, FRET)
for n in (3, 5, 7, 9, 15, 17, 19, 21):
    cylinder(f"Guitar.Dot{n}", (fret_x[n - 1] + fret_x[n]) / 2, 0, -0.088, .006, .013, DOT)
cylinder("Guitar.Moon", (fret_x[11] + fret_x[12]) / 2, 0, -0.088, .006, .026, DOT)
box("Guitar.Nut", NUT_X - .008, NUT_X + .008, -0.06, 0.06, -0.092, -0.04, BLACK)
# Headstock with seven in-line tuners on the bass edge.
outline("Guitar.Headstock", [(0.94, -0.055), (0.94, 0.055), (1.02, 0.10), (1.25, 0.13), (1.33, 0.10), (1.31, 0.02),
                             (1.13, -0.035), (1.02, -0.065)], .022, .008, MAPLE, -.055)
for k in range(7):
    x = 1.01 + k * .043
    cylinder(f"Guitar.TunerPost{k}", x, .085, -0.098, .03, .009, POLE)
    cylinder(f"Guitar.TunerKey{k}", x, .135, -0.078, .04, .016, BLACK, axis="Z")
# Hardware on the body.
for name, x in (("Guitar.PickupNeck", -0.40), ("Guitar.PickupBridge", -0.68)):
    box(name, x - .045, x + .045, -0.085, 0.085, -0.10, -0.07, BLACK)
    for row in (-.02, .02):
        for k in range(7):
            cylinder(f"{name}.Pole{row}{k}", x + row, -0.06 + k * .02, -0.106, .006, .006, POLE)
box("Guitar.Bridge", BRIDGE_X - .045, BRIDGE_X + .035, -0.095, 0.095, -0.10, -0.07, BLACK)
for name, x, z in (("Guitar.KnobVolume", -0.80, -0.22), ("Guitar.KnobTone", -0.64, -0.27)):
    cylinder(name, x, z, -0.115, .045, .036, BLACK)
box("Guitar.Switch", -0.72, -0.68, -0.165, -0.15, -0.13, -0.07, BLACK)
# Seven strings from the bridge to the nut, fanning slightly toward the bridge.
for k in range(7):
    u = k / 6 - .5
    z0, z1 = u * .11, u * .08
    obj = box(f"Guitar.String{k}", BRIDGE_X, NUT_X + .01, -.0028, .0028, -0.098, -0.093, STRING, into=strings)
    # Shear so each string runs from its bridge saddle to its nut slot.
    obj.matrix_world = Matrix.Translation((0, 0, (z0 + z1) / 2)) @ Matrix.Shear("XY", 4, (0, (z1 - z0) / (NUT_X - BRIDGE_X))) @ obj.matrix_world


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


guitar, string_set = join(parts, "Guitar"), join(strings, "Guitar.Strings")
# Grips: right hand rests over the strings between the pickups; left hand
# holds the neck at the fifth fret from below.
grips = {"Grip.Body": (-0.55, -0.11, -0.08), "Grip.Neck": ((fret_x[4] + fret_x[5]) / 2, -0.02, -0.07)}
for name, location in grips.items():
    marker = bpy.data.objects.new(name, None); marker.location = location; scene.collection.objects.link(marker)

# Preview: emission of the baked colours, front and three-quarter.
preview = bpy.data.materials.new("Preview"); preview.use_nodes = True
nodes, links = preview.node_tree.nodes, preview.node_tree.links
for n in list(nodes):
    nodes.remove(n)
out, emit, col = nodes.new("ShaderNodeOutputMaterial"), nodes.new("ShaderNodeEmission"), nodes.new("ShaderNodeVertexColor")
col.layer_name = "Col"; links.new(col.outputs["Color"], emit.inputs["Color"]); links.new(emit.outputs[0], out.inputs["Surface"])
for obj in (guitar, string_set):
    obj.data.materials.clear(); obj.data.materials.append(preview)
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera")); scene.collection.objects.link(cam); scene.camera = cam
target = bpy.data.objects.new("Target", None); target.location = (.15, 0, 0); scene.collection.objects.link(target)
track = cam.constraints.new("TRACK_TO"); track.target = target; track.track_axis, track.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
scene.render.resolution_x, scene.render.resolution_y = 900, 420
for name, loc, ortho in (("front", (.15, -8, 0), True), ("three-quarter", (-2.4, -3.6, 1.6), False)):
    cam.location = loc; cam.data.type = "ORTHO" if ortho else "PERSP"; cam.data.ortho_scale = 2.6; cam.data.lens = 40
    scene.render.filepath = str(DEST / "preview" / f"{name}.png")
    bpy.ops.render.render(write_still=True)

bpy.ops.object.select_all(action="DESELECT")
for obj in scene.objects:
    obj.select_set(obj.name.startswith(("Guitar", "Grip.")))
bpy.ops.export_scene.gltf(filepath=str(DEST / "runtime" / "mutsumi-guitar.glb"), export_format="GLB", use_selection=True,
                          export_extras=False, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_cameras=False, export_lights=False, export_apply=True, export_materials="NONE")
bpy.ops.wm.save_as_mainfile(filepath=str(DEST / "source" / "Mutsumi_Guitar.blend"))
print("GUITAR_DONE", json.dumps({"grips": grips, "length": 1.33 + 1.0}))
