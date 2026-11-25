import type { Track } from '../sim/track';
import type { World } from '../sim/world';
import type { ContactEvent } from '../sim/contact';
import type { Vec2 } from '../sim/vec';
import { SPECS } from '../sim/vehicle';
import { castRays, RAY_ANGLES, RAY_LENGTH } from '../sim/sensors';

export const COLORS = { car: '#4aa3ff', bike: '#ffb347' } as const;
const FLASH_FRAMES = 12;

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
    const pad = 24;
    this.k = Math.min((this.w - 2 * pad) / (x1 - x0 || 1), (this.h - 2 * pad) / (y1 - y0 || 1));
    this.ox = (this.w - this.k * (x0 + x1)) / 2; this.oy = (this.h - this.k * (y0 + y1)) / 2;
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
    // road: outer filled, inner punched out
    c.fillStyle = '#2a2d34'; this.line(t.outer); c.fill();
    c.fillStyle = '#0f1115'; this.line(t.inner); c.fill();
    c.strokeStyle = '#8a8f9c'; c.lineWidth = 2 * px; this.line(t.outer); c.stroke(); this.line(t.inner); c.stroke();
    const s = t.checkpoints[0];
    c.strokeStyle = '#fff'; c.lineWidth = 3 * px; this.line([s.a, s.b], false); c.stroke();

    // rays of the followed vehicle
    const r = opts.showRaysFor, v = r ? w.populations[r.pop]?.vehicles[r.vehicle] : undefined;
    if (v?.alive) {
      const hits = castRays(v, t);
      c.strokeStyle = 'rgba(120,255,160,0.7)'; c.lineWidth = 1 * px;
      c.beginPath();
      RAY_ANGLES.forEach((deg, i) => {
        const a = v.heading + (deg * Math.PI) / 180, d = hits[i] * RAY_LENGTH;
        c.moveTo(v.pos.x, v.pos.y); c.lineTo(v.pos.x + Math.cos(a) * d, v.pos.y + Math.sin(a) * d);
      });
      c.stroke();
      c.strokeStyle = '#6ee7a0'; c.lineWidth = 2 * px; // leader ring: the vehicle the net diagram is driving
      c.beginPath(); c.arc(v.pos.x, v.pos.y, Math.max(4, 9 * px), 0, Math.PI * 2); c.stroke();
    }

    // alive vehicles only; min size so tiny bikes stay visible when zoomed out
    for (const p of w.populations) {
      const spec = SPECS[p.kind], len = Math.max(spec.length, 3 * px), wid = Math.max(spec.width, 1.5 * px);
      c.fillStyle = COLORS[p.kind];
      for (const q of p.vehicles) {
        if (!q.alive) continue;
        c.save(); c.translate(q.pos.x, q.pos.y); c.rotate(q.heading);
        c.fillRect(-len / 2, -wid / 2, len, wid);
        c.restore();
      }
    }

    // contact flashes
    c.lineWidth = 1.5 * px;
    this.flashes = this.flashes.filter((f) => ++f.age <= FLASH_FRAMES);
    for (const f of this.flashes) {
      const a = 1 - f.age / FLASH_FRAMES;
      c.strokeStyle = f.crash ? `rgba(255,70,70,${a})` : `rgba(255,255,255,${a * 0.6})`;
      c.beginPath(); c.arc(f.pos.x, f.pos.y, (2 + f.age * 0.4) * (f.crash ? 1.5 : 1), 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }
}
