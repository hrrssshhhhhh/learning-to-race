import { buildTrack, TRACK_WIDTH } from '../../src/sim/track';
import { newVehicleState, CAR } from '../../src/sim/vehicle';
import { castRays, sensorInputs, wallSegmentsNear, RAY_LENGTH, INPUT_SIZE } from '../../src/sim/sensors';
import { DEFAULT_TRACK } from '../../src/sim/defaultTrack';
import { dist } from '../../src/sim/vec';

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

test('wallSegmentsNear returns nearby wall segments only', () => {
  const t = straight(); const p = t.start.pos;
  const segs = [...wallSegmentsNear(t, p, 10)];
  expect(segs.length).toBeGreaterThan(0);
  // every returned segment lies in a grid cell near p, so none can be on the far side of the track
  for (const [a] of segs) expect(dist(a, p)).toBeLessThan(10 + 60);
  // the loop is 400 m tall: the opposite straight must be absent
  expect(segs.every(([a]) => Math.abs(a.y - p.y) < 100)).toBe(true);
});

test('timing on default track', () => {
  const t = buildTrack(DEFAULT_TRACK); const s = newVehicleState(t.start);
  const N = 20000, t0 = performance.now();
  for (let i = 0; i < N; i++) castRays(s, t);
  console.log('castRays us/call', ((performance.now() - t0) * 1000 / N).toFixed(2));
});
