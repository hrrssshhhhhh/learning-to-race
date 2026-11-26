/**
 * Headless experiments behind the Results page. Writes public/results/experiments.json (raw per-run data;
 * the page and the report compute their statistics from it with src/stats.ts).
 *   npm run experiments              every unit, WORKERS processes at a time (~15 min on 8 cores)
 *   npm run experiments -- --unit X  one unit (e.g. exp2:car:7), prints its JSON to stdout
 * All experiments use HARD tracks (experiments only, the app keeps NORMAL ones). Every run is seeded, so the
 * numbers are reproducible. Generations are 1-based, like the app. A run that misses a milestone within GEN_CAP
 * generations is recorded as null (censored) and ranked after every run that made it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { World, POP_SIZE } from '../src/sim/world';
import { buildTrack, type Track } from '../src/sim/track';
import { randomTrack, HARD } from '../src/sim/trackgen';
import { makeRng } from '../src/sim/rng';
import type { VehicleKind } from '../src/sim/vehicle';
import type { Vec2 } from '../src/sim/vec';
import { LAYERS, createBrain, type Brain } from '../src/ml/nn';
import { fromFile } from '../src/storage/brains';

const OUT = 'public/results/experiments.json';
const WORKERS = 8; // ~150 MB each; more than this ran the machine short of memory
const KINDS: VehicleKind[] = ['car', 'bike'];
const GEN_CAP = 40;
const HALF = POP_SIZE / 2; // "the population has learned the track" = half of it completes a lap in one generation
const EXTRA = 10; // generations of extra training after that, before a population is moved or tested
const N = { exp1: 50, exp2: 30, exp3: 20, exp4: 10, unseen: 10 };
// Ablation: which rays the network sees (indices into sensorInputs: rays at -90,-60,-30,0,30,60,90 deg, then speed)
const SENSORS: Record<string, number[] | undefined> = { '3': [0, 3, 6, 7], '5': [0, 2, 3, 4, 6, 7], '7': undefined };

const loadFile = (name: string, kind: VehicleKind): Brain[] => {
  const b = fromFile(JSON.parse(readFileSync(`public/brains/${name}-${kind}.json`, 'utf8')));
  if (!b) throw new Error(`${name}-${kind}.json is invalid (run npm run pretrain)`);
  return b;
};
const track = (seed: number) => buildTrack(randomTrack(makeRng(seed), HARD));

/** One frozen attempt (same definition as the app's Test mode): share of the population that completes a lap. */
function completion(t: Track, kind: VehicleKind, brains: Brain[], inputs?: number[]): number {
  const w = new World(t, { kinds: [kind], seed: 0, frozen: true, initialBrains: { [kind]: brains }, inputs });
  const p = w.populations[0];
  while (!w.isAttemptOver(p)) w.step();
  return w.completionRate(p);
}

interface Run { first: number | null; half: number | null; brains: Brain[] }
/** Evolves until half the population laps (or GEN_CAP), then `extra` more generations. Records both milestones. */
function evolve(t: Track, kind: VehicleKind, seed: number, o: { brains?: Brain[]; inputs?: number[]; extra?: number } = {}): Run {
  const w = new World(t, { kinds: [kind], seed, maxGenerations: Infinity, initialBrains: o.brains && { [kind]: o.brains }, inputs: o.inputs });
  const p = w.populations[0];
  let half: number | null = null;
  while (half === null && p.generation < GEN_CAP) {
    const g = p.generation;
    w.step();
    if (p.generation !== g && p.history.at(-1)!.finishers >= HALF) half = g + 1;
  }
  const stop = p.generation + (half === null ? 0 : o.extra ?? 0);
  while (p.generation < stop) w.step();
  return { first: p.firstLapGeneration === null ? null : p.firstLapGeneration + 1, half, brains: p.brains };
}

/** Each centerline sample's radius over a ~12 m chord (same rule the kerbs use). */
function radii(c: Vec2[]): number[] {
  const n = c.length;
  return c.map((b, i) => {
    const a = c[(i + n - 3) % n], d = c[(i + 3) % n];
    const k = Math.abs((b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x));
    return k < 1e-9 ? Infinity : (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(d.x - b.x, d.y - b.y) * Math.hypot(d.x - a.x, d.y - a.y)) / (2 * k);
  });
}
const CORNER_R = 40; // m: tighter than this counts as a corner

/** Corners as runs of tight samples: [from, to] index ranges plus their tightest radius. */
export function corners(c: Vec2[]): { from: number; to: number; radius: number }[] {
  const r = radii(c), n = c.length, out: { from: number; to: number; radius: number }[] = [];
  const s0 = r.findIndex((v) => v >= CORNER_R); // start scanning on a straight so no corner is split at index 0
  if (s0 < 0) return [{ from: 0, to: n - 1, radius: Math.min(...r) }];
  for (let k = 0; k < n; k++) {
    const i = (s0 + k) % n;
    if (r[i] >= CORNER_R) continue;
    const last = out[out.length - 1];
    if (last && (last.to + 1) % n === i) { last.to = i; last.radius = Math.min(last.radius, r[i]); }
    else out.push({ from: i, to: i, radius: r[i] });
  }
  return out;
}

