import { gaussian, type Rng } from '../sim/rng';

/** 7 ray distances + speed in -> hidden -> [steer, throttle]. */
export const LAYERS = [8, 10, 2];

/**
 * All weights and biases live in ONE flat array, so the genetic algorithm can
 * crossover/mutate a brain as a plain list of numbers.
 * Layout per layer: out*in weights (row per output neuron), then out biases.
 */
export interface Brain { layers: number[]; weights: Float32Array }

export function weightCount(layers: number[]): number {
  let n = 0;
  for (let l = 1; l < layers.length; l++) n += layers[l] * layers[l - 1] + layers[l];
  return n;
}

export function createBrain(layers: number[], rng: Rng): Brain {
  const weights = new Float32Array(weightCount(layers));
  let i = 0;
  for (let l = 1; l < layers.length; l++) {
    const nIn = layers[l - 1], nOut = layers[l];
    // Scale by 1/sqrt(inputs) so a neuron's sum stays near 0: tanh then starts in
    // its responsive range instead of saturated at +-1 (where changes do nothing).
    const scale = 1 / Math.sqrt(nIn);
    for (let k = 0; k < nIn * nOut; k++) weights[i++] = gaussian(rng) * scale;
    i += nOut; // biases start at 0 (Float32Array is zero-filled)
  }
  return { layers: layers.slice(), weights };
}

export function forward(b: Brain, input: number[]): number[] {
  if (input.length !== b.layers[0]) throw new Error(`expected ${b.layers[0]} inputs, got ${input.length}`);
  let act = input;
  let i = 0;
  for (let l = 1; l < b.layers.length; l++) {
    const nIn = b.layers[l - 1], nOut = b.layers[l];
    const out = new Array<number>(nOut);
    for (let o = 0; o < nOut; o++) {
      let sum = 0;
      for (let k = 0; k < nIn; k++) sum += b.weights[i + o * nIn + k] * act[k];
      sum += b.weights[i + nIn * nOut + o]; // bias
      // tanh squashes to (-1,1): matches steer range, and adds the nonlinearity
      // that lets the net do more than a straight-line mapping.
      out[o] = Math.tanh(sum);
    }
    i += nIn * nOut + nOut;
    act = out;
  }
  return act;
}

export function cloneBrain(b: Brain): Brain {
  return { layers: b.layers.slice(), weights: b.weights.slice() };
}
