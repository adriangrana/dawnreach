import * as THREE from 'three';
import { BASE_LAYOUT, TEAM_START_BASE_LAYOUT, getTeamBaseShopPosition } from './mapLayout';

type Team = 'blue' | 'red';
type Basis = ReturnType<typeof basisFor>;
type Mats = ReturnType<typeof makeMaterials>;

const DECK_Y = TEAM_START_BASE_LAYOUT.elevation;
const PLAZA_Y = BASE_LAYOUT.elevation;
const CRYSTAL_Y = 4.18;
const STAIR_TOP = 6.05;
const STAIR_BOTTOM = 12.35;
const STAIR_HALF = 3.1;
const STAIR_STEP_COUNT = 8;
const OUTLINE = [
  [-1.65, -4.4], [-1.65, 4.4], [0.3, 5.8], [3.2, 6.4], [5.7, 5.5],
  [6.45, 3.4], [6.45, -3.4], [5.7, -5.5], [3.2, -6.4], [0.3, -5.8],
] as const;

export function installFountainSanctuaryPresentation(world: THREE.Group) {
  for (const team of ['blue', 'red'] as const) {
    const root = world.getObjectByName(`${team}-team-start-base`) as THREE.Group | undefined;
    if (!root || root.userData.fountainSanctuaryV3) continue;
    root.userData.fountainSanctuaryV3 = true;
    build(root, world, team);
  }
}

function build(root: THREE.Group, world: THREE.Group, team: Team) {
  const basis = basisFor(team);
  const angle = Math.atan2(basis.fz, basis.fx);
  const mats = makeMaterials(team);
  const fountain = root.getObjectByName(`${team}-team-start-fountain`) as THREE.Group | undefined;
  retireLegacy(root, basis, angle);

  const visual = new THREE.Group();
  visual.name = `${team}-fountain-sanctuary-presentation`;
  root.add(visual);
  addDeck(visual, mats, basis, angle);
  addWalls(visual, mats, basis);
  addStairs(visual, mats, basis, angle);
  addPilasters(visual, mats, basis, angle);
  addBanners(visual, mats, basis, angle);
  addVegetation(visual, mats, basis);
  addInlays(visual, mats, basis);

  let fountainVisual: THREE.Group | undefined;
  if (fountain) {
    fountainVisual = makeFountain(team, mats);
    fountain.add(fountainVisual);
  }

  root.userData.sanctuaryPresentationMeshes = countMeshes(visual) + (fountainVisual ? countMeshes(fountainVisual) : 0);
  root.userData.sanctuaryPresentationTriangles = countTriangles(visual) + (fountainVisual ? countTriangles(fountainVisual) : 0);

  const driver = visual.getObjectByName('sanctuary-deck') as THREE.Mesh | undefined;
  if (driver) driver.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    liftShop(world, team);
    animateFountain(fountain, mats, t);
  };
}

function retireLegacy(root: THREE.Group, basis: Basis, angle: number) {
  const invisible = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
    side: THREE.DoubleSide,
  });
  root.traverse(o => {
    if (o === root) return;
    if (o instanceof THREE.Light) { o.visible = false; return; }
    if (!(o instanceof THREE.Mesh)) return;
    if (o.userData.visionOccluder) { o.material = invisible; o.visible = true; return; }
    if (o.userData.commandSurface) {
      if (o.name === 'team-start-plaza') {
        o.geometry.dispose();
        o.geometry = new THREE.ShapeGeometry(outlineShape(basis), 2);
        o.material = invisible; o.visible = true; return;
      }
      if (o.name === 'team-start-citadel-bridge') {
        o.geometry.dispose();
        o.geometry = stairStepSurface(angle);
        o.material = invisible;
        o.visible = true;
        o.userData.stairCollider = true;
        return;
      }
      if (o.name === 'team-start-ramp') {
        // This was the old forest-facing ramp. Its mesh reference is already present in the
        // command-surface cache, so replace the geometry as well as hiding it to guarantee
        // that it can no longer win a height raycast behind the rebuilt staircase.
        o.geometry.dispose();
        o.geometry = new THREE.BufferGeometry();
      }
      o.userData.commandSurface = false; o.visible = false; return;
    }
    o.visible = false;
    if (o.userData.waterEffectsSurface) o.userData.waterEffectsSurface = false;
    if (o.userData.waterSurface) o.userData.waterSurface = false;
  });
}

