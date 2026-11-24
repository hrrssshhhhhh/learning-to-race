import { describe, it, expect } from 'vitest';
import { darkness, nearestWallPoint, wallIds } from '../../src/render3d/effects';
import { buildTrack } from '../../src/sim/track';
import { DEFAULT_TRACK } from '../../src/sim/defaultTrack';

describe('effects helpers', () => {
  it('darkness saturates monotonically', () => {
    expect(darkness(0)).toBe(0);
    expect(darkness(5)).toBeLessThan(darkness(50));
    expect(darkness(1000)).toBeGreaterThan(0.99);
  });
  it('finds the nearest wall point with the normal pointing at the track', () => {
    const t = buildTrack(DEFAULT_TRACK), ids = wallIds(t);
    const c = t.center[10], h = nearestWallPoint(t, ids, c, 60)!;
    expect(h).not.toBeNull();
    expect(Math.hypot(h.nx, h.ny)).toBeCloseTo(1);
    // stepping from the wall point along the normal moves toward the centreline
    const d0 = Math.hypot(h.x - c.x, h.y - c.y), d1 = Math.hypot(h.x + h.nx - c.x, h.y + h.ny - c.y);
    expect(d1).toBeLessThan(d0);
    expect(nearestWallPoint(t, ids, { x: 1e6, y: 1e6 }, 5)).toBeNull();
  });
});
