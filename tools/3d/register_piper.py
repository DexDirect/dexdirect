# Fit the official PiPER URDF (base pose + 6 joint angles) to the PiPER parts of the STEP assembly, then find the
# official-mesh surface the STEP lacks (missing covers).  Fast version: base by yaw sweep + ICP, joints by 1-D sweeps
# down the chain, then one short joint refinement.
# usage: python3 register_piper.py LEAVES_PREFIX PIPER_DESC_DIR OUT_JSON
import sys, os, json, numpy as np, trimesh
from scipy.spatial import cKDTree
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation as Rot
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from urdf_fk import URDF, T, axis_angle

prefix, desc, out_json = sys.argv[1:4]
idx = json.load(open(prefix + '.json')); A = np.load(prefix + '.npz')
piper = [p for p in idx if any('PIPER' in s for s in p['path'])]
step = trimesh.util.concatenate([trimesh.Trimesh(A[p['key'] + '_v'], A[p['key'] + '_f'], process=False) for p in piper])
pts_step, _ = trimesh.sample.sample_surface_even(step, 300000, seed=1)
tree = cKDTree(pts_step)

urdf = URDF(f'{desc}/urdf/piper_no_gripper_description.urdf')
LINKS = ['base_link', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6']
JN = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6']
J = {j['name']: j for j in urdf.joints}
lm = {}
for l in LINKS:
    v = urdf.links[l][0]
    m = trimesh.load(os.path.join(desc, v['mesh'].replace('package://piper_description/', '')), force='mesh')
    M = v['T'].copy(); m.apply_transform(M); m.apply_scale(1000.0)     # link frame, mm
    s, _ = trimesh.sample.sample_surface_even(m, 2500, seed=2)
    lm[l] = (m, s)


def cost(Tw, l, trim=0.8):
    P = lm[l][1] @ Tw[:3, :3].T + Tw[:3, 3]
    d, _ = tree.query(P)
    d.sort()
    return d[: int(len(d) * trim)].mean()                                 # trimmed mean: tolerate missing covers


def child_T(Tp, jn, q):
    M = J[jn]['T'].copy(); M[:3, 3] *= 1000.0
    return Tp @ M @ T(axis_angle(J[jn]['axis'], q))


# --- base: yaw sweep with z up, then ICP refine
best = None
for yaw in np.linspace(0, 2 * np.pi, 72, endpoint=False):
    T0 = T(Rot.from_euler('z', yaw).as_matrix(), [-193.0, 38.0, -228.0])
    c = cost(T0, 'base_link')
    if best is None or c < best[0]: best = (c, T0)
Tb = best[1]
for _ in range(3):
    src = lm['base_link'][1]
    Mx, _, c = trimesh.registration.icp(src, pts_step[tree.query_ball_point(Tb[:3, 3], 160)], initial=Tb, max_iterations=60, threshold=1e-6)
    Tb = Mx
print('base trimmed-mean dist %.2f mm' % cost(Tb, 'base_link'))

# --- joints: 1-D sweeps down the chain
q = []
Tp = Tb
for jn, l in zip(JN, LINKS[1:]):
    lo, hi = J[jn]['limit']
    grid = np.linspace(lo - 0.2, hi + 0.2, 721)
    cs = [cost(child_T(Tp, jn, a), l) for a in grid]
    a = grid[int(np.argmin(cs))]
    for step_ in (0.01, 0.002, 0.0004):                                     # local refine
        cand = a + np.linspace(-5, 5, 11) * step_
        a = cand[int(np.argmin([cost(child_T(Tp, jn, x), l) for x in cand]))]
    q.append(a); Tp = child_T(Tp, jn, a)
    print(f'{jn}: q = {a:+.4f} rad ({np.degrees(a):+.1f} deg), {l} trimmed-mean {cost(Tp, l):.2f} mm')


# --- joint refinement of base + q
def chain(p):
    Tb_ = T(Rot.from_rotvec(p[:3]).as_matrix(), p[3:6]); Ts = {'base_link': Tb_}; Tp_ = Tb_
    for k, (jn, l) in enumerate(zip(JN, LINKS[1:])):
        Tp_ = child_T(Tp_, jn, p[6 + k]); Ts[l] = Tp_
    return Ts


def resid(p):
    Ts = chain(p); r = []
    for l in LINKS:
        P = lm[l][1][::3] @ Ts[l][:3, :3].T + Ts[l][:3, 3]
        r.append(tree.query(P)[0])
    return np.concatenate(r)


p0 = np.r_[Rot.from_matrix(Tb[:3, :3]).as_rotvec(), Tb[:3, 3], q]
res = least_squares(resid, p0, loss='soft_l1', f_scale=1.0, max_nfev=60, x_scale=np.r_[[0.01] * 3, [1] * 3, [0.01] * 6])
Ts = chain(res.x)
report = {'base_rotvec': res.x[:3].tolist(), 'base_t_mm': res.x[3:6].tolist(), 'q': dict(zip(JN, res.x[6:].tolist())), 'links': {}}
for l in LINKS:
    m = lm[l][0].copy(); m.apply_transform(Ts[l])
    d, _ = tree.query(m.triangles_center)
    far = d > 2.0
    report['links'][l] = {'T_step_link_mm': Ts[l].tolist(), 'median_mm': float(np.median(d)),
                          'missing_area_mm2': float(m.area_faces[far].sum()), 'area_mm2': float(m.area)}
    print(f'{l}: median {np.median(d):.2f} mm, official-mesh area missing in STEP: {m.area_faces[far].sum():.0f} / {m.area:.0f} mm2')
print('q (deg):', np.round(np.degrees(res.x[6:]), 2).tolist())
json.dump(report, open(out_json, 'w'), indent=1)
