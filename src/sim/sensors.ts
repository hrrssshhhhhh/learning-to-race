import type { Vec2 } from './vec';
import type { Track } from './track';
import type { VehicleState, VehicleSpec } from './vehicle';

export const RAY_ANGLES = [-90, -60, -30, 0, 30, 60, 90]; // degrees from heading; positive = left
export const RAY_LENGTH = 80; // m
export const INPUT_SIZE = RAY_ANGLES.length + 1; // rays + normalized speed
const RAY_RAD = RAY_ANGLES.map((d) => (d * Math.PI) / 180);

// Cell is about half a ray so a query touches a handful of cells, not the whole track.
const CELL = 40;

/** Wall segments bucketed by cell; seg id k < n is inner[k]->inner[k+1], k >= n is outer[k-n]->... */
interface Grid { n: number; inner: Vec2[]; outer: Vec2[]; cells: Map<number, number[]> }

const key = (cx: number, cy: number) => cx * 100003 + cy; // cx,cy are small ints; collision-free in track range

const grids = new WeakMap<Track, Grid>();

function segOf(g: Grid, id: number): [Vec2, Vec2] {
  const [w, i] = id < g.n ? [g.inner, id] : [g.outer, id - g.n];
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

/** Wall segments (inner and outer) in the grid cells around p; also used by wall contact (Task 6). Deduped. */
export function wallSegmentsNear(track: Track, p: Vec2, radius: number): Iterable<[Vec2, Vec2]> {
  const g = gridFor(track), seen = new Set<number>(), out: [Vec2, Vec2][] = [];
  forNear(g, p, radius, (id) => { if (!seen.has(id)) { seen.add(id); out.push(segOf(g, id)); } });
  return out;
}

/** Per-ray distance to the nearest wall / RAY_LENGTH; 1 = nothing in range. */
export function castRays(s: VehicleState, track: Track): number[] {
  const g = gridFor(track), out = RAY_RAD.map(() => 1), px = s.pos.x, py = s.pos.y;
  const dx = RAY_RAD.map((a) => Math.cos(s.heading + a) * RAY_LENGTH);
  const dy = RAY_RAD.map((a) => Math.sin(s.heading + a) * RAY_LENGTH);
  // Hot path (200 vehicles x 7 rays): inlined segment intersection, no allocation, no dedupe
  // (a segment seen twice just re-tests harmlessly). Same maths as vec.segmentIntersect.
  forNear(g, s.pos, RAY_LENGTH, (id) => {
    const [a, b] = segOf(g, id);
    const sx = b.x - a.x, sy = b.y - a.y, qx = a.x - px, qy = a.y - py;
    for (let r = 0; r < dx.length; r++) {
      const denom = dx[r] * sy - dy[r] * sx;
      if (Math.abs(denom) < 1e-12) continue;
      const t = (qx * sy - qy * sx) / denom, u = (qx * dy[r] - qy * dx[r]) / denom;
      if (t >= 0 && t < out[r] && u >= 0 && u <= 1) out[r] = t;
    }
  });
  return out;
}

export function sensorInputs(s: VehicleState, spec: VehicleSpec, track: Track): number[] {
  return [...castRays(s, track), s.speed / spec.maxSpeed];
}
