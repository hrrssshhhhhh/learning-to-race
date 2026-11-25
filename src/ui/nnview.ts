import type { Brain } from '../ml/nn';
import { RAY_ANGLES } from '../sim/sensors';
import { fitCanvas } from './chart';

const IN_LABELS = [...RAY_ANGLES.map((d) => `ray ${d > 0 ? '+' : ''}${d}°`), 'speed'];
const OUT_LABELS = ['steer', 'throttle'];

/** Every layer's activations. Mirrors forward() in ml/nn.ts, which only returns the output layer. */
export function activations(b: Brain, input: number[]): number[][] {
  const acts = [input.slice()];
  let k = 0;
  for (let l = 1; l < b.layers.length; l++) {
    const nIn = b.layers[l - 1], nOut = b.layers[l], prev = acts[l - 1], cur: number[] = [];
    for (let o = 0; o < nOut; o++) {
      let sum = b.weights[k + nIn * nOut + o];
      for (let i = 0; i < nIn; i++) sum += b.weights[k + o * nIn + i] * prev[i];
      cur.push(Math.tanh(sum));
    }
    acts.push(cur);
    k += nIn * nOut + nOut;
  }
  return acts;
}

// positive = green, negative = red; brightness = magnitude (so it does not rely on hue alone)
const tint = (v: number, a: number) => (v >= 0 ? `rgba(110,231,160,${a})` : `rgba(255,107,107,${a})`);

/** Live diagram: nodes filled by activation, edges coloured by weight sign, thickness/opacity by magnitude. */
export function drawNN(canvas: HTMLCanvasElement, brain: Brain, input: number[]): void {
  const { c, w, h } = fitCanvas(canvas);
  const acts = activations(brain, input), L = brain.layers;
  const left = 64, right = 80, x = (l: number) => left + (l * (w - left - right)) / (L.length - 1);
  const y = (l: number, i: number) => 10 + ((i + 0.5) * (h - 20)) / L[l];
  let k = 0;
  for (let l = 1; l < L.length; l++) {
    const nIn = L[l - 1], nOut = L[l];
    for (let o = 0; o < nOut; o++) for (let i = 0; i < nIn; i++) {
      const wt = brain.weights[k + o * nIn + i], m = Math.min(1, Math.abs(wt));
      c.strokeStyle = tint(wt, 0.08 + 0.5 * m * Math.abs(acts[l - 1][i])); // edges carrying signal light up
      c.lineWidth = 0.5 + 1.5 * m;
      c.beginPath(); c.moveTo(x(l - 1), y(l - 1, i)); c.lineTo(x(l), y(l, o)); c.stroke();
    }
    k += nIn * nOut + nOut;
  }
  c.font = '10px system-ui, sans-serif'; c.textBaseline = 'middle';
  L.forEach((n, l) => {
    for (let i = 0; i < n; i++) {
      const a = acts[l][i];
      c.beginPath(); c.arc(x(l), y(l, i), 5, 0, Math.PI * 2);
      c.fillStyle = '#0f1115'; c.fill();
      c.fillStyle = tint(a, 0.15 + 0.85 * Math.min(1, Math.abs(a))); c.fill();
      c.strokeStyle = '#5a6070'; c.lineWidth = 1; c.stroke();
    }
  });
  c.fillStyle = '#c3c7d1';
  c.textAlign = 'right'; IN_LABELS.forEach((t, i) => c.fillText(t, x(0) - 9, y(0, i)));
  c.textAlign = 'left'; OUT_LABELS.forEach((t, i) => c.fillText(`${t} ${acts[L.length - 1][i].toFixed(2)}`, x(L.length - 1) + 9, y(L.length - 1, i)));
}
