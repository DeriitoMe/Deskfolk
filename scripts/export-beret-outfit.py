"""Export Mutsumi's approved crimson beret outfit to the runtime GLB.

Run: blender --background assets/characters/wakaba-mutsumi/beret-outfit-20261024/source/Mutsumi_Beret_Outfit.blend --python scripts/export-beret-outfit.py

Each garment piece is written with its vertices in model space and an identity
transform; the node extra `deskfolk_parent` names the rig control it follows
(CTRL_Body, CTRL_Arm.L/R, CTRL_Foot.L/R or CTRL_Head). Colours and shading are
baked into COLOR_0. The runtime attaches each piece to its control at the rest
pose (renderer/outfit.ts).
"""
import json
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/characters/wakaba-mutsumi/beret-outfit-20261024/runtime"
DEST.mkdir(parents=True, exist_ok=True)

sources = [o for o in bpy.data.objects if o.type == 'MESH' and (o.name.startswith('Outfit.') or o.name == 'Accessory.Beret')]
if not sources: raise SystemExit('No outfit pieces in this file')
# A scene of its own holds only the export copies, so nothing else (and no
# scene-level metadata) reaches the file.
scene = bpy.data.scenes.new('RuntimeExport')
pieces = []
for src in sources:
    name = src.name; src.name = name + '.source'  # the export copy keeps the clean name
    me = src.data.copy(); me.transform(src.matrix_world)
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    ob['deskfolk_parent'] = src.parent.name
    pieces.append({'name': name, 'parent': src.parent.name, 'triangles': sum(len(p.vertices) - 2 for p in me.polygons)})
props = bpy.ops.export_scene.gltf.get_rna_type().properties
opts = dict(filepath=str(DEST / 'beret-outfit.glb'), export_format='GLB', use_active_scene=True, export_extras=True,
            export_apply=False, export_yup=True, export_materials='NONE', export_normals=False, export_texcoords=False)
if 'export_vertex_color' in props: opts['export_vertex_color'] = 'ACTIVE'
elif 'export_colors' in props: opts['export_colors'] = True
with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
    bpy.ops.export_scene.gltf(**opts)
(DEST / 'beret-outfit-pieces.json').write_text(json.dumps(pieces, indent=2), encoding='utf-8')
print('EXPORTED', len(pieces), sum(p['triangles'] for p in pieces))