function stairStepTop(index: number) {
  return THREE.MathUtils.lerp(
    PLAZA_Y,
    DECK_Y + .035,
    (index + 1) / STAIR_STEP_COUNT,
  );
}

function stairStepSurface(a: number) {
  const radial = new THREE.Vector2(Math.cos(a), Math.sin(a));
  const tangent = new THREE.Vector2(-radial.y, radial.x);
  const halfWidth = STAIR_HALF - .32;
  const depth = (STAIR_BOTTOM - STAIR_TOP) / STAIR_STEP_COUNT;
  const vertices: number[] = [];
  const indices: number[] = [];
  const p = (d: number, s: number, y: number) => [
    radial.x * d + tangent.x * s,
    y,
    radial.y * d + tangent.y * s,
  ] as const;

  for (let index = 0; index < STAIR_STEP_COUNT; index++) {
    const outer = STAIR_BOTTOM - index * depth;
    const inner = STAIR_BOTTOM - (index + 1) * depth;
    const top = stairStepTop(index);
    const base = vertices.length / 3;
    vertices.push(
      ...p(outer, -halfWidth, top),
      ...p(outer, halfWidth, top),
      ...p(inner, -halfWidth, top),
      ...p(inner, halfWidth, top),
    );
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);

    // Add the vertical riser to make this a real stepped collision/height surface rather
    // than an invisible sloped ramp. The hero height ray lands on the horizontal tread.
    const lower = index === 0 ? PLAZA_Y : stairStepTop(index - 1);
    const riserBase = vertices.length / 3;
    vertices.push(
      ...p(outer, -halfWidth, lower),
      ...p(outer, halfWidth, lower),
      ...p(outer, -halfWidth, top),
      ...p(outer, halfWidth, top),
    );
    indices.push(riserBase, riserBase + 2, riserBase + 1, riserBase + 1, riserBase + 2, riserBase + 3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function makeMaterials(team: Team) {
  const blue = team === 'blue', stoneTex = stoneTexture(blue), floorTex = floorTexture(blue), waterTex = waterTexture();
  return {
    floor: new THREE.MeshStandardMaterial({ color: blue ? 0xd8cbaa : 0xd6c5a8, map: floorTex, bumpMap: floorTex, bumpScale: .055, roughness: .94 }),
    floorDark: new THREE.MeshStandardMaterial({ color: blue ? 0xb7a886 : 0xb59f84, map: floorTex, bumpMap: floorTex, bumpScale: .065, roughness: .96 }),
    stone: new THREE.MeshStandardMaterial({ color: blue ? 0xc8ba98 : 0xc6b293, map: stoneTex, bumpMap: stoneTex, bumpScale: .11, roughness: .96 }),
    dark: new THREE.MeshStandardMaterial({ color: blue ? 0x91836a : 0x907764, map: stoneTex, bumpMap: stoneTex, bumpScale: .13, roughness: .98 }),
    light: new THREE.MeshStandardMaterial({ color: blue ? 0xe2d6b8 : 0xdfcdb2, map: stoneTex, bumpMap: stoneTex, bumpScale: .075, roughness: .91 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd2aa50, roughness: .27, metalness: .78 }),
    goldDark: new THREE.MeshStandardMaterial({ color: 0x8b692d, roughness: .43, metalness: .62 }),
    rune: new THREE.MeshStandardMaterial({ color: blue ? 0x49c8ff : 0xff6b62, emissive: blue ? 0x075c96 : 0x8b211c, emissiveIntensity: 1.15, roughness: .3, metalness: .2 }),
    crystal: new THREE.MeshPhysicalMaterial({ color: blue ? 0x4ecbff : 0xff6a61, emissive: blue ? 0x0878c4 : 0xa5231d, emissiveIntensity: 1.7, roughness: .06, clearcoat: 1, transmission: .08, transparent: true, opacity: .95 }),
    water: new THREE.MeshPhysicalMaterial({ color: blue ? 0x128fd8 : 0xcc5e5c, emissive: blue ? 0x062c4d : 0x481311, emissiveIntensity: .18, roughness: .08, clearcoat: 1, ior: 1.333, bumpMap: waterTex, bumpScale: .045, transparent: true, opacity: .66, depthWrite: false, side: THREE.DoubleSide }),
    stream: new THREE.MeshPhysicalMaterial({ color: blue ? 0x42baf2 : 0xff9a91, emissive: blue ? 0x07557e : 0x681a17, emissiveIntensity: .3, roughness: .05, clearcoat: 1, transparent: true, opacity: .82, depthWrite: false, side: THREE.DoubleSide }),
    cloth: new THREE.MeshStandardMaterial({ map: bannerTexture(blue), roughness: .96, side: THREE.DoubleSide }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x36583d, roughness: .98 }),
  };
}

function addDeck(g: THREE.Group, m: Mats, b: Basis, angle: number) {
  const shape = outlineShape(b);
  const base = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .34, bevelEnabled: true, bevelSegments: 2, bevelSize: .08, bevelThickness: .055 }), m.dark);
  base.rotation.x = -Math.PI / 2; base.position.y = DECK_Y - .34; base.castShadow = base.receiveShadow = true; g.add(base);
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(shape, 2), m.floor);
  deck.name = 'sanctuary-deck'; deck.rotation.x = -Math.PI / 2; deck.position.y = DECK_Y + .025; deck.receiveShadow = true; g.add(deck);
  const c = offset(b, TEAM_START_BASE_LAYOUT.fountainForward, 0);
  const court = new THREE.Mesh(new THREE.CircleGeometry(4.05, 16), m.floorDark);
  court.rotation.x = -Math.PI / 2; court.rotation.z = -angle; court.position.set(c.x, DECK_Y + .038, c.z); court.receiveShadow = true; g.add(court);
}

