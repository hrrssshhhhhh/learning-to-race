import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../sim/track';
import type { World } from '../sim/world';
import type { Vec2 } from '../sim/vec';
import { SPECS, type VehicleKind } from '../sim/vehicle';
import { Effects } from './effects';
import { castRays, RAY_ANGLES, RAY_LENGTH } from '../sim/sensors';
import { popColor } from '../render2d/view2d';

// World (x, y) metres -> three (X, Z), Y up. Seen from above with screen-up = -Z this matches the 2D view.
const SKY = 0xb9cfe2, GROUND = 0x5f7356, ASPHALT = 0x2b2e35, WALL = 0xe4e6ea, KERB_RED = 0xd8312f, KERB_WHITE = 0xf2f2f2;
const WALL_H = 0.9, WALL_T = 0.6, KERB_W = 1.3, KERB_RADIUS = 40; // m; kerbs where the centreline radius is below KERB_RADIUS
const UP = new THREE.Vector3(0, 1, 0);

/** Parts are (geometry, grey level); grey multiplies the material colour, so one material tints the whole vehicle. */
function vehicleGeometry(kind: VehicleKind): THREE.BufferGeometry {
  const s = SPECS[kind], parts: [THREE.BufferGeometry, number][] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, g: number) =>
    parts.push([new THREE.BoxGeometry(w, h, d).translate(x, y, z), g]);
  const wheel = (x: number, z: number, r: number, t: number) =>
    parts.push([new THREE.CylinderGeometry(r, r, t, 10).rotateX(Math.PI / 2).translate(x, r, z), 0.08]);
  if (kind === 'car') {
    box(0, 0.58, 0, s.length, 0.55, s.width, 1); // body
    box(-0.3, 1.08, 0, s.length * 0.48, 0.45, s.width * 0.82, 0.35); // cabin
    box(-s.length / 2 + 0.2, 1.0, 0, 0.35, 0.08, s.width, 0.3); // rear wing
    for (const x of [-1, 1]) for (const z of [-1, 1]) wheel(x * s.length * 0.32, z * (s.width / 2 - 0.1), 0.36, 0.32);
  } else {
    box(0, 0.5, 0, s.length * 0.62, 0.3, 0.14, 1); // frame: thin, sits between the wheels
    box(s.length * 0.3, 0.95, 0, 0.08, 0.08, 0.62, 0.2); // handlebar
    box(-0.15, 1.05, 0, 0.45, 0.7, 0.3, 0.3); // rider
    box(0.05, 1.55, 0, 0.3, 0.3, 0.3, 1); // helmet
    for (const x of [-1, 1]) wheel(x * s.length * 0.36, 0, 0.33, 0.1);
  }
  const geos = parts.map(([g, grey]) => {
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(grey), 3));
    return g;
  });
  const merged = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  return merged;
}

