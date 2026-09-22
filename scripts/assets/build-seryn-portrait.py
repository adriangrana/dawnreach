"""Bake CC0 MakeHuman asset data into Seryn's synchronous runtime portrait.

No MakeHuman application code is imported. Downloads are OBJ/target data only.
Run from the repository root with Python 3; the cache avoids repeat downloads.
"""
from pathlib import Path
from collections import defaultdict
import json, math, urllib.request

CACHE = Path('node_modules/.cache/seryn-source')
OUT = Path('src/game/heroes/seryn/assets/portrait.json')
BASE = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/'
CACHE.mkdir(parents=True, exist_ok=True)

def fetch(path, name):
    dest = CACHE / name
    if not dest.exists(): urllib.request.urlretrieve(BASE + path, dest)
    return dest.read_text()

def obj(text):
    points, uv, faces = [], [], []
    group = ''
    for line in text.splitlines():
        a = line.split()
        if not a: continue
        if a[0] == 'v': points.append(list(map(float, a[1:4])))
        elif a[0] == 'vt': uv.append(list(map(float, a[1:3])))
        elif a[0] == 'g': group = a[1]
        elif a[0] == 'f': faces.append((group, [tuple(int(i)-1 for i in t.split('/')[:2]) for t in a[1:]]))
    return points, uv, faces

vertices, uvs, source_faces = obj(fetch('3dobjs/base.obj', 'base.obj'))
for target, name, weight in [
    ('macrodetails/caucasian-female-young', 'female', 1),
    ('macrodetails/universal-female-young-averagemuscle-averageweight', 'body', 1),
    ('mouth/mouth-upperlip-volume-incr', 'upper-lip', .23),
    ('mouth/mouth-lowerlip-volume-incr', 'lower-lip', .16),
    ('nose/nose-point-up', 'nose-tip', .12),
    ('chin/chin-width-decr', 'chin', .12),
    ('head/head-invertedtriangular', 'heart-contour', .13),
    ('mouth/mouth-scale-vert-decr', 'mouth-height', .16),
    ('nose/nose-volume-decr', 'nose-volume', .12),
]:
    for line in fetch('targets/' + target + '.target', name + '.target').splitlines():
        a = line.split()
        if not a or a[0].startswith('#'): continue
        i = int(a[0])
        vertices[i] = [p + weight * float(d) for p, d in zip(vertices[i], a[1:4])]

def transform(p): return [p[0] * .20, (p[1] - 6.65) * .20, (p[2] - .58) * .20]

# Only the connected skin above the collar; helper geometry never enters the game.
selected = [f for g, f in source_faces if g == 'body' and min(vertices[i][1] for i, _ in f) > 5.55]
ids = sorted({i for f in selected for i, _ in f})
remap = {i: j for j, i in enumerate(ids)}
points = [transform(vertices[i]) for i in ids]
# Extend the existing ear cartilage smoothly into an elven upper helix.
for p in points:
    ear = max(0, min(1, (abs(p[0]) - .135) / .035))
    upper = math.exp(-((p[1] - .005) / .045) ** 2)
    p[0] += math.copysign(.028 * ear * upper, p[0]); p[1] += .030 * ear * upper
faces = [[remap[i] for i, _ in f] for f in selected]
face_uv = [[uvs[t] for _, t in f] for f in selected]

# Continue the anatomical neck loop down inside the collar. Cutting the source at
# the neck removes the clavicles without squeezing the neck into an hourglass.
boundary_edges = defaultdict(list)
for fi,f in enumerate(faces):
    for k,a in enumerate(f):
        b=f[(k+1)%len(f)];boundary_edges[tuple(sorted((a,b)))].append((fi,k,a,b))
neck_edges=[fs[0] for fs in boundary_edges.values() if len(fs)==1 and max(points[fs[0][2]][1],points[fs[0][3]][1])<-.17]
previous={i:i for _,_,a,b in neck_edges for i in (a,b)}
neck_center=sum(points[i][2] for i in previous)/len(previous)
for step in range(1,4):
    next_ring={}
    for i in previous:
        p=points[i];t=step/3
        next_ring[i]=len(points)
        angle=math.atan2(p[0],p[2]-neck_center);blend=1-(1-t)**2
        points.append([p[0]+(math.sin(angle)*.073-p[0])*blend,p[1]+(-.34-p[1])*t,
            p[2]+(math.cos(angle)*.063-.065-p[2])*blend])
    for fi,k,a,b in neck_edges:
        ta,tb=face_uv[fi][k],face_uv[fi][(k+1)%len(face_uv[fi])]
        faces.append([previous[b],previous[a],next_ring[a],next_ring[b]])
        face_uv.append([tb,ta,ta,tb])
    previous=next_ring

