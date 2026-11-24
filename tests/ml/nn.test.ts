import { makeRng } from '../../src/sim/rng';
import { LAYERS, createBrain, forward, cloneBrain, weightCount, type Brain } from '../../src/ml/nn';

test('weightCount', () => expect(weightCount([8, 10, 2])).toBe(8 * 10 + 10 + 10 * 2 + 2));
test('forward output shape and range', () => {
  const b = createBrain(LAYERS, makeRng(1)); const y = forward(b, new Array(8).fill(0.5));
  expect(y).toHaveLength(2); for (const v of y) { expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1); }
});
test('known weights give known output', () => {
  const b: Brain = { layers: [1, 1], weights: new Float32Array([2, 0.5]) }; // w=2, bias=0.5
  expect(forward(b, [1])[0]).toBeCloseTo(Math.tanh(2.5));
});
test('clone is independent', () => {
  const a = createBrain(LAYERS, makeRng(1)); const c = cloneBrain(a); c.weights[0] += 1;
  expect(c.weights[0]).not.toBe(a.weights[0]);
});
test('forward throws on wrong input length', () => {
  const b = createBrain(LAYERS, makeRng(1));
  expect(() => forward(b, [1, 2, 3])).toThrow();
});
test('2-layer-deep known weights prove packing order', () => {
  // layer 1 (2->2): W=[[1,2],[3,4]] row-major by output, biases [0.1,0.2]
  // layer 2 (2->1): W=[[0.5,-0.5]], bias [0.3]
  const b: Brain = {
    layers: [2, 2, 1],
    weights: new Float32Array([1, 2, 3, 4, 0.1, 0.2, 0.5, -0.5, 0.3]),
  };
  const x = [0.5, -1];
  const h0 = Math.tanh(1 * 0.5 + 2 * -1 + 0.1);
  const h1 = Math.tanh(3 * 0.5 + 4 * -1 + 0.2);
  expect(forward(b, x)[0]).toBeCloseTo(Math.tanh(0.5 * h0 - 0.5 * h1 + 0.3), 5);
});
test('createBrain is deterministic per seed and biases start at 0', () => {
  const a = createBrain(LAYERS, makeRng(7)), b = createBrain(LAYERS, makeRng(7));
  expect(Array.from(a.weights)).toEqual(Array.from(b.weights));
  for (let o = 0; o < 10; o++) expect(a.weights[8 * 10 + o]).toBe(0); // layer-1 biases
  for (let o = 0; o < 2; o++) expect(a.weights[8 * 10 + 10 + 10 * 2 + o]).toBe(0); // layer-2 biases
});
test('forward works for a wider brain after a narrower one (buffers grow)', () => {
  const small: Brain = { layers: [1, 1], weights: new Float32Array([1, 0]) };
  forward(small, [1]);
  const big = createBrain([3, 12, 1], makeRng(2));
  expect(forward(big, [1, 1, 1])).toHaveLength(1);
});
