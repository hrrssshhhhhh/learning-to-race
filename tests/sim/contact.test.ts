import { buildTrack, TRACK_WIDTH, type Track } from '../../src/sim/track';
import { newVehicleState, CAR, BIKE } from '../../src/sim/vehicle';
import { resolveWallContact, DAMAGE_LIMIT } from '../../src/sim/contact';
import { add, scale } from '../../src/sim/vec';

const t = () => buildTrack([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }]);
function nearWall(track: Track, angleDeg: number, speed: number, off = TRACK_WIDTH / 2 - 0.2) {
  const s = newVehicleState(track.start); const n = { x: -Math.sin(s.heading), y: Math.cos(s.heading) };
  s.pos = add(s.pos, scale(n, off)); s.heading += angleDeg * Math.PI / 180; s.speed = speed; return s;
}
test('shallow contact scrapes: alive, slower, damaged, back inside', () => {
  const tr = t(); const s = nearWall(tr, 10, 30);
  const ev = resolveWallContact(s, CAR, tr)!;
  expect(ev.kind).toBe('scrape'); expect(s.alive).toBe(true);
  expect(s.speed).toBeLessThan(30); expect(s.damage).toBeGreaterThan(0);
  expect(resolveWallContact(s, CAR, tr)).toBeNull();
});
test('head-on contact crashes', () => {
  const tr = t(); const s = nearWall(tr, 80, 30);
  expect(resolveWallContact(s, CAR, tr)!.kind).toBe('crash'); expect(s.alive).toBe(false);
});
test('repeated scrapes reach damage limit', () => {
  const tr = t(); const s = nearWall(tr, 20, 20);
  for (let i = 0; i < 50 && s.alive; i++) { resolveWallContact(s, CAR, tr); s.pos = add(s.pos, scale({ x: -Math.sin(s.heading), y: Math.cos(s.heading) }, 0.5)); s.heading += 20 * Math.PI / 180; s.speed = 20; }
  expect(s.alive).toBe(false); expect(s.damage).toBeGreaterThanOrEqual(DAMAGE_LIMIT);
});
test('no contact in middle of track', () => {
  const tr = t(); expect(resolveWallContact(newVehicleState(tr.start), CAR, tr)).toBeNull();
});
test('dead vehicle: null and untouched', () => {
  const tr = t(); const s = nearWall(tr, 10, 30); s.alive = false;
  const before = { ...s, pos: { ...s.pos } };
  expect(resolveWallContact(s, CAR, tr)).toBeNull(); expect(s).toEqual(before);
});
test('bike (narrower) does not touch where a car does, but scrapes closer in', () => {
  const tr = t();
  // 6.0 m from centre = 1.0 m from wall: car radius 1.25 touches, bike 0.7 does not.
  expect(resolveWallContact(nearWall(tr, 10, 30, 6.0), CAR, tr)?.kind).toBe('scrape');
  expect(resolveWallContact(nearWall(tr, 10, 30, 6.0), BIKE, tr)).toBeNull();
  const s = nearWall(tr, 10, 30, 6.5); const ev = resolveWallContact(s, BIKE, tr)!;
  expect(ev.kind).toBe('scrape'); expect(ev.vehicleKind).toBe('bike');
});
test('event intensity: scrape in [0,1], crash exactly 1, heading follows wall, still forward', () => {
  const tr = t(); const s = nearWall(tr, 10, 30);
  const ev = resolveWallContact(s, CAR, tr)!;
  expect(ev.intensity).toBeGreaterThanOrEqual(0); expect(ev.intensity).toBeLessThanOrEqual(1);
  expect(s.heading).toBeCloseTo(tr.start.heading, 2);
  expect(resolveWallContact(nearWall(tr, 80, 30), CAR, tr)!.intensity).toBe(1);
});
test('overlapping but heading away from the wall is not a crash', () => {
  const tr = t(); const s = nearWall(tr, -60, 30); // inner wall on the left, turned 60 deg to the right = leaving it
  const ev = resolveWallContact(s, CAR, tr)!;
  expect(ev.kind).toBe('scrape'); expect(s.alive).toBe(true); expect(s.damage).toBe(0);
  expect(resolveWallContact(s, CAR, tr)).toBeNull();
});
test('near-stationary steep touch is a scrape, not a crash', () => {
  const tr = t(); const s = nearWall(tr, 60, 1);
  expect(resolveWallContact(s, CAR, tr)!.kind).toBe('scrape'); expect(s.alive).toBe(true);
});
