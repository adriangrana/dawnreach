import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HumanoidRig } from '../../characters/humanoidRig';
import type { SerynMaterials } from './materials';
import data from './assets/portrait.json';
import { createTaperedCurveGeometry } from './geometry';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const { columns, rows, position: scalpPositions } = data.scalp;

/** Sample the scalp baked against Seryn's anatomical head. */
function scalp(theta: number, v: number, lift = 0) {
  const u = ((theta / (Math.PI * 2)) % 1 + 1) % 1;
  const x = u * columns, y = THREE.MathUtils.clamp(v, 0, 1) * rows;
  const col = Math.min(columns - 1, Math.floor(x)), row = Math.min(rows - 1, Math.floor(y));
  const at = (r: number, c: number) => new THREE.Vector3().fromArray(scalpPositions, (r * (columns + 1) + c) * 3);
  const p = at(row,col).lerp(at(row,col+1),x-col).lerp(at(row+1,col).lerp(at(row+1,col+1),x-col),y-row);
  return p.addScaledVector(p.clone().sub(V(0,.025,-.025)).normalize(), lift);
}

export function buildSerynHair(rig: HumanoidRig, m: SerynMaterials) {
  const pieces: THREE.BufferGeometry[] = [];
  const cap = new THREE.BufferGeometry();
  const uv: number[] = [], indices: number[] = [];
  for (let r=0;r<=rows;r++) for(let c=0;c<=columns;c++) uv.push(c/columns,r/rows);
  for (let r=0;r<rows;r++) for(let c=0;c<columns;c++) {
    const a=r*(columns+1)+c,b=a+columns+1;
    indices.push(a,b,a+1,a+1,b,b+1);
  }
  cap.setAttribute('position',new THREE.Float32BufferAttribute(scalpPositions,3));
  cap.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); cap.setIndex(indices); cap.computeVertexNormals();
  pieces.push(cap);

  // Flattened locks with a shallow cross-section read as overlapping hair ribbons,
  // rather than thick round cords. The root and its supporting scalp share a shape.
  function lock(points: THREE.Vector3[], width: number, thickness: number, phase: number) {
    const path=new THREE.CatmullRomCurve3(points), steps=44, sides=8;
    const frames=path.computeFrenetFrames(steps,false), pos:number[]=[], uv:number[]=[], index:number[]=[];
    for(let j=0;j<=steps;j++) {
      const t=j/steps, center=path.getPointAt(t);
      const taper=Math.pow(Math.sin(Math.PI*(.10+.90*t)),.40);
      // Use the outward scalp direction for width orientation near the head.
      const outward=center.clone().sub(V(0,.025,-.025)).normalize();
      const across=new THREE.Vector3().crossVectors(frames.tangents[j],outward).normalize();
      if(across.lengthSq()<.1) across.copy(frames.normals[j]);
      const normal=new THREE.Vector3().crossVectors(across,frames.tangents[j]).normalize();
      for(let k=0;k<=sides;k++) {
        const a=k/sides*Math.PI*2;
        const p=center.clone().addScaledVector(across,Math.cos(a)*width*taper)
          .addScaledVector(normal,Math.sin(a)*thickness*taper);
        pos.push(p.x,p.y,p.z);uv.push(k/sides+phase,t*2);
      }
      if(j<steps) for(let k=0;k<sides;k++) {
        const a=j*(sides+1)+k,b=a+sides+1;index.push(a,b,a+1,a+1,b,b+1);
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();pieces.push(g);
  }

  for(let i=0;i<54;i++) {
    const angle=i/54*Math.PI*2, phase=Math.sin(i*2.37);
    const points=Array.from({length:20},(_,j)=>{
      const t=j/19, sweep=.30*Math.sin(t*Math.PI)+.045*Math.sin(t*9+i);
      return scalp(angle+sweep,.035+.965*t,.005+.008*Math.sin(t*Math.PI)**2);
    });
    lock(points,.013+.003*(phase+1),.0032,i*.13);
  }
  // A lifted, off-centre front sweep breaks the uniform cap silhouette.
  for(let i=0;i<10;i++) {
    const t=i/9;
    lock([scalp(-.48,.08+t*.30,.018),scalp(-.30,.25+t*.28,.026),
      scalp(.22,.46+t*.25,.024),scalp(.65,.64+t*.22,.020),
      scalp(1.18,.80+t*.17,.012),scalp(1.70,1,.006)],.012+.003*Math.sin(t*Math.PI),.0035,i*.19);
  }
  // Waves continue along the back of the skull before leaving it at the nape.
  for(let i=0;i<34;i++) {
    const a=1.94+i/33*2.40,w=Math.sin(i*2.4);
    const points=Array.from({length:9},(_,j)=>scalp(a+.08*Math.sin(j*.7+i),.24+j/8*.76,.009));
    const root=points[points.length-1];
    points.push(V(root.x+w*.015,-.23,-.229),V(root.x-w*.023,-.40,-.255),
      V(root.x+w*.033,-.59,-.285),V(root.x-w*.023,-.76-(i%4)*.026,-.29),
      V(root.x+w*.04,-.86-(i%3)*.045,-.265));
    lock(points,.016+(i%3)*.003,.004,i*.17);
  }
  for(const s of [-1,1]) {
    lock([scalp(s*.65,.30,.020),scalp(s*.72,.64,.018),scalp(s*.85,.92,.017),
      V(s*.148,.025,.145),V(s*.127,-.055,.156),V(s*.147,-.145,.125),V(s*.129,-.28,.105)],.012,.004,.3);
    for(let strand=0;strand<3;strand++) {
      const points=Array.from({length:81},(_,i)=>{
        const t=i/80,a=t*Math.PI*22+strand*Math.PI*2/3;
        const p=scalp(s*(.30+1.5*t),.44+.55*t,.023);
        p.x+=Math.cos(a)*.0045;p.y+=Math.sin(a)*.0045;return p;
      });
      pieces.push(createTaperedCurveGeometry(points,.0048,.0025,100,6));
    }
  }
  const geometry=mergeGeometries(pieces)!;pieces.forEach(g=>g.dispose());
  const p=geometry.getAttribute('position'),flex:number[]=[],phase:number[]=[];
  for(let i=0;i<p.count;i++) {
    flex.push(THREE.MathUtils.smoothstep(-p.getY(i),.15,.94));phase.push(p.getX(i)*4+p.getY(i)*1.7);
  }
  geometry.setAttribute('hairFlex',new THREE.Float32BufferAttribute(flex,1));
  geometry.setAttribute('hairPhase',new THREE.Float32BufferAttribute(phase,1));
  geometry.userData.serynHairBasePositions=new Float32Array(p.array);
  const hair=new THREE.Mesh<THREE.BufferGeometry,THREE.Material>(geometry,m.hair);
  hair.name='seryn-fitted-wavy-braided-hair';hair.castShadow=true;hair.receiveShadow=true;hair.frustumCulled=false;
  rig.head.add(hair);
  return hair;
}
