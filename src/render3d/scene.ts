import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Track } from '../sim/track';
import type { World } from '../sim/world';
import type { Vec2 } from '../sim/vec';
import { SPECS, type VehicleKind } from '../sim/vehicle';
import { Effects } from './effects';
import { castRays, RAY_ANGLES, RAY_LENGTH } from '../sim/sensors';
import { LEAD, NEON, popColor } from '../render2d/view2d';

// World (x, y) metres -> three (X, Z), Y up. Seen from above with screen-up = -Z this matches the 2D view.
// Night circuit: dark surfaces lit by a cool moon, with neon strips that the bloom pass makes glow.
const SKY = 0x05060c, GROUND = 0x07080d, ASPHALT = 0x16171d, WALL = 0x1c1f2a, KERB_RED = 0xff2d55, KERB_WHITE = 0xdfe7ff;
const WALL_H = 0.9, WALL_T = 0.6, KERB_W = 1.3, KERB_RADIUS = 40; // m; kerbs where the centreline radius is below KERB_RADIUS
const UP = new THREE.Vector3(0, 1, 0);

/** Parts are (geometry, grey level); grey multiplies the material colour, so one material tints the whole vehicle. */
function build(parts: [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  const geos = parts.map(([g, grey]) => {
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(grey), 3));
    return g;
  });
  const merged = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  return merged;
}

/** Dark body shell. Lit, metallic; its instances get a faint tint of the population colour. */
function bodyGeometry(kind: VehicleKind): THREE.BufferGeometry {
  const s = SPECS[kind], parts: [THREE.BufferGeometry, number][] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, g: number) =>
    parts.push([new THREE.BoxGeometry(w, h, d).translate(x, y, z), g]);
  const wheel = (x: number, z: number, r: number, t: number) =>
    parts.push([new THREE.CylinderGeometry(r, r, t, 12).rotateX(Math.PI / 2).translate(x, r, z), 0.15]);
  if (kind === 'car') {
    box(0, 0.5, 0, s.length, 0.42, s.width, 1); // low wedge body
    box(-0.2, 0.9, 0, s.length * 0.42, 0.36, s.width * 0.72, 0.55); // canopy
    box(s.length / 2 - 0.25, 0.45, 0, 0.5, 0.22, s.width * 1.04, 0.8); // front splitter
    box(-s.length / 2 + 0.2, 1.05, 0, 0.4, 0.06, s.width * 1.05, 0.7); // rear wing
    for (const z of [-1, 1]) box(-s.length / 2 + 0.25, 0.85, z * s.width * 0.4, 0.2, 0.36, 0.06, 0.7); // wing posts
    for (const x of [-1, 1]) for (const z of [-1, 1]) wheel(x * s.length * 0.32, z * (s.width / 2 - 0.08), 0.34, 0.3);
  } else {
    box(0, 0.55, 0, s.length * 0.66, 0.32, 0.2, 1); // fairing
    box(s.length * 0.26, 0.85, 0, 0.3, 0.18, 0.22, 0.7); // nose
    box(s.length * 0.3, 0.98, 0, 0.06, 0.06, 0.6, 0.3); // handlebar
    box(-0.12, 1.0, 0, 0.42, 0.55, 0.3, 0.45); // rider, tucked
    box(0.06, 1.38, 0, 0.3, 0.28, 0.28, 0.9); // helmet
    for (const x of [-1, 1]) wheel(x * s.length * 0.36, 0, 0.33, 0.1);
  }
  return build(parts);
}

