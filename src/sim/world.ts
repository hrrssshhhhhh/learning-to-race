import type { Vec2 } from './vec';
import { segmentIntersect } from './vec';
import type { Track } from './track';
import { makeRng, type Rng } from './rng';
import { SPECS, newVehicleState, stepVehicle, type Controls, type VehicleKind, type VehicleState } from './vehicle';
import { sensorInputs } from './sensors';
import { resolveWallContact, type ContactEvent } from './contact';
import { LAYERS, createBrain, forward, type Brain } from '../ml/nn';
import { nextGeneration } from '../ml/ga';

export const DT = 1 / 60; // fixed timestep: results never depend on frame rate
// Tuned in Task 9 (was 4): 2 s per ~10 m checkpoint = must average 5 m/s. Kills crawlers sooner, so a generation
// ends when its real leaders are done. Measured with the other final values: default track lapped within 120 s
// for 20/20 GA seeds at 2 s vs 17/20 at 4 s.
// Final Task 9 tuning set: STALL_SECONDS 2, DEFAULT_GA {elite 5, tournament 20, rate 0.3, std 0.3},
// steerAtSpeedFactor car 0.7 / bike 0.45, RAY_LENGTH 40, contact thresholds unchanged (see each file for why).
export const STALL_SECONDS = 2;
export const MAX_GEN_SECONDS = 90; // cap so one good-but-endless circler cannot freeze evolution
export const POP_SIZE = 100;
// Default stop point, user-adjustable. Best fitness plateaus within ~20 generations on the default track
// (measured for scripts/pretrain.ts), so 30 leaves headroom for harder drawn tracks.
export const MAX_GENERATIONS = 30;

export interface GenStats { generation: number; bestFitness: number; avgFitness: number; finishers: number; bestLapTicks: number | null }

export class Population {
  vehicles: VehicleState[];
  generation = 0;
  history: GenStats[] = [];
  firstLapGeneration: number | null = null;
  recorded = false; // the finished generation's stats are in history (it is waiting at the generation limit)
  genTicks = 0; // ticks since this generation (or frozen attempt) started
  constructor(public kind: VehicleKind, public brains: Brain[], public label: string, public frozen: boolean, track: Track) {
    this.vehicles = brains.map(() => startVehicle(track));
  }
}

export interface WorldOptions {
  kinds: VehicleKind[]; seed: number; initialBrains?: Partial<Record<VehicleKind, Brain[]>>; frozen?: boolean;
  contenders?: { label: string; kind: VehicleKind; brains: Brain[] }[]; maxGenerations?: number;
  /** Ablation: which sensor inputs the network sees (indices into sensorInputs). Default: all of them. */
  inputs?: number[];
}

/** The start line IS checkpoint 0, so the first target is checkpoint 1; checkpoint 0 is only crossed to finish a lap. */
function startVehicle(track: Track): VehicleState {
  const v = newVehicleState(track.start);
  v.nextCheckpoint = 1 % track.checkpoints.length;
  return v;
}

const mid = (track: Track, i: number): Vec2 => {
  const c = track.checkpoints[i];
  return { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 };
};

/** 0..1: how far from the previous checkpoint towards the next one. Gives the GA a smooth gradient between gates. */
export function progressToNext(s: VehicleState, track: Track): number {
  const n = track.checkpoints.length;
  const to = mid(track, s.nextCheckpoint), from = mid(track, (s.nextCheckpoint + n - 1) % n);
  const span = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const left = Math.hypot(to.x - s.pos.x, to.y - s.pos.y);
  return Math.min(1, Math.max(0, 1 - left / span));
}

/**
 * Fitness = gates passed + partial progress (distance along the track),
 * minus damage (so clean driving beats scraping along the wall),
 * plus a lap-time bonus that only lappers get (so evolution keeps getting faster once laps happen).
 * Must stay finite: the GA sorts by it and NaN breaks the sort.
 */
export function fitness(s: VehicleState, track: Track): number {
  const lap = s.bestLapTicks ? 2000 / (s.bestLapTicks * DT) : 0;
  const f = s.checkpointsPassed + progressToNext(s, track) - 3 * s.damage + lap;
  return Number.isFinite(f) ? f : 0;
}

/**
 * Counts a crossing of the NEXT checkpoint only, and only when moving forward through it.
 * Without the direction check a car could farm fitness by wiggling back and forth over a gate.
 */
export function advanceCheckpoints(v: VehicleState, prevPos: Vec2, track: Track): void {
  const n = track.checkpoints.length, cp = track.checkpoints[v.nextCheckpoint];
  if (!segmentIntersect(prevPos, v.pos, cp.a, cp.b)) return;
  // a = inner (left) wall, b = outer (right); forward is (a - b) rotated -90 degrees.
  const ex = cp.a.x - cp.b.x, ey = cp.a.y - cp.b.y;
  if ((v.pos.x - prevPos.x) * ey - (v.pos.y - prevPos.y) * ex <= 0) return;
  v.checkpointsPassed++;
  v.ticksSinceProgress = 0;
  if (v.nextCheckpoint === 0) {
    v.laps++;
    const lapTicks = v.ticks - v.lapStartTick;
    if (v.bestLapTicks === null || lapTicks < v.bestLapTicks) v.bestLapTicks = lapTicks;
    if (v.firstLapTick === null) v.firstLapTick = v.ticks;
    v.lapStartTick = v.ticks;
  }
  v.nextCheckpoint = (v.nextCheckpoint + 1) % n;
}

