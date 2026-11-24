import { World, fitness, advanceCheckpoints, DT, STALL_SECONDS } from '../../src/sim/world';
import { buildTrack } from '../../src/sim/track';
import { DEFAULT_TRACK } from '../../src/sim/defaultTrack';
import { CAR, stepVehicle } from '../../src/sim/vehicle';
import { createBrain, LAYERS } from '../../src/ml/nn';
import { makeRng } from '../../src/sim/rng';

test('generation advances when all vehicles die', () => {
  const w = new World(buildTrack(DEFAULT_TRACK), { kinds: ['car'], seed: 1 });
  const p = w.populations[0]; p.vehicles.forEach(v => (v.alive = false));
  w.step(); expect(p.generation).toBe(1); expect(p.history).toHaveLength(1);
  expect(p.vehicles.every(v => v.alive)).toBe(true);
});
test('reversing through a checkpoint earns no progress', () => {
  const tr = buildTrack(DEFAULT_TRACK); const w = new World(tr, { kinds: ['car'], seed: 1 });
  const v = w.populations[0].vehicles[0]; v.heading += Math.PI; v.speed = 20;
  const before = fitness(v, tr);
  for (let i = 0; i < 120; i++) { const prev = { ...v.pos }; stepVehicle(v, CAR, { steer: 0, throttle: 1 }, DT); advanceCheckpoints(v, prev, tr); }
  expect(v.checkpointsPassed).toBe(0); expect(fitness(v, tr)).toBeLessThanOrEqual(before + 1e-9);
});
test('stalled vehicle is removed', () => {
  const w = new World(buildTrack(DEFAULT_TRACK), { kinds: ['car'], seed: 1 });
  const v = w.populations[0].vehicles[0]; v.ticksSinceProgress = STALL_SECONDS / DT + 1;
  w.step(); expect(v.alive).toBe(false);
});
test('frozen population never evolves and reports completion rate', () => {
  const brains = Array.from({ length: 10 }, (_, i) => createBrain(LAYERS, makeRng(i)));
  const w = new World(buildTrack(DEFAULT_TRACK), { kinds: [], seed: 1, contenders: [{ label: 'x', kind: 'car', brains }], frozen: true });
  const p = w.populations[0];
  for (let i = 0; i < 100000 && !w.isAttemptOver(p); i++) w.step();
  expect(p.generation).toBe(0); expect(w.completionRate(p)).toBeGreaterThanOrEqual(0); expect(w.completionRate(p)).toBeLessThanOrEqual(1);
});
