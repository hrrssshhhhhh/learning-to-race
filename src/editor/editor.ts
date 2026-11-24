import type { Vec2 } from '../sim/vec';
import { buildTrack, validateTrack, type TrackError } from '../sim/track';
import { randomTrack } from '../sim/trackgen';
import { makeRng } from '../sim/rng';
import { DEFAULT_TRACK } from '../sim/defaultTrack';

export const EDITOR_METERS_PER_PX = 2;
const EPSILON_M = 6, MAX_POINTS = 40;

const MESSAGES: Record<TrackError, string> = {
  'too-few-points': 'Draw a bigger loop',
  'too-short': 'Draw a bigger loop',
  'too-long': 'Track too long — draw smaller',
  'self-intersect': 'Track crosses itself',
  'too-tight': 'A corner is too tight — widen it',
};

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Ramer–Douglas–Peucker on pts[lo..hi]; returns kept points including lo, excluding hi. */
function rdp(pts: Vec2[], lo: number, hi: number, eps: number): Vec2[] {
  let worst = -1, wi = lo;
  for (let i = lo + 1; i < hi; i++) {
    const d = segDist(pts[i], pts[lo], pts[hi]);
    if (d > worst) { worst = d; wi = i; }
  }
  return worst > eps ? [...rdp(pts, lo, wi, eps), ...rdp(pts, wi, hi, eps)] : [pts[lo]];
}

/** Freehand stroke (css px) -> closed-loop control points (meters). Never throws; validateTrack judges the result. */
export function strokeToControlPoints(stroke: Vec2[], metersPerPx: number): Vec2[] {
  let m = stroke.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: p.x * metersPerPx, y: p.y * metersPerPx }));
  if (m.length > 1 && Math.hypot(m[0].x - m[m.length - 1].x, m[0].y - m[m.length - 1].y) < 1e-6) m = m.slice(0, -1); // closing duplicate
  if (m.length < 3) return m;
  // a loop's endpoints coincide, so split at the point farthest from the start and simplify each half
  let far = 0, fd = -1;
  m.forEach((p, i) => { const d = Math.hypot(p.x - m[0].x, p.y - m[0].y); if (d > fd) { fd = d; far = i; } });
  const closed = [...m, m[0]];
  // shortcut: eps grows x1.25 until <= MAX_POINTS, so fussy strokes get coarser rather than rejected
  for (let eps = EPSILON_M; ; eps *= 1.25) {
    const out = [...rdp(closed, 0, far, eps), ...rdp(closed, far, closed.length - 1, eps)];
    if (out.length <= MAX_POINTS || eps > 1e4) return out.slice(0, MAX_POINTS);
  }
}

export class Editor {
  private ctx: CanvasRenderingContext2D;
  private panel = document.createElement('div');
  private msg = document.createElement('p');
  private stroke: Vec2[] = [];            // what is shown, css px
  private loaded: Vec2[] | null = null;   // meters, when a random/default track is shown instead of a drawn stroke
  private fit = { k: 1 / EDITOR_METERS_PER_PX, ox: 0, oy: 0 }; // meters -> px
  private drawing = false;
  private w = 0; private h = 0;
  private opened = false;
  private resizeHandler = () => this.layout();

  constructor(private canvas: HTMLCanvasElement, private onRace: (control: Vec2[]) => void) {
    this.ctx = canvas.getContext('2d')!;
    canvas.style.touchAction = 'none';
    this.panel.className = 'editor-panel';
    this.panel.innerHTML = `<button type="button" data-a="race">Race</button>
      <button type="button" data-a="random">Random track</button>
      <button type="button" data-a="default">Default track</button>
      <button type="button" data-a="clear">Clear</button>
      <button type="button" data-a="cancel">Cancel</button>`;
    this.msg.setAttribute('role', 'alert');
    this.msg.className = 'editor-msg';
    this.panel.append(this.msg);
    canvas.after(this.panel);
    this.panel.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'race') this.race();
      else if (a === 'random') this.show(randomTrack(makeRng(Date.now())));
      else if (a === 'default') this.show(DEFAULT_TRACK);
      else if (a === 'clear') this.clear();
      else if (a === 'cancel') this.close();
    });
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.drawing = true; this.loaded = null; this.msg.textContent = '';
      this.fit = { k: 1 / EDITOR_METERS_PER_PX, ox: 0, oy: 0 };
      this.stroke = [this.pt(e)]; this.draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      const p = this.pt(e), last = this.stroke[this.stroke.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) { this.stroke.push(p); this.draw(); }
    });
    const up = () => { this.drawing = false; this.draw(); };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.setVisible(false);
  }

  get isOpen(): boolean { return this.opened; }

  open(): void {
    this.opened = true; this.setVisible(true);
    window.addEventListener('resize', this.resizeHandler);
    this.layout(); this.clear();
  }
  close(): void {
    this.opened = false; this.setVisible(false);
    window.removeEventListener('resize', this.resizeHandler);
  }

  private setVisible(v: boolean): void { this.canvas.hidden = this.panel.hidden = !v; }
  private pt(e: PointerEvent): Vec2 { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private control(): Vec2[] { return this.loaded ?? strokeToControlPoints(this.stroke, EDITOR_METERS_PER_PX); }

  private clear(): void {
    this.stroke = []; this.loaded = null; this.msg.textContent = '';
    this.fit = { k: 1 / EDITOR_METERS_PER_PX, ox: 0, oy: 0 }; this.draw();
  }

  /** Show a track given in meters, scaled and centred into the canvas; control points stay in meters. */
  private show(control: Vec2[]): void {
    this.loaded = control; this.msg.textContent = '';
    const xs = control.map((p) => p.x), ys = control.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pad = 60;
    const k = Math.min((this.w - 2 * pad) / (x1 - x0 || 1), (this.h - 2 * pad) / (y1 - y0 || 1));
    this.fit = { k, ox: (this.w - k * (x0 + x1)) / 2, oy: (this.h - k * (y0 + y1)) / 2 };
    this.stroke = control.map((p) => this.toPx(p));
    this.draw();
  }

  private toPx(p: Vec2): Vec2 { return { x: p.x * this.fit.k + this.fit.ox, y: p.y * this.fit.k + this.fit.oy }; }

  private race(): void {
    const control = this.control(), v = validateTrack(control);
    if (!v.ok) { this.msg.textContent = MESSAGES[v.reason]; return; }
    this.msg.textContent = '';
    this.onRace(control);
    this.close();
  }

  private layout(): void {
    const dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.loaded) this.show(this.loaded); else this.draw();
  }

  private path(pts: Vec2[], close: boolean): void {
    const c = this.ctx; c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    if (close) c.closePath();
  }

  private draw(): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    if (!this.stroke.length) {
      c.fillStyle = '#8a90a0'; c.font = '16px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('Draw a loop with the mouse, then press Race', this.w / 2, this.h / 2);
      return;
    }
    const control = this.control();
    if (!this.drawing && validateTrack(control).ok) { // live preview: the smoothed walls the cars will see
      const t = buildTrack(control);
      c.strokeStyle = '#cfd3dd'; c.lineWidth = 2;
      for (const wall of [t.outer, t.inner]) { this.path(wall.map((p) => this.toPx(p)), true); c.stroke(); }
    }
    c.strokeStyle = '#4aa3ff'; c.lineWidth = 2;
    this.path(this.stroke, false); c.stroke();
  }
}
