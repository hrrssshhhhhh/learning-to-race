import { randomTrack, fallbackTrack, curvatureRadii } from '../../src/sim/trackgen';
import { validateTrack, buildTrack } from '../../src/sim/track';
import { makeRng } from '../../src/sim/rng';

const seeds = Array.from({ length: 100 }, (_, s) => s);
const tracks = seeds.map(s => randomTrack(makeRng(s)));
const built = tracks.map(buildTrack);
const radii = built.map(t => curvatureRadii(t.center));
// longest run (m) of consecutive samples with radius > 300, wrapping around the loop
function longestStraight(r: number[]): number {
  const n = r.length;
  let best = 0, run = 0;
  for (let i = 0; i < 2 * n; i++) { run = r[i % n] > 300 ? run + 1 : 0; best = Math.max(best, Math.min(run, n)); }
  return best * 2; // samples are ~2 m apart
}

test('100 seeds all produce valid tracks', () => {
  for (const t of tracks) expect(validateTrack(t)).toEqual({ ok: true });
});
test('same seed same track', () => expect(randomTrack(makeRng(5))).toEqual(randomTrack(makeRng(5))));
test('all 100 seeds give distinct tracks', () => {
  expect(new Set(tracks.map(t => JSON.stringify(t))).size).toBe(100);
  expect(new Set(built.map(t => Math.round(t.length))).size).toBeGreaterThan(95);
});
test('fallback ellipse is valid', () => {
  for (let s = 0; s < 20; s++) expect(validateTrack(fallbackTrack(makeRng(s)))).toEqual({ ok: true });
});
test('variety: hairpins, straights, length spread, no corner under 12 m', () => {
  const hairpin = radii.filter(r => Math.min(...r) <= 25).length;
  const straight = radii.filter(r => longestStraight(r) >= 150).length;
  const lens = built.map(t => t.length);
  console.log('STATS hairpin%', hairpin, 'straight%', straight, 'len', Math.min(...lens), Math.max(...lens), 'minR', Math.min(...radii.map(r => Math.min(...r))));
  expect(hairpin).toBeGreaterThanOrEqual(30);
  expect(straight).toBeGreaterThanOrEqual(50);
  expect(Math.max(...lens) / Math.min(...lens)).toBeGreaterThanOrEqual(2);
  for (const r of radii) expect(Math.min(...r)).toBeGreaterThanOrEqual(12);
});
