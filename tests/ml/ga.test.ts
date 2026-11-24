import { createBrain, forward, LAYERS, type Brain } from '../../src/ml/nn';
import { makeRng } from '../../src/sim/rng';
import { nextGeneration } from '../../src/ml/ga';

const pop = (n: number, seed = 1) => { const r = makeRng(seed); return Array.from({ length: n }, () => createBrain(LAYERS, r)); };

test('keeps population size', () => { const p = pop(100); expect(nextGeneration(p, p.map((_, i) => i), makeRng(2))).toHaveLength(100); });
test('elite survive unchanged', () => {
  const p = pop(100); const f = p.map((_, i) => i); const next = nextGeneration(p, f, makeRng(2));
  expect(next.some(b => b.weights.every((w, i) => w === p[99].weights[i]))).toBe(true);
});
test('evolves toward a target output', () => {
  // fitness = -(forward(x)[0] - 0.7)^2; after 60 gens best should be close
  let p = pop(60); const r = makeRng(3); const x = new Array(8).fill(0.3);
  const fit = (b: Brain) => -((forward(b, x)[0] - 0.7) ** 2);
  for (let g = 0; g < 60; g++) p = nextGeneration(p, p.map(fit), r);
  expect(Math.max(...p.map(fit))).toBeGreaterThan(-0.001);
});
test('deterministic for same seed', () => {
  const p = pop(20); const f = p.map((_, i) => i);
  expect(nextGeneration(p, f, makeRng(9))[10].weights).toEqual(nextGeneration(p, f, makeRng(9))[10].weights);
});
test('throws on length mismatch and does not mutate inputs', () => {
  const p = pop(10);
  expect(() => nextGeneration(p, [1, 2], makeRng(1))).toThrow();
  const before = p.map(b => Array.from(b.weights));
  nextGeneration(p, p.map((_, i) => i), makeRng(1));
  expect(p.map(b => Array.from(b.weights))).toEqual(before);
});
