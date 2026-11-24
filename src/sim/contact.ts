import type { Vec2 } from './vec';
import type { Track } from './track';
import type { VehicleState, VehicleSpec, VehicleKind } from './vehicle';
import { wallSegmentsNear } from './sensors';

export interface ContactEvent { kind: 'scrape' | 'crash'; pos: Vec2; intensity: number; vehicleKind: VehicleKind }

// Glancing hits (small angle, low speed into the wall) are survivable scrapes; anything harder is a crash.
// Placeholder numbers from the brief; tuned in Task 9.
export const SCRAPE_MAX_ANGLE = 30; // degrees between heading and wall tangent
export const SCRAPE_MAX_NORMAL_SPEED = 8; // m/s into the wall
export const DAMAGE_LIMIT = 1;
const SCRAPE_SPEED_LOSS = 0.85;
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
  for (const [a, b] of wallSegmentsNear(track, s.pos, r)) {
    const sx = b.x - a.x, sy = b.y - a.y, l2 = sx * sx + sy * sy;
    if (l2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((px - a.x) * sx + (py - a.y) * sy) / l2));
    const dx = px - (a.x + sx * t), dy = py - (a.y + sy * t), d = Math.hypot(dx, dy);
    if (r - d <= bestDepth) continue;
    bestDepth = r - d;
    const l = Math.sqrt(l2);
    btx = sx / l; bty = sy / l;
    // Normal points from wall to vehicle. If the centre is exactly on the wall, fall back to the segment's perpendicular.
    if (d > 1e-9) { bx = dx / d; by = dy / d; } else { bx = -bty; by = btx; }
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

  if (theta > SCRAPE_MAX_RAD || vn > SCRAPE_MAX_NORMAL_SPEED) {
    s.alive = false;
    return ev('crash', 1);
  }

  // Scrape: slide along the wall, losing speed and health. The tiny extra push stops float error re-triggering next call.
  const push = bestDepth + 1e-6;
  s.pos.x += bx * push; s.pos.y += by * push;
  s.heading = Math.atan2(bty, btx);
  s.speed *= SCRAPE_SPEED_LOSS;
  const intensity = vn / SCRAPE_MAX_NORMAL_SPEED;
  s.damage += 0.08 + 0.25 * intensity;
  if (s.damage >= DAMAGE_LIMIT) s.alive = false;
  return ev('scrape', intensity);
}
