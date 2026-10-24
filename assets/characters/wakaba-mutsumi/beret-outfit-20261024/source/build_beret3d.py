"""Mutsumi's crimson beret as a real 3D part on the V41 model.

A plump, round felt cushion worn on the middle-back of the head: its band plane
tilts back (~35 degrees) and leans a little to the screen-left. Seen from the
front, the head hides most of it and only a rounded strip shows above the hair;
from the side most of it shows. Placement is fitted against the real hair:
no hair above the band may poke out of the hat, and the band ring must rest on
the hair shell instead of floating. Shading is baked into vertex colours
because the pet renderer draws unlit materials.

Run: blender --background --factory-startup --python build_beret3d.py -- <out_dir> [--search]
Blender is Z-up with -Y as the front; the JSON export is glTF Y-up.
"""
import json, math, sys
import numpy as np
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0].rstrip('/\\') + '/'
SEARCH = '--search' in argv
# This file lives in assets/characters/wakaba-mutsumi/beret-outfit-20261024/source/.
from pathlib import Path
GLB = str(Path(__file__).resolve().parents[5] / "assets/characters/wakaba-mutsumi/v41-3d/runtime/mutsumi-v05.glb")
P = json.load(open(OUT + 'beret_params.json'))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
hair = bpy.data.objects['Hair.UnifiedScalp_Bangs_and_WavyFall']
co = np.empty(len(hair.data.vertices) * 3, np.float32); hair.data.vertices.foreach_get('co', co)
M = np.array(hair.matrix_world)
HV = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
HV = HV[HV[:, 2] > 2.4]
print('HAIR', len(HV), 'top', HV[:, 2].max().round(3))

# convex shell of the crown, used to judge whether the band rests on the hair
bm = bmesh.new()
for p in HV[::3]: bm.verts.new(Vector(p.tolist()))
res = bmesh.ops.convex_hull(bm, input=bm.verts[:])
bmesh.ops.delete(bm, geom=list(set(res['geom_interior'])), context='VERTS')
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
SHELL = BVHTree.FromBMesh(bm)


def profile(R, H, k_band=.93, zb=P.get('zb', .10), zm=.26, pw=2.6, n=36):
    """Half cross-section (r, z) from the band bottom, out over the bulge, to the crown centre."""
    Rb = R * k_band; pts = [(Rb, 0.0), (Rb, zb)]
    for i in range(1, 9):  # rounded underside of the bulge
        u = i / 8 * math.pi / 2
        pts.append((Rb + (R - Rb) * math.sin(u), zm - (zm - zb) * math.cos(u)))
    for i in range(1, n + 1):  # full-shouldered dome (superellipse) up to the crown
        t = i / n * math.pi / 2; c, s = math.cos(t), math.sin(t)
        pts.append((R * c ** (2 / pw), zm + (H - zm) * s ** (2 / pw)))
    pts[-1] = (0.0, H)
    return pts, Rb, zb


def frame(tilt, lean):
    t, l = math.radians(tilt), math.radians(lean)
    n = np.array([0.0, math.sin(t), math.cos(t)])
    rot = np.array([[math.cos(l), 0, math.sin(l)], [0, 1, 0], [-math.sin(l), 0, math.cos(l)]])
    n = rot @ n
    e1 = rot @ np.array([1.0, 0, 0]); e1 -= n * (e1 @ n); e1 /= np.linalg.norm(e1)
    return n, e1, np.cross(n, e1)


def r_at(prof, z):
    """Outer radius of the hat at local height z (np array); -1 above the crown."""
    zs = np.array([p[1] for p in prof]); rs = np.array([p[0] for p in prof])
    # profile z is monotonic after the band; take the max radius for each z
    out = np.interp(z, zs[1:], rs[1:]); out[z < zs[1]] = rs[0]; out[z > zs[-1]] = -1
    return out


def evaluate(C, tilt, lean, R, H):
    n, e1, e2 = frame(tilt, lean); prof, Rb, zb = profile(R, H)
    d = HV - C; z = d @ n; rho = np.linalg.norm(d - np.outer(z, n), axis=1)
    above = z > 0
    poke = int(np.sum(above & (rho > r_at(prof, z) - .02)))
    ring_d = []
    for k in range(48):
        a = 2 * math.pi * k / 48
        p = C + (e1 * math.cos(a) + e2 * math.sin(a)) * Rb + n * zb * .5
        loc, nor, _, dist = SHELL.find_nearest(Vector(p.tolist()))
        sgn = 1 if (Vector(p.tolist()) - loc).dot(nor) > 0 else -1
        ring_d.append(sgn * dist)
    ring_d = np.array(ring_d)
    # hat outline height above the hair
    ang = np.linspace(0, 2 * math.pi, 64, endpoint=False)
    pr = np.array(prof)
    pts = C + (np.outer(pr[:, 0], np.cos(ang)).reshape(-1, 1) * e1 + np.outer(pr[:, 0], np.sin(ang)).reshape(-1, 1) * e2
               + np.repeat(pr[:, 1], len(ang)).reshape(-1, 1) * n)
    vis = pts[:, 2].max() - HV[:, 2].max()
    return poke, ring_d, vis


