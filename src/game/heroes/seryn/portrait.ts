import * as THREE from 'three';
import data from './assets/portrait.json';
import type { HumanoidRig } from '../../characters/humanoidRig';
import type { SerynMaterials } from './materials';
import { createTaperedCurveGeometry } from './geometry';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function geometry(source: typeof data.skin) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(source.position, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(source.normal, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(source.uv, 2));
  result.setIndex(source.index);
  result.computeBoundingSphere();
  return result;
}

/** Anatomical eyelid/lip loops and neck are one surface with authored skin UVs. */
export function buildSerynPortrait(rig: HumanoidRig, materials: SerynMaterials) {
  const skin = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: .62, metalness: 0,
    emissive: 0xc0927d, emissiveIntensity: .075,
    sheen: .10, sheenColor: new THREE.Color(0xe6b5a7), sheenRoughness: .8,
    bumpMap: materials.skin.bumpMap, bumpScale: .00035,
  });
  if (typeof Image !== 'undefined') {
    skin.map = new THREE.TextureLoader().load('/assets/heroes/seryn/portrait-albedo.png');
    skin.map.colorSpace = THREE.SRGBColorSpace;
    skin.map.anisotropy = 8;
  }
  const head = new THREE.Mesh(geometry(data.skin), skin);
  head.name = 'seryn-anatomical-face-and-neck';
  head.castShadow = true;
  head.receiveShadow = false;
  rig.head.add(head);

  const eyeGeometry = geometry(data.eyes);
  const p = eyeGeometry.getAttribute('position'), uv = eyeGeometry.getAttribute('uv');
  for (const side of [-1, 1]) {
    const bounds = new THREE.Box3();
    for (let i = 0; i < p.count; i++) if (p.getX(i) * side > 0) bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(p, i));
    const center = bounds.getCenter(new THREE.Vector3());
    for (let i = 0; i < p.count; i++) if (p.getX(i) * side > 0) {
      // Planar iris projection stays circular; the eyelid mesh occludes the globe.
      uv.setXY(i, .5 + (p.getX(i) - center.x) / .094, .5 + (p.getY(i) - center.y) / .094);
    }
  }
  const eyes = new THREE.Mesh(eyeGeometry, materials.eyeSurface);
  eyes.name = 'seryn-fitted-eyeballs';
  rig.head.add(eyes);

  // Fit adornments to the face itself; offsets are millimetres, not a second mask.
  const probeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const probe = new THREE.Mesh(head.geometry, probeMaterial);
  const ray = new THREE.Raycaster();
  const facePoint = (x: number, y: number, offset = .001) => {
    ray.set(new THREE.Vector3(x,y,.45), new THREE.Vector3(0,0,-1));
    const hit = ray.intersectObject(probe)[0];
    return new THREE.Vector3(x,y,(hit?.point.z ?? .15)+offset);
  };
  const add = (name: string, g: THREE.BufferGeometry, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(g,mat);mesh.name=`seryn-${name}`;rig.head.add(mesh);return mesh;
  };
  const eyelids: THREE.Group[] = [];
  for (const side of [-1,1]) {
    // A fitted upper-eyelid membrane sits directly on the anatomical face surface.
    // It is authored at full closure, then animated from its upper lash line by
    // scaling only its local Y axis. At rest it is hidden, so the original MakeHuman
    // eyelid topology remains untouched.
    const lidPivotY = .054;
    const lidColumns = 20;
    const lidRows = 5;
    const lidPositions:number[] = [], lidUv:number[] = [], lidIndices:number[] = [];
    for (let row = 0; row <= lidRows; row++) for (let column = 0; column <= lidColumns; column++) {
      const u = column / lidColumns;
      const v = row / lidRows;
      const x = side * (.020 + .090 * u);
      const arch = Math.sin(u * Math.PI);
      const topY = .052 + .012 * arch - .003 * u;
      const bottomY = .002 + .004 * arch;
      const y = THREE.MathUtils.lerp(topY, bottomY, v);
      const fitted = facePoint(x, y, .0026);
      lidPositions.push(fitted.x, fitted.y - lidPivotY, fitted.z);
      lidUv.push(u, v);
      if (row < lidRows && column < lidColumns) {
        const a = row * (lidColumns + 1) + column;
        const b = a + lidColumns + 1;
        lidIndices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const lidGeometry = new THREE.BufferGeometry();
    lidGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lidPositions, 3));
    lidGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(lidUv, 2));
    lidGeometry.setIndex(lidIndices);
    lidGeometry.computeVertexNormals();

    const lidPivot = new THREE.Group();
    lidPivot.name = `seryn-${side > 0 ? 'left' : 'right'}-eyelid-pivot`;
    lidPivot.position.y = lidPivotY;
    lidPivot.visible = false;
    lidPivot.scale.y = .001;
    rig.head.add(lidPivot);

    const lid = new THREE.Mesh(lidGeometry, skin);
    lid.name = `seryn-${side > 0 ? 'left' : 'right'}-upper-eyelid`;
    lid.castShadow = false;
    lid.receiveShadow = false;
    lidPivot.add(lid);
    eyelids.push(lidPivot);

    const points:number[]=[],uv:number[]=[],index:number[]=[];
    for(let i=0;i<=40;i++) for(let row=0;row<2;row++) {
      const t=i/40,x=side*(.024+.082*t),y=.062+.014*Math.sin(t*Math.PI)-.009*t;
      const width=(.014+.007*Math.sin(t*Math.PI))*(1-.75*t*t);
      const p=facePoint(x,y+(row-.5)*width,.0012);points.push(p.x,p.y,p.z);uv.push(t,row);
      if(i<40 && row===0) {const a=i*2;index.push(a,a+2,a+1,a+1,a+2,a+3);}
    }
    const brow=new THREE.BufferGeometry();brow.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
    brow.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));brow.setIndex(index);brow.computeVertexNormals();
    add('fitted-arched-eyebrow',brow,materials.brow);

    const lashes:THREE.BufferGeometry[]=[];
    for(let i=0;i<22;i++) {
      const t=(i+.5)/22,x=side*(.028+.057*t);
      const y=.030+.013*Math.sin(t*Math.PI)+.003*t;
      const start=facePoint(x,y,.001);
      lashes.push(createTaperedCurveGeometry([start,start.clone().add(new THREE.Vector3(side*.001,.002,.003)),
        start.clone().add(new THREE.Vector3(side*(.002+.003*t),.004+.003*t,.005))],.0005,.00007,6,4));
    }
    add('upper-eyelashes',mergeGeometries(lashes)!,materials.eyeDark);lashes.forEach(g=>g.dispose());
  }
  const diademPoints=Array.from({length:33},(_,i)=>{
    const x=(i/16-1)*.132;return facePoint(x,.109+.013*Math.abs(x/.132),.004);
  });
  add('fitted-silver-diadem',createTaperedCurveGeometry(diademPoints,.0028,.0028,48,8),materials.silver);
  const center=facePoint(0,.111,.009);
  const setting=add('diadem-gold-setting',new THREE.OctahedronGeometry(.028),materials.gold);
  setting.position.copy(center);setting.scale.set(.56,1.35,.25);
  const gem=add('diadem-sapphire',new THREE.OctahedronGeometry(.024),materials.crystal);
  gem.position.copy(center).add(new THREE.Vector3(0,0,.006));gem.scale.set(.54,1.35,.25);
  probeMaterial.dispose();
  return { eyelids };
}