function addWalls(g: THREE.Group, m: Mats, b: Basis) {
  const rise = DECK_Y - PLAZA_Y, courseH = rise / 6;
  for (let e = 0; e < OUTLINE.length; e++) {
    const a = OUTLINE[e], z = OUTLINE[(e + 1) % OUTLINE.length];
    if (a[0] === 6.45 && z[0] === 6.45) continue;
    const A = offset(b, a[0], a[1]), B = offset(b, z[0], z[1]), dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(len / .72)), rot = -Math.atan2(dz, dx);
    for (let i = 0; i < n; i++) {
      const q = (i + .5) / n, x = THREE.MathUtils.lerp(A.x, B.x, q), zz = THREE.MathUtils.lerp(A.z, B.z, q), w = len / n * 1.06;
      for (let c = 0; c < 6; c++) {
        const block = new THREE.Mesh(chamfer(w * (.95 + noise(e * 211 + i * 29 + c) * .08), courseH - .035, .88, .055), c === 0 ? m.dark : c === 5 && (i + e) % 3 === 0 ? m.light : m.stone);
        block.position.set(x, PLAZA_Y + courseH * (c + .5), zz); block.rotation.y = rot; block.castShadow = block.receiveShadow = true; g.add(block);
      }
      const cap = new THREE.Mesh(chamfer(w, .22, 1.02, .055), (i + e) % 4 ? m.dark : m.light);
      cap.position.set(x, DECK_Y + .11, zz); cap.rotation.y = rot; cap.castShadow = cap.receiveShadow = true; g.add(cap);
    }
  }
}

