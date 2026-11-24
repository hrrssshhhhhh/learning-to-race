import type { Vec2 } from './vec';
import type { Track } from './track';
import type { VehicleState, VehicleSpec, VehicleKind } from './vehicle';
import { wallSegmentsNear } from './sensors';

export interface ContactEvent { kind: 'scrape' | 'crash'; pos: Vec2; intensity: number; vehicleKind: VehicleKind }

// Glancing hits (small angle, low speed into the wall) are survivable scrapes; anything harder is a crash.
// Thresholds kept at the Task 6 values after Task 9 tuning: changing them did not move the learning targets.
export const SCRAPE_MAX_ANGLE = 30; // degrees between heading and wall tangent
export const SCRAPE_MAX_NORMAL_SPEED = 8; // m/s into the wall
export const DAMAGE_LIMIT = 1;
const SCRAPE_SPEED_LOSS = 0.85;
const MAX_TUNNEL = 1; // m; > one tick of travel at top speed (55/60), so a centre this far past a wall still counts as in it
const CRAWL_SPEED = 2; // m/s; below this a steep touch is a nudge, not a crash
const BODY_MARGIN = 0.3; // m, padding around half-width so the body circle is slightly generous
const SCRAPE_MAX_RAD = (SCRAPE_MAX_ANGLE * Math.PI) / 180;

/**
 * Resolves contact between the vehicle's body circle and the nearest wall. Returns an event only on contact.
 * Only the deepest-penetrating segment is handled per call (one event per call): at a joint two segments can
 * overlap, but pushing out of the deepest one also clears the shallower one in all but extreme corners,
 * and the next step catches any remainder.
 */
export function resolveWallContact(s: VehicleState, spec: VehicleSpec, track: Track): ContactEvent | null {
  if (!s.alive) return null;
  const r = spec.width / 2 + BODY_MARGIN, px = s.pos.x, py = s.pos.y;

  let bestDepth = 0, bx = 0, by = 0, btx = 0, bty = 0;
  for (const [a, b, isInner] of wallSegmentsNear(track, s.pos, r + MAX_TUNNEL)) {
    const sx = b.x - a.x, sy = b.y - a.y, l2 = sx * sx + sy * sy;
    if (l2 === 0) continue;
    const l = Math.sqrt(l2);
    const tRaw = ((px - a.x) * sx + (py - a.y) * sy) / l2;
    let depth: number, nx: number, ny: number;
    if (tRaw >= 0 && tRaw <= 1) {
      // Alongside the segment: use the signed distance to the track side, so a centre that crossed the wall line
      // within one tick is seen as deep in the wall (and pushed back in), not as "on the far side, moving away".
      nx = isInner ? sy / l : -sy / l; ny = isInner ? -sx / l : sx / l;
      const sd = (px - a.x) * nx + (py - a.y) * ny;
      if (sd >= r || sd < -MAX_TUNNEL) continue;
      depth = r - sd;
    } else {
      // Past an end: touching the joint itself; the radial direction is the only sensible normal there.
      const t = tRaw < 0 ? 0 : 1, dx = px - (a.x + sx * t), dy = py - (a.y + sy * t), d = Math.hypot(dx, dy);
      if (d >= r || d < 1e-9) continue;
      depth = r - d; nx = dx / d; ny = dy / d;
    }
    if (depth <= bestDepth) continue;
    bestDepth = depth; bx = nx; by = ny; btx = sx / l; bty = sy / l;
  }
  if (bestDepth === 0) return null;

  // Unit heading; flip tangent so it points the way we are already going (keeps the vehicle moving forward).
  const hx = Math.cos(s.heading), hy = Math.sin(s.heading);
  const along = hx * btx + hy * bty;
  if (along < 0) { btx = -btx; bty = -bty; }
  const theta = Math.atan2(Math.abs(hx * bty - hy * btx), Math.abs(along)); // in [0, pi/2]
  const vn = s.speed * Math.sin(theta);
  const ev = (kind: 'scrape' | 'crash', intensity: number): ContactEvent =>
    ({ kind, pos: { x: s.pos.x, y: s.pos.y }, intensity, vehicleKind: spec.kind });

  const push = bestDepth + 1e-6; // the tiny extra push stops float error re-triggering next call

  // Already heading away from the wall (e.g. steering off after a corner joint): not an impact, just separate.
  if (hx * bx + hy * by >= 0) {
    s.pos.x += bx * push; s.pos.y += by * push;
    return ev('scrape', 0);
  }

  // Steep angle only counts as a crash when actually moving; a near-stationary nudge at any angle is a scrape.
  if ((theta > SCRAPE_MAX_RAD && s.speed > CRAWL_SPEED) || vn > SCRAPE_MAX_NORMAL_SPEED) {
    s.alive = false;
    return ev('crash', 1);
  }

  // Scrape: slide along the wall, losing speed and health.
  s.pos.x += bx * push; s.pos.y += by * push;
  s.heading = Math.atan2(bty, btx);
  s.speed *= SCRAPE_SPEED_LOSS;
  const intensity = vn / SCRAPE_MAX_NORMAL_SPEED;
  s.damage += 0.08 + 0.25 * intensity;
  if (s.damage >= DAMAGE_LIMIT) s.alive = false;
  return ev('scrape', intensity);
}