/** Flat-shaded triangle soup with per-vertex colours, built by pushing quads. */
class Soup {
  pos: number[] = []; col: number[] = [];
  private c = new THREE.Color();
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hex: number): void {
    this.c.set(hex); // converts sRGB hex to the linear working space
    for (const p of [a, b, c, a, c, d]) { this.pos.push(p.x, p.y, p.z); this.col.push(this.c.r, this.c.g, this.c.b); }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

const v3 = (p: Vec2, y = 0) => new THREE.Vector3(p.x, y, p.y);
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function trackGeometry(t: Track): THREE.BufferGeometry {
  const s = new Soup(), c = t.center, n = c.length;
  const normal = (i: number) => { // left of travel
    const a = c[(i + n - 1) % n], b = c[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: -dy / l, y: dx / l };
  };
  // circumradius over a 12 m chord, so single-sample noise doesn't light up kerbs
  const radius = (i: number) => {
    const a = c[(i + n - 3) % n], b = c[i], d = c[(i + 3) % n];
    const k = Math.abs((b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x));
    return k < 1e-9 ? Infinity : (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(d.x - b.x, d.y - b.y) * Math.hypot(d.x - a.x, d.y - a.y)) / (2 * k);
  };
  const tight = c.map((_, i) => radius(i) < KERB_RADIUS);
  const edgeIn = (wall: Vec2[], i: number) => lerp2(wall[i], c[i], KERB_W / (t.width / 2));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s.quad(v3(t.inner[i], 0.02), v3(t.inner[j], 0.02), v3(t.outer[j], 0.02), v3(t.outer[i], 0.02), ASPHALT);
    if (tight[i] || tight[j]) {
      const hex = (i >> 1) % 2 ? KERB_RED : KERB_WHITE; // 4 m stripes
      for (const wall of [t.inner, t.outer])
        s.quad(v3(wall[i], 0.06), v3(wall[j], 0.06), v3(edgeIn(wall, j), 0.06), v3(edgeIn(wall, i), 0.06), hex);
    }
    // walls: road-facing side, top, back; inner wall extends left, outer right
    for (const [wall, side] of [[t.inner, 1], [t.outer, -1]] as const) {
      const ni = normal(i), nj = normal(j);
      const bi = { x: wall[i].x + ni.x * side * WALL_T, y: wall[i].y + ni.y * side * WALL_T };
      const bj = { x: wall[j].x + nj.x * side * WALL_T, y: wall[j].y + nj.y * side * WALL_T };
      const hex = tight[i] && (i >> 1) % 2 ? KERB_RED : WALL;
      s.quad(v3(wall[i]), v3(wall[j]), v3(wall[j], WALL_H), v3(wall[i], WALL_H), hex);
      s.quad(v3(wall[i], WALL_H), v3(wall[j], WALL_H), v3(bj, WALL_H), v3(bi, WALL_H), WALL);
      s.quad(v3(bi), v3(bj), v3(bj, WALL_H), v3(bi, WALL_H), WALL);
    }
  }
  // chequered start line: 2 rows of 1 m squares across the road at sample 0
  const f = { x: normal(0).y, y: -normal(0).x }; // forward = right-turned left normal
  const cells = Math.round(t.width);
  for (let r = 0; r < 2; r++) for (let k = 0; k < cells; k++) {
    const p = (q: number, dr: number) => {
      const e = lerp2(t.inner[0], t.outer[0], q / cells);
      return v3({ x: e.x + f.x * dr, y: e.y + f.y * dr }, 0.07); // above kerbs (0.06): no z-fight at the line
    };
    s.quad(p(k, r - 1), p(k + 1, r - 1), p(k + 1, r), p(k, r), (k + r) % 2 ? 0x111111 : 0xffffff);
  }
  return s.build();
}

