import { Vec2, add, sub, scale, cross, norm, dist, segmentIntersect } from './vec';

export const TRACK_WIDTH = 14;
const SPACING = 2; // m between centerline samples
const CHECKPOINT_EVERY = 5; // samples (~10 m)
const MIN_RADIUS = 9;
const MIN_LEN = 400, MAX_LEN = 4000;
const START_WINDOW = 20; // samples (~40 m)

export interface Checkpoint { a: Vec2; b: Vec2 }
export interface Track {
  center: Vec2[]; inner: Vec2[]; outer: Vec2[]; checkpoints: Checkpoint[];
  start: { pos: Vec2; heading: number }; length: number; width: number;
}
export type TrackError = 'too-few-points' | 'too-short' | 'too-long' | 'self-intersect' | 'too-tight';

/** Closed cubic Hermite through the points; end tangents favor the longer neighbouring chord so straights stay straight. */
function spline(ctl: Vec2[]): Vec2[] {
  const n = ctl.length, out: Vec2[] = [];
  const dir = ctl.map((p, i) => {
    const d1 = sub(p, ctl[(i + n - 1) % n]), d2 = sub(ctl[(i + 1) % n], p);
    return norm(add(scale(d1, dist(p, ctl[(i + n - 1) % n])), scale(d2, dist(ctl[(i + 1) % n], p))));
  });
  for (let i = 0; i < n; i++) {
    const p1 = ctl[i], p2 = ctl[(i + 1) % n], L = dist(p1, p2);
    const m1 = scale(dir[i], L), m2 = scale(dir[(i + 1) % n], L);
    const steps = Math.max(8, Math.ceil(L));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push(add(add(scale(p1, h00), scale(m1, h10)), add(scale(p2, h01), scale(m2, h11))));
    }
  }
  return out;
}

/** Evenly spaced (~SPACING) closed loop, normalized to counter-clockwise. */
function resample(dense: Vec2[]): { pts: Vec2[]; length: number } {
  const m = dense.length;
  const cum = [0];
  for (let i = 0; i < m; i++) cum.push(cum[i] + dist(dense[i], dense[(i + 1) % m]));
  const length = cum[m], n = Math.max(3, Math.round(length / SPACING));
  const pts: Vec2[] = [];
  for (let k = 0, j = 0; k < n; k++) {
    const d = length * k / n;
    while (cum[j + 1] < d) j++;
    const f = (d - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    pts.push(add(dense[j], scale(sub(dense[(j + 1) % m], dense[j]), f)));
  }
  let area = 0;
  for (let i = 0; i < n; i++) area += cross(pts[i], pts[(i + 1) % n]);
  if (area < 0) pts.reverse();
  return { pts, length };
}

const tangent = (c: Vec2[], i: number) => norm(sub(c[(i + 1) % c.length], c[(i + c.length - 1) % c.length]));
// left of travel = inside for a CCW loop
const offsetWall = (c: Vec2[], d: number): Vec2[] =>
  c.map((p, i) => { const t = tangent(c, i); return add(p, scale({ x: -t.y, y: t.x }, d)); });

/** True if any two non-adjacent segments of the closed polyline cross (uniform grid broad phase). */
function selfIntersects(poly: Vec2[]): boolean {
  const n = poly.length, cell = 20, grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell);
    const y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = x + ',' + y, bucket = grid.get(key);
      if (!bucket) { grid.set(key, [i]); continue; }
      for (const j of bucket) {
        const gap = Math.min(i - j, n - (i - j));
        if (gap > 2 && segmentIntersect(poly[j], poly[(j + 1) % n], a, b)) return true;
      }
      bucket.push(i);
    }
  }
  return false;
}

/** Smallest circumradius over consecutive sample triples. */
function minRadius(c: Vec2[]): number {
  let best = Infinity;
  const n = c.length;
  for (let i = 0; i < n; i++) {
    const a = c[(i + n - 1) % n], b = c[i], d = c[(i + 1) % n];
    const k = Math.abs(cross(sub(b, a), sub(d, b)));
    if (k > 1e-9) best = Math.min(best, (dist(a, b) * dist(b, d) * dist(a, d)) / (2 * k));
  }
  return best;
}

type Checked = { ok: true; pts: Vec2[]; length: number } | { ok: false; reason: TrackError };

function check(control: Vec2[]): Checked {
  if (control.length < 4) return { ok: false, reason: 'too-few-points' };
  const { pts, length } = resample(spline(control));
  if (length < MIN_LEN) return { ok: false, reason: 'too-short' };
  if (length > MAX_LEN) return { ok: false, reason: 'too-long' };
  // order matters: centerline crossing, then radius (a tight corner folds the walls), then wall crossing
  if (selfIntersects(pts)) return { ok: false, reason: 'self-intersect' };
  if (minRadius(pts) < MIN_RADIUS) return { ok: false, reason: 'too-tight' };
  if (selfIntersects(offsetWall(pts, TRACK_WIDTH / 2)) || selfIntersects(offsetWall(pts, -TRACK_WIDTH / 2)))
    return { ok: false, reason: 'self-intersect' };
  return { ok: true, pts, length };
}

export function validateTrack(control: Vec2[]): { ok: true } | { ok: false; reason: TrackError } {
  const r = check(control);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

export function buildTrack(control: Vec2[]): Track {
  const r = check(control);
  if (!r.ok) throw new Error('Invalid track: ' + r.reason);
  const n = r.pts.length;
  // start = middle of the straightest window (lowest summed turning)
  const turn = r.pts.map((_, i) => Math.abs(cross(tangent(r.pts, (i + n - 1) % n), tangent(r.pts, (i + 1) % n))));
  let sum = 0;
  for (let i = 0; i < START_WINDOW; i++) sum += turn[i];
  let bestSum = sum, bestStart = 0;
  for (let s = 1; s < n; s++) {
    sum += turn[(s + START_WINDOW - 1) % n] - turn[s - 1];
    if (sum < bestSum) { bestSum = sum; bestStart = s; }
  }
  const shift = (bestStart + START_WINDOW / 2) % n;
  const center = r.pts.map((_, i) => r.pts[(i + shift) % n]);
  const inner = offsetWall(center, TRACK_WIDTH / 2), outer = offsetWall(center, -TRACK_WIDTH / 2);
  const checkpoints: Checkpoint[] = [];
  for (let i = 0; i < n; i += CHECKPOINT_EVERY) checkpoints.push({ a: inner[i], b: outer[i] });
  const t = tangent(center, 0);
  return { center, inner, outer, checkpoints, start: { pos: center[0], heading: Math.atan2(t.y, t.x) }, length: r.length, width: TRACK_WIDTH };
}
