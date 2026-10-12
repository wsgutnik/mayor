import * as THREE from "three";

/** Orbit-style RTS camera around a ground target. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(8, 0, 48);
  yaw = Math.PI * 0.25;
  pitch = 0.9;
  dist = 38;
  private bounds: number;

  constructor(aspect: number, mapSize: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.5, 600);
    this.bounds = mapSize;
    this.apply();
  }

  apply(): void {
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.bounds);
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, this.bounds);
    this.dist = THREE.MathUtils.clamp(this.dist, 8, 140);
    this.pitch = THREE.MathUtils.clamp(this.pitch, 0.25, 1.4);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
  }

  /** Pan by screen-space pixels; scales with distance so the ground follows the cursor. */
  panPixels(dx: number, dy: number, viewportH: number): void {
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.dist) / viewportH;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw); // screen right
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // screen up (into the map)
    this.target.x += (-dx * rx + dy * fx / Math.max(0.3, Math.sin(this.pitch))) * worldPerPx;
    this.target.z += (-dx * rz + dy * fz / Math.max(0.3, Math.sin(this.pitch))) * worldPerPx;
    this.apply();
  }

  /** Pan in world units along the camera's ground axes (keyboard). */
  panWorld(right: number, forward: number): void {
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.target.x += right * rx + forward * fx;
    this.target.z += right * rz + forward * fz;
    this.apply();
  }

  rotate(dyaw: number, dpitch = 0): void {
    this.yaw += dyaw;
    this.pitch += dpitch;
    this.apply();
  }

  zoom(factor: number): void {
    this.dist *= factor;
    this.apply();
  }

  setBounds(mapSize: number): void {
    this.bounds = mapSize;
    this.apply();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
