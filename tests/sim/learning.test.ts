import { World } from '../../src/sim/world';
import { buildTrack } from '../../src/sim/track';
import { DEFAULT_TRACK } from '../../src/sim/defaultTrack';
import { randomTrack } from '../../src/sim/trackgen';
import { makeRng } from '../../src/sim/rng';

// The project's success criteria, measured in simulated (not wall-clock) seconds.
test('default track: first lap from random brains within 120 sim seconds', () => {
  const w = new World(buildTrack(DEFAULT_TRACK), { kinds: ['car', 'bike'], seed: 1 });
  while (w.totalSimSeconds < 120 && w.populations.every(p => p.firstLapGeneration === null)) w.step();
  expect(w.populations.some(p => p.firstLapGeneration !== null)).toBe(true);
}, 120_000);
test('5 random tracks: first lap within 300 sim seconds each', () => {
  for (let s = 0; s < 5; s++) {
    const w = new World(buildTrack(randomTrack(makeRng(100 + s))), { kinds: ['car', 'bike'], seed: s });
    while (w.totalSimSeconds < 300 && w.populations.every(p => p.firstLapGeneration === null)) w.step();
    expect(w.populations.some(p => p.firstLapGeneration !== null)).toBe(true);
  }
}, 300_000);