function addStairs(g: THREE.Group, m: Mats, b: Basis, angle: number) {
  const n = STAIR_STEP_COUNT, depth = (STAIR_BOTTOM - STAIR_TOP) / n, radial = new THREE.Vector3(b.fx, 0, b.fz), tangent = new THREE.Vector3(b.sx, 0, b.sz);
  for (let i = 0; i < n; i++) {
    const d = STAIR_BOTTOM - (i + .5) * depth, top = stairStepTop(i), h = top - PLAZA_Y;
    const step = new THREE.Mesh(chamfer(depth + .10, h, STAIR_HALF * 2, .045), i % 5 === 2 ? m.floorDark : i % 3 ? m.floor : m.light);
    step.name = 'sanctuary-stair-step';
    step.userData.walkableStep = true;
    step.position.set(b.fx * d, PLAZA_Y + h / 2, b.fz * d); step.rotation.y = -angle; step.castShadow = step.receiveShadow = true; g.add(step);
    for (const side of [-1, 1]) {
      const p = radial.clone().multiplyScalar(d).addScaledVector(tangent, side * (STAIR_HALF + .35));
      const rail = new THREE.Mesh(chamfer(depth + .1, .56, .56, .045), i % 4 ? m.dark : m.light);
      rail.name = 'sanctuary-stair-side';
      rail.position.set(p.x, top + .28, p.z); rail.rotation.y = -angle; rail.castShadow = rail.receiveShadow = true; g.add(rail);
    }
  }
  for (const side of [-1, 1]) {
    addPillar(g, m, offset(b, STAIR_TOP + .12, side * (STAIR_HALF + .48)), DECK_Y, angle, 1.08);
    addPillar(g, m, offset(b, STAIR_BOTTOM - .10, side * (STAIR_HALF + .48)), PLAZA_Y, angle, .94);
  }
}

function addPilasters(g: THREE.Group, m: Mats, b: Basis, angle: number) {
  const sites = [[-1.15,-4.65],[-1.15,4.65],[1.2,-5.65],[1.2,5.65],[4.0,-5.7],[4.0,5.7]] as const;
  for (const [f,s] of sites) addPillar(g, m, offset(b,f,s), DECK_Y, angle, .82);
}

function addPillar(g: THREE.Group, m: Mats, p: {x:number;z:number}, y: number, angle: number, scale: number) {
  const r = new THREE.Group(); r.position.set(p.x, y, p.z); r.rotation.y = Math.PI / 2 - angle; r.scale.setScalar(scale);
  const parts: [THREE.BufferGeometry, THREE.Material, number][] = [
    [chamfer(.9,.34,.9,.07),m.dark,.17],[chamfer(.72,.30,.72,.06),m.light,.49],[chamfer(.56,1.24,.56,.055),m.stone,1.26],[chamfer(.78,.26,.78,.06),m.light,2.12],
  ];
  for (const [geo,mat,py] of parts) { const x = new THREE.Mesh(geo,mat); x.position.y=py; x.castShadow=x.receiveShadow=true; r.add(x); }
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(.4,.44,.18,12),m.gold); collar.position.y=1.93; r.add(collar);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.34,1),m.crystal); crystal.position.y=2.69; crystal.scale.set(.78,1.28,.78); crystal.castShadow=true; r.add(crystal);
  const light = new THREE.PointLight(m.crystal.color.getHex(),2.2,4,2); light.position.y=2.7; r.add(light); g.add(r);
}

function addBanners(g: THREE.Group, m: Mats, b: Basis, angle: number) {
  const sites = [[-.7,-5.65],[-.7,5.65],[3.55,-5.55],[3.55,5.55]] as const;
  sites.forEach(([f,s],i) => {
    const p=offset(b,f,s), root=new THREE.Group(); root.position.set(p.x,DECK_Y,p.z); root.rotation.y=-angle+(s>0?Math.PI:0);
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.065,.1,4.25,14),m.gold); pole.position.y=2.25; root.add(pole);
    const bar=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,2.05,12),m.gold); bar.rotation.z=Math.PI/2; bar.position.set(.86,3.72,0); root.add(bar);
    const cloth=new THREE.Mesh(bannerGeo(1.66,2.6,18,28),m.cloth); cloth.position.set(.84,2.35,.06); cloth.castShadow=true;
    const base=(cloth.geometry.getAttribute('position') as THREE.BufferAttribute).clone();
    cloth.onBeforeRender=()=>{const t=performance.now()*.001,a=cloth.geometry.getAttribute('position') as THREE.BufferAttribute;for(let v=0;v<a.count;v++){const x=base.getX(v),y=base.getY(v);a.setZ(v,base.getZ(v)+Math.sin(t*1.5+y*2.2+x*3+i)*.055*(.6-y/5));}a.needsUpdate=true;};
    root.add(cloth); g.add(root);
  });
}

