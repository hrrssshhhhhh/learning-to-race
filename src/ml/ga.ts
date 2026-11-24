import { gaussian, type Rng } from '../sim/rng';
import { cloneBrain, type Brain } from './nn';

export interface GAParams { eliteCount: number; tournamentSize: number; mutationRate: number; mutationStd: number }
export const DEFAULT_GA: GAParams = { eliteCount: 5, tournamentSize: 4, mutationRate: 0.1, mutationStd: 0.3 };

/** Tournament: sample k at random, best wins. Favours good brains but weak ones still get a chance,
 *  which keeps diversity (pure "top N only" converges too early). Tuning k tunes selection pressure. */
function tournament(order: number[], fitness: number[], k: number, rng: Rng): number {
  let best = order[Math.floor(rng() * order.length)];
  for (let i = 1; i < k; i++) {
    const c = order[Math.floor(rng() * order.length)];
    if (fitness[c] > fitness[best]) best = c;
  }
  return best;
}

export function nextGeneration(brains: Brain[], fitness: number[], rng: Rng, p: GAParams = DEFAULT_GA): Brain[] {
  if (brains.length !== fitness.length) throw new Error(`nextGeneration: ${brains.length} brains vs ${fitness.length} fitness values`);
  const n = brains.length;
  const order = brains.map((_, i) => i).sort((a, b) => fitness[b] - fitness[a]);

  // Elitism: copy the best unchanged so the best score can never regress between generations.
  const next: Brain[] = order.slice(0, Math.min(p.eliteCount, n)).map(i => cloneBrain(brains[i]));

  while (next.length < n) {
    const a = brains[tournament(order, fitness, p.tournamentSize, rng)];
    const b = brains[tournament(order, fitness, p.tournamentSize, rng)];
    const child = cloneBrain(a);
    for (let i = 0; i < child.weights.length; i++) {
      // Uniform crossover: each weight from a random parent. Weights are one flat array, so this
      // needs no knowledge of layer structure and mixes parents finely.
      if (rng() < 0.5) child.weights[i] = b.weights[i];
      // Gaussian mutation: mostly small nudges (local search), rare larger jumps; rate keeps most weights intact.
      if (rng() < p.mutationRate) child.weights[i] += gaussian(rng) * p.mutationStd;
    }
    next.push(child);
  }
  return next;
}