/** Wall contacts per corner of `B` during one frozen attempt; corners tighter than anything on `A` are flagged. */
function cornerContacts(A: Track, B: Track, brains: Brain[]) {
  const tightestA = Math.min(...corners(A.center).map((c) => c.radius));
  const cs = corners(B.center).map((c) => ({ ...c, scrapes: 0, crashes: 0 }));
  const owner = new Int32Array(B.center.length).fill(-1);
  cs.forEach((c, k) => { for (let j = c.from; ; j = (j + 1) % B.center.length) { owner[j] = k; if (j === c.to) break; } });
  const w = new World(B, { kinds: ['car'], seed: 0, frozen: true, initialBrains: { car: brains } });
  while (!w.isAttemptOver(w.populations[0])) {
    for (const e of w.step()) {
      let best = 0, bd = Infinity; // nearest centerline sample
      B.center.forEach((p, j) => { const d = (p.x - e.pos.x) ** 2 + (p.y - e.pos.y) ** 2; if (d < bd) { bd = d; best = j; } });
      const k = owner[best];
      if (k >= 0) cs[k][e.kind === 'crash' ? 'crashes' : 'scrapes']++;
    }
  }
  return cs.map((c) => ({ radius: +c.radius.toFixed(1), scrapes: c.scrapes, crashes: c.crashes, tighterThanA: c.radius < tightestA }));
}

const milestones = (r: Run) => ({ first: r.first, half: r.half });

/** One unit of work: small enough that WORKERS of them keep every core busy. */
function unit(id: string): unknown {
  const [exp, a, b] = id.split(':'), i = Number(b ?? a);
  switch (exp) {
    case 'exp1': { // pre-trained (default track only) vs random brains, one attempt on an unseen hard track
      const kind = a as VehicleKind, t = track(i), rng = makeRng(1000 + i);
      return { pre: completion(t, kind, loadFile('specialist', kind)), fresh: completion(t, kind, Array.from({ length: POP_SIZE }, () => createBrain(LAYERS, rng))) };
    }
    case 'exp2': return milestones(evolve(track(100 + i), a as VehicleKind, 100 + i)); // cars vs bikes, same tracks and seeds
    case 'exp3': { // transfer: learn A (half + EXTRA generations), then B from there vs from scratch
      const A = track(500 + i), B = track(600 + i), trained = evolve(A, 'car', 500 + i, { extra: EXTRA }).brains;
      return { fresh: milestones(evolve(B, 'car', 600 + i)), transfer: milestones(evolve(B, 'car', 600 + i, { brains: trained })), corners: cornerContacts(A, B, trained) };
    }
    case 'exp4': { // sensor ablation: learn one track, then one attempt on each of N.unseen unseen tracks
      const inputs = SENSORS[a], run = evolve(track(700 + i), 'car', 700 + i, { inputs, extra: EXTRA });
      const unseen = Array.from({ length: N.unseen }, (_, k) => completion(track(800 + k), 'car', run.brains, inputs));
      return { ...milestones(run), unseen: unseen.reduce((s, v) => s + v, 0) / unseen.length };
    }
  }
  throw new Error(`unknown unit ${id}`);
}

function units(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < N.exp3; i++) ids.push(`exp3:${i}`); // longest first, so the pool ends evenly
  for (const s of Object.keys(SENSORS)) for (let i = 0; i < N.exp4; i++) ids.push(`exp4:${s}:${i}`);
  for (const k of KINDS) for (let i = 0; i < N.exp2; i++) ids.push(`exp2:${k}:${i}`);
  for (const k of KINDS) for (let i = 0; i < N.exp1; i++) ids.push(`exp1:${k}:${i}`);
  return ids;
}

function assemble(r: Map<string, any>) {
  const col = <T>(prefix: string, n: number, f: (x: any) => T) => Array.from({ length: n }, (_, i) => f(r.get(`${prefix}:${i}`)));
  return {
    generated: new Date().toISOString().slice(0, 10),
    setup: { tracks: 'hard', population: POP_SIZE, half: HALF, genCap: GEN_CAP, extraGens: EXTRA, cornerRadius: CORNER_R, unseenTracks: N.unseen },
    exp1: { tracks: N.exp1, pretrained: Object.fromEntries(KINDS.map((k) => [k, col(`exp1:${k}`, N.exp1, (x) => x.pre)])),
      fresh: Object.fromEntries(KINDS.map((k) => [k, col(`exp1:${k}`, N.exp1, (x) => x.fresh)])) },
    exp2: { tracks: N.exp2, ...Object.fromEntries(KINDS.map((k) => [k, col(`exp2:${k}`, N.exp2, (x) => x)])) },
    exp3: { pairs: N.exp3, fresh: col('exp3', N.exp3, (x) => x.fresh), transfer: col('exp3', N.exp3, (x) => x.transfer),
      corners: Array.from({ length: N.exp3 }, (_, i) => r.get(`exp3:${i}`).corners).flat() },
    exp4: { seeds: N.exp4, configs: Object.fromEntries(Object.keys(SENSORS).map((s) => [s, col(`exp4:${s}`, N.exp4, (x) => x)])) },
  };
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1]; };
const one = arg('--unit');
if (one) process.stdout.write(JSON.stringify(unit(one)));
else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = Date.now(), self = fileURLToPath(import.meta.url), queue = units(), results = new Map<string, unknown>();
  const total = queue.length;
  const run = (id: string) => new Promise<void>((done, fail) => {
    let out = '';
    const p = spawn(process.execPath, [...process.execArgv, self, '--unit', id], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', (c) => {
      if (c !== 0) return fail(new Error(`${id} failed`));
      results.set(id, JSON.parse(out));
      if (results.size % 20 === 0 || results.size === total) console.log(`${results.size}/${total} units, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
      done();
    });
  });
  await Promise.all(Array.from({ length: WORKERS }, async () => { while (queue.length) await run(queue.shift()!); }));
  mkdirSync('public/results', { recursive: true });
  writeFileSync(OUT, JSON.stringify(assemble(results), null, 1));
  console.log(`wrote ${OUT} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
