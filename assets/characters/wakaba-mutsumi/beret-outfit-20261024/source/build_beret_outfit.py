"""Mutsumi's crimson beret outfit, modelled on the V41 desk-pet body.

Every garment is lofted from the measured body, arm and leg sections, so the
head-to-body ratio and silhouette stay as they are. The original dress, sleeves
and boots are hidden (not deleted). Each piece hangs on the control of the part
it replaces; the capelet is split so the pieces over the arms follow the arms.
Details that stand out (buttons, studs, ascot, cameo, clasp, earring) are small
meshes; bands such as the gold capelet hem are coloured rows. Shading is baked
into vertex colours because the pet renderer draws unlit materials.

Run: blender --background --factory-startup --python build_beret_outfit.py -- <out_dir> <beret.blend>
Blender is Z-up with -Y as the front; the JSON export is glTF Y-up.
"""
import json, math, sys
import bmesh, bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0].rstrip('/\\') + '/'
BERET_BLEND = argv[1] if len(argv) > 1 else None
# This file lives in assets/characters/wakaba-mutsumi/beret-outfit-20261024/source/.
from pathlib import Path
GLB = str(Path(__file__).resolve().parents[5] / "assets/characters/wakaba-mutsumi/v41-3d/runtime/mutsumi-v05.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
coll = bpy.context.scene.collection


def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in c]


RED, RED_D = '#a6262d', '#7c1a20'
BLACK, BLACK_L = '#2b2731', '#47414f'
GOLD, GOLD_D = '#dcb65d', '#a8823a'
CREAM, CREAM_D, BEIGE = '#f2e8d4', '#d6c6a6', '#e2d0ad'
GREY, GREY_L = '#4b4953', '#615e6a'
BOOT, BOOT_D, BOOT_L = '#7c1e24', '#541317', '#9a3b40'
STUD, GREEN = '#ece9f0', '#5f9e7f'
LIGHT = Vector((-.45, -.8, .62)).normalized()

vc_mat = bpy.data.materials.new('Outfit • baked vertex colour'); vc_mat.use_nodes = True
nt = vc_mat.node_tree; nt.nodes.clear()
vcn = nt.nodes.new('ShaderNodeVertexColor'); vcn.layer_name = 'Col'
em = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(vcn.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs[0])

pieces = []


def emit(name, parent, verts, faces, cols, centre, shade=(.56, .55, .10), gloss=0.0):
    """centre(p) -> a point inside the garment; normals are turned to face away from it."""
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
    me.calc_loop_triangles()
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    pos, col = [], []
    for i, v in enumerate(me.vertices):
        n = Vector(v.normal)
        if n.dot(v.co - centre(v.co)) < 0: n = -n
        c = cols(i) if callable(cols) else cols[i]
        base = srgb(c) if isinstance(c, str) else c
        lam = max(0.0, n.dot(LIGHT))
        k = shade[0] + shade[1] * lam + shade[2] * max(0.0, n.z)
        hl = gloss * lam ** 10
        rgb = [min(1.0, cc * k + hl) for cc in base]
        attr.data[i].color = (*rgb, 1)
        pos += [v.co.x, v.co.z, -v.co.y]; col += rgb
    idx = []
    for t in me.loop_triangles: idx += list(t.vertices)
    pieces.append({'name': name, 'parent': parent, 'pos': pos, 'col': col, 'idx': idx})
    me.materials.append(vc_mat)
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob)
    par = bpy.data.objects[parent]; ob.parent = par; ob.matrix_parent_inverse = par.matrix_world.inverted()
    return ob


class Acc:
    def __init__(self): self.v, self.f, self.c = [], [], []
    def add(self, vs, fs, col):
        o = len(self.v); self.v += list(vs); self.f += [tuple(x + o for x in f) for f in fs]
        self.c += [col(i) if callable(col) else col for i in range(len(vs))]
    def emit(self, name, parent, centre, **kw): return emit(name, parent, self.v, self.f, self.c, centre, **kw)


