export interface Series { label: string; color: string; points: number[] }

/** Sizes the backing store to the CSS box (crisp on hi-dpi) and returns a context in CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement): { c: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return { c, w, h };
}

const MUTED = '#7d7d88', TEXT = '#ffffff', TEXT_2 = '#b8b8c2', ROW = '#1b1b24', GRID = 'rgba(255,255,255,.06)', BASE = 'rgba(255,255,255,.16)';
const FONT = '600 12px "Barlow Condensed", sans-serif';
const LANE_X = 20, LANE_Y = 14; // oblique depth step between series lanes (first series = front lane)
const THICK_X = 10, THICK_Y = 7; // ribbon depth inside its lane
const GROW_MS = 600;

/** 1, 2 or 5 times a power of ten: the round step that gives about `count` intervals over `span`. */
export function niceStep(span: number, count: number): number {
  const raw = Math.max(span, 1e-9) / count, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Mixes a #rrggbb colour toward white (f > 0) or black (f < 0). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1, 7), 16), t = f < 0 ? 0 : 255, a = Math.abs(f);
  const ch = (v: number) => Math.round(v + (t - v) * a);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

interface Frame { series: Series[]; n: number; top: number; last: number[] }
interface Anim { from: Frame | null; to: Frame; start: number; raf: number }
const anims = new WeakMap<HTMLCanvasElement, Anim>();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Best fitness per generation as one lit ribbon per series, each in its own depth lane (elitism keeps best
 * fitness from dropping, so the ribbons read as a clean climb). When exactly one generation was added the
 * ribbons grow into the new point and the chip values count up; a new run or first draw is instant.
 */
export function drawChart(canvas: HTMLCanvasElement, series: Series[]): void {
  const n = Math.max(0, ...series.map((s) => s.points.length));
  const to: Frame = {
    series, n,
    top: Math.max(1, ...series.flatMap((s) => s.points)),
    last: series.map((s) => Math.max(0, s.points[s.points.length - 1] ?? 0)), // damage can push fitness below 0
  };
  const prev = anims.get(canvas);
  if (prev) cancelAnimationFrame(prev.raf);
  const was = prev?.to;
  const grows = !!was && was.n > 0 && n === was.n + 1 && series.length === was.series.length
    && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const a: Anim = { from: grows ? was! : null, to, start: performance.now(), raf: 0 };
  anims.set(canvas, a);
  canvas.setAttribute('aria-label', n
    ? `Best score per generation, ${n} so far. ` + series.map((s, k) => `${s.label} ${to.last[k].toFixed(0)}`).join(', ')
    : 'Best score per generation, no generations finished yet');
  const tick = (now: number) => {
    const t = a.from ? Math.min(1, (now - a.start) / GROW_MS) : 1;
    render(canvas, a.to, a.from, 1 - (1 - t) ** 3); // ease-out cubic
    if (t < 1) a.raf = requestAnimationFrame(tick);
  };
  tick(performance.now());
}

/** One frame. With `from`, the newest point is `t` of the way in and both scales are tweening. */
function render(canvas: HTMLCanvasElement, to: Frame, from: Frame | null, t: number): void {
  const { c, w, h } = fitCanvas(canvas);
  const { series, n } = to;
  c.font = FONT; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineCap = 'round';
  if (!n) {
    c.fillStyle = MUTED; c.textAlign = 'center'; c.fillText('Scores appear when the first generation ends', w / 2, h / 2);
    return;
  }
  const last = to.last.map((v, k) => (from ? lerp(from.last[k], v, t) : v));
  const chip = (k: number) => `${series[k].label} ${last[k].toFixed(0)}`;
  const chipW = Math.max(...series.map((s, k) => c.measureText(`${s.label} ${to.last[k].toFixed(0)}`).width)) + 16;
  const lanes = series.length, OX = (lanes - 1) * LANE_X + THICK_X, OY = (lanes - 1) * LANE_Y + THICK_Y;
  const L = 28, R = chipW + 8, T = 8 + OY, B = 20, pw = w - L - R - OX, ph = h - T - B, y0 = T + ph;
  const maxV = from ? lerp(from.top, to.top, t) : to.top;
  const yStep = niceStep(maxV, 4), top = Math.ceil(maxV / yStep) * yStep;
  const dom = Math.max(1, from ? lerp(from.n - 1, n - 1, t) : n - 1); // x domain widens as the new point grows in
  const x = (g: number) => L + (g / dom) * pw, y = (v: number) => y0 - (Math.max(0, v) / top) * ph;

  // walls: each round value runs along the left wall to the back wall; generation ticks run back across the floor
  c.lineWidth = 1;
  c.textAlign = 'right';
  for (let v = 0; v <= top + 1e-9; v += yStep) {
    const gy = Math.round(y(v)) + 0.5;
    c.strokeStyle = v === 0 ? BASE : GRID;
    c.beginPath(); c.moveTo(L, gy); c.lineTo(L + OX, gy - OY); c.lineTo(L + OX + pw, gy - OY); c.stroke();
    c.fillStyle = MUTED; c.fillText(String(+v.toFixed(2)), L - 6, gy);
  }
  c.strokeStyle = BASE;
  c.beginPath(); c.moveTo(L, y0 + 0.5); c.lineTo(L + pw, y0 + 0.5); c.lineTo(L + pw + OX, y0 + 0.5 - OY); c.stroke();
  const xStep = Math.max(1, niceStep(n - 1, 4));
  c.textAlign = 'center';
  for (let g = 0; g < n; g += xStep) {
    const gx = Math.round(x(g)) + 0.5;
    if (gx > L + pw + 1) break;
    c.strokeStyle = GRID; c.beginPath(); c.moveTo(gx, y0); c.lineTo(gx + OX, y0 - OY); c.stroke();
    c.fillStyle = MUTED; c.fillText(String(g + 1), x(g), h - 8);
  }
  if (!from && (n - 1) % xStep && x(n - 1) - x(Math.floor((n - 1) / xStep) * xStep) > 20) c.fillText(String(n), x(n - 1), h - 8);

  const lead = to.last.indexOf(Math.max(...to.last));
  const ends: { k: number; ex: number; ey: number; cy: number }[] = [];
  for (let k = lanes - 1; k >= 0; k--) { // back lane first so nearer ribbons overlap it
    const s = series[k];
    if (!s.points.length) continue;
    const pts = s.points.map((v, g): [number, number] => [x(g), y(v)]);
    if (from && pts.length === n && n >= 2) { // the newest point slides out of the previous one
      const g = n - 1;
      pts[g] = [x(lerp(g - 1, g, t)), y(lerp(s.points[g - 1], s.points[g], t))];
    }
    // P(p, e): point p in this series' lane, e = 0 front edge, 1 back edge of the ribbon
    const P = (p: [number, number], e = 0): [number, number] => [p[0] + k * LANE_X + e * THICK_X, p[1] - k * LANE_Y - e * THICK_Y];
    const end = pts[pts.length - 1];
    // front wall: the area under the ribbon, fading to the floor
    const fill = c.createLinearGradient(0, T, 0, y0);
    fill.addColorStop(0, s.color + '40'); fill.addColorStop(1, s.color + '00');
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(...P(p)) : c.moveTo(...P(p))));
    c.lineTo(...P([end[0], y0])); c.lineTo(...P([pts[0][0], y0])); c.closePath();
    c.fillStyle = fill; c.fill();
    // top face, one quad per segment, lit from above: flat stretches read bright, steep climbs darker
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i], slope = Math.atan2(p[1] - q[1], q[0] - p[0]);
      c.fillStyle = shade(s.color, 0.35 * Math.cos(slope) - 0.3 * Math.abs(Math.sin(slope)));
      c.beginPath(); c.moveTo(...P(p)); c.lineTo(...P(q)); c.lineTo(...P(q, 1)); c.lineTo(...P(p, 1)); c.closePath(); c.fill();
    }
    // front edge: the value line itself
    c.strokeStyle = s.color; c.lineWidth = k === lead ? 2 : 1.5;
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(...P(p)) : c.moveTo(...P(p)))); c.stroke();
    if (pts.length === 1) { c.fillStyle = s.color; c.beginPath(); c.arc(...P(end), 3, 0, Math.PI * 2); c.fill(); }
    const [ex, ey] = P(end, 0.5);
    ends.push({ k, ex, ey, cy: ey });
  }

  // end chips: nudged apart so close scores never overlap, then clamped into the frame
  ends.sort((p, q) => p.ey - q.ey);
  for (let i = 1; i < ends.length; i++) ends[i].cy = Math.max(ends[i].cy, ends[i - 1].cy + 20);
  const over = (ends.at(-1)?.cy ?? 0) - (y0 - 8);
  if (over > 0) ends.forEach((e) => (e.cy -= over));
  const cx = L + pw + OX + 8;
  c.textAlign = 'left'; c.lineWidth = 1;
  for (const e of ends) {
    e.cy = Math.max(10, e.cy);
    const s = series[e.k];
    if (cx - e.ex < 48) { c.strokeStyle = s.color + '80'; c.beginPath(); c.moveTo(e.ex + 2, e.ey); c.lineTo(cx, e.cy); c.stroke(); } // leader line, only when its ribbon ends nearby
    c.fillStyle = ROW; c.fillRect(cx, e.cy - 9, chipW, 18);
    c.fillStyle = s.color; c.fillRect(cx, e.cy - 9, 2, 18); // team bar, as on the population cards
    c.fillStyle = e.k === lead ? TEXT : TEXT_2; c.fillText(chip(e.k), cx + 8, e.cy + 1);
  }
}
