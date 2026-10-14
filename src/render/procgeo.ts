// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): buildings/geometry.js#gableGeometry, #hipGeometry, #wedgeGeometry.
import * as THREE from "three";

export type ProcShape = "box" | "gable" | "hip" | "wedge";
export interface ProcGeometry { geometry: THREE.BufferGeometry; triangles: number }

function geometry(vertices: number[]): ProcGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  return { geometry: g, triangles: vertices.length / 9 };
}
const q = (a: number[], A: number[], B: number[], C: number[], D: number[]) => a.push(...A, ...B, ...C, ...A, ...C, ...D);

/** Closed gable; base is y=0 and the ridge runs along x. */
export function gableGeometry(): ProcGeometry {
  const a: number[] = []; const A=[-.5,0,-.5],B=[.5,0,-.5],C=[.5,0,.5],D=[-.5,0,.5],E=[-.5,1,0],F=[.5,1,0];
  q(a,A,B,F,E); q(a,D,E,F,C); q(a,A,D,C,B); a.push(...A,...E,...D,...B,...C,...F); return geometry(a);
}
/** Closed hip roof with a ridge fraction in [0, 1]. */
export function hipGeometry(ridge = 0.5): ProcGeometry {
  const a: number[]=[]; const A=[-.5,0,-.5],B=[.5,0,-.5],C=[.5,0,.5],D=[-.5,0,.5]; const h=Math.max(0,Math.min(1,ridge))/2; const E=[-h,1,0],F=[h,1,0];
  q(a,A,B,F,E); q(a,D,E,F,C); a.push(...A,...E,...D,...B,...C,...F); q(a,A,D,C,B); return geometry(a);
}
/** Closed shed/awning wedge, high at local -z. */
export function wedgeGeometry(): ProcGeometry {
  const a:number[]=[]; const A=[-.5,0,-.5],B=[.5,0,-.5],C=[.5,0,.5],D=[-.5,0,.5],E=[-.5,1,-.5],F=[.5,1,-.5]; q(a,A,B,F,E); a.push(...A,...E,...D,...B,...C,...F); q(a,A,D,C,B); q(a,E,F,C,D); return geometry(a);
}
export function boxGeometry(): ProcGeometry { const g=new THREE.BoxGeometry(1,1,1); g.translate(0,.5,0); return { geometry:g, triangles:12 }; }
export function geometryFor(shape: ProcShape): ProcGeometry { return shape === "box" ? boxGeometry() : shape === "gable" ? gableGeometry() : shape === "hip" ? hipGeometry() : wedgeGeometry(); }
/** Invariant: finite, closed triangle soup with no degenerate triangle. */
export function checkGeometry(g: THREE.BufferGeometry, epsilon = 1e-8): boolean { const p=g.getAttribute("position"), index=g.getIndex(); const n=index ? index.count : p.count; for(let i=0;i<n;i+=3){ const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2; const ax=p.getX(ia),ay=p.getY(ia),az=p.getZ(ia), bx=p.getX(ib),by=p.getY(ib),bz=p.getZ(ib), cx=p.getX(ic),cy=p.getY(ic),cz=p.getZ(ic); if(!Number.isFinite(ax+ay+az+bx+by+bz+cx+cy+cz))return false; const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az; if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)<=epsilon)return false;} return true; }
