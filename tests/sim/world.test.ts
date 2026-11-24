import { World, fitness, advanceCheckpoints, DT, STALL_SECONDS } from '../../src/sim/world';
import { buildTrack } from '../../src/sim/track';
import { DEFAULT_TRACK } from '../../src/sim/defaultTrack';
import { CAR, newVehicleState, stepVehicle } from '../../src/sim/vehicle';
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
test('checkpoint crossings count only in the forward direction (no back-and-forth farming)', () => {
  const tr = buildTrack(DEFAULT_TRACK); const c = tr.checkpoints[1];
  const m = { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 };
  const ex = c.a.x - c.b.x, ey = c.a.y - c.b.y, L = Math.hypot(ex, ey), f = { x: ey / L, y: -ex / L }; // track forward
  const behind = { x: m.x - f.x, y: m.y - f.y }, ahead = { x: m.x + f.x, y: m.y + f.y };
  const mk = () => { const v = newVehicleState(tr.start); v.nextCheckpoint = 1; return v; };
  const back = mk(); back.pos = { ...behind }; advanceCheckpoints(back, ahead, tr);
  expect(back.checkpointsPassed).toBe(0);
  const fwd = mk(); fwd.pos = { ...ahead }; advanceCheckpoints(fwd, behind, tr);
  expect(fwd.checkpointsPassed).toBe(1);
  const osc = mk();
  for (let i = 0; i < 5; i++) { osc.pos = { ...behind }; advanceCheckpoints(osc, ahead, tr); osc.pos = { ...ahead }; advanceCheckpoints(osc, behind, tr); }
  expect(osc.checkpointsPassed).toBe(1);
});
