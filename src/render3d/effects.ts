import * as THREE from 'three';
import type { Track } from '../sim/track';
import type { Vec2 } from '../sim/vec';
import type { ContactEvent } from '../sim/contact';
import { wallSegmentsNear } from '../sim/sensors';

const CAP = 2000, MAX_SPAWN_PER_FRAME = 300, MAX_DT = 0.05, GRAVITY = 9.8;
const MARK_Y0 = 0.12, MARK_Y1 = 0.7, MARK_OFFSET = 0.03; // m; marks sit between the kerb plane (0.06) and the wall top (0.9)
const MARK_K = 40; // scrape events for ~63% darkness of a segment
const MARK_MAX_ALPHA = 0.9;
const FIND_RADIUS = 5; // m from the vehicle centre to look for the wall it touched

export interface WallHit { x: number; y: number; nx: number; ny: number; tx: number; ty: number; id: number }

/** Saturating darkness in [0,1): a few hits are faint, heavy rubbing approaches black. */
export const darkness = (count: number, k = MARK_K): number => 1 - Math.exp(-count / k);

/** Maps each wall point object to its segment id (inner i -> i, outer i -> n + i). */
export function wallIds(t: Track): Map<Vec2, number> {
  const m = new Map<Vec2, number>(), n = t.inner.length;
  t.inner.forEach((p, i) => m.set(p, i));
  t.outer.forEach((p, i) => m.set(p, n + i));
  return m;
}

/** Closest point on any wall within `radius` of p, with the unit normal pointing toward the track and the unit tangent. */
export function nearestWallPoint(t: Track, ids: Map<Vec2, number>, p: Vec2, radius: number): WallHit | null {
  let best: WallHit | null = null, bd = radius;
  for (const [a, b, isInner] of wallSegmentsNear(t, p, radius)) {
    const sx = b.x - a.x, sy = b.y - a.y, l2 = sx * sx + sy * sy;
    if (l2 === 0) continue;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * sx + (p.y - a.y) * sy) / l2));
    const x = a.x + sx * u, y = a.y + sy * u, d = Math.hypot(p.x - x, p.y - y);
    if (d >= bd) continue;
    const l = Math.sqrt(l2), s = isInner ? 1 : -1; // track is right of inner a->b, left of outer
    bd = d; best = { x, y, nx: (s * sy) / l, ny: (-s * sx) / l, tx: sx / l, ty: sy / l, id: ids.get(a)! };
  }
  return best;
}

export class Effects {
  private track: Track | null = null;
  private ids = new Map<Vec2, number>();
  // sparks: pooled ring buffer
  private pos = new Float32Array(CAP * 3); private vel = new Float32Array(CAP * 3);
  private col = new Float32Array(CAP * 3); private life = new Float32Array(CAP); private maxLife = new Float32Array(CAP);
  private head = 0; private budget = 0;
  private reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private points: THREE.Points;
  // marks
  private counts = new Float32Array(0);
  private marks: THREE.Mesh | null = null;
  private markDirty = false;

  constructor(private scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.25, sizeAttenuation: true, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.points.frustumCulled = false; // positions change every frame; the bounding sphere would be stale
    scene.add(this.points);
  }

