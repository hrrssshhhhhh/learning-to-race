import type { Track } from '../sim/track';
import type { World } from '../sim/world';
import type { ContactEvent } from '../sim/contact';
import type { Vec2 } from '../sim/vec';
import { SPECS, type VehicleKind } from '../sim/vehicle';
import { castRays, RAY_ANGLES, RAY_LENGTH } from '../sim/sensors';

export const COLORS = { car: '#4aa3ff', bike: '#ffb347' } as const;
// Test mode contenders share one kind, so they are coloured by label instead
const LABEL_COLORS: Record<string, string> = { specialist: '#ff8a3d', fresh: '#a0a6b3', mine: '#ff5ccf' };
export const popColor = (p: { kind: VehicleKind; label: string }) => LABEL_COLORS[p.label] ?? COLORS[p.kind];
const FLASH_FRAMES = 14;
const ROAD = '#2a2a2d', WALL = '#6b6b70', LEAD = '#6ee7a0'; // graphite road, hairline walls, green = followed leader

export class View2D {
  private ctx: CanvasRenderingContext2D;
  private track: Track | null = null;
  private flashes: { pos: Vec2; age: number; crash: boolean }[] = [];
  private k = 1; private ox = 0; private oy = 0; // world -> css px: p * k + o
  private w = 0; private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setTrack(t: Track): void { this.track = t; this.flashes = []; this.fit(); }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fit();
  }

  private fit(): void {
    if (!this.track || !this.w || !this.h) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.track.outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    // keep the track clear of the title/view bar (top) and the controls bar (bottom)
    const px = 32, top = 80, bottom = 88;
    this.k = Math.min((this.w - 2 * px) / (x1 - x0 || 1), (this.h - top - bottom) / (y1 - y0 || 1));
    this.ox = (this.w - this.k * (x0 + x1)) / 2; this.oy = top + (this.h - top - bottom - this.k * (y1 - y0)) / 2 - this.k * y0;
  }

  /** Chequered start line across the road at checkpoint 0: two rows of squares, like the 3D one. */
  private startLine(t: Track): void {
    const c = this.ctx, s0 = t.checkpoints[0], ax = s0.b.x - s0.a.x, ay = s0.b.y - s0.a.y, len = Math.hypot(ax, ay);
    const n = Math.max(4, Math.round(len / 2)), ux = ax / n, uy = ay / n; // ~2 m squares
    const fx = -ay / len * (len / n), fy = ax / len * (len / n); // one square deep, along the road
    for (let row = 0; row < 2; row++) for (let i = 0; i < n; i++) {
      c.fillStyle = (i + row) % 2 ? '#141415' : '#d6d6da';
      const x = s0.a.x + ux * i + fx * (row - 1), y = s0.a.y + uy * i + fy * (row - 1);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + ux, y + uy); c.lineTo(x + ux + fx, y + uy + fy); c.lineTo(x + fx, y + fy); c.closePath(); c.fill();
    }
  }

  private line(pts: Vec2[], close = true): void {
    const c = this.ctx;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    if (close) c.closePath();
  }

  render(w: World, events: ContactEvent[], opts: { showRaysFor?: { pop: number; vehicle: number } }): void {
    const c = this.ctx, t = this.track;
    c.clearRect(0, 0, this.w, this.h);
    if (!t || !this.k) return;
    // scrape with intensity 0 = steering off a wall, not an impact
    for (const e of events) if (e.kind === 'crash' || e.intensity > 0) this.flashes.push({ pos: e.pos, age: 0, crash: e.kind === 'crash' });
    if (this.flashes.length > 200) this.flashes.splice(0, this.flashes.length - 200);

    c.save();
    c.translate(this.ox, this.oy); c.scale(this.k, this.k);
    const px = 1 / this.k; // one css pixel in world units
    c.lineJoin = 'round';
    // road: both walls in one path, even-odd leaves the infield as page background
    c.fillStyle = ROAD; c.beginPath();
    for (const wall of [t.outer, t.inner]) { wall.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); }
    c.fill('evenodd');
    c.strokeStyle = WALL; c.lineWidth = 1.25 * px; this.line(t.outer); c.stroke(); this.line(t.inner); c.stroke();
    this.startLine(t);

    // alive vehicles only; min size so tiny bikes stay visible when zoomed out
    for (const p of w.populations) {
      const spec = SPECS[p.kind], len = Math.max(spec.length, 4 * px), wid = Math.max(spec.width, 2 * px);
      c.fillStyle = popColor(p);
      for (const q of p.vehicles) {
        if (!q.alive) continue;
        c.save(); c.translate(q.pos.x, q.pos.y); c.rotate(q.heading);
        c.fillRect(-len / 2, -wid / 2, len, wid);
        c.restore();
      }
    }

    // the followed leader: its 7 sensor rays, a dot where each one meets a wall, and a ring
    const r = opts.showRaysFor, v = r ? w.populations[r.pop]?.vehicles[r.vehicle] : undefined;
    if (v?.alive) {
      const hits = castRays(v, t), ends = RAY_ANGLES.map((deg, i) => {
        const a = v.heading + (deg * Math.PI) / 180, d = hits[i] * RAY_LENGTH;
        return { x: v.pos.x + Math.cos(a) * d, y: v.pos.y + Math.sin(a) * d, hit: hits[i] < 1 };
      });
      c.strokeStyle = 'rgba(110,231,160,0.55)'; c.lineWidth = 1 * px; c.beginPath();
      for (const e of ends) { c.moveTo(v.pos.x, v.pos.y); c.lineTo(e.x, e.y); }
      c.stroke();
      c.fillStyle = LEAD;
      for (const e of ends) if (e.hit) { c.beginPath(); c.arc(e.x, e.y, 2 * px, 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = LEAD; c.lineWidth = 1.5 * px;
      c.beginPath(); c.arc(v.pos.x, v.pos.y, Math.max(4, 10 * px), 0, Math.PI * 2); c.stroke();
    }

    // contact: small fading dots, amber for scrapes and red for crashes (same language as the 3D sparks)
    this.flashes = this.flashes.filter((f) => ++f.age <= FLASH_FRAMES);
    for (const f of this.flashes) {
      const a = 1 - f.age / FLASH_FRAMES;
      c.fillStyle = f.crash ? `rgba(229,72,77,${a})` : `rgba(240,180,76,${a * 0.8})`;
      c.beginPath(); c.arc(f.pos.x, f.pos.y, (f.crash ? 3 : 2) * px, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}
