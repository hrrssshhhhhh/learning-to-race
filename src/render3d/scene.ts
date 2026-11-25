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
import { LEAD, popColor } from '../render2d/view2d';

// World (x, y) metres -> three (X, Z), Y up. Seen from above with screen-up = -Z this matches the 2D view.
// A floodlit night race: a dark sky, the circuit lit bright and even by light towers, white walls with trackside boards.
const SKY = 0x0a0d18, GRASS = 0x0f1f12, ASPHALT = 0x26272d, WALL = 0xcfd0d4, KERB_RED = 0xe10600, KERB_WHITE = 0xf5f5f5;
const BOARDS = [0x15151e, 0xe10600, 0x15151e, 0xf5f5f5, 0x1f3b73]; // trackside board colours, cycling every ~16 m
const WALL_H = 0.9, WALL_T = 0.6, KERB_W = 1.3, KERB_RADIUS = 40; // m; kerbs where the centreline radius is below KERB_RADIUS
const UP = new THREE.Vector3(0, 1, 0);

/** Parts are (geometry, colour). Livery parts are multiplied by the population colour (instance colour), detail parts are not. */
type Part = [THREE.BufferGeometry, number];
function build(parts: Part[]): THREE.BufferGeometry {
  const c = new THREE.Color();
  const geos = parts.map(([g, hex]) => {
    c.set(hex);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  });
  const merged = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  return merged;
}
const boxAt = (x: number, y: number, z: number, w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const wheelAt = (x: number, z: number, r: number, t: number) => new THREE.CylinderGeometry(r, r, t, 16).rotateX(Math.PI / 2).translate(x, r, z);

/** Livery: an open-wheel race car's nose, chassis, sidepods and engine cover, or a race bike's fairing and tail. */
function liveryGeometry(kind: VehicleKind): THREE.BufferGeometry {
  const s = SPECS[kind], L = s.length, W = s.width, p: Part[] = [];
  if (kind === 'car') {
    p.push([boxAt(L * 0.33, 0.33, 0, L * 0.3, 0.22, 0.3), 0xffffff]); // nose
    p.push([boxAt(0.15, 0.42, 0, L * 0.3, 0.42, 0.72), 0xffffff]); // chassis
    p.push([boxAt(-0.45, 0.36, 0, L * 0.3, 0.38, W * 0.78), 0xffffff]); // sidepods
    p.push([boxAt(-L * 0.28, 0.55, 0, L * 0.25, 0.42, 0.5), 0xdddddd]); // engine cover
    p.push([boxAt(-0.15, 0.86, 0, 0.42, 0.3, 0.32), 0xbbbbbb]); // airbox
  } else {
    p.push([boxAt(0.15, 0.62, 0, L * 0.55, 0.42, 0.34), 0xffffff]); // fairing
    p.push([boxAt(L * 0.3, 0.82, 0, 0.32, 0.22, 0.26), 0xffffff]); // nose
    p.push([boxAt(-L * 0.3, 0.78, 0, 0.42, 0.16, 0.22), 0xdddddd]); // tail
  }
  return build(p);
}

/** Fixed colours: tyres, wings, halo, helmet, rider. Real race-car detail that is never team coloured. */
function detailGeometry(kind: VehicleKind): THREE.BufferGeometry {
  const s = SPECS[kind], L = s.length, W = s.width, p: Part[] = [];
  const BLACK = 0x111114, CARBON = 0x26262c, WHITE = 0xf4f4f4, RIM = 0x7a7a82;
  if (kind === 'car') {
    for (const x of [L * 0.34, -L * 0.33]) for (const z of [-1, 1]) {
      p.push([wheelAt(x, z * (W / 2 - 0.2), 0.34, 0.38), BLACK]); // open wheels, outside the body
      p.push([wheelAt(x, z * (W / 2 - 0.0), 0.2, 0.02), RIM]);
    }
    p.push([boxAt(L / 2 - 0.12, 0.12, 0, 0.42, 0.05, W), CARBON]); // front wing
    for (const z of [-1, 1]) p.push([boxAt(L / 2 - 0.12, 0.2, (z * W) / 2, 0.42, 0.18, 0.03), WHITE]); // front endplates
    p.push([boxAt(-L / 2 + 0.15, 0.95, 0, 0.3, 0.08, W * 0.5), CARBON]); // rear wing
    for (const z of [-1, 1]) p.push([boxAt(-L / 2 + 0.15, 0.82, z * W * 0.25, 0.34, 0.34, 0.03), WHITE]); // rear endplates
    p.push([boxAt(-L / 2 + 0.25, 0.62, 0, 0.12, 0.34, 0.06), CARBON]); // wing pillar
    p.push([boxAt(0.35, 0.82, 0, 0.06, 0.06, 0.5), BLACK]); // halo bar
    p.push([boxAt(0.1, 0.78, 0, 0.5, 0.05, 0.06), BLACK]); // halo spine
    p.push([boxAt(0.05, 0.75, 0, 0.26, 0.24, 0.24), WHITE]); // helmet
  } else {
    for (const x of [-1, 1]) p.push([wheelAt(x * L * 0.36, 0, 0.33, 0.12), BLACK]);
    p.push([boxAt(L * 0.38, 1.02, 0, 0.06, 0.24, 0.24), 0x2b3340]); // screen
    p.push([boxAt(-0.05, 1.05, 0, 0.42, 0.32, 0.3), BLACK]); // rider, tucked
    p.push([boxAt(0.15, 1.28, 0, 0.26, 0.26, 0.26), WHITE]); // helmet
  }
  return build(p);
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
  const outward = (i: number) => { // unit vector from the centreline to the outer wall
    const o = t.outer[i], m = c[i], d = Math.hypot(o.x - m.x, o.y - m.y) || 1;
    return { x: (o.x - m.x) / d, y: (o.y - m.y) / d };
  };
  return { c, n, normal, radius, outward };
}

function trackGeometry(t: Track): THREE.BufferGeometry {
  const s = new Soup(), { c, n, normal, radius } = helpers(t);
  const tight = c.map((_, i) => radius(i) < KERB_RADIUS);
  const edgeIn = (wall: Vec2[], i: number) => lerp2(wall[i], c[i], KERB_W / (t.width / 2));
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    dist += Math.hypot(c[j].x - c[i].x, c[j].y - c[i].y);
    s.quad(v3(t.inner[i], 0.02), v3(t.inner[j], 0.02), v3(t.outer[j], 0.02), v3(t.outer[i], 0.02), ASPHALT);
    if (tight[i] || tight[j]) {
      const hex = (i >> 1) % 2 ? KERB_RED : KERB_WHITE; // 4 m stripes
      for (const wall of [t.inner, t.outer])
        s.quad(v3(wall[i], 0.06), v3(wall[j], 0.06), v3(edgeIn(wall, j), 0.06), v3(edgeIn(wall, i), 0.06), hex);
    } else {
      // white painted track limit just inside each wall (kerbs replace it on corners)
      for (const wall of [t.inner, t.outer]) {
        const a = lerp2(wall[i], c[i], 0.3 / (t.width / 2)), b = lerp2(wall[j], c[j], 0.3 / (t.width / 2));
        s.quad(v3(wall[i], 0.04), v3(wall[j], 0.04), v3(b, 0.04), v3(a, 0.04), 0xf5f5f5);
      }
    }
    // walls: white concrete, with a band of trackside boards along the top of the road-facing face
    const board = BOARDS[Math.floor(dist / 16) % BOARDS.length];
    for (const [wall, side] of [[t.inner, 1], [t.outer, -1]] as const) {
      const ni = normal(i), nj = normal(j);
      const bi = { x: wall[i].x + ni.x * side * WALL_T, y: wall[i].y + ni.y * side * WALL_T };
      const bj = { x: wall[j].x + nj.x * side * WALL_T, y: wall[j].y + nj.y * side * WALL_T };
      s.quad(v3(wall[i]), v3(wall[j]), v3(wall[j], 0.45), v3(wall[i], 0.45), WALL);
      s.quad(v3(wall[i], 0.45), v3(wall[j], 0.45), v3(wall[j], WALL_H), v3(wall[i], WALL_H), board);
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
    s.quad(p(k, r - 1), p(k + 1, r - 1), p(k + 1, r), p(k, r), (k + r) % 2 ? 0x111111 : 0xf5f5f5);
  }
  return s.build();
}

/** Radial falloff texture for the pools of floodlight on the asphalt (drawn additively). */
function poolTexture(): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d')!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,248,230,0.16)'); grad.addColorStop(0.5, 'rgba(255,248,230,0.05)'); grad.addColorStop(1, 'rgba(255,248,230,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Furniture { towers: THREE.BufferGeometry | null; lamps: THREE.BufferGeometry | null; pools: THREE.Matrix4[]; tiers: THREE.BufferGeometry | null; seats: THREE.Matrix4[]; gantry: THREE.BufferGeometry; lightPos: THREE.Vector3[] }

/**
 * Everything beside the track: light towers every ~70 m outside the outer wall (pole, lamp head, a pool of light on the road),
 * grandstands with a crowd on the longest straights, and the start-light gantry over the grid.
 */
function furniture(t: Track): Furniture {
  const { c, n, radius, outward, normal } = helpers(t);
  const towers: THREE.BufferGeometry[] = [], lamps: THREE.BufferGeometry[] = [], pools: THREE.Matrix4[] = [], tiers: THREE.BufferGeometry[] = [], seats: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const step = (i: number) => Math.hypot(c[(i + 1) % n].x - c[i].x, c[(i + 1) % n].y - c[i].y);
  // light towers
  for (let i = 0, acc = 0; i < n; i++) {
    acc += step(i);
    if (acc < 70) continue;
    acc = 0;
    const o = t.outer[i], out = outward(i), d = WALL_T + 3, x = o.x + out.x * d, z = o.y + out.y * d, H = 18;
    towers.push(boxAt(x, H / 2, z, 0.35, H, 0.35));
    q.setFromAxisAngle(UP, -Math.atan2(-out.y, -out.x)); // lamp head faces the track
    lamps.push(new THREE.BoxGeometry(0.5, 1.2, 2.6).applyQuaternion(q).translate(x - out.x * 0.4, H, z - out.y * 0.4));
    const r = t.width * 1.3; // pool centred on the road, a little wider than it
    m.compose(pos.set(c[i].x, 0.05, c[i].y), flat, scl.set(r * 2, r * 2, 1));
    pools.push(m.clone());
  }
  // grandstands on the longest straights
  let s0 = 0; while (s0 < n && radius(s0) > 150) s0++;
  const runs: [number, number][] = []; // [first, length]
  for (let k = 0, first = -1, len = 0; k <= n; k++) {
    const i = (s0 + k) % n, straight = k < n && radius(i) > 150;
    if (straight) { if (first < 0) { first = i; len = 0; } len += step(i); }
    else if (first >= 0) { runs.push([first, len]); first = -1; }
  }
  runs.sort((a, b) => b[1] - a[1]);
  const rnd = (() => { let x = 1234567; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); })(); // fixed: same crowd every time
  for (const [first, len] of runs.filter((r) => r[1] >= 70).slice(0, 5)) {
    const L = Math.min(90, len * 0.7);
    let mid = first, acc = 0;
    while (acc < len / 2) { acc += step(mid); mid = (mid + 1) % n; }
    const o = t.outer[mid], out = outward(mid), tan = { x: -out.y, y: out.x };
    q.setFromAxisAngle(UP, -Math.atan2(tan.y, tan.x));
    for (let k = 0; k < 5; k++) {
      const d = WALL_T + 6 + k * 1.6 + 0.8, h = 1 + k * 0.9, cx = o.x + out.x * d, cz = o.y + out.y * d;
      tiers.push(new THREE.BoxGeometry(L, h, 1.6).applyQuaternion(q).translate(cx, h / 2, cz));
      for (let a = -L / 2 + 0.5; a < L / 2 - 0.4; a += 0.75) {
        if (rnd() < 0.12) continue; // empty seats
        const j = (rnd() - 0.5) * 0.2, hh = 0.75 + rnd() * 0.25;
        m.compose(pos.set(cx + tan.x * (a + j), h + hh / 2, cz + tan.y * (a + j)), q, scl.set(0.42, hh, 0.32));
        seats.push(m.clone());
      }
    }
    const rd = WALL_T + 6 + 4 * 0.8 + 3.2; // a roof over the stand
    tiers.push(new THREE.BoxGeometry(L + 2, 0.25, 9).applyQuaternion(q).translate(o.x + out.x * rd, 9.5, o.y + out.y * rd));
  }
  // start-light gantry: two posts outside the walls and a beam over the line, five light pods facing the grid
  const nr = normal(0), a = t.inner[0], b = t.outer[0], H = 6;
  const pa = { x: a.x + nr.x * 1.2, y: a.y + nr.y * 1.2 }, pb = { x: b.x - nr.x * 1.2, y: b.y - nr.y * 1.2 };
  const span = Math.hypot(pb.x - pa.x, pb.y - pa.y), ang = Math.atan2(pb.y - pa.y, pb.x - pa.x), gq = new THREE.Quaternion().setFromAxisAngle(UP, -ang);
  const back = { x: -nr.y, y: nr.x }; // towards the grid (opposite to the direction of travel)
  const gantryParts = [
    boxAt(pa.x, H / 2, pa.y, 0.4, H, 0.4), boxAt(pb.x, H / 2, pb.y, 0.4, H, 0.4),
    new THREE.BoxGeometry(span, 0.6, 0.5).applyQuaternion(gq).translate((pa.x + pb.x) / 2, H, (pa.y + pb.y) / 2),
  ];
  const lightPos: THREE.Vector3[] = [];
  for (let k = 0; k < 5; k++) {
    const u = (k - 2) * 1.1, cx = (pa.x + pb.x) / 2 + Math.cos(ang) * u, cz = (pa.y + pb.y) / 2 + Math.sin(ang) * u;
    gantryParts.push(new THREE.BoxGeometry(0.8, 1.4, 0.4).applyQuaternion(gq).translate(cx, H - 0.9, cz));
    for (const dy of [-0.3, 0.3]) lightPos.push(new THREE.Vector3(cx + back.x * 0.25, H - 0.9 + dy, cz + back.y * 0.25));
  }
  return {
    towers: towers.length ? mergeGeometries(towers) : null, lamps: lamps.length ? mergeGeometries(lamps) : null, pools,
    tiers: tiers.length ? mergeGeometries(tiers) : null, seats, gantry: mergeGeometries(gantryParts)!, lightPos,
  };
}