/** Neon parts (unlit): underglow, light bars, wheel rims. Instance colour = population colour, bright enough to bloom. */
function glowGeometry(kind: VehicleKind): THREE.BufferGeometry {
  const s = SPECS[kind], parts: [THREE.BufferGeometry, number][] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, g: number) =>
    parts.push([new THREE.BoxGeometry(w, h, d).translate(x, y, z), g]);
  if (kind === 'car') {
    box(0, 0.12, 0, s.length * 0.9, 0.04, s.width * 0.95, 0.55); // underglow
    box(-s.length / 2 - 0.01, 0.62, 0, 0.04, 0.08, s.width * 0.9, 1); // tail light bar
    box(s.length / 2 + 0.01, 0.55, 0, 0.04, 0.06, s.width * 0.8, 1); // front light bar
    for (const z of [-1, 1]) box(0, 0.55, z * (s.width / 2 + 0.01), s.length * 0.7, 0.05, 0.03, 1); // side strips
    box(-s.length / 2 + 0.2, 1.09, 0, 0.42, 0.03, s.width * 1.06, 1); // wing edge
  } else {
    box(0, 0.1, 0, s.length * 0.7, 0.04, 0.3, 0.55); // underglow
    box(s.length * 0.42, 0.85, 0, 0.04, 0.12, 0.18, 1); // headlight
    box(-s.length * 0.33, 0.7, 0, 0.04, 0.08, 0.16, 1); // tail light
    for (const z of [-1, 1]) box(0.1, 0.6, z * 0.11, s.length * 0.5, 0.04, 0.02, 1); // fairing stripes
    box(0.06, 1.38, 0.15, 0.2, 0.06, 0.01, 1); // visor
  }
  return build(parts);
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

function helpers(t: Track) {
  const c = t.center, n = c.length;
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
  return { c, n, normal, radius };
}

function trackGeometry(t: Track): THREE.BufferGeometry {
  const s = new Soup(), { c, n, normal, radius } = helpers(t);
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
      s.quad(v3(wall[i]), v3(wall[j]), v3(wall[j], WALL_H), v3(wall[i], WALL_H), WALL);
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
    s.quad(p(k, r - 1), p(k + 1, r - 1), p(k + 1, r), p(k, r), (k + r) % 2 ? 0x111111 : 0xdfe7ff);
  }
  return s.build();
}

/** Neon strips along both walls (unlit, so they bloom): a band on the road-facing face and a line on top. */
function neonGeometry(t: Track): THREE.BufferGeometry {
  const s = new Soup(), { n, normal } = helpers(t);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const [wall, side, hex] of [[t.inner, 1, NEON.bike], [t.outer, -1, NEON.car]] as const) {
      const ni = normal(i), nj = normal(j), o = -side * 0.01; // a hair in front of the face
      const a = { x: wall[i].x + ni.x * o, y: wall[i].y + ni.y * o }, b = { x: wall[j].x + nj.x * o, y: wall[j].y + nj.y * o };
      s.quad(v3(a, WALL_H - 0.22), v3(b, WALL_H - 0.22), v3(b, WALL_H - 0.12), v3(a, WALL_H - 0.12), hex);
      const ti = { x: wall[i].x + ni.x * side * WALL_T * 0.5, y: wall[i].y + ni.y * side * WALL_T * 0.5 };
      const tj = { x: wall[j].x + nj.x * side * WALL_T * 0.5, y: wall[j].y + nj.y * side * WALL_T * 0.5 };
      s.quad(v3(lerp2(wall[i], ti, 0.6), WALL_H + 0.005), v3(lerp2(wall[j], tj, 0.6), WALL_H + 0.005), v3(tj, WALL_H + 0.005), v3(ti, WALL_H + 0.005), hex);
    }
  }
  return s.build();
}

/**
 * Grandstands outside the outer wall on the long straights: stepped tiers (lit), a neon edge per tier (unlit),
 * and seat positions for the crowd. At most 6 stands, each up to 80 m.
 */
