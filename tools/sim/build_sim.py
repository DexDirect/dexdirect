#!/usr/bin/env python3
"""Build the MuJoCo playground model for the project page (static/sim/dexdirect.xml).

PiPER arm: body tree generated from AgileX's official URDF (exact frames, URDF inertials), clamped to the side of a
vertical post as on the real station (base +y up), gravity-compensated with low joint damping and no position
stiffness, like the real drag mode. MIDAS hand: the subtree of midas_whole_hand.xml (inertials, contact primitives,
PIP-DIP linkage constraints, 13 position actuators), mounted on link6 at the pose fitted from the team's STEP.
No meshes are needed: the page renders robot.glb and drives it from the simulated joint angles.

  python3 tools/sim/build_sim.py PIPER_URDF MIDAS_MJCF ROBOT_JOINTS_JSON OUT_XML OUT_META_JSON
"""
import json, sys, os, copy
import xml.etree.ElementTree as ET
import numpy as np
from scipy.spatial.transform import Rotation as Rot
from scipy.optimize import least_squares
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '3d'))
from urdf_fk import URDF  # noqa: E402

urdf_path, midas_path, joints_json, out_xml, out_meta = sys.argv[1:6]
f6 = lambda v: ' '.join(f'{x:.6g}' for x in v)
quat = lambda R: Rot.from_matrix(R).as_quat()[[3, 0, 1, 2]]        # wxyz

TABLE_Z = 0.75                    # table top above the floor
BASE_Z = TABLE_Z + 0.3733         # robot base origin: 0.373 m above the table top (from the recorded episode)
BASE_Q = [0.70710678, 0.70710678, 0, 0]   # base +y -> world +z (arm clamped to a vertical post)
GRIP = [-0.0537, -0.0637, 0.0642]          # handle grip-bar centre in link6 (from the STEP)
DAMP = {'joint1': 2.0, 'joint2': 2.0, 'joint3': 1.5, 'joint4': 0.35, 'joint5': 0.35, 'joint6': 0.25}

# ---------- arm from the URDF ----------
import xml.etree.ElementTree as ET2
ur = ET2.parse(urdf_path).getroot()
inert = {}
for l in ur.findall('link'):
    i = l.find('inertial')
    if i is None: continue
    o = i.find('origin'); m = float(i.find('mass').get('value')); I = i.find('inertia')
    xyz = [float(s) for s in (o.get('xyz', '0 0 0') if o is not None else '0 0 0').split()]
    rpy = [float(s) for s in (o.get('rpy', '0 0 0') if o is not None else '0 0 0').split()]
    Iv = {k: float(I.get(k)) for k in ('ixx', 'iyy', 'izz', 'ixy', 'ixz', 'iyz')}
    Im = np.array([[Iv['ixx'], Iv['ixy'], Iv['ixz']], [Iv['ixy'], Iv['iyy'], Iv['iyz']], [Iv['ixz'], Iv['iyz'], Iv['izz']]])
    R = Rot.from_euler('xyz', rpy).as_matrix(); Iw = R @ Im @ R.T
    inert[l.get('name')] = (xyz, m, Iw)
u = URDF(urdf_path)

def inertial_xml(name):
    xyz, m, I = inert[name]
    return f'<inertial pos="{f6(xyz)}" mass="{m:.6g}" fullinertia="{f6([I[0,0], I[1,1], I[2,2], I[0,1], I[0,2], I[1,2]])}"/>'

# collision capsules on the outer arm (contype 2: hits the table and cubes, never the hand)
ARM_COL = {
    'link3': '<geom type="capsule" fromto="-0.02 -0.03 0  -0.02 -0.22 0" size="0.032" class="armcol"/>',
    'link4': '<geom type="capsule" fromto="0 0 -0.03  0 0 0.03" size="0.034" class="armcol"/>',
    'link5': '<geom type="capsule" fromto="0 -0.02 0  0 -0.08 0" size="0.034" class="armcol"/>',
    'link6': '<geom type="cylinder" pos="0 0 0.012" size="0.034 0.014" class="armcol"/>',
}

midas = ET.parse(midas_path).getroot()
palm = midas.find('worldbody').find("body[@name='palm_base']")
palm = copy.deepcopy(palm)
for b in palm.iter('body'):
    b.set('gravcomp', '1')
    for g in list(b.findall('geom')):
        if g.get('mesh') is not None or g.get('type') == 'mesh': b.remove(g)   # visuals come from robot.glb
