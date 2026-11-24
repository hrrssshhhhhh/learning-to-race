import type { Vec2 } from './vec';
import type { Track } from './track';
import type { VehicleState, VehicleSpec } from './vehicle';

export const RAY_ANGLES = [-90, -60, -30, 0, 30, 60, 90]; // degrees from heading; positive = left
// m. Task 9 tuning (was 80): at 80 m the side rays in a 14 m track read ~0.09 each, so left/right
// differences were too small for random brains to steer on; 40 m doubles that signal. 40 m is still ~0.7 s ahead at top speed.
export const RAY_LENGTH = 40;
export const INPUT_SIZE = RAY_ANGLES.length + 1; // rays + normalized speed
const RAY_RAD = RAY_ANGLES.map((d) => (d * Math.PI) / 180);

// Cell is about half a ray so a query touches a handful of cells, not the whole track.
const CELL = 40;

/** Wall segments bucketed by cell; seg id k < n is inner[k]->inner[k+1], k >= n is outer[k-n]->... */
interface Grid { n: number; inner: Vec2[]; outer: Vec2[]; cells: Map<number, number[]> }

const key = (cx: number, cy: number) => cx * 100003 + cy; // cx,cy are small ints; collision-free in track range

const grids = new WeakMap<Track, Grid>();

function segOf(g: Grid, id: number): [Vec2, Vec2] {
  const w = id < g.n ? g.inner : g.outer, i = id < g.n ? id : id - g.n;
  return [w[i], w[(i + 1) % g.n]];
}

function gridFor(track: Track): Grid {
  let g = grids.get(track);
  if (g) return g;
  const n = track.inner.length;
  g = { n, inner: track.inner, outer: track.outer, cells: new Map() };
  for (let id = 0; id < 2 * n; id++) {
    const [a, b] = segOf(g, id);
    const x1 = Math.floor(Math.max(a.x, b.x) / CELL), y1 = Math.floor(Math.max(a.y, b.y) / CELL);
    for (let x = Math.floor(Math.min(a.x, b.x) / CELL); x <= x1; x++)
      for (let y = Math.floor(Math.min(a.y, b.y) / CELL); y <= y1; y++) {
        const k = key(x, y), bucket = g.cells.get(k);
        if (bucket) bucket.push(id); else g.cells.set(k, [id]);
      }
  }
  grids.set(track, g);
  return g;
}

/** Calls f for each segment id in cells overlapping the square p +/- radius. Ids may repeat (a segment spans cells). */
function forNear(g: Grid, p: Vec2, radius: number, f: (id: number) => void): void {
  const x1 = Math.floor((p.x + radius) / CELL), y1 = Math.floor((p.y + radius) / CELL);
  for (let x = Math.floor((p.x - radius) / CELL); x <= x1; x++)
    for (let y = Math.floor((p.y - radius) / CELL); y <= y1; y++) {
      const bucket = g.cells.get(key(x, y));
      if (bucket) for (const id of bucket) f(id);
    }
}

/** Wall segments [a, b, isInner] in the grid cells around p; also used by wall contact (Task 6). Deduped.
 *  isInner tells contact which side is the track: right of a->b for the inner wall, left for the outer (CCW track). */
export function wallSegmentsNear(track: Track, p: Vec2, radius: number): Iterable<[Vec2, Vec2, boolean]> {
  const g = gridFor(track), seen = new Set<number>(), out: [Vec2, Vec2, boolean][] = [];
  forNear(g, p, radius, (id) => { if (!seen.has(id)) { seen.add(id); out.push([...segOf(g, id), id < g.n]); } });
  return out;
}

// Scratch buffers: castRays is synchronous and never re-entered, so sharing them is safe.
const RAY_DX = new Float64Array(RAY_RAD.length), RAY_DY = new Float64Array(RAY_RAD.length);
const RAY_HIT = new Float64Array(RAY_RAD.length);

/** Writes per-ray distance / RAY_LENGTH (1 = nothing in range) into RAY_HIT. */
function cast(s: VehicleState, track: Track): void {
  const g = gridFor(track), px = s.pos.x, py = s.pos.y, n = g.n, R = RAY_RAD.length;
  for (let r = 0; r < R; r++) {
    RAY_DX[r] = Math.cos(s.heading + RAY_RAD[r]) * RAY_LENGTH;
    RAY_DY[r] = Math.sin(s.heading + RAY_RAD[r]) * RAY_LENGTH;
    RAY_HIT[r] = 1;
  }
  const cx1 = Math.floor((px + RAY_LENGTH) / CELL), cy1 = Math.floor((py + RAY_LENGTH) / CELL);
  for (let cx = Math.floor((px - RAY_LENGTH) / CELL); cx <= cx1; cx++)
    for (let cy = Math.floor((py - RAY_LENGTH) / CELL); cy <= cy1; cy++) {
      const bucket = g.cells.get(key(cx, cy));
      if (!bucket) continue;
      // Inlined segment intersection (same maths as vec.segmentIntersect). A segment spanning
      // several cells is simply re-tested, which is harmless for a min.
      for (let k = 0; k < bucket.length; k++) {
        const id = bucket[k], w = id < n ? g.inner : g.outer, i = id < n ? id : id - n;
        const a = w[i], b = w[i + 1 === n ? 0 : i + 1];
        const sx = b.x - a.x, sy = b.y - a.y, qx = a.x - px, qy = a.y - py;
        for (let r = 0; r < R; r++) {
          const denom = RAY_DX[r] * sy - RAY_DY[r] * sx;
          if (Math.abs(denom) < 1e-12) continue;
          const t = (qx * sy - qy * sx) / denom, u = (qx * RAY_DY[r] - qy * RAY_DX[r]) / denom;
          if (t >= 0 && t < RAY_HIT[r] && u >= 0 && u <= 1) RAY_HIT[r] = t;
        }
      }
    }
}

/** Per-ray distance to the nearest wall / RAY_LENGTH; 1 = nothing in range. Only allocation: the result. */
export function castRays(s: VehicleState, track: Track): number[] {
  cast(s, track);
  return Array.from(RAY_HIT);
}

export function sensorInputs(s: VehicleState, spec: VehicleSpec, track: Track): number[] {
  cast(s, track);
  const out = Array.from(RAY_HIT);
  out.push(s.speed / spec.maxSpeed);
  return out;
}