export class Scene3D {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 5000);
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private group = new THREE.Group(); // everything rebuilt per track
  private ground: THREE.Mesh;
  private trackMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide });
  private steelMat = new THREE.MeshStandardMaterial({ color: 0x3b3e47, roughness: 0.6, metalness: 0.5 });
  private standMat = new THREE.MeshStandardMaterial({ color: 0x2b2d35, roughness: 0.85 });
  private lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false }); // the lamp heads: bright enough to bloom
  private poolTex = poolTexture();
  private poolMat = new THREE.MeshBasicMaterial({ map: this.poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  private crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  private crowd: THREE.InstancedMesh | null = null;
  private seats: THREE.Matrix4[] = [];
  private startLights: THREE.Mesh[] = [];
  private lit = 0;
  private lightOff = new THREE.MeshBasicMaterial({ color: 0x2a0808 });
  private lightOn = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  private geo = { livery: { car: liveryGeometry('car'), bike: liveryGeometry('bike') }, detail: { car: detailGeometry('car'), bike: detailGeometry('bike') } };
  private liveryMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15 }); // glossy paint
  private detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
  private fleets: Partial<Record<VehicleKind, { livery: THREE.InstancedMesh; detail: THREE.InstancedMesh }>> = {};
  private observer: ResizeObserver;
  readonly effects: Effects;
  // reused every frame: no per-frame allocation
  private m = new THREE.Matrix4(); private p = new THREE.Vector3(); private q = new THREE.Quaternion();
  private tint = new THREE.Color();
  private one = new THREE.Vector3(1, 1, 1); private zero = new THREE.Vector3(0, 0, 0);
  private used: Record<VehicleKind, number> = { car: 0, bike: 0 };
  private clock = 0;
  // followed leader: its 7 sensor rays plus a red marker overhead, so the net diagram has a visible body
  private rays = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAY_ANGLES.length * 6), 3)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  private marker = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 3).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: LEAD }));

  /** Throws if WebGL is unavailable; the caller falls back to 2D. */
  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 1000, 4000);
    this.scene.add(new THREE.HemisphereLight(0xb8c6ff, 0x0b120c, 0.7));
    // the floodlights, as one strong, slightly warm key light from high above: night races are lit bright and even
    const key = new THREE.DirectionalLight(0xfff3e0, 2.1);
    key.position.set(0.25, 1, 0.15);
    this.scene.add(key);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      // pushed back in depth so the road (2 cm up) never z-fights it from far or oblique views
      new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }));
    this.scene.add(this.ground, this.group);
    this.effects = new Effects(this.scene);
    this.rays.frustumCulled = false; // positions change every frame; bounds would go stale
    this.scene.add(this.rays, this.marker);
    // bloom with a high threshold: only the lamp heads, start lights and sparks glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.85);
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

  /** Start-light columns on the gantry: n of 5 lit (0 = lights out). Mirrors the on-screen lights. */
  setStartLights(n: number): void {
    this.lit = n;
    this.startLights.forEach((m, i) => (m.material = Math.floor(i / 2) < n ? this.lightOn : this.lightOff));
  }

  setTrack(t: Track): void {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
    this.crowd = null; this.startLights = [];
    this.group.add(new THREE.Mesh(trackGeometry(t), this.trackMat));
    const f = furniture(t);
    if (f.towers) this.group.add(new THREE.Mesh(f.towers, this.steelMat));
    if (f.lamps) this.group.add(new THREE.Mesh(f.lamps, this.lampMat));
    if (f.tiers) this.group.add(new THREE.Mesh(f.tiers, this.standMat));
    this.group.add(new THREE.Mesh(f.gantry, this.steelMat));
    if (f.pools.length) {
      const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.poolMat, f.pools.length);
      f.pools.forEach((mx, i) => pools.setMatrixAt(i, mx));
      pools.renderOrder = 1;
      this.group.add(pools);
    }
    for (const lp of f.lightPos) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), this.lightOff);
      lamp.position.copy(lp);
      this.group.add(lamp); this.startLights.push(lamp);
    }
    this.setStartLights(this.lit);
    this.seats = f.seats;
    if (f.seats.length) {
      this.crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.crowdMat, f.seats.length);
      const col = new THREE.Color(), shirts = [0x3a3d48, 0x24262e, 0x4a4f5c, 0x5a2a28, 0x2c3f5e, 0xd9d9de];
      f.seats.forEach((mx, i) => {
        this.crowd!.setMatrixAt(i, mx);
        col.set(i % 7 === 0 ? 0xff8000 : i % 7 === 3 ? 0x4d8df7 : shirts[i % shirts.length]); // fans in team colours dotted through the crowd
        this.crowd!.setColorAt(i, col);
      });
      this.crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.crowd);
    }
    this.effects.setTrack(t);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of t.outer) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.y); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.y); }
    const size = Math.max(x1 - x0, z1 - z0);
    this.ground.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.ground.scale.set(size * 12, 1, size * 12);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = size * 1.5; fog.far = size * 5; // top view sits ~1.3 sizes up, so it stays clear
    this.camera.far = size * 8; this.camera.updateProjectionMatrix();
  }

  render(w: World, dt = 0, focus?: { pop: number; vehicle: number }): void {
    this.clock += dt;
    this.effects.update(dt);
    this.used.car = this.used.bike = 0;
    for (const pop of w.populations) this.used[pop.kind] += pop.vehicles.length;
    for (const kind of ['car', 'bike'] as const) {
      let f = this.fleets[kind];
      if (!f || f.livery.instanceMatrix.count < this.used[kind]) { // grow (rare): rebuild with headroom
        if (f) { this.scene.remove(f.livery, f.detail); f.livery.dispose(); f.detail.dispose(); }
        const cap = Math.max(this.used[kind], 100);
        const mk = (g: THREE.BufferGeometry, mat: THREE.Material) => {
          const im = new THREE.InstancedMesh(g, mat, cap);
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.frustumCulled = false; // instances span the whole track
          return im;
        };
        f = this.fleets[kind] = { livery: mk(this.geo.livery[kind], this.liveryMat), detail: mk(this.geo.detail[kind], this.detailMat) };
        this.scene.add(f.livery, f.detail);
      }
      f.livery.count = f.detail.count = 0;
    }
    for (const pop of w.populations) {
      const f = this.fleets[pop.kind]!;
      this.tint.set(popColor(pop));
      for (const v of pop.vehicles) {
        this.p.set(v.pos.x, 0, v.pos.y);
        this.q.setFromAxisAngle(UP, -v.heading); // heading is CCW in xy; rotating about +Y maps +X toward -Z
        this.m.compose(this.p, this.q, v.alive ? this.one : this.zero);
        f.livery.setColorAt(f.livery.count, this.tint); f.livery.setMatrixAt(f.livery.count++, this.m);
        f.detail.setMatrixAt(f.detail.count++, this.m);
      }
    }
    for (const kind of ['car', 'bike'] as const) for (const im of [this.fleets[kind]!.livery, this.fleets[kind]!.detail]) {
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
      this.marker.position.set(v.pos.x, 2.4, v.pos.y);
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
    for (const o of this.group.children) if (o instanceof THREE.Mesh) o.geometry.dispose();
    for (const mat of [this.trackMat, this.steelMat, this.standMat, this.lampMat, this.poolMat, this.crowdMat, this.lightOff, this.lightOn, this.liveryMat, this.detailMat]) mat.dispose();
    this.poolTex.dispose();
    this.ground.geometry.dispose(); (this.ground.material as THREE.Material).dispose();
    for (const k of ['car', 'bike'] as const) {
      this.geo.livery[k].dispose(); this.geo.detail[k].dispose();
      this.fleets[k]?.livery.dispose(); this.fleets[k]?.detail.dispose();
    }
    this.rays.geometry.dispose(); (this.rays.material as THREE.Material).dispose();
    this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
