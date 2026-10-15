from pathlib import Path
import os
PUBLIC_PROJECT_ROOT = Path(__file__).resolve().parents[5]
# Optional historical authoring input; current editable models are included.
PUBLIC_REFERENCE_ROOT = Path(os.environ.get("DESKFOLK_ART_REFERENCE_ROOT", str(PUBLIC_PROJECT_ROOT / "external-model-archive")))
import bpy,json
bpy.ops.wm.open_mainfile(filepath=str(PUBLIC_PROJECT_ROOT / 'assets/characters/wakaba-mutsumi/side-hair-20261012/source/Side_Hair_Flow_20261012.blend'),load_ui=False)
s=bpy.context.scene;s.name='Side Hair Strand Definition 20261012'
sample=next(o for o in bpy.data.objects if o.type=='CURVE' and o.name.startswith('S01'))
line_mat=sample.data.materials[0].copy();line_mat.name='Sage tapered strand accents'
def linear(v):
 v=v/255
 return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
shade=next(n for n in line_mat.node_tree.nodes if n.type=='MIX_RGB' and n.label=='Sage strand shading blended into base')
shade.inputs[2].default_value=tuple(linear(v) for v in (169,191,151))+(1,)
factor=next(n for n in line_mat.node_tree.nodes if n.type=='MATH' and n.operation=='MULTIPLY')
for link in list(factor.inputs[0].links):line_mat.node_tree.links.remove(link)
factor.inputs[0].default_value=1;factor.inputs[1].default_value=.66

def accent(name,start,segments):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='2D';cu.fill_mode='BOTH';cu.resolution_u=48
 sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(segments)-1)
 anchors=[start]+[part[2] for part in segments[:-1]]
 for point,(x,y) in zip(sp.bezier_points,anchors):
  point.co=(x,512-y,0);point.handle_left_type='FREE';point.handle_right_type='FREE'
 for i,(c1,c2,end) in enumerate(segments):
  sp.bezier_points[i].handle_right=(c1[0],512-c1[1],0)
  sp.bezier_points[(i+1)%len(anchors)].handle_left=(c2[0],512-c2[1],0)
 sp.use_cyclic_u=True
 obj=bpy.data.objects.new(name,cu);s.collection.objects.link(obj);obj.location.z=.07;cu.materials.append(line_mat)
 obj['role']='Tapered sage strand separation with soft colour edges'

paths=[
 ('C01 Front crown seam',(246,81),[((233,117),(223,153),(221,177)),((218,193),(212,205),(203,217)),((214,196),(216,180),(216,169)),((220,135),(232,99),(246,81))]),
 ('C02 Temple crown seam',(289,88),[((308,114),(315,143),(316,166)),((315,190),(310,203),(299,214)),((309,191),(310,172),(308,156)),((307,129),(300,104),(289,88))]),
 ('C03 Rear crown seam',(343,114),[((355,144),(361,177),(366,196)),((368,208),(373,218),(382,226)),((368,217),(360,199),(357,184)),((354,157),(348,129),(343,114))]),
 ('C04 Front lower lock',(235,224),[((233,247),(248,267),(258,282)),((269,301),(271,317),(267,334)),((267,312),(259,294),(250,281)),((238,263),(230,241),(235,224))]),
 ('C05 Middle lower lock',(350,242),[((356,265),(353,286),(341,302)),((330,317),(318,330),(316,346)),((316,329),(325,312),(336,298)),((348,282),(352,263),(350,242))]),
 ('C06 Front tip separation',(252,331),[((252,351),(260,365),(254,383)),((249,396),(241,405),(237,418)),((239,402),(246,391),(249,378)),((254,363),(248,347),(252,331))]),
 ('C07 Middle tip separation',(326,345),[((319,365),(321,382),(335,400)),((344,412),(347,422),(345,434)),((344,419),(337,410),(327,399)),((314,382),(313,363),(326,345))]),
 ('C08 Rear tip separation',(403,292),[((396,316),(394,338),(398,355)),((405,374),(411,390),(408,406)),((406,391),(400,376),(393,358)),((389,337),(395,311),(403,292))])
]
for name,start,segments in paths:accent(name,start,segments)
s.render.use_stamp=False;s.render.resolution_x=s.render.resolution_y=2048;s.render.resolution_percentage=100
s.render.filepath=str(PUBLIC_PROJECT_ROOT / 'assets/characters/wakaba-mutsumi/side-hair-lines-20261012/runtime/side-hair-lines.png')
s['edit_spec']='Eight broad flow shadows, eight tapered sage separation accents, two gentle reflections.'
bpy.ops.wm.save_as_mainfile(filepath=str(PUBLIC_PROJECT_ROOT / 'assets/characters/wakaba-mutsumi/side-hair-lines-20261012/source/Side_Hair_Lines_20261012.blend'),compress=True)
bpy.ops.render.render(write_still=True)
print(json.dumps({'broad_shadows':8,'strand_accents':len(paths),'atlas_saved':True}))
