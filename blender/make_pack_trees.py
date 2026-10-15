import bpy, bmesh, os, math, random
import numpy as np
from mathutils import Vector
SRC = "/Users/williangutnik/Downloads/trees_blender_pack"
OUT = os.environ.get("TREE_OUT", "/tmp/mayor-agents/treedec/clumped")
os.makedirs(OUT, exist_ok=True)
H_TARGET = 0.6
NAMES = {"01_Autumn_Amber": ("tree_photo_amber", 9), "02_Light_Green_Airy": ("tree_photo_airy", 8),
         "03_Deep_Green_Dense": ("tree_photo_dense", 10), "04_Broad_Green": ("tree_photo_broad", 10)}

def colors_of(me):
    a = me.color_attributes[0]
    n = len(me.vertices) if a.domain == "POINT" else len(me.loops)
    buf = np.zeros(n * 4, dtype=np.float32); a.data.foreach_get("color", buf)
    return buf.reshape(-1, 4), a.domain

for src, (name, nclump) in NAMES.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f"{SRC}/{src}.glb")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    leaves = next(o for o in meshes if "Leaves" in o.name)
    wood = next(o for o in meshes if "Branches" in o.name)
    # world coordinates (the importer converted y-up to z-up)
    def world_pts(o):
        me = o.data; n = len(me.vertices)
        buf = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get("co", buf)
        return buf.reshape(-1, 3)
    wp = world_pts(wood); lp = world_pts(leaves)
    ext = wp.max(axis=0) - wp.min(axis=0)
    ha = int(ext.argmax())
    axes = [i for i in range(3) if i != ha] + [ha]
    wp = wp[:, axes]; lp = lp[:, axes]
    hh = wp[:, 2]; lo = wp[hh < hh.min() + 0.1 * (hh.max() - hh.min())]; hi = wp[hh > hh.max() - 0.1 * (hh.max() - hh.min())]
    spread = lambda a: float(np.std(a[:, :2], axis=0).mean()) if len(a) else 0.0
    if spread(lo) > spread(hi):
        wp[:, 2] *= -1; lp[:, 2] *= -1
    print("ORIENT", src, "h-axis", ha, "lo", round(spread(lo), 2), "hi", round(spread(hi), 2), "flip", spread(lo) > spread(hi))
    allp = np.vstack([wp, lp])
    zmin, zmax = allp[:, 2].min(), allp[:, 2].max()
    cx, cy = (allp[:, 0].min() + allp[:, 0].max()) / 2, (allp[:, 1].min() + allp[:, 1].max()) / 2
    s = H_TARGET / (zmax - zmin)
    # leaf quads: 4 verts each, consecutive
    me = leaves.data
    cols, dom = colors_of(me)
    _orig = [leaves, wood]
    if dom == "POINT": vc = cols
    else:
        vc = np.zeros((len(me.vertices), 4), dtype=np.float32)
        for li, l in enumerate(me.loops): vc[l.vertex_index] = cols[li]
    nq = len(lp) // 4
    q = lp[: nq * 4].reshape(nq, 4, 3)
    qc = q.mean(axis=1)
    qcol = vc[: nq * 4].reshape(nq, 4, 4).mean(axis=1)[:, :3]
    # k-means-ish clustering: farthest-point seeds then assign, 2 refinement passes
    rng = np.random.default_rng(7)
    seeds = [int(rng.integers(nq))]
    d = np.linalg.norm(qc - qc[seeds[0]], axis=1)
    for _ in range(nclump - 1):
        i = int(d.argmax()); seeds.append(i); d = np.minimum(d, np.linalg.norm(qc - qc[i], axis=1))
    cen = qc[seeds].copy()
    for _ in range(3):
        lab = np.argmin(((qc[:, None, :] - cen[None, :, :]) ** 2).sum(-1), axis=1)
        for k in range(nclump):
            m = lab == k
            if m.any(): cen[k] = qc[m].mean(axis=0)
    lab = np.argmin(((qc[:, None, :] - cen[None, :, :]) ** 2).sum(-1), axis=1)
    bm = bmesh.new()
    col_layer = bm.loops.layers.color.new("Col")
    PHI = (1 + 5 ** 0.5) / 2
    ICO_V = [(-1, PHI, 0), (1, PHI, 0), (-1, -PHI, 0), (1, -PHI, 0), (0, -1, PHI), (0, 1, PHI), (0, -1, -PHI), (0, 1, -PHI), (PHI, 0, -1), (PHI, 0, 1), (-PHI, 0, -1), (-PHI, 0, 1)]
    ICO_F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
             (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    def blob(center, r, col, hflat=0.8):
        nrm = 1 / (1 + PHI * PHI) ** 0.5
        vs = []
        for (x, y, z) in ICO_V:
            j = rng.uniform(0.82, 1.12)
            vs.append(bm.verts.new((center[0] + x * nrm * r * j, center[1] + y * nrm * r * j, center[2] + z * nrm * r * hflat * j)))
        for f_ in ICO_F:
            f = bm.faces.new((vs[f_[0]], vs[f_[1]], vs[f_[2]]))
            for l in f.loops: l[col_layer] = (float(col[0]), float(col[1]), float(col[2]), 1.0)
    # crown clumps
    for k in range(nclump):
        m = lab == k
        if m.sum() < 3: continue
        pts = qc[m]
        c = pts.mean(axis=0)
        ext = np.linalg.norm(pts - c, axis=1)
        r = float(np.clip(np.percentile(ext, 85), 0.12, 2.0)) * 2.1
        col = qcol[m].mean(axis=0)
        # light up the top of the tree a bit, darken the bottom
        t = (c[2] - zmin) / (zmax - zmin)
        col = np.clip(col * (0.82 + 0.3 * t), 0, 1)
        blob(((c[0] - cx) * s, (c[1] - cy) * s, (c[2] - zmin) * s), r * s, col)
    # trunk + main branches from the wood mesh: keep verts, build tapered cylinder trunk + a few branch cones from clusters of wood
    w = wp; wz = (w[:, 2] - zmin) * s
    wcol = np.array([0.30, 0.20, 0.12])
    trunk_top = 0.28
    def cyl(p0, p1, r0, r1, seg=5):
        v0 = []; v1 = []
        d = np.array(p1) - np.array(p0); L = np.linalg.norm(d); d /= L
        a = np.cross(d, [0, 0, 1.0]); 
        if np.linalg.norm(a) < 1e-3: a = np.array([1.0, 0, 0])
        a /= np.linalg.norm(a); b = np.cross(d, a)
        for j in range(seg):
            ang = j * math.tau / seg
            off = a * math.cos(ang) + b * math.sin(ang)
            v0.append(bm.verts.new(tuple(np.array(p0) + off * r0))); v1.append(bm.verts.new(tuple(np.array(p1) + off * r1)))
        for j in range(seg):
            j2 = (j + 1) % seg
            for tri in ((v0[j], v0[j2], v1[j]), (v0[j2], v1[j2], v1[j])):
                f = bm.faces.new(tri)
                for l in f.loops: l[col_layer] = (float(wcol[0]), float(wcol[1]), float(wcol[2]), 1.0)
    cyl((0, 0, 0), (0, 0, trunk_top), 0.035, 0.018, 5)
    # branches: 6 limbs toward the crown clump centres
    top_clumps = sorted(range(nclump), key=lambda k: -qc[lab == k].mean(axis=0)[2] if (lab == k).any() else 0)
    for i, k in enumerate(top_clumps[: 3]):
        if not (lab == k).any(): continue
        c = qc[lab == k].mean(axis=0)
        tgt = ((c[0] - cx) * s * 0.6, (c[1] - cy) * s * 0.6, (c[2] - zmin) * s * 0.85)
        base = (0, 0, trunk_top * (0.55 + 0.06 * i))
        cyl(base, tgt, 0.012, 0.005, 4)
    me2 = bpy.data.meshes.new(name); bm.to_mesh(me2); bm.free()
    try: me2.color_attributes.active_color = me2.color_attributes["Col"]; me2.color_attributes.render_color_index = 0
    except Exception as e: print("COLATTR", e)
    ob = bpy.data.objects.new(name, me2); bpy.context.scene.collection.objects.link(ob)
    for _o in _orig: bpy.data.objects.remove(_o, do_unlink=True)
    mat = bpy.data.materials.new("tree_vc"); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
    vcn = nt.nodes.new("ShaderNodeVertexColor"); vcn.layer_name = "Col"
    nt.links.new(vcn.outputs["Color"], bsdf.inputs["Base Color"]); bsdf.inputs["Roughness"].default_value = 0.9
    ob.data.materials.append(mat)
    for p in me2.polygons: p.use_smooth = False
    tris = sum(len(p.vertices) - 2 for p in me2.polygons)
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    print("CLUMP", name, "tris", tris, "bounds", tuple(round(v, 3) for v in (min(b.x for b in bb), max(b.x for b in bb), min(b.y for b in bb), max(b.y for b in bb), min(b.z for b in bb), max(b.z for b in bb))))
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=f"{OUT}/{name}.glb", export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_vertex_color="ACTIVE", export_image_format="NONE")
    # preview
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.color_type = "VERTEX"; sc.display.shading.light = "STUDIO"
    sc.world = bpy.data.worlds.new("w"); sc.world.color = (0.55, 0.7, 0.9)
    sc.render.resolution_x = 480; sc.render.resolution_y = 480
    cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (1.2, -1.2, 0.65)
    cam.rotation_euler = (Vector((0, 0, 0.27)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{OUT}/{name}.png"
    bpy.ops.render.render(write_still=True)