function addVegetation(g: THREE.Group, m: Mats, b: Basis) {
  const sites=[[-3.85,-5.18],[-4.45,4.58],[.15,5.98],[-3.0,-5.75],[1.1,-6.05]] as const;
  for(const [f,s] of sites){const p=offset(b,f,s),r=new THREE.Group();r.position.set(p.x,DECK_Y+.08,p.z);for(let i=0;i<7;i++){const a=i/7*Math.PI*2,d=.18+noise(i*37+f*9)*.3,x=new THREE.Mesh(new THREE.DodecahedronGeometry(.17+(i%3)*.025,0),m.leaf);x.position.set(Math.cos(a)*d,.14+(i%2)*.05,Math.sin(a)*d*.7);x.scale.set(1.1,.62,.82);x.castShadow=true;r.add(x);}g.add(r);}
}

function addInlays(g: THREE.Group, m: Mats, b: Basis) {
  const c=offset(b,TEAM_START_BASE_LAYOUT.fountainForward,0);
  for(const radius of [3.0,4.35])for(let q=0;q<4;q++){const pts:THREE.Vector3[]=[];for(let i=0;i<=18;i++){const a=q*Math.PI/2+.12+i/18*(Math.PI/2-.24);pts.push(new THREE.Vector3(c.x+Math.cos(a)*radius,DECK_Y+.06,c.z+Math.sin(a)*radius));}const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),30,radius===3?.055:.04,7,false),radius===3?m.gold:m.goldDark);g.add(mesh);}
}

function makeFountain(team: Team, m: Mats) {
  const g=new THREE.Group();g.name='sanctuary-fountain-visual';
  const L=(profile:[number,number][],seg:number,mat:THREE.Material)=>{const x=new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),seg),mat);x.castShadow=x.receiveShadow=true;g.add(x);};
  L([[2.12,0],[2.22,.1],[2.2,.22],[2.02,.31],[1.98,.44],[2.06,.55]],96,m.dark);
  L([[1.92,.47],[2.1,.59],[2.14,.74],[2,.86],[1.7,.95],[1.45,1],[1.18,1.28]],96,m.light);
  L([[.88,.92],[.82,1.22],[.7,1.36],[.64,1.69],[.86,1.92]],72,m.stone);
  L([[1.28,1.76],[1.43,1.86],[1.46,2.01],[1.34,2.12],[1.08,2.19],[.71,2.34],[.66,2.48]],88,m.light);
  L([[.55,2.2],[.5,2.47],[.42,2.58],[.38,2.82],[.58,3.04]],64,m.stone);
  L([[.8,2.91],[.94,3],[.96,3.14],[.84,3.24],[.66,3.3],[.52,3.39]],72,m.light);
  for(const [r,y] of [[2.08,.76],[1.42,2.02],[.93,3.15]] as const){const ring=new THREE.Mesh(new THREE.TorusGeometry(r,.065,10,80),m.gold);ring.rotation.x=Math.PI/2;ring.position.y=y;g.add(ring);}
  const waters:[number,number,string][]=[[1.82,1,'lower'],[1.2,2.2,'middle'],[.76,3.3,'upper']];
  for(const [r,y,n] of waters){const w=new THREE.Mesh(new THREE.CircleGeometry(r,80),m.water);w.name=`sanctuary-fountain-water-${n}`;w.rotation.x=-Math.PI/2;w.position.y=y;w.renderOrder=8;w.userData.waterEffectsSurface=true;g.add(w);}
  for(let i=0;i<8;i++)g.add(waterfall(i/8*Math.PI*2+Math.PI/8,.78,3.26,1.12,2.23,.28,11,4,m.stream));
  for(let i=0;i<12;i++)g.add(waterfall(i/12*Math.PI*2,1.2,2.16,1.72,1.03,.30,12,4,m.stream));
  const pivot=new THREE.Group();pivot.name='sanctuary-fountain-crystal-pivot';pivot.position.y=CRYSTAL_Y;
  const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.68,2),m.crystal);crystal.scale.set(.82,1.42,.82);crystal.castShadow=true;pivot.add(crystal);
  const halo=new THREE.Mesh(new THREE.TorusGeometry(.86,.038,10,72),m.rune);halo.rotation.x=Math.PI/2;halo.position.y=-.12;pivot.add(halo);g.add(pivot);
  for(let i=0;i<6;i++){const a=i/6*Math.PI*2,s=new THREE.Mesh(new THREE.OctahedronGeometry(.12+(i%2)*.025,1),m.crystal);s.position.set(Math.cos(a)*.98,CRYSTAL_Y+(i%3)*.14-.12,Math.sin(a)*.98);g.add(s);}
  const light=new THREE.PointLight(team==='blue'?0x45c7ff:0xff6a61,9.5,9.2,2);light.position.y=CRYSTAL_Y;g.add(light);
  g.userData.crystalPivot=pivot;g.userData.halo=halo;return g;
}

