/**
 * Headless pre-training: writes public/brains/specialist-{car,bike}.json (evolved on the default track only).
 *   npm run pretrain            train both kinds in parallel (one process each, ~2 min), then --check
 *   npm run pretrain -- --check completion rates of the shipped files on the default track and 10 random tracks
 * (A generalist trained on random tracks was planned and dropped on 2026-11-25 to keep pre-training short.)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { World, POP_SIZE, fitness } from '../src/sim/world';
import { buildTrack, type Track } from '../src/sim/track';
import { DEFAULT_TRACK } from '../src/sim/defaultTrack';
import { randomTrack } from '../src/sim/trackgen';
import { makeRng } from '../src/sim/rng';
import type { VehicleKind } from '../src/sim/vehicle';
import { LAYERS, createBrain, type Brain } from '../src/ml/nn';
import { nextGeneration } from '../src/ml/ga';
import { fromFile, toFile } from '../src/storage/brains';

const OUT = 'public/brains';
const KINDS: VehicleKind[] = ['car', 'bike'];
// Best fitness plateaus within ~20 generations on the default track (measured), so 30 is enough.
const GENS = 30;
const heldOut = (i: number) => buildTrack(randomTrack(makeRng(i)));

/** One attempt of the whole population on a track, no evolution. */
function attempt(track: Track, kind: VehicleKind, brains: Brain[]): World {
  const w = new World(track, { kinds: [kind], seed: 0, frozen: true, initialBrains: { [kind]: brains } });
  while (!w.isAttemptOver(w.populations[0])) w.step();
  return w;
}

function train(name: string, kind: VehicleKind, gens: number, trackFor: (gen: number) => Track): Brain[] {
  const rng = makeRng(kind === 'car' ? 11 : 22);
  let brains = Array.from({ length: POP_SIZE }, () => createBrain(LAYERS, rng));
  for (let g = 0; g < gens; g++) {
    const track = trackFor(g), w = attempt(track, kind, brains), vs = w.populations[0].vehicles;
    const fit = vs.map((v) => fitness(v, track));
    if (g % 10 === 0 || g === gens - 1) {
      const best = Math.max(...fit), avg = fit.reduce((a, b) => a + b, 0) / fit.length, fin = vs.filter((v) => v.laps >= 1).length;
      console.log(`${name} ${kind} gen ${g}: best ${best.toFixed(1)} avg ${avg.toFixed(1)} finishers ${fin}/${vs.length}`);
    }
    brains = nextGeneration(brains, fit, rng);
  }
  return brains;
}

function check(): void {
  for (const kind of KINDS) {
    const b = fromFile(JSON.parse(readFileSync(`${OUT}/specialist-${kind}.json`, 'utf8')));
    if (!b) throw new Error(`specialist-${kind}.json is invalid`);
    const rate = (t: Track) => { const w = attempt(t, kind, b); return w.completionRate(w.populations[0]); };
    const rates = Array.from({ length: 10 }, (_, i) => rate(heldOut(i)));
    const mean = rates.reduce((a, r) => a + r, 0) / rates.length;
    console.log(`specialist ${kind}: default track ${(100 * rate(buildTrack(DEFAULT_TRACK))).toFixed(0)}% | unseen mean ${(100 * mean).toFixed(0)}%, per track ${rates.map((r) => (100 * r).toFixed(0)).join(' ')}`);
  }
}

/** One training job per kind, each in its own process so they use separate cores. */
function job(kind: VehicleKind): void {
  const def = buildTrack(DEFAULT_TRACK);
  writeFileSync(`${OUT}/specialist-${kind}.json`, JSON.stringify(toFile(kind, train('specialist', kind, GENS, () => def))));
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1]; };
if (process.argv.includes('--check')) check();
else if (arg('--job')) job(arg('--job') as VehicleKind);
else {
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now(), self = fileURLToPath(import.meta.url);
  const codes = await Promise.all(KINDS.map((j) => new Promise<number>((done) =>
    spawn(process.execPath, [...process.execArgv, self, '--job', j], { stdio: 'inherit' }).on('exit', (c) => done(c ?? 1)))));
  if (codes.some((c) => c !== 0)) { console.error('a training job failed'); process.exit(1); }
  console.log(`trained in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  check();
}
