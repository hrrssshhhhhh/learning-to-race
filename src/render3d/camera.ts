import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Track } from '../sim/track';
import type { Vec2 } from '../sim/vec';

export type CameraMode = 'chase' | 'orbit' | 'top';

const CHASE_BACK = 16, CHASE_UP = 7, CHASE_AHEAD = 12; // m, relative to the followed vehicle
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // ease-in-out cubic
const NORTH = new THREE.Vector3(0, 0, -1); // top view's screen-up, so it matches the 2D view (world y down the screen)
const Y = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  mode: CameraMode = 'chase';
  private controls: OrbitControls;
  private center = new THREE.Vector3();
  private size = 100; // largest track extent, m
  private ext = { x: 100, z: 100 };
  private target = { pos: { x: 0, y: 0 }, heading: 0 };
  private chasePos = new THREE.Vector3(); private chaseLook = new THREE.Vector3(); private chaseReady = false;
  private swoop: { t0: number; ms: number; fromPos: THREE.Vector3; fromLook: THREE.Vector3; done: () => void } | null = null;
  // scratch
  private v = new THREE.Vector3(); private w = new THREE.Vector3(); private u = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47; // stay above the ground
  }

  setTrack(t: Track): void {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of t.outer) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.y); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.y); }
    this.center.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.ext = { x: x1 - x0, z: z1 - z0 };
    this.size = Math.max(x1 - x0, z1 - z0);
    this.controls.minDistance = 15; this.controls.maxDistance = this.size * 2.5;
    this.chaseReady = false;
    if (this.mode !== 'chase') this.setMode(this.mode);
  }
  setMode(m: CameraMode): void {
    this.mode = m;
    if (this.swoop) return; // applied when the swoop ends; input mid-swoop must not break it
    this.camera.up.copy(Y);
    this.controls.enabled = m === 'orbit';
    if (m === 'orbit') {
      this.controls.target.copy(this.center);
      this.camera.position.copy(this.center).add(this.v.set(0, this.size * 0.4, this.size * 0.6));
      this.controls.update();
    }
    this.chaseReady = false;
  }

  follow(pos: Vec2, heading: number): void { this.target.pos = pos; this.target.heading = heading; }

  /** Straight-down view of the track (same framing as the 2D view), then ease into the low chase angle. Ends in chase mode. */
  swoopFromTop(track: Track, ms = 1800): Promise<void> {
    this.setTrack(track);
    this.swoop?.done();
    this.swoop = null;
    this.setMode('chase');
    this.topPose();
    this.chaseReady = false;
    return new Promise((done) => {
      this.swoop = { t0: performance.now(), ms, fromPos: this.camera.position.clone(), fromLook: this.center.clone(), done };
    });
  }

  private topPose(): void {
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const h = 1.08 * Math.max(this.ext.z / 2 / tan, this.ext.x / 2 / (tan * this.camera.aspect));
    this.camera.position.copy(this.center).setY(h);
    this.camera.up.copy(NORTH);
    this.camera.lookAt(this.center);
  }

  /** Desired chase position/look for the followed vehicle, smoothed (snap when not ready). */
  private chasePose(dt: number): void {
    const { pos, heading } = this.target, fx = Math.cos(heading), fz = Math.sin(heading);
    this.v.set(pos.x - fx * CHASE_BACK, CHASE_UP, pos.y - fz * CHASE_BACK);
    this.w.set(pos.x + fx * CHASE_AHEAD, 0, pos.y + fz * CHASE_AHEAD);
    const k = this.chaseReady ? 1 - Math.exp(-dt * 4) : 1;
    this.chasePos.lerp(this.v, k); this.chaseLook.lerp(this.w, k);
    this.chaseReady = true;
  }

  update(dt: number): void {
    if (this.swoop) {
      const s = this.swoop, t = Math.min(1, (performance.now() - s.t0) / s.ms), e = ease(t);
      this.chasePose(dt); // the end pose tracks the leader as it moves
      // position, look target and up all ease together, so the track stays in frame and the roll is smooth
      this.camera.position.lerpVectors(s.fromPos, this.chasePos, e);
      this.camera.up.lerpVectors(NORTH, Y, e).normalize();
      this.camera.lookAt(this.u.lerpVectors(s.fromLook, this.chaseLook, e));
      if (t >= 1) { this.swoop = null; this.setMode(this.mode); this.chaseReady = true; s.done(); }
    } else if (this.mode === 'orbit') this.controls.update(dt);
    else if (this.mode === 'top') this.topPose();
    else {
      this.chasePose(dt);
      this.camera.up.copy(Y);
      this.camera.position.copy(this.chasePos);
      this.camera.lookAt(this.chaseLook);
    }
    // depth precision: road sits 2 cm above the ground, so push the near plane out when the camera is high
    this.camera.near = Math.max(0.5, this.camera.position.y * 0.05);
    this.camera.updateProjectionMatrix();
  }
}