  /** Clears sparks and marks and builds a mark strip for the new track. */
  setTrack(t: Track): void {
    this.track = t; this.ids = wallIds(t);
    this.life.fill(0); this.col.fill(0); this.head = 0;
    this.points.geometry.attributes.color.needsUpdate = true;
    if (this.marks) { this.scene.remove(this.marks); this.marks.geometry.dispose(); (this.marks.material as THREE.Material).dispose(); }
    const n = t.inner.length, segs = 2 * n, posArr = new Float32Array(segs * 18);
    this.counts = new Float32Array(segs);
    for (let id = 0; id < segs; id++) {
      const w = id < n ? t.inner : t.outer, i = id % n, a = w[i], b = w[(i + 1) % n];
      const sx = b.x - a.x, sy = b.y - a.y, l = Math.hypot(sx, sy) || 1, s = id < n ? 1 : -1;
      const ox = ((s * sy) / l) * MARK_OFFSET, oy = ((-s * sx) / l) * MARK_OFFSET;
      const A0 = [a.x + ox, MARK_Y0, a.y + oy], B0 = [b.x + ox, MARK_Y0, b.y + oy];
      const A1 = [a.x + ox, MARK_Y1, a.y + oy], B1 = [b.x + ox, MARK_Y1, b.y + oy];
      posArr.set([...A0, ...B0, ...B1, ...A0, ...B1, ...A1], id * 18);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segs * 24), 4).setUsage(THREE.DynamicDrawUsage)); // rgba, black with alpha = darkness
    this.marks = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.marks.renderOrder = 1;
    this.scene.add(this.marks);
    this.markDirty = false;
  }

  /** Call once per frame with all events from that frame's steps. Crashes spark but leave no mark (a crash ends the run; the heatmap is about scrapes). */
  add(events: ContactEvent[]): void {
    if (!this.track) return;
    this.budget = MAX_SPAWN_PER_FRAME;
    for (const e of events) {
      if (e.intensity <= 0) continue; // vehicle steering off a wall, not an impact
      const hit = nearestWallPoint(this.track, this.ids, e.pos, FIND_RADIUS);
      if (!hit) continue;
      if (e.kind === 'crash') this.spawn(hit, 30, 1, 3.5);
      else {
        this.spawn(hit, 4 + 12 * e.intensity, e.intensity, 1);
        this.counts[hit.id]++;
        const al = darkness(this.counts[hit.id]) * MARK_MAX_ALPHA, c = this.marks!.geometry.attributes.color.array as Float32Array;
        for (let v = 0; v < 6; v++) c[hit.id * 24 + v * 4 + 3] = al;
        this.markDirty = true;
      }
    }
  }

  private spawn(h: WallHit, count: number, strength: number, up: number): void {
    const n = Math.min(this.budget, Math.round(count * (this.reduced ? 0.25 : 1)));
    this.budget -= n;
    const life = this.reduced ? 0.25 : 0.6;
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % CAP; // oldest overwritten when full
      const away = 1 + Math.random() * 3 * (0.5 + strength), along = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 8 * (0.5 + strength));
      const side = (Math.random() - 0.5) * 3;
      this.pos[i * 3] = h.x + h.nx * 0.1; this.pos[i * 3 + 1] = 0.4 + Math.random() * 0.4; this.pos[i * 3 + 2] = h.y + h.ny * 0.1;
      this.vel[i * 3] = h.nx * away + h.tx * along + side * h.ty;
      this.vel[i * 3 + 1] = (1 + Math.random() * 3) * up;
      this.vel[i * 3 + 2] = h.ny * away + h.ty * along - side * h.tx;
      this.life[i] = this.maxLife[i] = life * (0.5 + Math.random() * 0.5) * (up > 1 ? 1.5 : 1);
    }
  }

  /** Render-only: advances sparks by real time and uploads changed attributes. */
  update(dt: number): void {
    dt = Math.min(dt, MAX_DT);
    for (let i = 0; i < CAP; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      this.vel[i3 + 1] -= GRAVITY * dt;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.life[i] <= 0 || this.pos[i3 + 1] < 0) { this.life[i] = 0; this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0; continue; }
      const f = this.life[i] / this.maxLife[i]; // 1 -> 0: yellow-orange fading to red, dimming (additive, so black = invisible)
      this.col[i3] = 1; this.col[i3 + 1] = 0.75 * f * f; this.col[i3 + 2] = 0.1 * f * f;
      const dim = Math.min(1, f * 2); this.col[i3] *= dim; this.col[i3 + 1] *= dim; this.col[i3 + 2] *= dim;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    if (this.markDirty) { this.marks!.geometry.attributes.color.needsUpdate = true; this.markDirty = false; }
  }

  dispose(): void {
    this.scene.remove(this.points); this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose();
    if (this.marks) { this.scene.remove(this.marks); this.marks.geometry.dispose(); (this.marks.material as THREE.Material).dispose(); }
  }
}
