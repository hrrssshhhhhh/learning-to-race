/**
 * Small, dependency-free statistics for the experiments: summaries, seeded bootstrap confidence intervals,
 * and two rank tests (normal approximation with tie correction, two-sided). Good for n >= ~10 per group,
 * which every experiment here has.
 */
import { makeRng, type Rng } from './sim/rng';

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, error < 1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Percentile bootstrap CI of `stat` over one sample (or over paired differences: pass the differences). */
export function bootstrapCI(xs: number[], stat: (s: number[]) => number = mean, opts: { B?: number; alpha?: number; rng?: Rng } = {}): [number, number] {
  const { B = 4000, alpha = 0.05, rng = makeRng(12345) } = opts, n = xs.length, out = new Float64Array(B), s = new Array<number>(n);
  for (let b = 0; b < B; b++) { for (let i = 0; i < n; i++) s[i] = xs[Math.floor(rng() * n)]; out[b] = stat(s); }
  out.sort();
  return [out[Math.floor((alpha / 2) * B)], out[Math.min(B - 1, Math.ceil((1 - alpha / 2) * B) - 1)]];
}

/** Average ranks (1-based), ties share their mean rank. Also returns the tie-correction term sum(t^3 - t). */
function ranks(xs: number[]): { r: number[]; ties: number } {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]), r = new Array<number>(xs.length);
  let ties = 0;
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1, t = j - i + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    ties += t ** 3 - t; i = j + 1;
  }
  return { r, ties };
}

/** Mann-Whitney U for two independent samples. Returns U for `a` and a two-sided p-value. */
export function mannWhitney(a: number[], b: number[]): { U: number; p: number } {
  const n1 = a.length, n2 = b.length, N = n1 + n2, { r, ties } = ranks([...a, ...b]);
  const R1 = r.slice(0, n1).reduce((s, v) => s + v, 0), U = R1 - (n1 * (n1 + 1)) / 2, mu = (n1 * n2) / 2;
  const sd = Math.sqrt(((n1 * n2) / 12) * (N + 1 - ties / (N * (N - 1))));
  if (!sd) return { U, p: 1 };
  const z = (Math.abs(U - mu) - 0.5) / sd; // continuity correction
  return { U, p: Math.min(1, 2 * (1 - normCdf(Math.max(0, z)))) };
}

/** Wilcoxon signed-rank for paired samples (zero differences dropped). Returns W+ and a two-sided p-value. */
export function wilcoxon(a: number[], b: number[]): { W: number; n: number; p: number } {
  const d = a.map((v, i) => v - b[i]).filter((v) => v !== 0), n = d.length;
  if (!n) return { W: 0, n, p: 1 };
  const { r, ties } = ranks(d.map(Math.abs)), W = d.reduce((s, v, i) => s + (v > 0 ? r[i] : 0), 0);
  const mu = (n * (n + 1)) / 4, sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - ties / 48);
  if (!sd) return { W, n, p: 1 };
  const z = (Math.abs(W - mu) - 0.5) / sd;
  return { W, n, p: Math.min(1, 2 * (1 - normCdf(Math.max(0, z)))) };
}

/** "p = 0.012" / "p < 0.001", the way results are usually reported. */
export const fmtP = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
