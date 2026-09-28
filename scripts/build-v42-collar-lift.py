"""Archive the current rigid collar-lift controls in a separate editable blend."""
import bpy, json, math
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector

root = Path(__file__).resolve().parents[1] / 'assets/characters/wakaba-mutsumi/v42-motion'
dest = root / 'source/collar-lift'
data = json.loads((dest / 'motion-30fps.json').read_text(encoding='utf8'))
bpy.ops.wm.open_mainfile(filepath=str(root / 'source/Mutsumi_V42_Motion.blend'))
scene = bpy.context.scene
for obj in scene.objects:
    obj.animation_data_clear()
for mat in bpy.data.materials:
    if mat.node_tree:
        mat.node_tree.animation_data_clear()
scene.timeline_markers.clear()
controls = {o.name.replace('.', ''): o for o in scene.objects if o.name.startswith('CTRL_')}
C = Matrix.Rotation(math.pi / 2, 4, 'X')

def matrix(s):
    x, y, z, w = s['quaternion']
    return C @ Matrix.LocRotScale(Vector(s['position']), Quaternion((w, x, y, z)), Vector(s['scale'])) @ C.inverted()

for o in controls.values():
    o.matrix_parent_inverse = Matrix.Identity(4)
    o.rotation_mode = 'QUATERNION'
for o in scene.objects:
    if o.name.startswith(('Water', 'Cucumber')):
        o.hide_render = True
expressions = []
for side in ['R', 'L']:
    for state in ['Normal', 'Squeeze']:
        o = bpy.data.objects['Eye.' + state + '.' + side]
        alpha = next(n for n in o.data.materials[0].node_tree.nodes if n.type == 'MATH' and n.operation == 'MULTIPLY')
        expressions.append((o, alpha, state))
for action, duration, start, end in data['clips']:
    scene.timeline_markers.new(action + ' / 30 FPS', frame=start)
    scene.timeline_markers.new(action + ' / end', frame=end)
for rec in data['frames']:
    frame, p = rec['frame'], rec['pose']
    for s in rec['controls']:
        o = controls[s['name']]
        o.matrix_basis = matrix(s)
        o.keyframe_insert('location', frame=frame, group='Rigid collar suspension')
        o.keyframe_insert('rotation_quaternion', frame=frame, group='Rigid collar suspension')
    for o, alpha, state in expressions:
        o.scale.z = max(.025, p['open'])
        o.keyframe_insert('scale', frame=frame, group='Eye opening')
        alpha.inputs[1].default_value = p['squeeze'] if state == 'Squeeze' else 1-p['squeeze']
        alpha.inputs[1].keyframe_insert('default_value', frame=frame)
    for name, value in p.items():
        controls['CTRL_Root'][name] = value
        controls['CTRL_Root'].keyframe_insert(data_path='["' + name + '"]', frame=frame, group='Pose weights')
scene.render.fps = 30
scene.render.fps_base = 1
scene.frame_start = 1
scene.frame_end = len(data['frames'])
scene.frame_set(25)
scene.camera = bpy.data.objects['Camera.Front']
scene['clip_ranges'] = json.dumps(data['clips'])
scene['motion_note'] = 'Upper-back suspension, frontal view, forward torso pitch and head nod. 4.6s struggle loop retained.'
scene['runtime_fps'] = '60; editable samples 30 FPS'
for image in bpy.data.images:
    if image.source == 'FILE' and image.users and not image.packed_file:
        image.pack()
target = dest / 'Mutsumi_V42_CollarLift.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(target))
(dest / 'blender-verification.json').write_text(json.dumps({
    'path': str(target), 'fps': 30, 'frames': scene.frame_end,
    'controllers': list(controls), 'rigid': all(all(abs(s-1) < 1e-5 for s in o.scale) for o in controls.values()),
    'originalSourcePreserved': str(root / 'source/Mutsumi_V42_Motion.blend')
}, ensure_ascii=False, indent=2), encoding='utf8')
print('COLLAR_BLEND_SAVED', flush=True)
