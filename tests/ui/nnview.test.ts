import { activations } from '../../src/ui/nnview';
import { LAYERS, createBrain, forward } from '../../src/ml/nn';
import { makeRng } from '../../src/sim/rng';

test('activations: last layer equals forward(), one array per layer', () => {
  const rng = makeRng(7), b = createBrain(LAYERS, rng);
  const input = Array.from({ length: LAYERS[0] }, () => rng() * 2 - 1);
  const acts = activations(b, input);
  expect(acts.map((a) => a.length)).toEqual(LAYERS);
  forward(b, input).forEach((o, i) => expect(acts[acts.length - 1][i]).toBeCloseTo(o, 6));
});
