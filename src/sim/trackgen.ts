import { Vec2, sub, cross, dist, add, scale } from './vec';
import { Rng } from './rng';
import { validateTrack, buildTrack } from './track';

const MAX_TRIES = 200;
const MIN_CORNER = 12; // stricter than the validator's 9 m so learning targets stay reachable

/** Shape knobs. NORMAL is what the app uses; HARD (experiments only) packs in more, tighter corners so learning takes long enough to measure. */
export interface TrackStyle { minPoints: number; extraPoints: number; pinch: number; minCorner: number }
export const NORMAL: TrackStyle = { minPoints: 8, extraPoints: 7, pinch: 0.18, minCorner: MIN_CORNER };
export const HARD: TrackStyle = { minPoints: 14, extraPoints: 7, pinch: 0.4, minCorner: 9 };

/** Gentle ellipse with a little radial jitter; far from any validity limit. */
export function fallbackTrack(rng: Rng): Vec2[] {
  const a = 250 + rng() * 100, b = 150 + rng() * 60, n = 10;
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n, j = 1 + (rng() - 0.5) * 0.06;
    return { x: a * j * Math.cos(t), y: b * j * Math.sin(t) };
  });
}

/** Circumradius at each sample of a closed polyline (Infinity where straight). */
export function curvatureRadii(c: Vec2[]): number[] {
  const n = c.length;
  return c.map((b, i) => {
    const a = c[(i + n - 1) % n], d = c[(i + 1) % n];
    const k = Math.abs(cross(sub(b, a), sub(d, b)));
    return k > 1e-9 ? (dist(a, b) * dist(b, d) * dist(a, d)) / (2 * k) : Infinity;
  });
}

function candidate(rng: Rng, st: TrackStyle): Vec2[] {
  const n = st.minPoints + Math.floor(rng() * st.extraPoints);
  // non-uniform angle gaps: wide gaps become long edges, narrow ones tight sections
  const gaps = Array.from({ length: n }, () => 0.4 + rng() * 1.2);
  const total = gaps.reduce((s, g) => s + g, 0);
  const pts: Vec2[] = [];
  let r = 150 + rng() * 300, t = rng() * 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    r += (rng() - 0.5) * (rng() < 0.3 ? 300 : 100);
    r = Math.min(450, Math.max(150, r));
    let rr = r;
    if (rng() < st.pinch) rr *= 0.4 + rng() * 0.3; // pinched point: hairpin / chicane
    pts.push({ x: rr * Math.cos(t), y: rr * Math.sin(t) });
    t += (2 * Math.PI * gaps[i]) / total;
  }
  if (rng() < 0.7) { // straight: put a point on the chord between its neighbours
    const k = Math.floor(rng() * n), a = pts[k], b = pts[(k + 2) % n];
    pts[(k + 1) % n] = add(a, scale(sub(b, a), 0.4 + rng() * 0.2));
  }
  return pts;
}

/** Valid closed-track control points: varied angle gaps and radii, pinched points and collinear runs. Retries until valid. */
export function randomTrack(rng: Rng, st: TrackStyle = NORMAL): Vec2[] {
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const pts = candidate(rng, st);
    if (validateTrack(pts).ok && Math.min(...curvatureRadii(buildTrack(pts).center)) >= st.minCorner) return pts;
  }
  return fallbackTrack(rng);
}