function waterfall(a:number,sr:number,sy:number,er:number,ey:number,w:number,rows:number,cols:number,mat:THREE.Material){const v:number[]=[],idx:number[]=[],r=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),t=new THREE.Vector3(-Math.sin(a),0,Math.cos(a));for(let y=0;y<=rows;y++){const p=y/rows,e=p*p*(3-2*p),rad=THREE.MathUtils.lerp(sr,er,e),yy=THREE.MathUtils.lerp(sy,ey,p),c=r.clone().multiplyScalar(rad+Math.sin(p*Math.PI)*.12);c.y=yy;for(let x=0;x<=cols;x++){const u=x/cols,q=c.clone().addScaledVector(t,(u-.5)*w);v.push(q.x,q.y,q.z);if(y<rows&&x<cols){const k=y*(cols+1)+x,n=k+cols+1;idx.push(k,k+1,n,k+1,n+1,n);}}}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(v,3));geo.setIndex(idx);geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,mat);mesh.renderOrder=9;return mesh;}

function animateFountain(fountain: THREE.Group | undefined,m:Mats,t:number){if(m.water.bumpMap)m.water.bumpMap.offset.set(t*.015,t*.011);m.water.opacity=.64+Math.sin(t*.84)*.025;const f=fountain?.getObjectByName('sanctuary-fountain-visual') as THREE.Group|undefined,p=f?.userData.crystalPivot as THREE.Group|undefined,h=f?.userData.halo as THREE.Mesh|undefined;if(p){p.rotation.y=t*.48;p.position.y=CRYSTAL_Y+Math.sin(t*1.45)*.085;}if(h)h.rotation.z=-t*.22;const beam=fountain?.getObjectByName('team-start-fountain-defense-beam') as THREE.Line|undefined;if(beam?.visible){const a=beam.geometry.getAttribute('position') as THREE.BufferAttribute;if(a.count>=2){a.setY(0,CRYSTAL_Y);a.needsUpdate=true;}}}

