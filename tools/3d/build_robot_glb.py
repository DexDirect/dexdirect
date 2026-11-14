# Articulated PiPER + MIDAS hand GLB (Z-up, metres) from the per-link meshes, plus a joint table JSON.
# Hierarchy: <link> -> O_<joint> (fixed origin) -> J_<joint> (rotation about axis, identity at q=0) -> <child link>.
# usage: python3 build_robot_glb.py SCRATCH OUT_GLB OUT_JOINTS_JSON [arm_keep] [hand_keep]
import sys, os, json, pickle, numpy as np, trimesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from urdf_fk import URDF
import fast_simplification

S, out_glb, out_json = sys.argv[1:4]
ARM_KEEP = float(sys.argv[4]) if len(sys.argv) > 4 else 0.17
HAND_KEEP = float(sys.argv[5]) if len(sys.argv) > 5 else 0.15
arm = URDF(f'{S}/src/piper_ros/src/piper_description/urdf/piper_no_gripper_description.urdf')
hand = URDF(f'{S}/src/midas_hand_mujoco/assets/midas_description/midas_hand_urdf.urdf')
A = pickle.load(open(f'{S}/model/arm_links.pkl', 'rb')); H = pickle.load(open(f'{S}/model/hand_links.pkl', 'rb'))
pr = json.load(open(f'{S}/model/piper_reg.json')); hr = json.load(open(f'{S}/model/hand_reg.json'))
T6p = np.linalg.inv(np.array(pr['links']['link6']['T_step_link_mm'])) @ np.array(hr['T_step_palm_mm']); T6p[:3, 3] /= 1000.0


def material(rgb):
    r, g, b = rgb; lum = 0.3 * r + 0.59 * g + 0.11 * b; sat = max(rgb) - min(rgb)
    if sat > 0.25: return dict(metal=0.0, rough=0.45)            # orange handle, red accents, blue mount
    if lum > 0.9: return dict(metal=0.0, rough=0.42)             # white plastic covers
    if lum > 0.7: return dict(metal=0.25, rough=0.38)            # light grey housings
    if lum > 0.35: return dict(metal=0.6, rough=0.34)            # anodised aluminium
    return dict(metal=0.05, rough=0.6)                           # black plastic / TPU


def link_meshes(items, keep):
    groups = {}
    for kind, name, m, col in items:
        if m.bounding_box.extents.max() < 0.005: continue           # screws, nuts
        col = tuple(np.round(np.clip(col if col is not None else [0.7] * 3, 0, 1), 2))
        groups.setdefault(col, []).append(m)
    out = []
    for col, ms in groups.items():
        m = trimesh.util.concatenate(ms); m.merge_vertices()
        if len(m.faces) > 400:
            v, f = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int32), target_reduction=1 - keep)
            m = trimesh.Trimesh(v, f, process=True)
        mat = material(col)
        m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            baseColorFactor=[*col, 1.0], metallicFactor=mat['metal'], roughnessFactor=mat['rough'], doubleSided=False))
        out.append((col, m))
    return out


scene = trimesh.Scene()
scene.graph.update(frame_from='world', frame_to='robot', matrix=np.eye(4))
joints = {}
tri = 0


def add_link(lname, parent, items, keep, prefix=''):
    global tri
    node = prefix + lname
    for i, (col, m) in enumerate(link_meshes(items, keep)):
        scene.add_geometry(m, node_name=f'{node}__m{i}', geom_name=f'{node}__g{i}', parent_node_name=parent)
        tri += len(m.faces)


def add_chain(u, link, parent_node, packs, keep, prefix=''):
    add_link(link, parent_node, packs.get(link, []), keep, prefix)
    for j in u.by_parent.get(link, []):
        o, r = f'O_{j["name"]}', f'J_{j["name"]}'
        scene.graph.update(frame_from=parent_node, frame_to=o, matrix=j['T'])
        scene.graph.update(frame_from=o, frame_to=r, matrix=np.eye(4))
        if j['type'] in ('revolute', 'continuous'):
            joints[j['name']] = {'node': r, 'axis': [round(a, 6) for a in j['axis']], 'limit': j['limit']}
        add_chain(u, j['child'], r, packs, keep, prefix)


# arm: base_link hangs directly under 'robot'; link nodes are the rotation nodes themselves
def add_arm(link, parent_node):
    add_link(link, parent_node, A.get(link, []), ARM_KEEP)
    for j in arm.by_parent.get(link, []):
        o, r = f'O_{j["name"]}', f'J_{j["name"]}'
        scene.graph.update(frame_from=parent_node, frame_to=o, matrix=j['T'])
        scene.graph.update(frame_from=o, frame_to=r, matrix=np.eye(4))
        if j['type'] in ('revolute', 'continuous'):
            joints[j['name']] = {'node': r, 'axis': [round(a, 6) for a in j['axis']], 'limit': j['limit']}
        if j['child'] == 'link6':
            add_link('link6', r, A.get('link6', []), ARM_KEEP)
            scene.graph.update(frame_from=r, frame_to='hand_mount', matrix=T6p)
            add_chain(hand, 'palm_base', 'hand_mount', H, HAND_KEEP)
        else:
            add_arm(j['child'], r)


scene.graph.update(frame_from='robot', frame_to='base', matrix=np.eye(4))
add_arm('base_link', 'base')
scene.export(out_glb)
json.dump({'joints': joints, 'T_link6_palm': T6p.tolist()}, open(out_json, 'w'), indent=1)
print(f'triangles {tri}, joints {len(joints)}, glb {os.path.getsize(out_glb) / 1e6:.1f} MB')
