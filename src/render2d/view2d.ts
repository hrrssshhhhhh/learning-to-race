import type { Track } from '../sim/track';
import type { World } from '../sim/world';
import type { ContactEvent } from '../sim/contact';
import type { Vec2 } from '../sim/vec';
import type { VehicleKind, VehicleState } from '../sim/vehicle';
import { castRays, RAY_ANGLES, RAY_LENGTH } from '../sim/sensors';

// Team colours shared by 2D, 3D and the panel (papaya cars, blue bikes); broadcast red marks the followed leader.
export const COLORS = { car: '#ff8000', bike: '#4d8df7' } as const;
export const LEAD = '#e10600';
// Test mode contenders share one kind, so they are coloured by label instead
const LABEL_COLORS: Record<string, string> = { specialist: '#00d2be', fresh: '#9b9ba5', mine: '#ffd400' };
export const popColor = (p: { kind: VehicleKind; label: string }) => LABEL_COLORS[p.label] ?? COLORS[p.kind];

const FLASH_FRAMES = 14, TRAIL = 10; // a short comet tail per dot, like a broadcast track map
const BG = '#15151e', VERGE = '#1b1b25', ROAD = '#3a3a46', SECTORS = ['#e10600', '#4d8df7', '#ffd400'];
const KERB_RED = '#e10600', KERB_WHITE = '#ffffff', KERB_W = 1.3, KERB_RADIUS = 40, VERGE_W = 7; // m, same kerb rule as the 3D track
const DOT_PX = 4.5; // vehicles are position dots, as on a broadcast map

/** Circumradius over a ~12 m chord at centre sample i (same rule the 3D kerbs use). */
function radius(c: Vec2[], i: number): number {
  const n = c.length, a = c[(i + n - 3) % n], b = c[i], d = c[(i + 3) % n];
  const k = Math.abs((b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x));
  return k < 1e-9 ? Infinity : (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(d.x - b.x, d.y - b.y) * Math.hypot(d.x - a.x, d.y - a.y)) / (2 * k);
}

interface Trail { xs: Float32Array; ys: Float32Array; n: number; i: number }

