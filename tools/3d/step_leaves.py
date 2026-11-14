# Export every leaf part of a STEP assembly as a triangle mesh in assembly coordinates (mm, Z-up) -> npz + json index.
# usage: python3 step_leaves.py IN.step OUT_prefix [lin_defl_mm] [ang_defl_rad]
import sys, json, numpy as np
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorSurf, XCAFDoc_ColorGen, XCAFDoc_ColorTool
from OCP.TDF import TDF_LabelSequence, TDF_Label
from OCP.TDataStd import TDataStd_Name
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.Quantity import Quantity_Color
from OCP.gp import gp_Trsf

src, prefix = sys.argv[1:3]
lin = float(sys.argv[3]) if len(sys.argv) > 3 else 0.2
ang = float(sys.argv[4]) if len(sys.argv) > 4 else 0.35
doc = TDocStd_Document(TCollection_ExtendedString('MDTV-XCAF'))
rd = STEPCAFControl_Reader(); rd.SetColorMode(True); rd.SetNameMode(True)
assert rd.ReadFile(src) == IFSelect_RetDone
rd.Transfer(doc)
st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())


def name(lbl):
    a = TDataStd_Name()
    return TCollection_AsciiString(a.Get()).ToCString() if lbl.FindAttribute(TDataStd_Name.GetID_s(), a) else ''


def colour(lbl):
    c = Quantity_Color()
    for t in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen):
        if XCAFDoc_ColorTool.GetColor_s(lbl, t, c):
            return [c.Red(), c.Green(), c.Blue()]
    return None


def mesh_of(shape, trsf):
    BRepMesh_IncrementalMesh(shape, lin, False, ang, True)
    V, F, off = [], [], 0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            t = gp_Trsf(); t.Multiply(trsf); t.Multiply(loc.Transformation())
            n = tri.NbNodes()
            pts = np.array([[p.X(), p.Y(), p.Z()] for p in (tri.Node(i).Transformed(t) for i in range(1, n + 1))])
            tr = np.array([tri.Triangle(i).Get() for i in range(1, tri.NbTriangles() + 1)]) - 1
            if face.Orientation() == TopAbs_REVERSED: tr = tr[:, ::-1]
            V.append(pts); F.append(tr + off); off += n
        exp.Next()
    return (np.vstack(V), np.vstack(F)) if V else (np.zeros((0, 3)), np.zeros((0, 3), int))


index, arrays = [], {}


def walk(lbl, trsf, path, col):
    if st.IsAssembly_s(lbl):
        comps = TDF_LabelSequence(); st.GetComponents_s(lbl, comps, False)
        for i in range(1, comps.Length() + 1):
            c = comps.Value(i); ref = TDF_Label(); st.GetReferredShape_s(c, ref)
            t = gp_Trsf(); t.Multiply(trsf); t.Multiply(st.GetLocation_s(c).Transformation())
            walk(ref, t, path + [name(c) or name(ref)], colour(c) or col)
    else:
        V, F = mesh_of(st.GetShape_s(lbl), trsf)
        k = f'p{len(index):03d}'
        arrays[k + '_v'] = V.astype(np.float32); arrays[k + '_f'] = F.astype(np.int32)
        index.append({'key': k, 'path': path, 'product': name(lbl), 'colour': col or colour(lbl), 'nv': len(V), 'nf': len(F)})


roots = TDF_LabelSequence(); st.GetFreeShapes(roots)
for i in range(1, roots.Length() + 1):
    r = roots.Value(i); walk(r, gp_Trsf(), [name(r)], colour(r))
np.savez_compressed(prefix + '.npz', **arrays)
json.dump(index, open(prefix + '.json', 'w'), indent=1, ensure_ascii=False)
print('parts', len(index), 'triangles', sum(p['nf'] for p in index))