def loft(rows, closed=True):
    nv = len(rows[0]); verts = [p for r in rows for p in r]; faces = []
    for r in range(len(rows) - 1):
        for i in range(nv if closed else nv - 1):
            i2 = (i + 1) % nv
            faces.append((r * nv + i, r * nv + i2, (r + 1) * nv + i2, (r + 1) * nv + i))
    return verts, faces


def se(th, a, b, p=3.0):
    c, s = math.cos(th), math.sin(th)
    return a * math.copysign(abs(c) ** (2 / p), c), b * math.copysign(abs(s) ** (2 / p), s)


def smooth(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


def interp(table, x):
    if x <= table[0][0]: return list(table[0][1:])
    for (x0, *a), (x1, *b) in zip(table, table[1:]):
        if x <= x1:
            u = (x - x0) / (x1 - x0); return [p + (q - p) * u for p, q in zip(a, b)]
    return list(table[-1][1:])


def blob(c, ax, ay, az, ux=Vector((1, 0, 0)), uy=Vector((0, 0, 1)), uz=Vector((0, -1, 0)), nu=14, nv=9):
    vs, fs = [], []
    for i in range(nu):
        for j in range(nv):
            th = math.pi * j / (nv - 1); ph = 2 * math.pi * i / nu
            vs.append(c + ux * ax * math.sin(th) * math.cos(ph) + uy * ay * math.sin(th) * math.sin(ph) + uz * az * math.cos(th))
    for i in range(nu):
        for j in range(nv - 1): fs.append((i * nv + j, ((i + 1) % nu) * nv + j, ((i + 1) % nu) * nv + j + 1, i * nv + j + 1))
    return vs, fs


def open_ring(z, a, b, w, cx, cy, n, p=3.0, warp=None):
    """Ring around the body that is open at the front between x = cx -+ w."""
    d = math.asin(min(.999, (w / a) ** (p / 2)))
    pts = []
    for k in range(n):
        th = -math.pi / 2 + d + (2 * math.pi - 2 * d) * k / (n - 1)
        x, y = se(th, a, b, p); pt = Vector((cx + x, cy + y, z))
        if warp: pt = warp(pt, th)
        pts.append(pt)
    return pts


CX, CY = -0.02, -0.05
NU = 160
BOD = [(0.90, .50, .372), (0.98, .50, .372), (1.10, .505, .38), (1.30, .515, .388), (1.46, .525, .39), (1.56, .48, .385),
       (1.64, .41, .37), (1.72, .345, .345), (1.80, .30, .32), (1.88, .27, .29)]


def body_ab(z): return interp(BOD, z)


def front_y(x, z, extra=0.0):
    a, b = body_ab(z); a += extra; b += extra
    u = min(.999, abs((x - CX) / a)) ** 3.2
    return CY - b * (1 - u) ** (1 / 3.2)


body_c = lambda p: Vector((CX, CY, p.z))

# ------------------------------------------------------------------ bodice: red vest in front, coat black at the back
rows = []
for j in range(41):
    z = .92 + (1.88 - .92) * j / 40; a, b = body_ab(z)
    rows.append([Vector((CX + x, CY + y, z)) for x, y in (se(2 * math.pi * i / NU, a + .012, b + .012, 3.2) for i in range(NU))])
v, f = loft(rows)
ci = len(v); v.append(Vector((CX, CY, 1.9)))
for i in range(NU): f.append((40 * NU + i, 40 * NU + (i + 1) % NU, ci))
emit('Outfit.Vest', 'CTRL_Body', v, f, lambda i: RED if i == ci or math.sin(2 * math.pi * (i % NU) / NU) < .42 else BLACK, body_c)

# stand collar
rows = []
for j, z in enumerate([1.62, 1.70, 1.78, 1.84]):
    a, b = body_ab(z)
    rows.append([Vector((CX + x, CY + y, z)) for x, y in (se(2 * math.pi * i / NU, a + .035, b + .035, 3.0) for i in range(NU))])
v, f = loft(rows)
emit('Outfit.Collar', 'CTRL_Body', v, f, lambda i: RED_D if i // NU == 3 else RED, body_c)

# ascot under the collar, knot and cameo
acc = Acc()
rows = []
for j in range(9):
    s = j / 8; z = 1.585 - .225 * s; hw = .045 + .07 * math.sin(math.pi * min(1, s * 1.15) * .9)
    row = []
    for k in range(9):
        u = -1 + 2 * k / 8; x = CX + .012 + hw * u
        row.append(Vector((x, front_y(x, z) - .025 - .03 * (1 - u * u), z)))
    rows.append(row)
v, f = loft(rows, closed=False)
acc.add(v, f, lambda i: CREAM_D if i % 9 == 4 else CREAM)
kc = Vector((CX + .012, front_y(CX, 1.60) - .05, 1.60))
v, f = blob(kc, .072, .048, .03); acc.add(v, f, CREAM)
acc.emit('Outfit.Ascot', 'CTRL_Body', lambda p: Vector((CX, CY + .2, p.z)))
acc = Acc()
for r, d, col in [(.048, .020, GOLD_D), (.042, .030, GOLD), (.031, .042, GREEN)]:
    v, f = blob(kc + Vector((0, -d, 0)), r, r, .012); acc.add(v, f, col)
v, f = blob(kc + Vector((-.012, -.054, .012)), .009, .007, .004); acc.add(v, f, '#c9ecd9')
acc.emit('Outfit.Cameo', 'CTRL_Body', lambda p: kc + Vector((0, .2, 0)), gloss=.25)

# gold vest buttons
acc = Acc()
for x in (-.056, .044):
    for z in (1.182, 1.098, 1.014):
        v, f = blob(Vector((x, front_y(x, z, .012) - .012, z)), .023, .023, .014); acc.add(v, f, GOLD)
acc.emit('Outfit.VestButtons', 'CTRL_Body', lambda p: Vector((p.x, p.y + .3, p.z)), gloss=.3)

# ------------------------------------------------------------------ skirt, belt
def skirt_ab(s):
    g = 1 - (1 - s) ** 2.2
    return .515 + .105 * g, .385 + .065 * g


rows = []
for j in range(21):
    s = j / 20; z = 1.0 - .59 * s; a, b = skirt_ab(s); pl = .03 * smooth(s * 1.5)
    rows.append([Vector((CX + x * (1 + pl * math.sin(16 * th)), CY + y * (1 + pl * math.sin(16 * th)), z))
                 for x, y, th in ((*se(th, a, b, 2.8), th) for th in [2 * math.pi * i / NU for i in range(NU)])])
v, f = loft(rows)
emit('Outfit.Skirt', 'CTRL_Body', v, f, lambda i: CREAM if i // NU >= 18 else (CREAM_D if i // NU == 17 else RED), body_c)

rows = []
for z, s in [(.99, 1.0), (.98, 1.03), (.91, 1.03), (.90, 1.0)]:
    rows.append([Vector((CX + x * s, CY + y * s, z)) for x, y in (se(2 * math.pi * i / NU, .535, .405, 3.0) for i in range(NU))])
v, f = loft(rows)
emit('Outfit.Belt', 'CTRL_Body', v, f, lambda i: BLACK_L if i // NU == 1 else BLACK, body_c)

# ------------------------------------------------------------------ open tailcoat below the belt, long tails at the back
NC = 140


def coat_row(s):
    g = 1 - (1 - s) ** 2
    a, b = .565 + .16 * g, .43 + .13 * g; w = .085 + .085 * s
    d = math.asin(min(.999, (w / a) ** 1.4))
    pts = []
    for k in range(NC):
        th = -math.pi / 2 + d + (2 * math.pi - 2 * d) * k / (NC - 1)
        x, y = se(th, a, b, 2.8)
        hz = .40 - .17 * smooth((math.sin(th) + .1) / 1.0)
        pts.append(Vector((CX + x, CY + y, .985 + (hz - .985) * s)))
    return pts


rows = [coat_row(j / 24) for j in range(25)]
v, f = loft(rows, closed=False)
emit('Outfit.Coat', 'CTRL_Body', v, f, lambda i: BLACK_L if i % NC in (0, NC - 1) else BLACK, body_c, shade=(.6, .5, .1))
hem = rows[-1]
acc = Acc()
for layer, (drop, out_, colA, colB) in enumerate([(.075, .05, '#c9b690', BEIGE), (.045, .03, CREAM_D, CREAM)]):
    rr = []
    for j in range(3):
        t = j / 2; row = []
        for k, p in enumerate(hem):
            rad = Vector((p.x - CX, p.y - CY, 0)).normalized()
            wave = .012 * math.sin(k * .9) * t
            row.append(p + rad * (out_ * t + wave + .006 * layer) + Vector((0, 0, -drop * t - .004 * layer)))
        rr.append(row)
    v, f = loft(rr, closed=False); acc.add(v, f, lambda i, a=colA, b=colB: b if i // NC == 2 else a)
acc.emit('Outfit.CoatRuffle', 'CTRL_Body', body_c)
acc = Acc()
for side in (0, NC - 1):
    for k in range(6):
        s = (k + .5) / 6 * .92; p = coat_row(s)[side]; q = coat_row(s)[side + (3 if side == 0 else -3)]
        c = p + (q - p).normalized() * .035 + Vector((p.x - CX, p.y - CY, 0)).normalized() * .01
        v, f = blob(c, .015, .015, .01, nu=8, nv=6); acc.add(v, f, STUD)
acc.emit('Outfit.CoatStuds', 'CTRL_Body', body_c, gloss=.3)

# ------------------------------------------------------------------ capelet: gold hem, red piping; the pieces over the arms follow the arms
CAPE = [(1.83, .335, .355, 0.0), (1.75, .45, .41, .05), (1.64, .60, .45, .12), (1.50, .74, .48, .18), (1.37, .82, .495, .20), (1.25, .86, .505, .21)]
OPEN = [(1.83, .24), (1.62, .058), (1.25, .115)]
NK = 170
P_ARM_Z = float(argv[2]) if len(argv) > 2 else 1.45  # capelet below this height over the arms follows the arms


def cape_warp(p, th):
    z = p.z
    bul = interp([(r[0], r[3]) for r in sorted(CAPE)], z)[0]
    if p.y < CY:
        p = p + Vector((0, -bul * math.exp(-((abs(p.x - CX) - .45) / .24) ** 2), 0))
    return p


def hem_z(p):
    """Draped hem: dips over the upper arms like the design, with soft folds."""
    ax_ = abs(p.x - CX)
    return 1.25 - .045 * math.exp(-((ax_ - .40) / .2) ** 2) + .012 * math.sin(11 * math.atan2(p.y - CY, p.x - CX))


rows = []
for j in range(24):
    s = j / 23; zz = 1.83 + (1.25 - 1.83) * s
    a, b = interp([(r[0], r[1], r[2]) for r in sorted(CAPE)], zz)
    w = interp(sorted(OPEN), zz)[0]
    ring = open_ring(zz, a, b, w, CX, CY + .02, NK, 3.0, cape_warp)
    row = []
    for k, p in enumerate(ring):
        th = math.atan2(p.y - CY, p.x - CX)
        fold = 1 + .03 * s * s * math.sin(9 * th)
        q = Vector((CX + (p.x - CX) * fold, CY + (p.y - CY) * fold, 1.83 + (hem_z(p) - 1.83) * s))
        row.append(q)
    rows.append(row)
hem_row = rows[-1]
for dz, k in [(-.022, 1.012), (-.034, 1.02)]:  # thin gold band, flaring a touch at the edge
    rows.append([Vector((CX + (p.x - CX) * k, CY + (p.y - CY) * k, p.z + dz)) for p in hem_row])
nr = len(rows)


def cape_col(i):
    r, k = divmod(i, NK)
    if r >= nr - 2: return GOLD_D if r == nr - 1 else GOLD
    if k < 2 or k > NK - 3: return RED
    return BLACK


verts = [p for row in rows for p in row]
parts = {'CTRL_Body': [], 'CTRL_Arm.L': [], 'CTRL_Arm.R': []}
for r in range(nr - 1):
    for k in range(NK - 1):
        fv = (r * NK + k, r * NK + k + 1, (r + 1) * NK + k + 1, (r + 1) * NK + k)
        m = sum((verts[i] for i in fv), Vector()) / 4
        if abs(m.x - CX) > .34 and m.z < P_ARM_Z:
            parts['CTRL_Arm.L' if m.x > CX else 'CTRL_Arm.R'].append(fv)
        else:
            parts['CTRL_Body'].append(fv)
for parent, fs in parts.items():
    used = sorted({i for f in fs for i in f}); remap = {o: n for n, o in enumerate(used)}
    emit('Outfit.Capelet.' + parent.split('_')[1], parent, [verts[i] for i in used], [tuple(remap[i] for i in f) for f in fs],
         [cape_col(i) for i in used], lambda p: Vector((CX, CY + .05, p.z + .25)), shade=(.58, .5, .12))

# ------------------------------------------------------------------ sleeves: cream puff under the capelet, black lower sleeve
SLEEVES = {'L': (Vector((0.297, -0.399, 1.499)), Vector((0.643, -0.413, 0.831))),
           'R': (Vector((-0.363, -0.418, 1.502)), Vector((-0.651, -0.382, 0.821)))}
PROF = [(-.06, .12), (.05, .15), (.20, .17), (.32, .19), (.37, .225), (.47, .25), (.56, .235), (.61, .17), (.65, .145),
        (.86, .14), (.93, .15), (.97, .158)]
NS = 72
for side, (S, E) in SLEEVES.items():
    ax = E - S; L_ = ax.length; ax.normalize()
    u = ax.cross(Vector((0, -1, 0))).normalized(); w = ax.cross(u).normalized()
    ts = [-.06 + 1.03 * j / 44 for j in range(45)]
    rows = []
    for t in ts:
        r = interp(PROF, t)[0]; puff = smooth((t - .34) / .06) * (1 - smooth((t - .56) / .06))
        c = S + ax * (L_ * t)
        rows.append([c + (u * math.cos(ph) + w * math.sin(ph)) * r * (1 + .07 * puff * abs(math.sin(4 * ph))) for ph in [2 * math.pi * i / NS for i in range(NS)]])
    v, f = loft(rows)

    def sl_col(i, ts=ts):
        t = ts[i // NS]
        if t < .585: return CREAM if (i % NS) % 9 else CREAM_D
        if t < .62: return RED_D
        return BLACK
    emit('Outfit.Sleeve.' + side, 'CTRL_Arm.' + side, v, f, sl_col, lambda p, S=S, ax=ax: S + ax * (p - S).dot(ax))

# ------------------------------------------------------------------ stockings and short boots on the original leg shapes
for side in ('L', 'R'):
    src = bpy.data.objects['Foot.Boot.' + side]
    bm = bmesh.new(); bm.from_mesh(src.data); bm.transform(src.matrix_world)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    vs = [v.co.copy() for v in bm.verts]; fs = [tuple(v.index for v in f.verts) for f in bm.faces]; bm.free()
    xs = [p.x for p in vs if .15 < p.z < .25]; ys = [p.y for p in vs if .15 < p.z < .25]
    lc = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0)); la, lb = (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2

    def leg_col(i, vs=vs, lc=lc):
        p = vs[i]
        if p.z < .04: return BOOT_D
        if p.z < .155:
            if p.y < lc.y - .17 and .07 < p.z < .13 and abs(p.x - (lc.x - .06)) < .06: return BOOT_L
            return BOOT
        if p.z < .205: return BLACK
        if p.y < lc.y - .2 and abs(p.x - (lc.x - .08)) < .028: return GREY_L
        return GREY
    emit('Outfit.Legs.' + side, 'CTRL_Foot.' + side, vs, fs, leg_col, lambda p, lc=lc: Vector((lc.x, lc.y, p.z)))
    acc = Acc()
    rows = []
    for z, k in [(.205, 1.02), (.19, 1.08), (.165, 1.10)]:
        rows.append([Vector((lc.x + x * k * (1 + .03 * (z < .17) * abs(math.sin(9 * th))), lc.y + y * k, z))
                     for x, y, th in ((*se(th, la, lb, 2.6), th) for th in [2 * math.pi * i / 96 for i in range(96)])])
    v, f = loft(rows); acc.add(v, f, BLACK)
    fy = lc.y - lb * 1.04
    dc = Vector((lc.x, fy - .012, .10))
    dv = [dc + Vector((0, 0, .03)), dc + Vector((.022, 0, 0)), dc + Vector((0, 0, -.03)), dc + Vector((-.022, 0, 0)), dc + Vector((0, -.012, 0))]
    o = len(acc.v); acc.v += dv; acc.c += [GOLD] * 5; acc.f += [(o + 4, o + 0, o + 1), (o + 4, o + 1, o + 2), (o + 4, o + 2, o + 3), (o + 4, o + 3, o + 0)]
    acc.emit('Outfit.BootCuff.' + side, 'CTRL_Foot.' + side, lambda p, lc=lc: Vector((lc.x, lc.y, p.z)), gloss=.2)

# ------------------------------------------------------------------ black drop earring under the visible ear
ear = bpy.data.objects['Head.Ear.L']; EM = ear.matrix_world
low = min((EM @ v.co for v in ear.data.vertices), key=lambda p: p.z)
acc = Acc()
top = low + Vector((-.01, -.03, .01)); bot = top + Vector((0, 0, -.07))
acc.add([top + Vector((-.006, 0, 0)), top + Vector((.006, 0, 0)), bot + Vector((.006, 0, 0)), bot + Vector((-.006, 0, 0))], [(0, 1, 2, 3)], GOLD_D)
dc = bot + Vector((0, 0, -.06))
dv = [dc + Vector((0, 0, .06)), dc + Vector((.035, 0, 0)), dc + Vector((0, 0, -.06)), dc + Vector((-.035, 0, 0)), dc + Vector((0, -.022, 0)), dc + Vector((0, .022, 0))]
o = len(acc.v); acc.v += dv; acc.c += ['#2a2430'] * 6
for a, b in [(0, 1), (1, 2), (2, 3), (3, 0)]: acc.f += [(o + 4, o + a, o + b), (o + 5, o + b, o + a)]
acc.emit('Outfit.Earring', 'CTRL_Head', lambda p, dc=dc: Vector((dc.x, dc.y + .5, p.z)), gloss=.3)

# ------------------------------------------------------------------ keep the approved beret, hide the replaced originals
if BERET_BLEND:
    with bpy.data.libraries.load(BERET_BLEND) as (src, dst): dst.meshes = ['Beret']
    head = bpy.data.objects['CTRL_Head']
    ob = bpy.data.objects.new('Accessory.Beret', dst.meshes[0]); coll.objects.link(ob)
    ob.parent = head; ob.matrix_parent_inverse = head.matrix_world.inverted()
for name in ['Body.SailorDress', 'Body.ConcealedCollar', 'Arm.Sleeve.L', 'Arm.Sleeve.R', 'Foot.Boot.L', 'Foot.Boot.R']:
    o = bpy.data.objects[name]; o.hide_set(True); o.hide_render = True
json.dump(pieces, open(OUT + 'outfit_parts.json', 'w'))
bpy.ops.wm.save_as_mainfile(filepath=OUT + 'Mutsumi_Beret_Outfit.blend')
print('PARTS', len(pieces), sum(len(p['idx']) // 3 for p in pieces))
