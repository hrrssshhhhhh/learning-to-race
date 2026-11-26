/**
 * Headless experiments behind the Results page. Writes public/results/experiments.json.
 *   npm run experiments          all three, one process each (they are independent)
 *   npm run experiments -- --job exp1|exp2|exp3   one experiment, prints its JSON to stdout
 * Every run is seeded, so the numbers are reproducible. Generations are reported 1-based, like the app.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { World, POP_SIZE } from '../src/sim/world';
import { buildTrack, type Track } from '../src/sim/track';
import { randomTrack } from '../src/sim/trackgen';
import { makeRng } from '../src/sim/rng';
import type { VehicleKind } from '../src/sim/vehicle';
import type { Vec2 } from '../src/sim/vec';
import { LAYERS, createBrain, type Brain } from '../src/ml/nn';
import { fromFile } from '../src/storage/brains';

const OUT = 'public/results/experiments.json';
const KINDS: VehicleKind[] = ['car', 'bike'];
const GEN_CAP = 60; // a run that has not lapped by then counts as "did not lap" (null)
const loadFile = (name: string, kind: VehicleKind): Brain[] => {
  const b = fromFile(JSON.parse(readFileSync(`public/brains/${name}-${kind}.json`, 'utf8')));
  if (!b) throw new Error(`${name}-${kind}.json is invalid (run npm run pretrain)`);
  return b;
};
const track = (seed: number) => buildTrack(randomTrack(makeRng(seed)));

/** One frozen attempt (same definition as the app's Test mode): share of the population that completes a lap. */
function completion(t: Track, kind: VehicleKind, brains: Brain[]): number {
  const w = new World(t, { kinds: [kind], seed: 0, frozen: true, initialBrains: { [kind]: brains } });
  const p = w.populations[0];
  while (!w.isAttemptOver(p)) w.step();
  return w.completionRate(p);
}

/** Evolves until someone laps; returns the world (1-based first-lap generation via firstLap()). */
function evolveToLap(t: Track, kind: VehicleKind, seed: number, brains?: Brain[], extraGens = 0): World {
  const w = new World(t, { kinds: [kind], seed, maxGenerations: Infinity, initialBrains: brains && { [kind]: brains } });
  const p = w.populations[0];
  while (p.firstLapGeneration === null && p.generation < GEN_CAP) w.step();
  const stop = p.generation + extraGens;
  while (p.firstLapGeneration !== null && p.generation < stop) w.step();
  return w;
}
const firstLap = (w: World) => { const g = w.populations[0].firstLapGeneration; return g === null ? null : g + 1; };

/** Exp 1: the shipped pre-trained population vs random brains, 50 tracks neither has seen (pre-training used only the default track). */
function exp1() {
  const tracks = 50, out: Record<string, Record<VehicleKind, number[]>> = { pretrained: { car: [], bike: [] }, fresh: { car: [], bike: [] } };
  for (const kind of KINDS) {
    const pre = loadFile('specialist', kind);
    for (let i = 0; i < tracks; i++) {
      const t = track(i), rng = makeRng(1000 + i);
      out.pretrained[kind].push(completion(t, kind, pre));
      out.fresh[kind].push(completion(t, kind, Array.from({ length: POP_SIZE }, () => createBrain(LAYERS, rng))));
    }
  }
  return { tracks, ...out };
}

/** Exp 2: generations to a first lap from random brains, cars vs bikes, same 20 tracks and seeds. */
function exp2() {
  const tracks = 20, out: Record<VehicleKind, (number | null)[]> = { car: [], bike: [] };
  for (const kind of KINDS) for (let i = 0; i < tracks; i++) out[kind].push(firstLap(evolveToLap(track(100 + i), kind, 100 + i)));
  return { tracks, cap: GEN_CAP, ...out };
}

/** Indices of centerline samples, and each sample's radius over a ~12 m chord (same rule the kerbs use). */
function radii(c: Vec2[]): number[] {
  const n = c.length;
  return c.map((b, i) => {
    const a = c[(i + n - 3) % n], d = c[(i + 3) % n];
    const k = Math.abs((b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x));
    return k < 1e-9 ? Infinity : (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(d.x - b.x, d.y - b.y) * Math.hypot(d.x - a.x, d.y - a.y)) / (2 * k);
  });
}
const CORNER_R = 40; // m: tighter than this counts as a corner

/** Corners as runs of tight samples: [start, end] index ranges plus their tightest radius. */
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

/**
 * Exp 3: transfer. Evolve on track A until the first lap + 20 generations, then move that population to track B,
 * against random brains on B. On B's first generation with the transferred brains, count wall contacts per corner,
 * and mark corners tighter than anything on A (the hypothesis: those are the ones that still cause scrapes).
 */
function exp3() {
  const pairs = 20, fresh: (number | null)[] = [], transfer: (number | null)[] = [];
  const cornerStats: { radius: number; scrapes: number; crashes: number; tighterThanA: boolean }[] = [];
  for (let i = 0; i < pairs; i++) {
    const A = track(500 + i), B = track(600 + i);
    const trained = evolveToLap(A, 'car', 500 + i, undefined, 20).populations[0].brains;
    fresh.push(firstLap(evolveToLap(B, 'car', 600 + i)));
    transfer.push(firstLap(evolveToLap(B, 'car', 600 + i, trained)));

    const tightestA = Math.min(...corners(A.center).map((c) => c.radius));
    const cs = corners(B.center).map((c) => ({ ...c, scrapes: 0, crashes: 0 }));
    const owner = new Int32Array(B.center.length).fill(-1);
    cs.forEach((c, k) => { for (let j = c.from; ; j = (j + 1) % B.center.length) { owner[j] = k; if (j === c.to) break; } });
    const w = new World(B, { kinds: ['car'], seed: 0, frozen: true, initialBrains: { car: trained } });
    while (!w.isAttemptOver(w.populations[0])) {
      for (const e of w.step()) {
        let best = 0, bd = Infinity; // nearest centerline sample
        B.center.forEach((p, j) => { const d = (p.x - e.pos.x) ** 2 + (p.y - e.pos.y) ** 2; if (d < bd) { bd = d; best = j; } });
        const k = owner[best];
        if (k >= 0) cs[k][e.kind === 'crash' ? 'crashes' : 'scrapes']++;
      }
    }
    for (const c of cs) cornerStats.push({ radius: +c.radius.toFixed(1), scrapes: c.scrapes, crashes: c.crashes, tighterThanA: c.radius < tightestA });
  }
  return { pairs, cap: GEN_CAP, extraGensOnA: 20, cornerRadius: CORNER_R, fresh, transfer, corners: cornerStats };
}

const JOBS = { exp1, exp2, exp3 };
const arg = (k: string) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1]; };
const job = arg('--job') as keyof typeof JOBS | undefined;
if (job) process.stdout.write(JSON.stringify(JOBS[job]()));
else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = Date.now(), self = fileURLToPath(import.meta.url);
  const results = await Promise.all(Object.keys(JOBS).map((j) => new Promise<[string, unknown]>((done, fail) => {
    let out = '';
    const p = spawn(process.execPath, [...process.execArgv, self, '--job', j], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', (c) => (c === 0 ? done([j, JSON.parse(out)]) : fail(new Error(`${j} failed`))));
  })));
  mkdirSync('public/results', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), ...Object.fromEntries(results) }, null, 1));
  console.log(`wrote ${OUT} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
