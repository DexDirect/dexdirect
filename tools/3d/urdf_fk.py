# Minimal URDF parser + forward kinematics (revolute/fixed), numpy only.
import xml.etree.ElementTree as ET
import numpy as np


def rpy_mat(r, p, y):
    cr, sr, cp, sp, cy, sy = np.cos(r), np.sin(r), np.cos(p), np.sin(p), np.cos(y), np.sin(y)
    return np.array([[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
                     [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
                     [-sp, cp * sr, cp * cr]])


def axis_angle(axis, a):
    axis = np.asarray(axis, float); axis = axis / np.linalg.norm(axis)
    x, y, z = axis; c, s = np.cos(a), np.sin(a); C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def T(R=np.eye(3), t=(0, 0, 0)):
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = t; return M


class URDF:
    def __init__(self, path):
        root = ET.parse(path).getroot()
        self.links = {}
        for l in root.findall('link'):
            vis = []
            for v in l.findall('visual'):
                o = v.find('origin'); m = v.find('geometry/mesh')
                if m is None: continue
                xyz = [float(s) for s in (o.get('xyz', '0 0 0') if o is not None else '0 0 0').split()]
                rpy = [float(s) for s in (o.get('rpy', '0 0 0') if o is not None else '0 0 0').split()]
                col = v.find('material/color')
                vis.append({'mesh': m.get('filename'), 'T': T(rpy_mat(*rpy), xyz),
                            'scale': [float(s) for s in m.get('scale', '1 1 1').split()],
                            'rgba': [float(s) for s in col.get('rgba').split()] if col is not None else None})
            self.links[l.get('name')] = vis
        self.joints = []
        for j in root.findall('joint'):
            o = j.find('origin'); a = j.find('axis'); lim = j.find('limit'); mim = j.find('mimic')
            xyz = [float(s) for s in (o.get('xyz', '0 0 0') if o is not None else '0 0 0').split()]
            rpy = [float(s) for s in (o.get('rpy', '0 0 0') if o is not None else '0 0 0').split()]
            self.joints.append({'name': j.get('name'), 'type': j.get('type'), 'parent': j.find('parent').get('link'),
                                'child': j.find('child').get('link'), 'T': T(rpy_mat(*rpy), xyz),
                                'axis': [float(s) for s in a.get('xyz').split()] if a is not None else [1, 0, 0],
                                'limit': (float(lim.get('lower', 0)), float(lim.get('upper', 0))) if lim is not None else None,
                                'mimic': (mim.get('joint'), float(mim.get('multiplier', 1)), float(mim.get('offset', 0))) if mim is not None else None})
        children = {j['child'] for j in self.joints}
        self.root = [n for n in self.links if n not in children][0]
        self.by_parent = {}
        for j in self.joints: self.by_parent.setdefault(j['parent'], []).append(j)

    def fk(self, q=None, base=np.eye(4)):
        q = q or {}
        out = {self.root: base}
        stack = [self.root]
        while stack:
            p = stack.pop()
            for j in self.by_parent.get(p, []):
                M = out[p] @ j['T']
                if j['type'] in ('revolute', 'continuous'):
                    v = q.get(j['name'], 0.0)
                    if j['mimic']: v = q.get(j['mimic'][0], 0.0) * j['mimic'][1] + j['mimic'][2]
                    M = M @ T(axis_angle(j['axis'], v))
                out[j['child']] = M
                stack.append(j['child'])
        return out
