"""Editable rigid-part motion, expression surfaces and watering props at 30 FPS."""
import bpy,json,math
from pathlib import Path
from mathutils import Matrix,Quaternion,Vector
base=Path(__file__).resolve().parents[1]/'assets/characters/wakaba-mutsumi'
root=base/'v42-motion';data=json.loads((root/'source/motion-30fps.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(base/'v41-3d/source/Mutsumi_V41.blend'))
scene=bpy.context.scene;scene.render.fps=30;scene.render.fps_base=1
controls={o.name.replace('.',''):o for o in scene.objects if o.name.startswith('CTRL_')}
C=Matrix.Rotation(math.pi/2,4,'X')
def matrix(s):
 x,y,z,w=s['quaternion']
 return C@Matrix.LocRotScale(Vector(s['position']),Quaternion((w,x,y,z)),Vector(s.get('scale',(1,1,1))))@C.inverted()
for o in controls.values():o.matrix_parent_inverse=Matrix.Identity(4);o.rotation_mode='QUATERNION'
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(root/'source/watering-props.glb'))
props=[o for o in scene.objects if o not in before];can=bpy.data.objects['WateringCan'];can.rotation_mode='QUATERNION'
expressions=[]
for side,filename in [('R','squeeze-left.png'),('L','squeeze-right.png')]:
 bpy.data.objects['Eye.Gold.'+side].hide_render=True
 for state,png in [('Normal',root/'source/art/normal-eye.png'),('Squeeze',root/'source/art'/filename)]:
  mesh=bpy.data.meshes.new('Eye.'+state+'.'+side)
  mesh.from_pydata([(-.265,-.009,-.305),(.265,-.009,-.305),(.265,-.009,.305),(-.265,-.009,.305)],[],[(0,1,2,3)])
  uv=mesh.uv_layers.new()
  for loop,xy in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=xy
  obj=bpy.data.objects.new('Eye.'+state+'.'+side,mesh);scene.collection.objects.link(obj);obj.parent=bpy.data.objects['CTRL_Eye.'+side]
  mat=bpy.data.materials.new(obj.name+' / Krita');mat.use_nodes=True;n=mat.node_tree.nodes;n.clear();links=mat.node_tree.links
  tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(png),check_existing=True);tex.image.pack()
  emission=n.new('ShaderNodeEmission');trans=n.new('ShaderNodeBsdfTransparent');mix=n.new('ShaderNodeMixShader');out=n.new('ShaderNodeOutputMaterial')
  alpha=n.new('ShaderNodeMath');alpha.operation='MULTIPLY';alpha.inputs[1].default_value=1
  links.new(tex.outputs['Color'],emission.inputs['Color']);links.new(tex.outputs['Alpha'],alpha.inputs[0]);links.new(alpha.outputs[0],mix.inputs[0]);links.new(trans.outputs[0],mix.inputs[1]);links.new(emission.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],out.inputs[0]);mesh.materials.append(mat)
  expressions.append((obj,alpha,state))
for name,duration,start,end in data['clips']:
 scene.timeline_markers.new(name+' / 30 FPS',frame=start);scene.timeline_markers.new(name+' / end',frame=end)
for rec in data['frames']:
 frame=rec['frame'];p=rec['pose']
 for s in rec['controls']:
  o=controls[s['name']];o.matrix_basis=matrix(s);o.keyframe_insert('location',frame=frame,group='Independent parts');o.keyframe_insert('rotation_quaternion',frame=frame,group='Independent parts')
 for o,alpha,state in expressions:
  o.scale.z=max(.025,p['open']);o.keyframe_insert('scale',frame=frame,group='Continuous blink')
  alpha.inputs[1].default_value=p['squeeze'] if state=='Squeeze' else 1-p['squeeze'];alpha.inputs[1].keyframe_insert('default_value',frame=frame)
 for o in props:
  o.hide_render=p['water']<.005 or (o.name.startswith('WaterDrop_') and p['flow']<.005);o.keyframe_insert('hide_render',frame=frame)
 can.matrix_basis=matrix(rec['can']);can.keyframe_insert('location',frame=frame);can.keyframe_insert('rotation_quaternion',frame=frame)
 for name,value in p.items():controls['CTRL_Root'][name]=value;controls['CTRL_Root'].keyframe_insert(data_path='["'+name+'"]',frame=frame,group='Expression and effect weights')
scene.frame_start=1;scene.frame_end=len(data['frames']);scene.frame_set(1)
scene['clip_ranges']=json.dumps(data['clips']);scene['runtime_fps']='60; editable samples 30 FPS'
scene['motion_note']='Rear collar is the rigid suspension pivot; 4.6s cycle, efforts 1.35–1.95s and 2.03–2.63s. No mesh stretch.'
scene['effect_note']='Krita golden squeeze eyes. Work code glyphs / water flow / flowers are procedural runtime effects; complete rendered timelines are in Aseprite.'
for a in bpy.data.actions:a.name='V42 / '+a.name
for i in bpy.data.images:
 if i.source=='FILE' and i.users and not i.packed_file:i.pack()
scene.camera=bpy.data.objects['Camera.Front'];scene.render.resolution_x=scene.render.resolution_y=512;scene.render.resolution_percentage=100
target=root/'source/Mutsumi_V42_Motion.blend';bpy.ops.wm.save_as_mainfile(filepath=str(target))
report={'path':str(target),'frames':scene.frame_end,'fps':30,'controllers':list(controls),'clips':data['clips'],'expression_surfaces':[o.name for o,a,s in expressions],'packed_images':sum(bool(i.packed_file) for i in bpy.data.images),'actions':len(bpy.data.actions)}
(root/'verification/blender-motion.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print('V42_BLEND_SAVED',flush=True)
