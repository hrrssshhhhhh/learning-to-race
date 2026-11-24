import { buildTrack, TRACK_WIDTH } from '../../src/sim/track';
import { newVehicleState, CAR } from '../../src/sim/vehicle';
import { castRays, sensorInputs, wallSegmentsNear, RAY_LENGTH, RAY_ANGLES, INPUT_SIZE } from '../../src/sim/sensors';
import { DEFAULT_TRACK } from '../../src/sim/defaultTrack';
import { segmentIntersect, type Vec2 } from '../../src/sim/vec';

const straight = () => buildTrack([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }]);

test('centered vehicle on straight: left/right rays see walls at half width', () => {
  const t = straight(); const s = newVehicleState(t.start);
  const r = castRays(s, t);
  expect(r).toHaveLength(7);
  expect(r[0] * RAY_LENGTH).toBeCloseTo(TRACK_WIDTH / 2, 0);
  expect(r[6] * RAY_LENGTH).toBeCloseTo(TRACK_WIDTH / 2, 0);
  expect(r[3]).toBeGreaterThan(0.5);
});

test('sensorInputs length and speed term', () => {
  const t = straight(); const s = newVehicleState(t.start); s.speed = CAR.maxSpeed / 2;
  const x = sensorInputs(s, CAR, t); expect(x).toHaveLength(INPUT_SIZE); expect(x[7]).toBeCloseTo(0.5);
});

test('rays: offset toward left wall shortens the +90 (left) ray, not the right one', () => {
  const t = straight(); const s = newVehicleState(t.start);
  s.pos = { x: s.pos.x - Math.sin(s.heading) * 4, y: s.pos.y + Math.cos(s.heading) * 4 }; // 4 m to the left
  const r = castRays(s, t);
  expect(r[6]).toBeLessThan(r[0]);
  expect(r[6] * RAY_LENGTH).toBeCloseTo(TRACK_WIDTH / 2 - 4, 0);
  expect(r[0] * RAY_LENGTH).toBeCloseTo(TRACK_WIDTH / 2 + 4, 0);
  // rotated heading: facing +y on the bottom straight, the wall dead ahead is ~7 m away
  s.pos = { ...t.start.pos }; s.heading = t.start.heading + Math.PI / 2;
  expect(castRays(s, t)[3] * RAY_LENGTH).toBeCloseTo(TRACK_WIDTH / 2, 0);
});

test('a ray that hits nothing returns exactly 1', () => {
  const t = straight(); const s = newVehicleState(t.start);
  s.pos = { x: 500, y: 0 }; s.heading = 0; // middle of a 1000 m straight; forward wall is far away
  expect(castRays(s, t)[3]).toBe(1);
});

// Reference: test every wall segment, no grid.
function bruteRays(s: ReturnType<typeof newVehicleState>, t: ReturnType<typeof straight>): number[] {
  return RAY_ANGLES.map((deg) => {
    const h = s.heading + (deg * Math.PI) / 180;
    const end = { x: s.pos.x + Math.cos(h) * RAY_LENGTH, y: s.pos.y + Math.sin(h) * RAY_LENGTH };
    let best = 1;
    for (const w of [t.inner, t.outer]) for (let i = 0; i < w.length; i++) {
      const hit = segmentIntersect(s.pos, end, w[i], w[(i + 1) % w.length]);
      if (hit && hit.t < best) best = hit.t;
    }
    return best;
  });
}

test('castRays matches brute force over all walls along DEFAULT_TRACK', () => {
  const t = buildTrack(DEFAULT_TRACK);
  let checked = 0;
  for (let i = 0; i < t.center.length; i += 25) {
    const c = t.center[i], nx = t.center[(i + 1) % t.center.length];
    const base = Math.atan2(nx.y - c.y, nx.x - c.x);
    for (const off of [-4, 0, 4]) for (const jitter of [-0.5, 0, 0.7]) {
      const s = newVehicleState(t.start);
      s.heading = base + jitter;
      s.pos = { x: c.x - Math.sin(base) * off, y: c.y + Math.cos(base) * off };
      const got = castRays(s, t), want = bruteRays(s, t);
      got.forEach((v, k) => expect(Math.abs(v - want[k])).toBeLessThan(1e-9));
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(50);
});

test('wallSegmentsNear returns every segment within radius and none from the far wall', () => {
  const t = straight(); const p = t.start.pos, radius = 10;
  const got = new Set([...wallSegmentsNear(t, p, radius)].map(([a, b]) => `${a.x},${a.y},${b.x},${b.y}`));
  let within = 0;
  for (const w of [t.inner, t.outer]) for (let i = 0; i < w.length; i++) {
    const a = w[i], b = w[(i + 1) % w.length];
    if (distToSegment(p, a, b) <= radius) { within++; expect(got.has(`${a.x},${a.y},${b.x},${b.y}`)).toBe(true); }
  }
  expect(within).toBeGreaterThan(0);
  // the loop is 400 m tall: segments of the opposite straight (400 m away in y) must be absent
  for (const [a, b] of wallSegmentsNear(t, p, radius)) expect(Math.abs(a.y - p.y)).toBeLessThan(100);
});

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}
