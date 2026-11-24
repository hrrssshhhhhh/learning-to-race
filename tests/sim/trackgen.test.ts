import { randomTrack, fallbackTrack } from '../../src/sim/trackgen';
import { validateTrack } from '../../src/sim/track';
import { makeRng } from '../../src/sim/rng';

test('100 seeds all produce valid tracks', () => {
  for (let s = 0; s < 100; s++) expect(validateTrack(randomTrack(makeRng(s)))).toEqual({ ok: true });
});
test('same seed same track', () => expect(randomTrack(makeRng(5))).toEqual(randomTrack(makeRng(5))));
test('tracks vary', () => expect(randomTrack(makeRng(1))).not.toEqual(randomTrack(makeRng(2))));
test('fallback ellipse is valid', () => {
  for (let s = 0; s < 20; s++) expect(validateTrack(fallbackTrack(makeRng(s)))).toEqual({ ok: true });
});
