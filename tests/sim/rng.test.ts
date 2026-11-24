import { makeRng, gaussian } from '../../src/sim/rng';

test('same seed gives same sequence', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 100; i++) expect(a()).toBe(b());
});
test('values in [0,1)', () => {
  const r = makeRng(1);
  for (let i = 0; i < 10000; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
});
test('gaussian mean≈0 sd≈1', () => {
  const r = makeRng(7); const xs = Array.from({ length: 20000 }, () => gaussian(r));
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
  expect(Math.abs(m)).toBeLessThan(0.05); expect(Math.abs(sd - 1)).toBeLessThan(0.05);
});