def score(C, tilt, lean, R, H):
    poke, ring_d, vis = evaluate(C, tilt, lean, R, H)
    floating = np.clip(ring_d - .03, 0, None).mean()
    buried = np.clip(-ring_d - .25, 0, None).mean()
    worst = max(0.0, float(ring_d.max()) - .10)
    return poke * .02 + floating * 6 + worst * 5 + buried * 2 + abs(vis - P['vis']) * 3, poke, ring_d, vis


if SEARCH:
    best = []
    for tilt in P['tilts']:
        for R in P['radii']:
            for H in P['heights']:
                for cy in np.arange(*P['cy']):
                    for cz in np.arange(*P['cz']):
                      for cx in P.get('cxs', [P['cx']]):
                        C = np.array([cx, cy, cz])
                        s, poke, ring_d, vis = score(C, tilt, P['lean'], R, H)
                        best.append((s, tilt, R, H, cx, round(float(cy), 3), round(float(cz), 3), poke,
                                     round(float(ring_d.max()), 3), round(float(ring_d.min()), 3), round(float(vis), 3)))
    best.sort()
    for b in best[:12]: print('FIT', b)
    sys.exit(0)

# ------------------------------------------------------------------ build the chosen hat
C = np.array([P['cx'], P['C'][0], P['C'][1]]); tilt, lean, R, H = P['tilt'], P['lean'], P['R'], P['H']
poke, ring_d, vis = evaluate(C, tilt, lean, R, H)
print('RINGD', ' '.join('%d:%.2f' % (k * 360 // 48, d) for k, d in enumerate(ring_d) if k % 3 == 0))
print('CHOSEN poke', poke, 'ring', ring_d.min().round(3), ring_d.max().round(3), 'vis', round(float(vis), 3))
n, e1, e2 = frame(tilt, lean); prof, Rb, zb = profile(R, H, n=40)
NA = 160
# soft felt: drop the band onto the hair shell all the way round, fading out toward the crown
drop = []
for k in range(NA):
    a = 2 * math.pi * k / NA; radial = e1 * math.cos(a) + e2 * math.sin(a)
    start = C + radial * Rb + n * 1.0
    hit = SHELL.ray_cast(Vector(start.tolist()), Vector((-n).tolist()))
    drop.append((1.0 - hit[3]) - P.get('sink', .03) if hit[0] else 0.0)
drop = np.convolve(np.pad(drop, 6, mode='wrap'), np.ones(13) / 13, mode='valid')
print('DROP', drop.min().round(3), drop.max().round(3))
verts, faces, kind = [], [], []
for i, (r, z) in enumerate(prof):
    w = 1.0 if z <= P.get('zm', .26) else (r / R) ** 1.5
    for k in range(NA):
        a = 2 * math.pi * k / NA
        verts.append(C + (e1 * math.cos(a) + e2 * math.sin(a)) * r + n * (z + drop[k] * w))
        kind.append('band' if z <= zb + 1e-6 else 'felt')
for i in range(len(prof) - 1):
    for k in range(NA):
        k2 = (k + 1) % NA
        a_, b_ = i * NA + k, i * NA + k2; c_, d_ = (i + 1) * NA + k2, (i + 1) * NA + k
        if prof[i + 1][0] == 0: faces.append((a_, b_, c_))
        else: faces.append((a_, b_, c_, d_))
# shallow underside dish closing the band ring (hidden inside the hair)
ci = len(verts); verts.append(C + n * .12); kind.append('band')
for k in range(NA): faces.append((ci, (k + 1) % NA, k))

me = bpy.data.meshes.new('Beret'); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
me.calc_loop_triangles()


def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return np.array([v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in c])


FELT, BAND = srgb(P['felt']), srgb(P['band'])
LIGHT = np.array([-.45, -.8, .62]); LIGHT /= np.linalg.norm(LIGHT)
rng = np.random.default_rng(4)
cols = []
for i, v in enumerate(me.vertices):
    nn = np.array(v.normal)
    lam = max(0.0, nn @ LIGHT)
    sky = max(0.0, nn[2])
    if kind[i] == 'band':
        k = .62 + .45 * lam + .10 * sky
        base = BAND
    else:
        # strong form shading: lit crown, deep core shadow toward the band, a little bounce under the bulge
        k = .46 + .70 * lam ** 1.1 + .16 * sky + .05 * max(0.0, -nn[2])
        k *= 1 + rng.normal(0, .025)
        base = FELT
    cols.append(np.clip(base * k, 0, 1))
attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
for i, c in enumerate(cols): attr.data[i].color = (*c, 1)

mat = bpy.data.materials.new('Beret • baked vertex colour'); mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
em = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(vc.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs[0])
me.materials.append(mat)
ob = bpy.data.objects.new('Accessory.Beret', me); bpy.context.scene.collection.objects.link(ob)
head = bpy.data.objects['CTRL_Head']; ob.parent = head; ob.matrix_parent_inverse = head.matrix_world.inverted()

pos, col, idx = [], [], []
for v, c in zip(me.vertices, cols):
    pos += [v.co.x, v.co.z, -v.co.y]; col += c.tolist()
for t in me.loop_triangles: idx += list(t.vertices)
json.dump([{'name': 'Beret', 'parent': 'CTRL_Head', 'pos': pos, 'col': col, 'idx': idx}], open(OUT + 'beret_parts.json', 'w'))
bpy.ops.wm.save_as_mainfile(filepath=OUT + 'Mutsumi_Beret_3D.blend')
print('BUILT verts', len(verts), 'tris', len(idx) // 3)
