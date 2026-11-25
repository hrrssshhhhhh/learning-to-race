import type { Track } from '../sim/track';
import type { World } from '../sim/world';
import type { ContactEvent } from '../sim/contact';
import type { Vec2 } from '../sim/vec';
import { SPECS, type VehicleKind, type VehicleState } from '../sim/vehicle';
import { castRays, RAY_ANGLES, RAY_LENGTH } from '../sim/sensors';

// Neon palette, shared by 2D, 3D and the panel: cars cyan, bikes magenta, the followed leader lime.
export const COLORS = { car: '#38e1ff', bike: '#ff4fd8' } as const;
export const NEON = { car: 0x38e1ff, bike: 0xff4fd8 } as const;
export const LEAD = '#c6ff3d';
// Test mode contenders share one kind, so they are coloured by label instead
const LABEL_COLORS: Record<string, string> = { specialist: '#ffb020', fresh: '#8a90a6', mine: '#9d7bff' };
export const popColor = (p: { kind: VehicleKind; label: string }) => LABEL_COLORS[p.label] ?? COLORS[p.kind];

const FLASH_FRAMES = 14, TRAIL = 18; // trail = last 18 rendered positions per vehicle
const BG = '#07080d', VERGE = '#0d0f1a', ROAD = '#14151d';
const KERB_RED = '#ff2d55', KERB_WHITE = '#dfe7ff', KERB_W = 1.3, KERB_RADIUS = 40, VERGE_W = 7; // m, same kerb rule as the 3D track
const MIN_LEN_PX = 10; // vehicles never draw shorter than this, so they read as cars and bikes when zoomed out

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
    c.strokeStyle = 'rgba(70,80,170,0.16)'; c.lineWidth = 1; c.beginPath(); // ground: a faint indigo grid, like the 3D floor
    for (let x = 0.5; x < this.w; x += 32) { c.moveTo(x, 0); c.lineTo(x, this.h); }
    for (let y = 0.5; y < this.h; y += 32) { c.moveTo(0, y); c.lineTo(this.w, y); }
    c.stroke();

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
    // centre line, dashed and faint: shows the shape of the lap without competing with the cars
    c.strokeStyle = 'rgba(56,225,255,0.16)'; c.lineWidth = 1 * px; c.setLineDash([6 * px, 10 * px]);
    c.beginPath(); this.path(c, cen); c.stroke(); c.setLineDash([]);
    // neon walls: cyan outside, magenta inside, each drawn twice (soft glow, then a crisp core)
    for (const [wall, col] of [[t.outer, COLORS.car], [t.inner, COLORS.bike]] as const) {
      c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = 12; c.globalAlpha = 0.55; c.lineWidth = 3 * px;
      c.beginPath(); this.path(c, wall); c.stroke();
      c.shadowBlur = 0; c.globalAlpha = 1; c.lineWidth = 1.25 * px; c.stroke();
    }
    this.startLine(c, t, px);
  }

  /** Chequered start line across the road at checkpoint 0, plus a few grid-slot ticks behind it. */
  private startLine(c: CanvasRenderingContext2D, t: Track, px: number): void {
    const s0 = t.checkpoints[0], ax = s0.b.x - s0.a.x, ay = s0.b.y - s0.a.y, len = Math.hypot(ax, ay);
    const n = Math.max(4, Math.round(len / 2)), ux = ax / n, uy = ay / n; // ~2 m squares
    const fx = (-ay / len) * (len / n), fy = (ax / len) * (len / n); // one square deep, along the road
    for (let row = 0; row < 2; row++) for (let i = 0; i < n; i++) {
      c.fillStyle = (i + row) % 2 ? '#07080d' : '#dfe7ff';
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

  /** A car: body, darker cockpit, four wheels. A bike: slim frame, two wheels, a rider. Drawn heading along +x. */
  private sprite(c: CanvasRenderingContext2D, kind: VehicleKind, color: string, len: number, wid: number): void {
    c.fillStyle = '#0d0d0e';
    if (kind === 'car') {
      for (const sx of [-0.32, 0.32]) for (const sy of [-1, 1]) c.fillRect(sx * len - len * 0.1, sy * wid * 0.5 - wid * 0.12, len * 0.2, wid * 0.24);
      c.fillStyle = color; c.beginPath(); c.roundRect(-len / 2, -wid * 0.42, len, wid * 0.84, wid * 0.3); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.38)'; c.fillRect(-len * 0.18, -wid * 0.26, len * 0.3, wid * 0.52); // cockpit
    } else {
      c.fillRect(-len * 0.5, -wid * 0.18, len * 0.26, wid * 0.36); c.fillRect(len * 0.24, -wid * 0.18, len * 0.26, wid * 0.36);
      c.fillStyle = color; c.beginPath(); c.roundRect(-len * 0.34, -wid * 0.22, len * 0.68, wid * 0.44, wid * 0.2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.arc(-len * 0.06, 0, wid * 0.24, 0, Math.PI * 2); c.fill(); // rider's helmet
    }
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

    // trails first, under every vehicle: additive streaks, so where many overlap the racing line glows
    c.lineWidth = 2 * px; c.globalCompositeOperation = 'lighter';
    for (const p of w.populations) {
      c.strokeStyle = popColor(p); c.globalAlpha = 0.3; c.beginPath();
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
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';

    for (const p of w.populations) {
      const spec = SPECS[p.kind], s = Math.max(1, (MIN_LEN_PX * px) / spec.length), color = popColor(p);
      const len = spec.length * s, wid = Math.max(spec.width * s, len * (p.kind === 'car' ? 0.45 : 0.32));
      for (const q of p.vehicles) {
        if (!q.alive) continue;
        c.save(); c.translate(q.pos.x, q.pos.y); c.rotate(q.heading);
        this.sprite(c, p.kind, color, len, wid);
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
      c.strokeStyle = 'rgba(198,255,61,0.6)'; c.lineWidth = 1 * px; c.beginPath();
      for (const e of ends) { c.moveTo(v.pos.x, v.pos.y); c.lineTo(e.x, e.y); }
      c.stroke();
      c.fillStyle = LEAD;
      for (const e of ends) if (e.hit) { c.beginPath(); c.arc(e.x, e.y, 2.5 * px, 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = LEAD; c.lineWidth = 1.5 * px; c.shadowColor = LEAD; c.shadowBlur = 10;
      c.beginPath(); c.arc(v.pos.x, v.pos.y, Math.max(5, 12 * px), 0, Math.PI * 2); c.stroke(); c.shadowBlur = 0;
    }

    // contact: small fading dots, amber for scrapes and red for crashes (same language as the 3D sparks)
    this.flashes = this.flashes.filter((f) => ++f.age <= FLASH_FRAMES);
    for (const f of this.flashes) {
      const a = 1 - f.age / FLASH_FRAMES;
      c.fillStyle = f.crash ? `rgba(255,45,85,${a})` : `rgba(255,176,32,${a * 0.85})`;
      c.beginPath(); c.arc(f.pos.x, f.pos.y, (f.crash ? 3.5 : 2.5) * px, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}
