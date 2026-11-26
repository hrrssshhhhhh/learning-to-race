import { cornerInputs } from '../../src/ui/heroDeck';
import { INPUT_SIZE } from '../../src/sim/sensors';

test('cornerInputs looks like real sensor input: right size, all in 0..1', () => {
  for (let t = 0; t < 30; t += 0.37) {
    const v = cornerInputs(t);
    expect(v).toHaveLength(INPUT_SIZE);
    for (const x of v) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
  }
});
