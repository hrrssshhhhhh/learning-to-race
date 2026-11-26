import { normCdf, bootstrapCI, mannWhitney, wilcoxon, median, mean } from '../src/stats';

test('normCdf matches known values', () => {
  expect(normCdf(0)).toBeCloseTo(0.5, 6);
  expect(normCdf(1.959964)).toBeCloseTo(0.975, 4);
  expect(normCdf(-1)).toBeCloseTo(0.158655, 4);
});
test('median and mean', () => {
  expect(median([3, 1, 2])).toBe(2); expect(median([4, 1, 3, 2])).toBe(2.5); expect(mean([1, 2, 3, 6])).toBe(3);
});
test('bootstrap CI brackets the mean and is reproducible', () => {
  const xs = Array.from({ length: 40 }, (_, i) => i % 10);
  const [lo, hi] = bootstrapCI(xs);
  expect(lo).toBeLessThan(mean(xs)); expect(hi).toBeGreaterThan(mean(xs));
  expect(bootstrapCI(xs)).toEqual([lo, hi]);
});
// Reference values worked by hand (normal approximation, continuity and tie correction).
test('Mann-Whitney U: clearly shifted samples are significant, identical ones are not', () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], b = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const r = mannWhitney(a, b);
  expect(r.U).toBe(0); expect(r.p).toBeCloseTo(0.000183, 4);
  expect(mannWhitney(a, a).p).toBeCloseTo(1, 6);
});
test('Wilcoxon signed-rank on paired data', () => {
  const a = [125, 115, 130, 140, 140, 115, 140, 125, 140, 135], b = [110, 122, 125, 120, 140, 124, 123, 137, 135, 145];
  const r = wilcoxon(a, b); // W+ = 27, n = 9 (one zero dropped), z = 0.474, p = 0.635
  expect(r.n).toBe(9); expect(r.W).toBe(27); expect(r.p).toBeCloseTo(0.634, 2);
  expect(wilcoxon([1, 2], [1, 2]).p).toBe(1);
});
