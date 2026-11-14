# Assign STEP PiPER parts to URDF links and cut the missing covers out of the official STL meshes; colour the covers
# from the official DAE meshes (aligned to the STL by ICP, since the DAE files use other frames).
# Writes a static preview GLB (STEP frame) and a pickle with per-link part meshes in LINK frames (metres).
# usage: python3 arm_parts.py LEAVES_PREFIX PIPER_DESC REG_JSON OUT_DIR
import sys, os, json, pickle, numpy as np, trimesh
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as Rot
prefix, desc, reg_json, out = sys.argv[1:5]
idx = json.load(open(prefix + '.json')); A = np.load(prefix + '.npz'); reg = json.load(open(reg_json))
LINKS = ['base_link', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6']
Tsl = {l: np.array(reg['links'][l]['T_step_link_mm']) for l in LINKS}

parts = [(p, trimesh.Trimesh(A[p['key'] + '_v'], A[p['key'] + '_f'], process=False)) for p in idx if any('PIPER' in s for s in p['path'])]
step_all = trimesh.util.concatenate([m for _, m in parts])
tree = cKDTree(trimesh.sample.sample_surface_even(step_all, 300000, seed=1)[0])

stl = {}
for l in LINKS:
    m = trimesh.load(f'{desc}/meshes/{l}.STL', force='mesh'); m.apply_scale(1000.0); m.apply_transform(Tsl[l]); stl[l] = m
off_tree = {l: cKDTree(trimesh.sample.sample_surface_even(stl[l], 20000, seed=3)[0]) for l in LINKS}

assign = {}
for p, m in parts:
    s = trimesh.sample.sample_surface(m, 400, seed=4)[0] if m.area > 0 else m.vertices
    med = {l: float(np.median(off_tree[l].query(s)[0])) for l in LINKS}
    best = min(med, key=med.get)
    if med[best] > 4.0:
        c = m.bounds.mean(0)
        best = 'link6' if c[1] > 330 else ('base_link' if c[2] < -140 else best)
    assign.setdefault(best, []).append((p, m, med[best]))


def dae_coloured(l):
    """DAE faces (with colours) aligned onto the STL of the same link (both in STEP frame, mm)."""
    sc = trimesh.load(f'{desc}/meshes/dae/{l}.dae')
    geoms = []
    for node in sc.graph.nodes_geometry:
        Tn, gname = sc.graph[node]
        g = sc.geometry[gname].copy(); g.apply_transform(Tn); g.apply_scale(1000.0)
        col = np.array(g.visual.material.main_color[:3]) / 255.0 if hasattr(g.visual, 'material') else np.array([0.8] * 3)
        geoms.append((g, col))
    allm = trimesh.util.concatenate([g for g, _ in geoms])
    src = trimesh.sample.sample_surface(allm, 6000, seed=5)[0]
    tgt = trimesh.sample.sample_surface(stl[l], 20000, seed=6)[0]
    tt = cKDTree(tgt); best = None
    for rv in [[0, 0, 0], [0, 0, np.pi / 2], [0, 0, np.pi], [0, 0, -np.pi / 2], [np.pi, 0, 0], [np.pi, 0, np.pi / 2], [np.pi, 0, -np.pi / 2], [0, np.pi, 0]]:
        R0 = Rot.from_rotvec(rv).as_matrix()
        T0 = np.eye(4); T0[:3, :3] = Tsl[l][:3, :3] @ R0
        T0[:3, 3] = tgt.mean(0) - (src @ T0[:3, :3].T).mean(0)
        M, _, cost = trimesh.registration.icp(src, tgt, initial=T0, max_iterations=80, threshold=1e-7)
        d = np.sort(tt.query(src @ M[:3, :3].T + M[:3, 3])[0]); c = d[: int(0.6 * len(d))].mean()   # trimmed: DAE may hold extra parts
        if best is None or c < best[0]: best = (c, M)
    centers, cols = [], []
    for g, col in geoms:
        g = g.copy(); g.apply_transform(best[1]); centers.append(g.triangles_center); cols.append(np.tile(col, (len(g.faces), 1)))
    return best[0], cKDTree(np.vstack(centers)), np.vstack(cols)


covers = {}
for l in LINKS:
    m = stl[l]
    d = tree.query(m.triangles_center)[0]
    far = np.where(d > 2.0)[0]
    if len(far) == 0: continue
    sub = m.submesh([far], append=True)
    comps = [c for c in sub.split(only_watertight=False) if c.area > 150.0]
    if not comps: continue
    fit, dtree, dcols = dae_coloured(l)
    pieces = []
    for c in comps:
        dist, ii = dtree.query(c.triangles_center)
        col = np.median(dcols[ii], axis=0) if np.median(dist) < 3.0 else np.array([0.85, 0.85, 0.86])
        pieces.append((c, col))
    covers[l] = pieces
    print(f'{l}: DAE->STL fit {fit:.2f} mm; cover pieces {len(pieces)}, area {sum(c.area for c, _ in pieces):.0f} mm2, colours {[tuple(np.round(cc, 2)) for _, cc in pieces][:6]}')


def colored(m, rgb):
    m = m.copy(); m.apply_scale(0.001)
    m.visual = trimesh.visual.ColorVisuals(m, face_colors=np.tile((np.r_[rgb, 1.0] * 255).astype(np.uint8), (len(m.faces), 1)))
    return m


R = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
for name, highlight in (('arm_preview', False), ('arm_covers_highlight', True)):
    scene = trimesh.Scene()
    for l in LINKS:
        for p, m, _ in assign.get(l, []):
            scene.add_geometry(colored(m, np.array([0.75, 0.75, 0.78]) if highlight else np.array(p['colour'] or [0.7] * 3)), node_name=f'{l}:{p["product"]}')
        for i, (c, col) in enumerate(covers.get(l, [])):
            scene.add_geometry(colored(c, np.array([1.0, 0.35, 0.1]) if highlight else col), node_name=f'{l}:cover{i}')
    scene.apply_transform(R); scene.export(f'{out}/{name}.glb')

inv = {l: np.linalg.inv(Tsl[l]) for l in LINKS}
pack = {}
for l in LINKS:
    items = []
    for p, m, _ in assign.get(l, []):
        mm = m.copy(); mm.apply_transform(inv[l]); mm.apply_scale(0.001); items.append(('step', p['product'], mm, p['colour']))
    for c, col in covers.get(l, []):
        cc = c.copy(); cc.apply_transform(inv[l]); cc.apply_scale(0.001); items.append(('cover', 'cover', cc, list(map(float, col))))
    pack[l] = items
pickle.dump(pack, open(f'{out}/arm_links.pkl', 'wb'))
print('ok')