export class Scene3D {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 5000);
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private trackMesh: THREE.Mesh | null = null;
  private ground: THREE.Mesh;
  private trackMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  private geo: Record<VehicleKind, THREE.BufferGeometry> = { car: vehicleGeometry('car'), bike: vehicleGeometry('bike') };
  private mat: Record<VehicleKind, THREE.MeshStandardMaterial> = {
    // white: each instance is tinted with its population's colour (setColorAt), same palette as the 2D view
    car: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 }),
    bike: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 }),
  };
  private fleets: Partial<Record<VehicleKind, THREE.InstancedMesh>> = {};
  private observer: ResizeObserver;
  readonly effects: Effects;
  // reused every frame: no per-frame allocation
  private m = new THREE.Matrix4(); private p = new THREE.Vector3(); private q = new THREE.Quaternion();
  private tint = new THREE.Color(); private one = new THREE.Vector3(1, 1, 1); private zero = new THREE.Vector3(0, 0, 0);
  private used: Record<VehicleKind, number> = { car: 0, bike: 0 };
  // followed leader: its 7 sensor rays plus a marker cone overhead, so the net diagram has a visible body
  private rays = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAY_ANGLES.length * 6), 3)),
    new THREE.LineBasicMaterial({ color: 0x6ee7a0 }));
  private marker = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 12).rotateX(Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x6ee7a0 }));

  /** Throws if WebGL is unavailable; the caller falls back to 2D. */
  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 1000, 4000);
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x56604c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(0.6, 1, 0.35);
    this.scene.add(sun);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      // pushed back in depth so the road (2 cm up) never z-fights it from far or oblique views
      new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }));
    this.scene.add(this.ground);
    this.effects = new Effects(this.scene);
    this.rays.frustumCulled = false; // positions change every frame; bounds would go stale
    this.scene.add(this.rays, this.marker);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setTrack(t: Track): void {
    if (this.trackMesh) { this.trackMesh.geometry.dispose(); this.scene.remove(this.trackMesh); }
    this.trackMesh = new THREE.Mesh(trackGeometry(t), this.trackMat);
    this.scene.add(this.trackMesh);
    this.effects.setTrack(t);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of t.outer) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.y); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.y); }
    const size = Math.max(x1 - x0, z1 - z0);
    this.ground.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.ground.scale.set(size * 12, 1, size * 12);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = size * 2; fog.far = size * 6; // top view sits ~1.3 sizes up, so it stays clear
    this.camera.far = size * 8; this.camera.updateProjectionMatrix();
  }

  render(w: World, dt = 0, focus?: { pop: number; vehicle: number }): void {
    this.effects.update(dt);
    this.used.car = this.used.bike = 0;
    for (const pop of w.populations) this.used[pop.kind] += pop.vehicles.length;
    for (const kind of ['car', 'bike'] as const) {
      let mesh = this.fleets[kind];
      if (!mesh || mesh.instanceMatrix.count < this.used[kind]) { // grow (rare): rebuild with headroom
        if (mesh) { this.scene.remove(mesh); mesh.dispose(); }
        mesh = this.fleets[kind] = new THREE.InstancedMesh(this.geo[kind], this.mat[kind], Math.max(this.used[kind], 100));
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false; // instances span the whole track
        this.scene.add(mesh);
      }
      mesh.count = 0;
    }
    for (const pop of w.populations) {
      const mesh = this.fleets[pop.kind]!;
      this.tint.set(popColor(pop));
      for (const v of pop.vehicles) {
        mesh.setColorAt(mesh.count, this.tint);
        this.p.set(v.pos.x, 0, v.pos.y);
        this.q.setFromAxisAngle(UP, -v.heading); // heading is CCW in xy; rotating about +Y maps +X toward -Z
        this.m.compose(this.p, this.q, v.alive ? this.one : this.zero);
        mesh.setMatrixAt(mesh.count++, this.m);
      }
    }
    for (const kind of ['car', 'bike'] as const) {
      const f = this.fleets[kind]!;
      f.instanceMatrix.needsUpdate = true;
      if (f.instanceColor) f.instanceColor.needsUpdate = true;
    }
    const v = focus ? w.populations[focus.pop]?.vehicles[focus.vehicle] : undefined;
    this.rays.visible = this.marker.visible = !!v?.alive;
    if (v?.alive) {
      const hits = castRays(v, w.track), arr = this.rays.geometry.attributes.position as THREE.BufferAttribute;
      RAY_ANGLES.forEach((deg, i) => {
        const a = v.heading + (deg * Math.PI) / 180, d = hits[i] * RAY_LENGTH;
        arr.setXYZ(2 * i, v.pos.x, 0.6, v.pos.y);
        arr.setXYZ(2 * i + 1, v.pos.x + Math.cos(a) * d, 0.6, v.pos.y + Math.sin(a) * d);
      });
      arr.needsUpdate = true;
      this.marker.position.set(v.pos.x, 3.2, v.pos.y);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.observer.disconnect();
    this.effects.dispose();
    this.rays.geometry.dispose(); (this.rays.material as THREE.Material).dispose();
    this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose();
    this.trackMesh?.geometry.dispose();
    this.trackMat.dispose();
    this.ground.geometry.dispose(); (this.ground.material as THREE.Material).dispose();
    for (const k of ['car', 'bike'] as const) { this.geo[k].dispose(); this.mat[k].dispose(); this.fleets[k]?.dispose(); }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
