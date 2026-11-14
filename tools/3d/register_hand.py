# Fit the MIDAS hand URDF (palm pose + every joint) to the Hand_Assembly parts of the STEP, then assign each STEP
# hand part to a hand link.  Output: JSON (T_step_palm, STEP-pose joint angles, per-link fit) + pickle of link-frame meshes.
# usage: python3 register_hand.py LEAVES_PREFIX HAND_ASSETS_DIR OUT_DIR
import sys, os, json, pickle, itertools, numpy as np, trimesh
from scipy.spatial import cKDTree
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation as Rot
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from urdf_fk import URDF, T, axis_angle

prefix, assets, out = sys.argv[1:4]
idx = json.load(open(prefix + '.json')); A = np.load(prefix + '.npz')
hp = [(p, trimesh.Trimesh(A[p['key'] + '_v'], A[p['key'] + '_f'], process=False)) for p in idx if any('Hand_Assembly' in s for s in p['path'])]
step = trimesh.util.concatenate([m for _, m in hp])
pts = trimesh.sample.sample_surface_even(step, 250000, seed=1)[0]
tree = cKDTree(pts)
print('STEP hand parts', len(hp))

u = URDF(f'{assets}/midas_description/midas_hand_urdf.urdf')
J = {j['name']: j for j in u.joints}
meshes = {}
for l, vis in u.links.items():
    if not vis: continue
    v = vis[0]
    m = trimesh.load(f"{assets}/meshes/{os.path.basename(v['mesh'])}", force='mesh')
    m.apply_transform(v['T']); m.apply_scale(1000.0)
    meshes[l] = (m, trimesh.sample.sample_surface_even(m, 1500, seed=2)[0])


def cost(Tw, l, trim=0.85):
    d = np.sort(tree.query(meshes[l][1] @ Tw[:3, :3].T + Tw[:3, 3])[0])
    return d[: int(len(d) * trim)].mean()


def child(Tp, jn, q):
    M = J[jn]['T'].copy(); M[:3, 3] *= 1000.0
    return Tp @ M @ T(axis_angle(J[jn]['axis'], q))


# palm: 24 axis-aligned starts + ICP
palm_pts = meshes['palm_base'][1]
palm_parts = trimesh.util.concatenate([m for p, m in hp if any('Palm_Assembly' in s for s in p['path'])])
best = None
for R0 in Rot.create_group('O').as_matrix():
    T0 = np.eye(4); T0[:3, :3] = R0; T0[:3, 3] = palm_parts.bounds.mean(0) - (palm_pts @ R0.T).mean(0)
    M, _, _ = trimesh.registration.icp(palm_pts, pts, initial=T0, max_iterations=60, threshold=1e-7)
    c = cost(M, 'palm_base')
    if best is None or c < best[0]: best = (c, M)
Tpalm = best[1]
print(f'palm fit {best[0]:.2f} mm')

CHAINS = {'thumb': ['thumb_cmc_roll_joint', 'thumb_cmc_side_joint', 'thumb_mcp_joint', 'thumb_dip_joint']}
for f in ('index', 'middle', 'ring'):
    CHAINS[f] = [f'{f}_mcp_abad_joint', f'{f}_mcp_pitch_joint', f'{f}_pip_joint', f'{f}_dip_joint']
q = {}
Tl = {'palm_base': Tpalm}
for name, chain in CHAINS.items():
    for jn in chain:
        Tp = Tl[J[jn]['parent']]; l = J[jn]['child']
        lo, hi = J[jn]['limit'] if J[jn]['limit'] and J[jn]['limit'][1] > J[jn]['limit'][0] else (-np.pi, np.pi)
        lo, hi = max(lo - 0.3, -np.pi), min(hi + 0.3, np.pi)
        grid = np.linspace(lo, hi, 541)
        a = grid[int(np.argmin([cost(child(Tp, jn, x), l) for x in grid]))]
        for s in (0.01, 0.002, 0.0004):
            cand = a + np.linspace(-5, 5, 11) * s
            a = cand[int(np.argmin([cost(child(Tp, jn, x), l) for x in cand]))]
        q[jn] = float(a); Tl[l] = child(Tp, jn, a)
    if name != 'thumb':                                       # passive linkage hangs off mcp_pitch
        jn = f'{name}_dip_linkage_joint'; Tp = Tl[J[jn]['parent']]; l = J[jn]['child']
        grid = np.linspace(-np.pi, np.pi, 721)
        a = grid[int(np.argmin([cost(child(Tp, jn, x), l) for x in grid]))]
        q[jn] = float(a); Tl[l] = child(Tp, jn, a)
    print(name, {k.replace(name + '_', ''): round(np.degrees(v), 1) for k, v in q.items() if k.startswith(name)},
          {l: round(cost(Tl[l], l), 2) for l in Tl if l.startswith(name)})

# assign STEP hand parts to the nearest hand link
ltree = {l: cKDTree(trimesh.sample.sample_surface_even(meshes[l][0].copy().apply_transform(Tl[l]), 6000, seed=3)[0]) for l in Tl}
assign = {}
for p, m in hp:
    s = trimesh.sample.sample_surface(m, 300, seed=4)[0] if m.area > 0 else m.vertices
    med = {l: float(np.median(ltree[l].query(s)[0])) for l in Tl}
    b = min(med, key=med.get)
    assign.setdefault(b, []).append((p, m, med[b]))
for l in sorted(assign):
    print(f'{l:22s} {len(assign[l]):2d} parts  max part dist {max(d for *_, d in assign[l]):5.1f} mm')

pack = {}
for l, items in assign.items():
    inv = np.linalg.inv(Tl[l]); lst = []
    for p, m, d in items:
        mm = m.copy(); mm.apply_transform(inv); mm.apply_scale(0.001)
        lst.append(('step', p['product'], mm, p['colour']))
    pack[l] = lst
pickle.dump(pack, open(f'{out}/hand_links.pkl', 'wb'))
json.dump({'T_step_palm_mm': Tpalm.tolist(), 'q_step': q, 'T_step_link_mm': {l: M.tolist() for l, M in Tl.items()}},
          open(f'{out}/hand_reg.json', 'w'), indent=1)
print('ok')