function stands(t: Track): { tiers: THREE.BufferGeometry | null; trim: THREE.BufferGeometry | null; seats: THREE.Matrix4[] } {
  const { c, n, radius } = helpers(t), tiers: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [], seats: THREE.Matrix4[] = [];
  const step = (i: number) => Math.hypot(c[(i + 1) % n].x - c[i].x, c[(i + 1) % n].y - c[i].y);
  // find straight runs (radius > 150 m), starting the walk on a corner so no run wraps past the start
  let s0 = 0; while (s0 < n && radius(s0) > 150) s0++;
  const runs: [number, number, number][] = []; // [first, last, length]
  for (let k = 0, first = -1, len = 0; k <= n; k++) {
    const i = (s0 + k) % n, straight = k < n && radius(i) > 150;
    if (straight) { if (first < 0) { first = i; len = 0; } len += step(i); }
    else if (first >= 0) { runs.push([first, (i + n - 1) % n, len]); first = -1; }
  }
  runs.sort((a, b) => b[2] - a[2]);
  const rnd = (() => { let x = 1234567; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); })(); // fixed: same crowd every time
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  for (const [first, , len] of runs.filter((r) => r[2] >= 70).slice(0, 6)) {
    const L = Math.min(80, len * 0.7);
    let mid = first, acc = 0; // the sample halfway along the run
    while (acc < len / 2) { acc += step(mid); mid = (mid + 1) % n; }
    const o = t.outer[mid], cen = c[mid], dl = Math.hypot(o.x - cen.x, o.y - cen.y) || 1;
    const out = { x: (o.x - cen.x) / dl, y: (o.y - cen.y) / dl }, tan = { x: -out.y, y: out.x };
    const yaw = Math.atan2(tan.y, tan.x);
    q.setFromAxisAngle(UP, -yaw);
    for (let k = 0; k < 4; k++) {
      const d = WALL_T + 5 + k * 1.6 + 0.8, h = 0.9 + k * 0.9;
      const cx = o.x + out.x * d, cz = o.y + out.y * d;
      tiers.push(new THREE.BoxGeometry(L, h, 1.6).applyQuaternion(q).translate(cx, h / 2, cz));
      const ex = o.x + out.x * (d - 0.8), ez = o.y + out.y * (d - 0.8);
      trim.push(new THREE.BoxGeometry(L, 0.06, 0.06).applyQuaternion(q).translate(ex, h + 0.01, ez));
      for (let a = -L / 2 + 0.5; a < L / 2 - 0.4; a += 0.8) {
        if (rnd() < 0.18) continue; // empty seats
        const j = (rnd() - 0.5) * 0.2, sx = cx + tan.x * (a + j), sz = cz + tan.y * (a + j);
        const hh = 0.75 + rnd() * 0.25;
        m.compose(pos.set(sx, h + hh / 2, sz), q, scl.set(0.42, hh, 0.32));
        seats.push(m.clone());
      }
    }
  }
  return { tiers: tiers.length ? mergeGeometries(tiers) : null, trim: trim.length ? mergeGeometries(trim) : null, seats };
}