T6p = np.array(json.load(open(joints_json))['T_link6_palm'])
palm_xml = ET.tostring(palm, encoding='unicode')
hand_xml = f'<body name="hand_mount" pos="{f6(T6p[:3, 3])}" quat="{f6(quat(T6p[:3, :3]))}" gravcomp="1">{palm_xml}</body>'

def arm_body(link, indent=''):
    out = []
    for j in u.by_parent.get(link, []):
        c = j['child']; T = j['T']
        lim = j['limit']
        if j['name'] == 'joint5': lim = (-1.35, 1.35)      # the real arm reaches -1.305 rad (recorded episode)
        out.append(f'<body name="{c}" pos="{f6(T[:3, 3])}" quat="{f6(quat(T[:3, :3]))}" gravcomp="1">')
        out.append(inertial_xml(c))
        out.append(f'<joint name="{j["name"]}" axis="{f6(j["axis"])}" range="{lim[0]:.4f} {lim[1]:.4f}" damping="{DAMP[j["name"]]}" armature="0.02"/>')
        if c in ARM_COL: out.append(ARM_COL[c])
        if c == 'link6':
            out.append(f'<site name="grip" pos="{f6(GRIP)}" size="0.006"/>')
            out.append(hand_xml)
        out.extend(arm_body(c))
        out.append('</body>')
    return out

arm_xml = '\n'.join([f'<body name="base_link" pos="0 0 {BASE_Z:.4f}" quat="{f6(BASE_Q)}">', inertial_xml('base_link')] + arm_body('base_link') + ['</body>'])

defaults = ET.tostring(midas.find('default'), encoding='unicode')
defaults = defaults.replace('<default>', '<default>\n    <default class="armcol"><geom contype="2" conaffinity="0" rgba="1 0.5 0 0.15" group="2"/></default>\n'
                            '    <default class="world"><geom contype="3" conaffinity="3" friction="1 0.01 0.001"/></default>', 1)
equality = ET.tostring(midas.find('equality'), encoding='unicode')
contact = ET.tostring(midas.find('contact'), encoding='unicode').replace(
    '</contact>', '<exclude body1="link6" body2="palm_base"/><exclude body1="link6" body2="hand_mount"/></contact>')
actuator = ET.tostring(midas.find('actuator'), encoding='unicode')

CUBES = [('cube_orange', [0.44, -0.30], '0.96 0.46 0.08 1'), ('cube_blue', [0.50, -0.20], '0.16 0.38 0.86 1'),
         ('cube_white', [0.37, -0.38], '0.93 0.93 0.91 1'), ('cube_green', [0.53, -0.36], '0.25 0.66 0.38 1')]
TRAY = [0.30, -0.52]
cubes_xml = '\n'.join(f'<body name="{n}" pos="{p[0]} {p[1]} {TABLE_Z + 0.0205}"><freejoint name="{n}"/>'
                      f'<geom type="box" size="0.02 0.02 0.02" mass="0.04" rgba="{c}" class="world" friction="1.2 0.01 0.001"/></body>'
                      for n, p, c in CUBES)
tw = 0.006
tray_xml = (f'<body name="tray" pos="{TRAY[0]} {TRAY[1]} {TABLE_Z}">'
            f'<geom type="box" pos="0 0 {tw/2}" size="0.075 0.075 {tw/2}" rgba="0.2 0.21 0.23 1" class="world"/>'
            + ''.join(f'<geom type="box" pos="{x} {y} 0.025" size="{sx} {sy} 0.025" rgba="0.2 0.21 0.23 1" class="world"/>'
                      for x, y, sx, sy in [(0.075, 0, tw / 2, 0.075), (-0.075, 0, tw / 2, 0.075), (0, 0.075, 0.075, tw / 2), (0, -0.075, 0.075, tw / 2)])
            + '</body>')

xml = f'''<mujoco model="dexdirect_playground">
  <compiler angle="radian" autolimits="true"/>
  <option timestep="0.002" integrator="implicitfast" cone="elliptic" impratio="10" gravity="0 0 -9.81"/>
  {defaults}
  <worldbody>
    <light pos="0.3 -0.3 2.5" dir="0 0 -1" directional="true"/>
    <geom name="floor" type="plane" size="4 4 0.1" rgba="0.1 0.1 0.11 1" class="world"/>
    <geom name="table" type="box" pos="0.42 -0.25 {TABLE_Z - 0.02}" size="0.5 0.42 0.02" rgba="0.72 0.55 0.38 1" class="world"/>
    <geom name="post" type="box" pos="-0.005 0.0454 {(BASE_Z + 0.24 + TABLE_Z) / 2:.4f}" size="0.025 0.025 {(BASE_Z + 0.24 - TABLE_Z) / 2:.4f}" rgba="0.72 0.74 0.77 1" class="world"/>
    {arm_xml}
    {cubes_xml}
    {tray_xml}
  </worldbody>
  {equality}
  {contact}
  {actuator}
</mujoco>'''