function liftShop(world:THREE.Group,team:Team){const shop=world.getObjectByName(`${team}-shop`) as THREE.Group|undefined;if(!shop)return;const p=getTeamBaseShopPosition(team),y=DECK_Y+.045;if(Math.abs(shop.position.y-y)>.001){shop.position.set(p.x,y,p.z);shop.updateMatrixWorld(true);}}
function basisFor(team:Team){const p=getTeamBaseShopPosition(team),l=Math.hypot(p.x,p.z)||1,fx=-p.x/l,fz=-p.z/l;return{fx,fz,sx:-fz,sz:fx};}
function offset(b:Basis,f:number,s:number){return{x:b.fx*f+b.sx*s,z:b.fz*f+b.sz*s};}
function outlineShape(b:Basis){const sh=new THREE.Shape();OUTLINE.forEach(([f,s],i)=>{const p=offset(b,f,s);if(i===0)sh.moveTo(p.x,-p.z);else sh.lineTo(p.x,-p.z);});sh.closePath();return sh;}
function chamfer(w:number,h:number,d:number,b:number){const s=new THREE.Shape(),x=w/2,y=h/2,c=Math.min(b,x*.45,y*.45);s.moveTo(-x+c,-y);s.lineTo(x-c,-y);s.lineTo(x,-y+c);s.lineTo(x,y-c);s.lineTo(x-c,y);s.lineTo(-x+c,y);s.lineTo(-x,y-c);s.lineTo(-x,-y+c);s.closePath();const g=new THREE.ExtrudeGeometry(s,{depth:d,bevelEnabled:true,bevelSegments:6,bevelSize:Math.min(c*.55,d*.13),bevelThickness:Math.min(c*.52,d*.11),curveSegments:1});g.translate(0,0,-d/2);g.computeVertexNormals();return g;}
function bannerGeo(w:number,h:number,cols:number,rows:number){const v:number[]=[],uv:number[]=[],idx:number[]=[];for(let r=0;r<=rows;r++){const q=r/rows,y=h*(.5-q),tap=q<.76?1:THREE.MathUtils.lerp(1,.05,(q-.76)/.24);for(let c=0;c<=cols;c++){const u=c/cols,x=(u-.5)*w*tap;v.push(x,y,Math.sin(u*Math.PI*5)*.025);uv.push(u,1-q);if(r<rows&&c<cols){const k=r*(cols+1)+c,n=k+cols+1;idx.push(k,k+1,n,k+1,n+1,n);}}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;}

function floorTexture(blue:boolean){
  const c=document.createElement('canvas');c.width=c.height=1024;const x=c.getContext('2d');if(!x)return null;
  x.fillStyle=blue?'#c7b998':'#c4b194';x.fillRect(0,0,1024,1024);
  for(let r=0;r<8;r++){
    const n=r%2?6:7,w=1024/n,o=r%2?-w*.44:-w*.08;
    for(let k=-1;k<=n;k++){
      const seed=r*71+k*43,q=164+Math.floor(noise(seed)*30),warm=Math.floor(noise(seed+17)*13);
      x.fillStyle=`rgb(${q+warm},${q+Math.floor(warm*.65)},${q-14})`;
      x.fillRect(k*w+o+6,r*128+6,w-12,116);
      x.strokeStyle='rgba(92,84,67,.52)';x.lineWidth=4;x.strokeRect(k*w+o+6,r*128+6,w-12,116);
      if(noise(seed+31)>.53){
        x.strokeStyle='rgba(92,79,60,.28)';x.lineWidth=2;x.beginPath();
        const sx=k*w+o+w*(.22+noise(seed+5)*.16),sy=r*128+30+noise(seed+9)*42;
        x.moveTo(sx,sy);x.lineTo(sx+w*.13,sy+10);x.lineTo(sx+w*.21,sy-5);x.stroke();
      }
    }
  }
  for(let i=0;i<180;i++){const px=noise(i*53+7)*1024,py=noise(i*97+19)*1024,a=.025+noise(i*31)*.04;x.fillStyle=`rgba(86,76,58,${a})`;x.fillRect(px,py,2+noise(i*17)*5,1+noise(i*23)*3);}
  return tex(c,2.05,2.05);
}
function stoneTexture(blue:boolean){
  const c=document.createElement('canvas');c.width=c.height=768;const x=c.getContext('2d');if(!x)return null;
  x.fillStyle=blue?'#b6aa8d':'#b7a48b';x.fillRect(0,0,768,768);
  for(let r=0;r<9;r++)for(let k=-1;k<7;k++){
    const w=144,o=r%2?72:0,seed=r*43+k*29,q=148+Math.floor(noise(seed)*38),warm=Math.floor(noise(seed+11)*16);
    x.fillStyle=`rgb(${q+warm},${q+Math.floor(warm*.66)},${q-18})`;x.fillRect(k*w-o+5,r*85+5,w-10,75);
    x.strokeStyle='rgba(70,65,52,.66)';x.lineWidth=5;x.strokeRect(k*w-o+5,r*85+5,w-10,75);
    if(noise(seed+23)>.56){x.strokeStyle='rgba(77,67,52,.34)';x.lineWidth=2;x.beginPath();const sx=k*w-o+32+noise(seed+5)*58,sy=r*85+20+noise(seed+9)*28;x.moveTo(sx,sy);x.lineTo(sx+18,sy+11);x.lineTo(sx+29,sy+4);x.stroke();}
    if(noise(seed+37)>.78){x.fillStyle='rgba(74,86,48,.22)';x.fillRect(k*w-o+7,r*85+66,18+noise(seed+41)*28,7);}
  }
  for(const y of [72,382]){
    x.fillStyle='rgba(213,199,163,.92)';x.fillRect(0,y,768,31);x.strokeStyle='rgba(99,88,66,.72)';x.lineWidth=3;x.strokeRect(0,y,768,31);
    x.strokeStyle='rgba(105,91,64,.70)';x.lineWidth=3;
    for(let i=0;i<16;i++){const px=i*48+24;x.beginPath();x.moveTo(px-15,y+16);x.lineTo(px,y+7);x.lineTo(px+15,y+16);x.lineTo(px,y+25);x.closePath();x.stroke();}
  }
  return tex(c,3.0,2.55);
}
function bannerTexture(blue:boolean){const c=document.createElement('canvas');c.width=512;c.height=768;const x=c.getContext('2d');if(!x)return null;const g=x.createLinearGradient(0,0,512,768);g.addColorStop(0,blue?'#0b2d57':'#5a2026');g.addColorStop(.5,blue?'#155a94':'#8a353b');g.addColorStop(1,blue?'#082341':'#42171c');x.fillStyle=g;x.fillRect(0,0,512,768);x.strokeStyle='#d2aa50';x.lineWidth=20;x.strokeRect(26,26,460,716);x.fillStyle='#d2aa50';x.beginPath();x.moveTo(256,180);x.lineTo(350,360);x.lineTo(256,545);x.lineTo(162,360);x.closePath();x.fill();x.fillStyle=blue?'#45bde9':'#db6960';x.beginPath();x.moveTo(256,235);x.lineTo(305,360);x.lineTo(256,485);x.lineTo(207,360);x.closePath();x.fill();return tex(c,1,1);}
function waterTexture(){const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');if(!x)return null;x.fillStyle='#808080';x.fillRect(0,0,512,512);for(let i=0;i<64;i++){x.strokeStyle='rgba(235,235,235,.06)';x.beginPath();for(let p=0;p<=512;p+=12){const y=i*8+Math.sin(p*.04+i*.7)*4;if(p===0)x.moveTo(p,y);else x.lineTo(p,y);}x.stroke();}const t=tex(c,2.8,2.8);if(t)t.colorSpace=THREE.NoColorSpace;return t;}
function tex(c:HTMLCanvasElement,x:number,y:number){const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(x,y);t.anisotropy=4;return t;}
function noise(s:number){const v=Math.sin(s*12.9898+78.233)*43758.5453;return v-Math.floor(v);}
function countMeshes(o:THREE.Object3D){let n=0;o.traverse(x=>{if(x instanceof THREE.Mesh&&x.visible)n++;});return n;}
function countTriangles(o:THREE.Object3D){let n=0;o.traverse(x=>{if(!(x instanceof THREE.Mesh)||!x.visible)return;const p=x.geometry.getAttribute('position');n+=x.geometry.index?Math.floor(x.geometry.index.count/3):Math.floor((p?.count??0)/3);});return n;}