export class Scene3D {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 5000);
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private trackMesh: THREE.Mesh | null = null;
  private neonMesh: THREE.Mesh | null = null;
  private standMesh: THREE.Mesh | null = null;
  private trimMesh: THREE.Mesh | null = null;
  private crowd: THREE.InstancedMesh | null = null;
  private seats: THREE.Matrix4[] = [];
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper | null = null;
  private trackMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide });
  private neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  private standMat = new THREE.MeshStandardMaterial({ color: 0x1a1c26, roughness: 0.8, metalness: 0.2 });
  private crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  private geo = { body: { car: bodyGeometry('car'), bike: bodyGeometry('bike') }, glow: { car: glowGeometry('car'), bike: glowGeometry('bike') } };
  // low metalness: with no environment map to reflect, metal renders almost black at night
  private bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
  private glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private fleets: Partial<Record<VehicleKind, { body: THREE.InstancedMesh; glow: THREE.InstancedMesh }>> = {};
  private observer: ResizeObserver;
  readonly effects: Effects;
  // reused every frame: no per-frame allocation
  private m = new THREE.Matrix4(); private p = new THREE.Vector3(); private q = new THREE.Quaternion();
  private tint = new THREE.Color(); private shell = new THREE.Color(); private dark = new THREE.Color(0x56607c);
  private one = new THREE.Vector3(1, 1, 1); private zero = new THREE.Vector3(0, 0, 0);
  private used: Record<VehicleKind, number> = { car: 0, bike: 0 };
  private clock = 0;
  // followed leader: its 7 sensor rays plus a marker cone overhead, so the net diagram has a visible body
  private rays = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAY_ANGLES.length * 6), 3)),
    new THREE.LineBasicMaterial({ color: LEAD, toneMapped: false }));
  private marker = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 12).rotateX(Math.PI),
    new THREE.MeshBasicMaterial({ color: LEAD, toneMapped: false }));

  /** Throws if WebGL is unavailable; the caller falls back to 2D. */
  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 1000, 4000);
    this.scene.add(new THREE.HemisphereLight(0x6d7cff, 0x0b0c14, 1.6)); // cool sky, near-black ground bounce
    const moon = new THREE.DirectionalLight(0xb4c4ff, 2.0);
    moon.position.set(-0.4, 1, 0.3);
    this.scene.add(moon);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      // pushed back in depth so the road (2 cm up) never z-fights it from far or oblique views
      new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }));
    this.scene.add(this.ground);
    this.effects = new Effects(this.scene);
    this.rays.frustumCulled = false; // positions change every frame; bounds would go stale
    this.scene.add(this.rays, this.marker);
    // bloom: only bright, unlit things (neon, light bars, sparks) cross the threshold and glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.45, 0.32);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2); // half-res bloom: plenty for a soft glow, much cheaper
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setTrack(t: Track): void {
    for (const mesh of [this.trackMesh, this.neonMesh, this.standMesh, this.trimMesh]) if (mesh) { mesh.geometry.dispose(); this.scene.remove(mesh); }
    if (this.crowd) { this.scene.remove(this.crowd); this.crowd.dispose(); this.crowd = null; }
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); }
    this.trackMesh = new THREE.Mesh(trackGeometry(t), this.trackMat);
    this.neonMesh = new THREE.Mesh(neonGeometry(t), this.neonMat);
    this.scene.add(this.trackMesh, this.neonMesh);
    const st = stands(t);
    this.standMesh = st.tiers ? new THREE.Mesh(st.tiers, this.standMat) : null;
    this.trimMesh = st.trim ? new THREE.Mesh(st.trim, new THREE.MeshBasicMaterial({ color: NEON.bike, toneMapped: false })) : null;
    if (this.standMesh) this.scene.add(this.standMesh);
    if (this.trimMesh) this.scene.add(this.trimMesh);
    this.seats = st.seats;
    if (st.seats.length) {
      this.crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.crowdMat, st.seats.length);
      const col = new THREE.Color(), shirts = [0x2a2f45, 0x3b2a45, 0x1f3a3f, 0x45302a, 0x30303a];
      st.seats.forEach((mx, i) => {
        this.crowd!.setMatrixAt(i, mx);
        // most of the crowd in dark clothes; one in eight holds up a light in a team colour
        col.set(i % 8 === 0 ? (i % 16 === 0 ? NEON.car : NEON.bike) : shirts[i % shirts.length]);
        this.crowd!.setColorAt(i, col);
      });
      this.crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(this.crowd);
    }
    this.effects.setTrack(t);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of t.outer) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.y); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.y); }
    const size = Math.max(x1 - x0, z1 - z0);
    this.ground.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.ground.scale.set(size * 12, 1, size * 12);
    // neon floor grid, faint, around the circuit
    const span = Math.ceil((size * 3) / 20) * 20;
    this.grid = new THREE.GridHelper(span, span / 20, 0x2a2f6b, 0x161a3a);
    (this.grid.material as THREE.Material).transparent = true; (this.grid.material as THREE.Material).opacity = 0.6;
    this.grid.position.set((x0 + x1) / 2, 0.005, (z0 + z1) / 2);
    this.scene.add(this.grid);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = size * 1.2; fog.far = size * 4; // top view sits ~1.3 sizes up, so it stays clear
    this.camera.far = size * 8; this.camera.updateProjectionMatrix();
  }

  render(w: World, dt = 0, focus?: { pop: number; vehicle: number }): void {
    this.clock += dt;
    this.effects.update(dt);
    this.used.car = this.used.bike = 0;
    for (const pop of w.populations) this.used[pop.kind] += pop.vehicles.length;
    for (const kind of ['car', 'bike'] as const) {
      let f = this.fleets[kind];
      if (!f || f.body.instanceMatrix.count < this.used[kind]) { // grow (rare): rebuild with headroom
        if (f) { this.scene.remove(f.body, f.glow); f.body.dispose(); f.glow.dispose(); }
        const cap = Math.max(this.used[kind], 100);
        const mk = (g: THREE.BufferGeometry, mat: THREE.Material) => {
          const im = new THREE.InstancedMesh(g, mat, cap);
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.frustumCulled = false; // instances span the whole track
          return im;
        };
        f = this.fleets[kind] = { body: mk(this.geo.body[kind], this.bodyMat), glow: mk(this.geo.glow[kind], this.glowMat) };
        this.scene.add(f.body, f.glow);
      }
      f.body.count = f.glow.count = 0;
    }
    for (const pop of w.populations) {
      const f = this.fleets[pop.kind]!;
      this.tint.set(popColor(pop));
      this.shell.copy(this.dark).lerp(this.tint, 0.38); // dark metal with a clear hint of the team colour
      for (const v of pop.vehicles) {
        this.p.set(v.pos.x, 0, v.pos.y);
        this.q.setFromAxisAngle(UP, -v.heading); // heading is CCW in xy; rotating about +Y maps +X toward -Z
        this.m.compose(this.p, this.q, v.alive ? this.one : this.zero);
        f.body.setColorAt(f.body.count, this.shell); f.body.setMatrixAt(f.body.count++, this.m);
        f.glow.setColorAt(f.glow.count, this.tint); f.glow.setMatrixAt(f.glow.count++, this.m);
      }
    }
    for (const kind of ['car', 'bike'] as const) for (const im of [this.fleets[kind]!.body, this.fleets[kind]!.glow]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.animateCrowd();
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
      this.marker.position.set(v.pos.x, 2.6, v.pos.y);
    }
    this.composer.render();
  }

  /** The crowd shifts on its feet: a small, slow bob per person, out of phase so it never moves in unison. */
  private animateCrowd(): void {
    if (!this.crowd) return;
    const t = this.clock;
    for (let i = 0; i < this.seats.length; i++) {
      this.m.copy(this.seats[i]);
      this.m.elements[13] += Math.max(0, Math.sin(t * 3 + i * 1.7)) * 0.08;
      this.crowd.setMatrixAt(i, this.m);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.observer.disconnect();
    this.effects.dispose();
    for (const mesh of [this.trackMesh, this.neonMesh, this.standMesh, this.trimMesh]) mesh?.geometry.dispose();
    this.crowd?.dispose();
    for (const mat of [this.trackMat, this.neonMat, this.standMat, this.crowdMat, this.bodyMat, this.glowMat]) mat.dispose();
    this.ground.geometry.dispose(); (this.ground.material as THREE.Material).dispose();
    for (const k of ['car', 'bike'] as const) {
      this.geo.body[k].dispose(); this.geo.glow[k].dispose();
      this.fleets[k]?.body.dispose(); this.fleets[k]?.glow.dispose();
    }
    this.rays.geometry.dispose(); (this.rays.material as THREE.Material).dispose();
    this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