# ---------- home pose: palm down above the cubes ----------
import mujoco
m = mujoco.MjModel.from_xml_string(xml); d = mujoco.MjData(m)
J = [m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, f'joint{i}')] for i in range(1, 7)]
palm_id = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, 'palm_base')
target_p = np.array([0.36, -0.27, TABLE_Z + 0.24])
fwd = np.array([0.82, 0.12, -0.42]); fwd /= np.linalg.norm(fwd)           # fingers forward, tilted a little down
z_palm = np.array([0.0, 0.0, 1.0]); z_palm = z_palm - fwd * (z_palm @ fwd); z_palm /= np.linalg.norm(z_palm)   # palm (-Z) faces down
Rt = np.stack([np.cross(fwd, z_palm), fwd, z_palm], 1)

def res(q):
    d.qpos[J] = q; mujoco.mj_kinematics(m, d)
    R = d.xmat[palm_id].reshape(3, 3)
    return np.r_[d.xpos[palm_id] - target_p, 0.15 * Rot.from_matrix(Rt @ R.T).as_rotvec()]

jid = [mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, f'joint{i}') for i in range(1, 7)]
lo, hi = m.jnt_range[jid, 0] + 1e-3, m.jnt_range[jid, 1] - 1e-3
best = None
for u_ in np.random.default_rng(3).uniform(0, 1, size=(60, 6)):
    r = least_squares(res, lo + u_ * (hi - lo), bounds=(lo, hi))
    if best is None or r.cost < best.cost: best = r
home_arm = best.x
print('home arm (deg):', np.round(np.degrees(home_arm), 1).tolist(), 'residual', np.round(best.fun, 4).tolist())
mujoco.mj_resetData(m, d); d.qpos[J] = home_arm
key = ' '.join(f'{v:.6g}' for v in d.qpos)
xml = xml.replace('</mujoco>', f'  <keyframe><key name="home" qpos="{key}"/></keyframe>\n</mujoco>')
m = mujoco.MjModel.from_xml_string(xml)
d = mujoco.MjData(m); mujoco.mj_resetDataKeyframe(m, d, 0); mujoco.mj_forward(m, d)
touch = [(mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[c.geom1]), mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[c.geom2]))
         for c in d.contact[:d.ncon] if c.dist < 0 and 'cube' not in str(mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[c.geom1])) + str(mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[c.geom2])) or (c.dist < -0.001)]
assert not touch, f'home pose starts in contact: {touch}'
open(out_xml, 'w').write(xml)

# DIP / linkage coupling (for the retargeting's forward kinematics) and joint lists for the page
d = mujoco.MjData(m)
qa = lambda nm: m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, nm)]
sid = lambda nm: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_SITE, nm)
pips = np.linspace(-1.45, 0.0, 30); dip, lnk = [], []; x0 = np.zeros(2)
for p in pips[::-1]:
    mujoco.mj_resetDataKeyframe(m, d, 0); d.qpos[qa('index_pip_joint')] = p
    def rr(v):
        d.qpos[qa('index_dip_joint')], d.qpos[qa('index_dip_linkage_joint')] = v; mujoco.mj_kinematics(m, d)
        return d.site_xpos[sid('index_dip_pin')] - d.site_xpos[sid('index_linkage_pin')]
    x0 = least_squares(rr, x0, xtol=1e-12).x; dip.append(x0[0]); lnk.append(x0[1])
meta = {'coupling': {'pip': np.round(pips, 4).tolist(), 'dip': np.round(dip[::-1], 4).tolist(), 'linkage': np.round(lnk[::-1], 4).tolist()},
        'actuators': [mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_ACTUATOR, i) for i in range(m.nu)],
        'cubes': [n for n, _, _ in CUBES], 'table_z': TABLE_Z, 'base': {'pos': [0, 0, BASE_Z], 'quat': BASE_Q}, 'grip': GRIP}
json.dump(meta, open(out_meta, 'w'), indent=1)
print(f'model ok: nbody {m.nbody}, nq {m.nq}, nu {m.nu}, ngeom {m.ngeom}; xml {len(xml) // 1024} KB')