export class View2D {
  private ctx: CanvasRenderingContext2D;
  private track: Track | null = null;
  private flashes: { pos: Vec2; age: number; crash: boolean }[] = [];
  private trails = new WeakMap<VehicleState, Trail>(); // a new generation = new states = fresh trails
  private layer = document.createElement('canvas'); // the static track, redrawn only on setTrack/resize
  private k = 1; private ox = 0; private oy = 0; // world -> css px: p * k + o
  private w = 0; private h = 0; private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setTrack(t: Track): void { this.track = t; this.flashes = []; this.fit(); }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.fit();
  }

  private fit(): void {
    if (!this.track || !this.w || !this.h) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.track.outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    // keep the track clear of the title/view bar (top) and the controls bar (bottom)
    const px = 40, top = 88, bottom = 96;
    this.k = Math.min((this.w - 2 * px) / (x1 - x0 || 1), (this.h - top - bottom) / (y1 - y0 || 1));
    this.ox = (this.w - this.k * (x0 + x1)) / 2; this.oy = top + (this.h - top - bottom - this.k * (y1 - y0)) / 2 - this.k * y0;
    this.drawLayer();
  }

  private path(c: CanvasRenderingContext2D, pts: Vec2[]): void {
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
  }

  /** Ground, verge, asphalt, kerbs, centre line, walls and the start grid, cached in one bitmap. */
  private drawLayer(): void {
    const t = this.track!, L = this.layer, c = L.getContext('2d')!;
    L.width = this.canvas.width; L.height = this.canvas.height;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = BG; c.fillRect(0, 0, this.w, this.h);

    c.translate(this.ox, this.oy); c.scale(this.k, this.k);
    const px = 1 / this.k;
    c.lineJoin = 'round'; c.lineCap = 'round';
    // verge: a wide green-grey band under both walls
    c.strokeStyle = VERGE; c.lineWidth = VERGE_W * 2;
    for (const wall of [t.outer, t.inner]) { c.beginPath(); this.path(c, wall); c.stroke(); }
    // asphalt: both walls in one path, even-odd leaves the infield
    c.fillStyle = ROAD; c.beginPath(); this.path(c, t.outer); this.path(c, t.inner); c.fill('evenodd');
    // kerbs on tight corners: red/white 4 m stripes along each edge
    const cen = t.center, n = cen.length, tight = cen.map((_, i) => radius(cen, i) < KERB_RADIUS);
    const kw = Math.max(KERB_W, 3 * px) / (t.width / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!tight[i] && !tight[j]) continue;
      c.fillStyle = (i >> 1) % 2 ? KERB_RED : KERB_WHITE;
      for (const wall of [t.inner, t.outer]) {
        const a = wall[i], b = wall[j], ai = { x: a.x + (cen[i].x - a.x) * kw, y: a.y + (cen[i].y - a.y) * kw }, bi = { x: b.x + (cen[j].x - b.x) * kw, y: b.y + (cen[j].y - b.y) * kw };
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(bi.x, bi.y); c.lineTo(ai.x, ai.y); c.closePath(); c.fill();
      }
    }
    // three sectors, as on a timing map: a thin coloured line down the middle of each third of the lap
    c.lineWidth = 2 * px; c.globalAlpha = 0.55;
    for (let k = 0; k < 3; k++) {
      const i0 = Math.floor((k * n) / 3), i1 = Math.floor(((k + 1) * n) / 3);
      c.strokeStyle = SECTORS[k]; c.beginPath();
      for (let i = i0; i <= i1; i++) { const p = cen[i % n]; if (i === i0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y); }
      c.stroke();
    }
    c.globalAlpha = 1;
    // white track limits
    c.strokeStyle = '#ffffff'; c.lineWidth = 1.5 * px;
    for (const wall of [t.outer, t.inner]) { c.beginPath(); this.path(c, wall); c.stroke(); }
    // sector labels at each boundary, outside the track
    c.font = `italic 700 ${13 * px}px "Barlow Condensed", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) {
      const i = Math.floor((k * n) / 3), o = t.outer[i], m = cen[i], d = Math.hypot(o.x - m.x, o.y - m.y) || 1, off = 16 * px;
      c.fillStyle = SECTORS[k];
      c.fillText(`S${k + 1}`, o.x + ((o.x - m.x) / d) * off, o.y + ((o.y - m.y) / d) * off);
    }
    this.startLine(c, t, px);
  }

  /** Chequered start line across the road at checkpoint 0, plus a few grid-slot ticks behind it. */
  private startLine(c: CanvasRenderingContext2D, t: Track, px: number): void {
    const s0 = t.checkpoints[0], ax = s0.b.x - s0.a.x, ay = s0.b.y - s0.a.y, len = Math.hypot(ax, ay);
    const n = Math.max(4, Math.round(len / 2)), ux = ax / n, uy = ay / n; // ~2 m squares
    const fx = (-ay / len) * (len / n), fy = (ax / len) * (len / n); // one square deep, along the road
    for (let row = 0; row < 2; row++) for (let i = 0; i < n; i++) {
      c.fillStyle = (i + row) % 2 ? '#0b0b0f' : '#ffffff';
      const x = s0.a.x + ux * i + fx * (row - 1), y = s0.a.y + uy * i + fy * (row - 1);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + ux, y + uy); c.lineTo(x + ux + fx, y + uy + fy); c.lineTo(x + fx, y + fy); c.closePath(); c.fill();
    }
    // grid slots: short white ticks behind the line, alternating sides
    c.strokeStyle = 'rgba(242,242,242,0.5)'; c.lineWidth = 1.25 * px;
    const bx = -fx / (len / n), by = -fy / (len / n); // unit vector, back from the line
    for (let k = 1; k <= 4; k++) {
      const side = k % 2 ? 0.3 : 0.7, d = 4 + k * 8;
      const ox = s0.a.x + ax * side + bx * d, oy = s0.a.y + ay * side + by * d;
      c.beginPath(); c.moveTo(ox - (ax / len) * 2.5, oy - (ay / len) * 2.5); c.lineTo(ox + (ax / len) * 2.5, oy + (ay / len) * 2.5); c.stroke();
    }
  }

  private trailFor(v: VehicleState): Trail {
    let tr = this.trails.get(v);
    if (!tr) { tr = { xs: new Float32Array(TRAIL), ys: new Float32Array(TRAIL), n: 0, i: 0 }; this.trails.set(v, tr); }
    return tr;
  }

  render(w: World, events: ContactEvent[], opts: { showRaysFor?: { pop: number; vehicle: number } }): void {
    const c = this.ctx, t = this.track;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!t || !this.k) return;
    c.drawImage(this.layer, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // scrape with intensity 0 = steering off a wall, not an impact
    for (const e of events) if (e.kind === 'crash' || e.intensity > 0) this.flashes.push({ pos: e.pos, age: 0, crash: e.kind === 'crash' });
    if (this.flashes.length > 200) this.flashes.splice(0, this.flashes.length - 200);

    c.save();
    c.translate(this.ox, this.oy); c.scale(this.k, this.k);
    const px = 1 / this.k;
    c.lineJoin = 'round'; c.lineCap = 'round';

    // short comet tails under the dots, so you can read direction and speed
    c.lineWidth = 2 * px;
    for (const p of w.populations) {
      c.strokeStyle = popColor(p); c.globalAlpha = 0.4; c.beginPath();
      for (const v of p.vehicles) {
        if (!v.alive) continue;
        const tr = this.trailFor(v);
        tr.xs[tr.i] = v.pos.x; tr.ys[tr.i] = v.pos.y; tr.i = (tr.i + 1) % TRAIL; tr.n = Math.min(TRAIL, tr.n + 1);
        for (let k = 0; k < tr.n; k++) {
          const q = (tr.i - tr.n + k + TRAIL) % TRAIL;
          if (k) c.lineTo(tr.xs[q], tr.ys[q]); else c.moveTo(tr.xs[q], tr.ys[q]);
        }
      }
      c.stroke();
    }
    c.globalAlpha = 1;

    // position dots: team colour with a dark rim so overlapping dots stay countable
    c.lineWidth = 1.25 * px; c.strokeStyle = '#0b0b0f';
    for (const p of w.populations) {
      c.fillStyle = popColor(p);
      const r = (p.kind === 'car' ? DOT_PX : DOT_PX - 1) * px;
      for (const q of p.vehicles) {
        if (!q.alive) continue;
        c.beginPath(); c.arc(q.pos.x, q.pos.y, r, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    }

    // the followed leader: its 7 sensor rays, a dot where each one meets a wall, and a ring
    const r = opts.showRaysFor, v = r ? w.populations[r.pop]?.vehicles[r.vehicle] : undefined;
    if (v?.alive) {
      const hits = castRays(v, t), ends = RAY_ANGLES.map((deg, i) => {
        const a = v.heading + (deg * Math.PI) / 180, d = hits[i] * RAY_LENGTH;
        return { x: v.pos.x + Math.cos(a) * d, y: v.pos.y + Math.sin(a) * d, hit: hits[i] < 1 };
      });
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1 * px; c.beginPath();
      for (const e of ends) { c.moveTo(v.pos.x, v.pos.y); c.lineTo(e.x, e.y); }
      c.stroke();
      c.fillStyle = LEAD;
      for (const e of ends) if (e.hit) { c.beginPath(); c.arc(e.x, e.y, 2.5 * px, 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = LEAD; c.lineWidth = 2 * px;
      c.beginPath(); c.arc(v.pos.x, v.pos.y, Math.max(6, 11 * px), 0, Math.PI * 2); c.stroke();
      // broadcast-style tag on the followed car: red tab with LEAD
      const tx = v.pos.x + 14 * px, ty = v.pos.y - 18 * px;
      c.fillStyle = LEAD; c.fillRect(tx, ty - 8 * px, 40 * px, 16 * px);
      c.fillStyle = '#fff'; c.font = `italic 700 ${12 * px}px "Barlow Condensed", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('LEADER', tx + 20 * px, ty);
    }

    // contact: small fading dots, amber for scrapes and red for crashes (same language as the 3D sparks)
    this.flashes = this.flashes.filter((f) => ++f.age <= FLASH_FRAMES);
    for (const f of this.flashes) {
      const a = 1 - f.age / FLASH_FRAMES;
      c.fillStyle = f.crash ? `rgba(225,6,0,${a})` : `rgba(255,184,0,${a * 0.85})`;
      c.beginPath(); c.arc(f.pos.x, f.pos.y, (f.crash ? 3.5 : 2.5) * px, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}