export class World {
  populations: Population[] = [];
  tick = 0;
  maxGenerations: number; // editable mid-run: raising it resumes a stopped population
  private inputs?: number[];
  private rng: Rng;
  // Reused every vehicle step. sensorInputs and forward still return fresh arrays (their APIs); the rest is allocation-free.
  private prev: Vec2 = { x: 0, y: 0 };
  private controls: Controls = { steer: 0, throttle: 0 };

  constructor(public track: Track, opts: WorldOptions) {
    this.rng = makeRng(opts.seed);
    this.maxGenerations = opts.maxGenerations ?? MAX_GENERATIONS;
    this.inputs = opts.inputs;
    const layers = opts.inputs ? [opts.inputs.length, ...LAYERS.slice(1)] : LAYERS;
    const frozen = opts.frozen ?? false;
    if (opts.contenders) {
      for (const c of opts.contenders) this.populations.push(new Population(c.kind, c.brains, c.label, frozen, track));
    } else {
      for (const kind of opts.kinds) {
        const brains = opts.initialBrains?.[kind] ?? Array.from({ length: POP_SIZE }, () => createBrain(layers, this.rng));
        this.populations.push(new Population(kind, brains, kind, frozen, track));
      }
    }
  }

  get totalSimSeconds(): number { return this.tick * DT; }

  step(): ContactEvent[] {
    const events: ContactEvent[] = [];
    for (const pop of this.populations) {
      if (this.isAttemptOver(pop)) {
        if (pop.frozen) continue; // one attempt only, then stand still
        if (!pop.recorded) this.record(pop);
        if (pop.generation + 1 >= this.maxGenerations) continue; // limit reached: stand still
        this.breed(pop);
      }
      const spec = SPECS[pop.kind];
      for (let i = 0; i < pop.vehicles.length; i++) {
        const v = pop.vehicles[i];
        if (!v.alive) continue;
        const all = sensorInputs(v, spec, this.track);
        const out = forward(pop.brains[i], this.inputs ? this.inputs.map((k) => all[k]) : all);
        this.prev.x = v.pos.x; this.prev.y = v.pos.y;
        this.controls.steer = out[0]; this.controls.throttle = out[1];
        stepVehicle(v, spec, this.controls, DT);
        const ev = resolveWallContact(v, spec, this.track);
        if (ev) events.push(ev);
        v.ticks++;
        v.ticksSinceProgress++;
        if (v.alive) advanceCheckpoints(v, this.prev, this.track);
        if (v.laps > 0 && pop.firstLapGeneration === null) pop.firstLapGeneration = pop.generation;
        if (v.ticksSinceProgress > STALL_SECONDS / DT) v.alive = false;
      }
      pop.genTicks++;
    }
    this.tick++;
    return events;
  }

  /** Records the finished generation's stats (once, even while it waits at the generation limit). */
  private record(pop: Population): void {
    const fit = pop.vehicles.map(v => fitness(v, this.track));
    const laps = pop.vehicles.map(v => v.bestLapTicks).filter((t): t is number => t !== null);
    pop.history.push({
      generation: pop.generation, bestFitness: Math.max(...fit), avgFitness: fit.reduce((a, b) => a + b, 0) / fit.length,
      finishers: laps.length, bestLapTicks: laps.length ? Math.min(...laps) : null,
    });
    pop.recorded = true;
  }

  /** Breeds the next generation and puts everyone back on the start line. */
  private breed(pop: Population): void {
    const fit = pop.vehicles.map(v => fitness(v, this.track));
    pop.brains = nextGeneration(pop.brains, fit, this.rng);
    pop.vehicles = pop.brains.map(() => startVehicle(this.track));
    pop.generation++;
    pop.genTicks = 0;
    pop.recorded = false;
  }

  /** Index of the best vehicle by current fitness, preferring the living (camera follows it). */
  leader(pop: Population): number {
    let best = 0, bestF = -Infinity;
    for (let i = 0; i < pop.vehicles.length; i++) {
      const v = pop.vehicles[i], f = fitness(v, this.track) + (v.alive ? 1e6 : 0);
      if (f > bestF) { bestF = f; best = i; }
    }
    return best;
  }

  isAttemptOver(pop: Population): boolean {
    return pop.genTicks >= MAX_GEN_SECONDS / DT || pop.vehicles.every(v => !v.alive);
  }

  completionRate(pop: Population): number {
    return pop.vehicles.length ? pop.vehicles.filter(v => v.laps >= 1).length / pop.vehicles.length : 0;
  }
}
