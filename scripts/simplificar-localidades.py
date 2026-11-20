import json, sys, math, unicodedata
src, dst, tol = sys.argv[1], sys.argv[2], float(sys.argv[3])
fc = json.load(open(src, encoding='utf-8'))
def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(pts)-1):
        p = pts[i]
        d = abs(dy*p[0] - dx*p[1] + b[0]*a[1] - b[1]*a[0]) / L
        if d > dmax: dmax, idx = d, i
    if dmax > eps:
        return dp(pts[:idx+1], eps)[:-1] + dp(pts[idx:], eps)
    return [a, b]
def name(s):
    s = s.strip().title()
    fix = {'Usaquen':'Usaquén','Fontibon':'Fontibón','Engativa':'Engativá','San Cristobal':'San Cristóbal','Ciudad Bolivar':'Ciudad Bolívar','Antonio Nariño':'Antonio Nariño','Los Martires':'Los Mártires'}
    return fix.get(s, s)
out = []
for f in fc['features']:
    p = f['properties']; code = str(p['LOCCODIGO']).zfill(2)
    if code == '20': continue
    g = f['geometry']; polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    rings = []
    for poly in polys:
        ring = poly[0]
        r = ring[:-1] if ring[0] == ring[-1] else ring
        far = max(range(len(r)), key=lambda i: (r[i][0]-r[0][0])**2 + (r[i][1]-r[0][1])**2)
        s = dp(r[:far+1], tol)[:-1] + dp(r[far:] + [r[0]], tol)
        if len(s) >= 4: rings.append([[round(x,4), round(y,4)] for x,y in s])
    out.append({'code': code, 'name': name(p['LOCNOMBRE']), 'rings': rings})
out.sort(key=lambda r: r['code'])
doc = {'source': 'IDECA · Secretaría Distrital de Planeación, "Localidad. Bogotá D.C." (datosabiertos.bogota.gov.co), CC BY 4.0. Simplificado.', 'localities': out}
json.dump(doc, open(dst,'w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
print(len(out), sum(len(r) for o in out for r in o['rings']), 'puntos')