def avg(ps): return [sum(v[d] for v in ps) / len(ps) for d in range(len(ps[0]))]
def subdivide(points, faces, tex):
    centers = [avg([points[i] for i in f]) for f in faces]
    edges, incident = {}, defaultdict(list)
    for fi, f in enumerate(faces):
        for k, a in enumerate(f):
            b = f[(k+1) % len(f)]; key = tuple(sorted((a,b)))
            edges.setdefault(key, []).append(fi); incident[a].append(fi)
    neighbours, boundary = defaultdict(list), defaultdict(list)
    for (a,b), fs in edges.items():
        neighbours[a].append(b); neighbours[b].append(a)
        if len(fs) == 1: boundary[a].append(b); boundary[b].append(a)
    result = []
    for i, p in enumerate(points):
        if boundary[i]: result.append([p[d]*.75 + sum(points[j][d] for j in boundary[i])*.125 for d in range(3)])
        else:
            n = len(incident[i]); F = avg([centers[j] for j in incident[i]])
            R = avg([avg([p, points[j]]) for j in neighbours[i]])
            result.append([(F[d]+2*R[d]+(n-3)*p[d])/n for d in range(3)])
    edge_ids = {}
    for (a,b), fs in edges.items():
        edge_ids[(a,b)] = len(result)
        result.append(avg([points[a], points[b]] + ([centers[j] for j in fs] if len(fs) == 2 else [])))
    center_start = len(result); result.extend(centers)
    newfaces, newuv = [], []
    for fi, f in enumerate(faces):
        t = tex[fi]; tc = avg(t)
        for k,a in enumerate(f):
            b,c = f[(k+1)%len(f)], f[k-1]
            newfaces.append([a, edge_ids[tuple(sorted((a,b)))], center_start+fi, edge_ids[tuple(sorted((a,c)))]])
            newuv.append([t[k], avg([t[k],t[(k+1)%len(f)]]), tc, avg([t[k],t[k-1]])])
    return result, newfaces, newuv

for _ in range(1): points, faces, face_uv = subdivide(points, faces, face_uv)

def pack(points, faces, tex):
    normals = [[0.,0.,0.] for _ in points]
    triangles = []
    for fi,f in enumerate(faces):
        for k in range(1,len(f)-1):
            a,b,c = f[0],f[k],f[k+1]
            u = [points[b][d]-points[a][d] for d in range(3)]
            v = [points[c][d]-points[a][d] for d in range(3)]
            n = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
            for i in (a,b,c): normals[i] = [normals[i][d]+n[d] for d in range(3)]
            triangles.append([(a,tex[fi][0]),(b,tex[fi][k]),(c,tex[fi][k+1])])
    for i,n in enumerate(normals):
        size = math.sqrt(sum(x*x for x in n)) or 1
        normals[i] = [x/size for x in n]
    pos, norm, uv, index, lookup = [],[],[],[],{}
    for tri in triangles:
        for i,t in tri:
            key = (i,round(t[0],7),round(t[1],7))
            if key not in lookup:
                lookup[key] = len(pos)//3; pos.extend(points[i]); norm.extend(normals[i]); uv.extend(t)
            index.append(lookup[key])
    return {k:[round(x,6) for x in a] for k,a in [('position',pos),('normal',norm),('uv',uv),('index',index)]}

# Eye proxy's barycentric fitting data carries the same female morph as the face.
ep, euv, ef = obj(fetch('eyes/high-poly/high-poly.obj','eyes.obj'))
proxy = fetch('eyes/high-poly/high-poly.mhclo','eyes.mhclo').split('verts 0',1)[1]
fitted = []
for line in proxy.splitlines():
    a = line.split()
    if not a: continue
    if len(a) == 1 and a[0].isdigit(): fitted.append(vertices[int(a[0])])
    elif len(a) == 9 and a[0].isdigit():
        ids = list(map(int,a[:3])); weights=list(map(float,a[3:6])); offset=list(map(float,a[6:9]))
        fitted.append([sum(vertices[i][d]*w for i,w in zip(ids,weights))+offset[d] for d in range(3)])
    else: break
ep = [transform(p) for p in fitted[:len(ep)]]
eyes = pack(ep, [[i for i,t in f] for _,f in ef], [[euv[t] for i,t in f] for _,f in ef])

# Smooth cranial envelope, calibrated to the morphed head; ears stay exposed.
scalp=[]; columns=72; rows=36
for row in range(rows+1):
    for col in range(columns+1):
        theta=col/columns*math.tau; front=max(0,math.cos(theta))
        end=1.64+.49*max(0,-math.cos(theta))-.60*front**1.3
        phi=.002+(end-.002)*row/rows
        # Smooth cranial envelope leaves the ears outside the hairstyle. Using
        # individual ear intersections as roots made the locks trace their helix.
        pos=[.158*math.sin(phi)*math.sin(theta),.025+.226*math.cos(phi),
            -.025+(.211 if math.cos(theta)>0 else .226)*math.sin(phi)*math.cos(theta)]
        scalp.extend(round(float(x),6) for x in pos)
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({'skin':pack(points,faces,face_uv),'eyes':eyes,'scalp':{'columns':columns,'rows':rows,'position':scalp}},separators=(',',':')))
print(f'Baked {len(points)} skin vertices; {len(ep)} eye vertices; {OUT.stat().st_size:,} bytes')
