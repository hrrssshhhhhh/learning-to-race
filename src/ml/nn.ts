import { gaussian, type Rng } from '../sim/rng';

/** 8 sensor inputs (7 rays + speed) -> 10 hidden -> [steer, throttle]. */
export const LAYERS = [8, 10, 2];

/**
 * Weight packing (one flat array so the GA can mutate/crossover it directly).
 * Layers are stored in order. For a layer with `in` inputs and `out` outputs
 * starting at `offset` (0 for the first layer):
 *   weight(output o, input i) = weights[offset + o*in + i]   (row-major by output)
 *   bias(output o)            = weights[offset + out*in + o]
 *   next layer's offset       = offset + out*in + out
 */
export interface Brain { layers: number[]; weights: Float32Array }

export function weightCount(layers: number[]): number {
  let n = 0;
  for (let l = 1; l < layers.length; l++) n += layers[l] * layers[l - 1] + layers[l];
  return n;
}

export function createBrain(layers: number[], rng: Rng): Brain {
  const weights = new Float32Array(weightCount(layers));
  let k = 0;
  for (let l = 1; l < layers.length; l++) {
    const nIn = layers[l - 1], nOut = layers[l];
    // Scale by 1/sqrt(fan-in): keeps each neuron's pre-activation ~unit variance,
    // so tanh starts in its sloped region instead of saturating at +-1.
    const scale = 1 / Math.sqrt(nIn);
    for (let j = 0; j < nIn * nOut; j++) weights[k++] = gaussian(rng) * scale;
    k += nOut; // biases stay 0 (Float32Array is zero-filled)
  }
  return { layers: layers.slice(), weights };
}

// Scratch activations reused across calls so forward() only allocates its result.
// Two buffers ping-pong (a layer never reads and writes the same one); grown lazily.
let bufA = new Float64Array(0), bufB = new Float64Array(0);

export function forward(b: Brain, input: number[]): number[] {
  const { layers, weights } = b;
  if (input.length !== layers[0]) throw new Error(`forward: expected ${layers[0]} inputs, got ${input.length}`);
  for (let l = 0; l < layers.length; l++) {
    if (bufA.length < layers[l]) { bufA = new Float64Array(layers[l]); bufB = new Float64Array(layers[l]); }
  }

  let cur = bufA, next = bufB;
  for (let i = 0; i < input.length; i++) cur[i] = input[i];
  let k = 0;
  for (let l = 1; l < layers.length; l++) {
    const nIn = layers[l - 1], nOut = layers[l];
    for (let o = 0; o < nOut; o++) {
      let sum = 0;
      for (let i = 0; i < nIn; i++) sum += weights[k + o * nIn + i] * cur[i];
      // tanh on every layer: smooth, zero-centred, bounds outputs to [-1,1],
      // exactly the range steer and throttle need.
      next[o] = Math.tanh(sum + weights[k + nIn * nOut + o]);
    }
    k += nIn * nOut + nOut;
    [cur, next] = [next, cur];
  }
  const out = new Array<number>(layers[layers.length - 1]);
  for (let o = 0; o < out.length; o++) out[o] = cur[o];
  return out;
}

export function cloneBrain(b: Brain): Brain {
  return { layers: b.layers.slice(), weights: new Float32Array(b.weights) };
}
