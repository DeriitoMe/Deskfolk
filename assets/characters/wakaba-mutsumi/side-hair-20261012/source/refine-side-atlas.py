from pathlib import Path
import os
PUBLIC_PROJECT_ROOT = Path(__file__).resolve().parents[5]
# Optional historical authoring input; current editable models are included.
PUBLIC_REFERENCE_ROOT = Path(os.environ.get("DESKFOLK_ART_REFERENCE_ROOT", str(PUBLIC_PROJECT_ROOT / "external-model-archive")))
import bpy,json
# Original model and atlas remain in their existing source files.
bpy.ops.wm.open_mainfile(filepath=str(PUBLIC_REFERENCE_ROOT / 'v05/Side_Hair_Texture_Source_V05.blend'),load_ui=False)
s=bpy.context.scene
s.name='Side Hair Flow 20261012'

def linear(v):
    v=v/255
    return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def rgba(rgb):return tuple(linear(x) for x in rgb)+(1,)

def flow_material(name,shadow,strength):
    m=bpy.data.materials.new(name);m.use_nodes=True
    n=m.node_tree.nodes;l=m.node_tree.links;n.clear()
    out=n.new('ShaderNodeOutputMaterial');em=n.new('ShaderNodeEmission')
    geometry=n.new('ShaderNodeNewGeometry');world=n.new('ShaderNodeSeparateXYZ');l.new(geometry.outputs['Position'],world.inputs[0])
    height=n.new('ShaderNodeMath');height.operation='DIVIDE';height.inputs[1].default_value=512;l.new(world.outputs['Y'],height.inputs[0])
    base=n.new('ShaderNodeMixRGB');base.label='Shared pale-green height gradient'
    base.inputs[1].default_value=rgba((201,223,184));base.inputs[2].default_value=rgba((211,230,199));l.new(height.outputs[0],base.inputs[0])
    uv=n.new('ShaderNodeTexCoord');axes=n.new('ShaderNodeSeparateXYZ');l.new(uv.outputs['Generated'],axes.inputs[0])
    ramp=n.new('ShaderNodeValToRGB');ramp.label='Soft width variation within editable strand'
    ramp.color_ramp.interpolation='EASE'
    entries=[(0,.25),(.22,.72),(.58,1),(.84,.72),(1,.25)]
    for i,(at,value) in enumerate(entries):
        stop=ramp.color_ramp.elements[i] if i<2 else ramp.color_ramp.elements.new(at)
        stop.position=at;stop.color=(value,value,value,1)
    l.new(axes.outputs['X'],ramp.inputs[0])
    factor=n.new('ShaderNodeMath');factor.operation='MULTIPLY';factor.inputs[1].default_value=strength;l.new(ramp.outputs[0],factor.inputs[0])
    shade=n.new('ShaderNodeMixRGB');shade.label='Sage strand shading blended into base'
    shade.inputs[2].default_value=rgba(shadow);l.new(factor.outputs[0],shade.inputs[0]);l.new(base.outputs[0],shade.inputs[1])
    l.new(shade.outputs[0],em.inputs[0]);l.new(em.outputs[0],out.inputs[0])
    return m

def object_name(o):return o.name
shadows=sorted((o for o in bpy.data.objects if o.type=='CURVE' and o.name.startswith('S0')),key=object_name)
for i,o in enumerate(shadows):
    o.data.materials.clear();o.data.materials.append(flow_material('Flow shadow '+str(i+1),(177+i%3,200+i%3,166+i%2),.82))
    o['edit_role']='Broad tapered strand shadow with continuous soft width shading'
# Two broad restrained highlights give curvature without dense line detail.
for o in bpy.data.objects:
    if o.type=='CURVE' and o.name.startswith('L0'):
        visible=o.name.startswith(('L02','L04'))
        o.hide_render=not visible;o.hide_set(not visible)
        if visible:
            o.data.materials.clear();o.data.materials.append(flow_material('Soft reflection '+o.name,(219,235,207),.45))
s.render.resolution_x=s.render.resolution_y=2048;s.render.resolution_percentage=100
s.render.image_settings.color_mode='RGB';s.render.use_stamp=False
s.render.filepath=str(PUBLIC_PROJECT_ROOT / 'assets/characters/wakaba-mutsumi/side-hair-20261012/runtime/side-hair-flow.png')
s['edit_spec']='Existing eight tapered Bezier fields; softer longitudinal shading, two low-contrast broad reflections. Original character geometry and silhouette preserved.'
for im in bpy.data.images:
    if im.source=='FILE' and im.users:im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(PUBLIC_PROJECT_ROOT / 'assets/characters/wakaba-mutsumi/side-hair-20261012/source/Side_Hair_Flow_20261012.blend'),compress=True)
bpy.ops.render.render(write_still=True)
print(json.dumps({'atlas_exported':True,'editable_shadow_curves':len(shadows)}))
