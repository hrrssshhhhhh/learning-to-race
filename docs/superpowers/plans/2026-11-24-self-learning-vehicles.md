# Self-Learning Vehicles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static website where cars and bikes teach themselves (neuroevolution, from scratch) to drive user-drawn F1-style tracks, shown in a 2D-draw → 3D-race view, with generalization, transfer and scrape-vs-crash features plus a Results page.

**Architecture:** A pure-TypeScript 2D simulation + ML core (`src/sim`, `src/ml`) with no DOM or Three.js imports. It runs both in the browser and headless in Node (`scripts/`) for pre-training and experiments. Renderers (`src/render2d`, `src/render3d`) and UI (`src/ui`, `src/editor`) only read sim state and contact events. Pre-trained populations ship as static JSON in `public/brains/`; experiment results ship as `public/results/experiments.json`.

**Tech Stack:** Vite, TypeScript (strict), Three.js, Vitest, tsx (runs Node scripts). No ML libraries, no UI framework.

**Spec:** `docs/superpowers/specs/2026-11-24-self-learning-vehicles-design.md`

## Global Constraints

- No ML library (no TensorFlow.js, brain.js, synaptic, neataptic). The NN and GA are hand-written in `src/ml/`.
- `src/sim/**` and `src/ml/**` must not import `three`, DOM APIs, `window`, or `localStorage`. They must run under Node.
- All randomness in sim/ml goes through `Rng` from `src/sim/rng.ts` (seeded), so headless runs are reproducible.
- Fixed timestep `DT = 1/60` s. Speed control 1x–10x = run `speed` sim steps per animation frame (never delta-time based).
- Population size `POP_SIZE = 100` per vehicle type; two types: `'car' | 'bike'`.
- Vehicles never collide with each other.
- Static hosting only. No backend, no accounts.
- No external 3D model assets. Vehicle meshes are built in code.
- Default track must reach a first full lap within 120 simulated seconds from random brains (this is the "~2 minutes at default speed" criterion). A valid random track must reach one within 300 simulated seconds at most (the "5 minutes" criterion).
- Target: ~60 fps with 200 vehicles on a mid-range laptop (instanced meshes in 3D).
- NN and GA code stays small and readable, with comments on the *why*. The owner must be able to explain it.

## Review Focus

1. **Junk drawings**: a scribble, a self-crossing loop, a tiny loop, or a hairpin tighter than a vehicle can turn → `validateTrack` rejects it with a reason shown in the editor, and the app never crashes. (Test in Task 2.)
2. **Drawing direction**: a track drawn clockwise and the same track drawn counter-clockwise → both produce valid, correctly ordered checkpoints, and vehicles start facing forward along the track. (Test in Task 2.)
3. **Driving backwards or spinning in place**: a vehicle that reverses through a checkpoint or circles near the start → earns no progress, and the stall timeout removes it. (Test in Task 9.)
4. **Corrupt or stale saved vehicles**: `localStorage` holding invalid JSON, a different layer shape, or an unavailable `localStorage` (private mode) → `loadMyVehicles` returns `null`, and the UI falls back to Fresh with a notice. (Test in Task 15.)
5. **Start on a corner**: a user track whose first drawn point sits mid-corner → the start/finish is placed on the straightest section, so generation 1 isn't wiped out in the first second. (Test in Task 2.)

---

## File Structure

```
index.html                     main app page
results.html                   Results / How it works page
vite.config.ts                 multi-page build (index + results)
src/main.ts                    app wiring: world loop, view switching, controls
src/results.ts                 renders public/results/experiments.json as charts
src/sim/rng.ts                 seeded RNG
src/sim/vec.ts                 Vec2 math + segment intersection
src/sim/track.ts               buildTrack, validateTrack
src/sim/defaultTrack.ts        DEFAULT_TRACK control points
src/sim/trackgen.ts            randomTrack
src/sim/vehicle.ts             VehicleSpec (CAR, BIKE), VehicleState, stepVehicle
src/sim/sensors.ts             castRays, sensorInputs
src/sim/contact.ts             wall contact: scrape / crash / damage
src/sim/world.ts               World, Population, generation loop, fitness, frozen mode
src/ml/nn.ts                   Brain, createBrain, forward
src/ml/ga.ts                   nextGeneration
src/storage/brains.ts          PopulationFile JSON, shipped + localStorage load/save
src/render2d/view2d.ts         Canvas 2D renderer
src/render3d/scene.ts          Three.js scene, track mesh, instanced vehicles
src/render3d/camera.ts         chase / orbit / top-down + 2D→3D swoop
src/render3d/effects.ts        sparks + scrape marks
src/editor/editor.ts           freehand track drawing
src/ui/hud.ts                  stats, damage, celebration
src/ui/chart.ts                fitness-over-generations canvas chart
src/ui/nnview.ts               live NN diagram
src/ui/controls.ts             buttons, speed, starting-point picker, mode switch
scripts/pretrain.ts            trains specialist + generalist → public/brains/*.json
scripts/experiments.ts         runs experiments 1–3 → public/results/experiments.json
tests/**                       Vitest unit tests mirroring src/
```

---

### Task 1: Project scaffold, RNG and vector math

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `results.html`, `.gitignore`, `src/main.ts` (placeholder), `src/results.ts` (placeholder), `src/sim/rng.ts`, `src/sim/vec.ts`
- Test: `tests/sim/rng.test.ts`, `tests/sim/vec.test.ts`

**Interfaces:**
- Produces:
  - `type Rng = () => number` (uniform in [0,1))
  - `makeRng(seed: number): Rng` (mulberry32)
  - `gaussian(rng: Rng): number` (Box–Muller, mean 0, sd 1)
  - `type Vec2 = { x: number; y: number }`
  - `add, sub, scale, dot, cross, len, norm, rotate(v, angle), dist`: plain functions on `Vec2`
  - `segmentIntersect(a1, a2, b1, b2): { t: number; u: number } | null`: `t` and `u` are the parametric positions on each segment

- [ ] **Step 1:** `git init`; `npm init -y`; install `vite typescript three @types/three vitest tsx` as dev deps (three as dep). Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`), `pretrain` (`tsx scripts/pretrain.ts`), `experiments` (`tsx scripts/experiments.ts`). `tsconfig` strict. `vite.config.ts` uses `build.rollupOptions.input` for `index.html` and `results.html`.
- [ ] **Step 2: Write the failing tests**

```ts
// tests/sim/rng.test.ts
test('same seed gives same sequence', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 100; i++) expect(a()).toBe(b());
});
test('values in [0,1)', () => {
  const r = makeRng(1);
  for (let i = 0; i < 10000; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
});
test('gaussian mean≈0 sd≈1', () => {
  const r = makeRng(7); const xs = Array.from({ length: 20000 }, () => gaussian(r));
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
  expect(Math.abs(m)).toBeLessThan(0.05); expect(Math.abs(sd - 1)).toBeLessThan(0.05);
});
// tests/sim/vec.test.ts
test('crossing segments intersect at midpoint', () => {
  const hit = segmentIntersect({x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0});
  expect(hit!.t).toBeCloseTo(0.5); expect(hit!.u).toBeCloseTo(0.5);
});
test('parallel segments do not intersect', () => {
  expect(segmentIntersect({x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1})).toBeNull();
});
test('rotate 90°', () => { const v = rotate({x:1,y:0}, Math.PI/2); expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(1); });
```

- [ ] **Step 3:** Run `npx vitest run tests/sim` → FAIL (modules missing).
- [ ] **Step 4:** Implement `src/sim/rng.ts` and `src/sim/vec.ts`.
- [ ] **Step 5:** Run `npx vitest run tests/sim` → PASS. Run `npm run build` → succeeds.
- [ ] **Step 6:** Commit: `chore: scaffold vite+ts project, rng and vec math`

---

### Task 2: Track model and validation

**Files:**
- Create: `src/sim/track.ts`, `src/sim/defaultTrack.ts`
- Test: `tests/sim/track.test.ts`

**Interfaces:**
- Consumes: `Vec2`, `segmentIntersect`, vec helpers (Task 1)
- Produces:
  - `const TRACK_WIDTH = 14` (meters)
  - `interface Checkpoint { a: Vec2; b: Vec2 }` (segment from inner to outer wall)
  - `interface Track { center: Vec2[]; inner: Vec2[]; outer: Vec2[]; checkpoints: Checkpoint[]; start: { pos: Vec2; heading: number }; length: number; width: number }`. `center[i]`, `inner[i]` and `outer[i]` are index-aligned closed loops (last point ≠ first; wrap implicitly).
  - `type TrackError = 'too-few-points' | 'too-short' | 'too-long' | 'self-intersect' | 'too-tight'`
  - `validateTrack(control: Vec2[]): { ok: true } | { ok: false; reason: TrackError }`
  - `buildTrack(control: Vec2[]): Track` (throws if `validateTrack` fails)
  - `DEFAULT_TRACK: Vec2[]` (control points, meters, ~1.2–1.8 km lap with hairpin, chicane, long straight, fast sweeper)

Approach: closed Catmull-Rom through the control points, resampled to evenly spaced centerline points every ~2 m. Normalize orientation to counter-clockwise (reverse if signed area < 0) so inner is always left. Inner/outer = center ± normal · width/2. Checkpoints every ~10 m of centerline. Rotate the loop so index 0 is the middle of the straightest 40 m window (lowest summed |curvature|); start heading = tangent there. Validation: ≥ 4 control points; length 400–4000 m; no self-intersection of either wall; minimum centerline radius of curvature ≥ 9 m (anything tighter makes the inner wall fold).

- [ ] **Step 1: Write the failing tests**

```ts
const circle = (r: number, n = 24) => Array.from({ length: n }, (_, i) => ({ x: r * Math.cos(2*Math.PI*i/n), y: r * Math.sin(2*Math.PI*i/n) }));
test('default track is valid', () => expect(validateTrack(DEFAULT_TRACK)).toEqual({ ok: true }));
test('rejects too few points', () => expect(validateTrack(circle(100, 3))).toEqual({ ok: false, reason: 'too-few-points' }));
test('rejects tiny loop', () => expect(validateTrack(circle(20))).toEqual({ ok: false, reason: 'too-short' }));
test('rejects figure-eight', () => {
  const eight = Array.from({ length: 32 }, (_, i) => { const t = 2*Math.PI*i/32; return { x: 300*Math.sin(t), y: 150*Math.sin(2*t) }; });
  expect(validateTrack(eight)).toEqual({ ok: false, reason: 'self-intersect' });
});
test('rejects impossibly tight hairpin', () => {
  const pin = [{x:0,y:0},{x:300,y:0},{x:300,y:6},{x:0,y:6}];
  expect(validateTrack(pin).ok).toBe(false);
});
test('clockwise and counter-clockwise give same checkpoint count and forward start', () => {
  const ccw = buildTrack(circle(150)); const cw = buildTrack([...circle(150)].reverse());
  expect(cw.checkpoints.length).toBe(ccw.checkpoints.length);
  for (const t of [ccw, cw]) {
    const fwd = { x: Math.cos(t.start.heading), y: Math.sin(t.start.heading) };
    const toNext = sub(t.center[5], t.center[0]);
    expect(dot(fwd, toNext)).toBeGreaterThan(0);
  }
});
test('start is placed on the straightest section', () => {
  // long straight along y=0 from x=0..600, then a loop back
  const stadium = [{x:0,y:0},{x:600,y:0},{x:700,y:100},{x:600,y:200},{x:0,y:200},{x:-100,y:100}];
  const rotated = [...stadium.slice(2), ...stadium.slice(0, 2)]; // first point mid-corner
  const t = buildTrack(rotated);
  expect(Math.abs(t.start.pos.y - 0) < 20 || Math.abs(t.start.pos.y - 200) < 20).toBe(true);
});
test('walls are width apart', () => {
  const t = buildTrack(DEFAULT_TRACK);
  for (let i = 0; i < t.center.length; i += 50) expect(dist(t.inner[i], t.outer[i])).toBeCloseTo(TRACK_WIDTH, 1);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/sim/track.test.ts` → FAIL.
- [ ] **Step 3:** Implement `validateTrack`, `buildTrack`, `DEFAULT_TRACK`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(sim): track spline, walls, checkpoints, validation`

---

### Task 3: Random track generator

**Files:**
- Create: `src/sim/trackgen.ts`
- Test: `tests/sim/trackgen.test.ts`

**Interfaces:**
- Consumes: `Rng`, `validateTrack` (Tasks 1–2)
- Produces: `randomTrack(rng: Rng): Vec2[]`, which always returns control points that pass `validateTrack`

Approach: 8–14 points at sorted random angles around a center, random radius 150–450 m. Jitter some to make hairpins and chicanes. Retry until `validateTrack` is ok (cap 200 tries, then fall back to a jittered ellipse that is known to be valid).

- [ ] **Step 1: Write the failing tests**

```ts
test('100 seeds all produce valid tracks', () => {
  for (let s = 0; s < 100; s++) expect(validateTrack(randomTrack(makeRng(s)))).toEqual({ ok: true });
});
test('same seed same track', () => expect(randomTrack(makeRng(5))).toEqual(randomTrack(makeRng(5))));
test('tracks vary', () => expect(randomTrack(makeRng(1))).not.toEqual(randomTrack(makeRng(2))));
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(sim): seeded random track generator`

---

### Task 4: Vehicle specs and physics

**Files:**
- Create: `src/sim/vehicle.ts`
- Test: `tests/sim/vehicle.test.ts`

**Interfaces:**
- Consumes: `Vec2` (Task 1)
- Produces:
  - `type VehicleKind = 'car' | 'bike'`
  - `interface VehicleSpec { kind: VehicleKind; length: number; width: number; maxSpeed: number; accel: number; brake: number; maxSteer: number; steerAtSpeedFactor: number; drag: number }`. `steerAtSpeedFactor` is the fraction of `maxSteer` still available at `maxSpeed` (grip proxy).
  - `CAR: VehicleSpec`, `BIKE: VehicleSpec`, `SPECS: Record<VehicleKind, VehicleSpec>`
  - `interface Controls { steer: number; throttle: number }`: both in [-1, 1]; throttle < 0 means brake
  - `interface VehicleState { pos: Vec2; heading: number; speed: number; alive: boolean; damage: number; nextCheckpoint: number; checkpointsPassed: number; laps: number; ticks: number; ticksSinceProgress: number; lapStartTick: number; bestLapTicks: number | null; firstLapTick: number | null }`
  - `newVehicleState(start: { pos: Vec2; heading: number }): VehicleState`
  - `stepVehicle(s: VehicleState, spec: VehicleSpec, c: Controls, dt: number): void`: kinematic bicycle model; speed clamped to [0, maxSpeed]; usable steer = `maxSteer * lerp(1, steerAtSpeedFactor, speed/maxSpeed)`

Pinned difference: `BIKE.accel > CAR.accel`, `BIKE.width < CAR.width`, `BIKE.steerAtSpeedFactor < CAR.steerAtSpeedFactor`. Starting values: CAR `{length 4.5, width 1.9, maxSpeed 55, accel 9, brake 20, maxSteer 0.6, steerAtSpeedFactor 0.35, drag 0.02}`, BIKE `{length 2.1, width 0.8, maxSpeed 55, accel 12, brake 16, maxSteer 0.7, steerAtSpeedFactor 0.2, drag 0.02}`. Tune later in Task 9 / Task 14.

- [ ] **Step 1: Write the failing tests**

```ts
test('throttle accelerates, clamped at maxSpeed', () => {
  const s = newVehicleState({ pos: {x:0,y:0}, heading: 0 });
  for (let i = 0; i < 6000; i++) stepVehicle(s, CAR, { steer: 0, throttle: 1 }, 1/60);
  expect(s.speed).toBeLessThanOrEqual(CAR.maxSpeed); expect(s.speed).toBeGreaterThan(CAR.maxSpeed * 0.8);
  expect(s.pos.x).toBeGreaterThan(0); expect(Math.abs(s.pos.y)).toBeLessThan(1e-6);
});
test('brake never makes speed negative', () => {
  const s = newVehicleState({ pos: {x:0,y:0}, heading: 0 });
  for (let i = 0; i < 600; i++) stepVehicle(s, CAR, { steer: 0, throttle: -1 }, 1/60);
  expect(s.speed).toBe(0);
});
test('positive steer turns left (heading increases)', () => {
  const s = newVehicleState({ pos: {x:0,y:0}, heading: 0 }); s.speed = 10;
  stepVehicle(s, CAR, { steer: 1, throttle: 0 }, 1/60); expect(s.heading).toBeGreaterThan(0);
});
test('bike accelerates faster but turns less at top speed', () => {
  expect(BIKE.accel).toBeGreaterThan(CAR.accel);
  expect(BIKE.width).toBeLessThan(CAR.width);
  expect(BIKE.steerAtSpeedFactor).toBeLessThan(CAR.steerAtSpeedFactor);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(sim): car and bike kinematic physics`

---

### Task 5: Sensors

**Files:**
- Create: `src/sim/sensors.ts`
- Test: `tests/sim/sensors.test.ts`

**Interfaces:**
- Consumes: `Track` (Task 2), `VehicleState`, `VehicleSpec` (Task 4)
- Produces:
  - `RAY_ANGLES = [-90, -60, -30, 0, 30, 60, 90]` (degrees, relative to heading; positive = left)
  - `RAY_LENGTH = 80` (m)
  - `castRays(s: VehicleState, track: Track): number[]`: one value per ray in [0,1] (distance to the nearest wall / `RAY_LENGTH`, 1 = nothing hit)
  - `sensorInputs(s: VehicleState, spec: VehicleSpec, track: Track): number[]`: `[...castRays, s.speed / spec.maxSpeed]`, length `INPUT_SIZE = 8`

Approach: test rays only against wall segments within `RAY_LENGTH` of the vehicle. Use a coarse spatial grid on the `Track` built once (cache in a `WeakMap<Track, Grid>`) so 200 vehicles × 7 rays stays cheap.

- [ ] **Step 1: Write the failing tests**

```ts
const straight = () => buildTrack([{x:0,y:0},{x:1000,y:0},{x:1000,y:400},{x:0,y:400}]);
test('centered vehicle on straight: left/right rays see walls at half width', () => {
  const t = straight(); const s = newVehicleState(t.start);
  const r = castRays(s, t);
  expect(r).toHaveLength(7);
  expect(r[0] * RAY_LENGTH).toBeCloseTo(TRACK_WIDTH / 2, 0);
  expect(r[6] * RAY_LENGTH).toBeCloseTo(TRACK_WIDTH / 2, 0);
  expect(r[3]).toBeGreaterThan(0.5);
});
test('sensorInputs length and speed term', () => {
  const t = straight(); const s = newVehicleState(t.start); s.speed = CAR.maxSpeed / 2;
  const x = sensorInputs(s, CAR, t); expect(x).toHaveLength(INPUT_SIZE); expect(x[7]).toBeCloseTo(0.5);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(sim): ray sensors with spatial grid`

---

### Task 6: Wall contact (scrape vs crash)

**Files:**
- Create: `src/sim/contact.ts`
- Test: `tests/sim/contact.test.ts`

**Interfaces:**
- Consumes: `Track`, `VehicleState`, `VehicleSpec`, vec helpers
- Produces:
  - `interface ContactEvent { kind: 'scrape' | 'crash'; pos: Vec2; intensity: number; vehicleKind: VehicleKind }`. `intensity` is in [0,1].
  - `SCRAPE_MAX_ANGLE = 30` (degrees between heading and wall tangent)
  - `SCRAPE_MAX_NORMAL_SPEED = 8` (m/s into the wall)
  - `DAMAGE_LIMIT = 1`
  - `resolveWallContact(s: VehicleState, spec: VehicleSpec, track: Track): ContactEvent | null`

Rule: if the vehicle body (circle of radius `spec.width/2 + 0.3`) penetrates a wall segment, compute θ = angle between heading and the wall tangent, and `vn = speed · sin θ`. If θ ≤ `SCRAPE_MAX_ANGLE` and `vn` ≤ `SCRAPE_MAX_NORMAL_SPEED`, it's a **scrape**: push the position back out along the wall normal, rotate the heading to the wall tangent (the direction closest to the current heading), `speed *= 0.85`, `damage += 0.08 + 0.25 · vn / SCRAPE_MAX_NORMAL_SPEED`, intensity = `vn / SCRAPE_MAX_NORMAL_SPEED`. If damage ≥ `DAMAGE_LIMIT`, set `alive = false`. Otherwise it's a **crash**: `alive = false`, intensity 1.

- [ ] **Step 1: Write the failing tests**

```ts
const t = () => buildTrack([{x:0,y:0},{x:1000,y:0},{x:1000,y:400},{x:0,y:400}]);
function nearWall(track: Track, angleDeg: number, speed: number) {
  const s = newVehicleState(track.start); const n = { x: -Math.sin(s.heading), y: Math.cos(s.heading) };
  s.pos = add(s.pos, scale(n, TRACK_WIDTH / 2 - 0.2)); s.heading += angleDeg * Math.PI / 180; s.speed = speed; return s;
}
test('shallow contact scrapes: alive, slower, damaged, back inside', () => {
  const tr = t(); const s = nearWall(tr, 10, 30);
  const ev = resolveWallContact(s, CAR, tr)!;
  expect(ev.kind).toBe('scrape'); expect(s.alive).toBe(true);
  expect(s.speed).toBeLessThan(30); expect(s.damage).toBeGreaterThan(0);
  expect(resolveWallContact(s, CAR, tr)).toBeNull();
});
test('head-on contact crashes', () => {
  const tr = t(); const s = nearWall(tr, 80, 30);
  expect(resolveWallContact(s, CAR, tr)!.kind).toBe('crash'); expect(s.alive).toBe(false);
});
test('repeated scrapes reach damage limit', () => {
  const tr = t(); const s = nearWall(tr, 20, 40);
  for (let i = 0; i < 50 && s.alive; i++) { resolveWallContact(s, CAR, tr); s.pos = add(s.pos, scale({ x: -Math.sin(s.heading), y: Math.cos(s.heading) }, 0.5)); s.heading += 20*Math.PI/180; s.speed = 40; }
  expect(s.alive).toBe(false); expect(s.damage).toBeGreaterThanOrEqual(DAMAGE_LIMIT);
});
test('no contact in middle of track', () => {
  const tr = t(); expect(resolveWallContact(newVehicleState(tr.start), CAR, tr)).toBeNull();
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (reuse the Task 5 spatial grid). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(sim): scrape vs crash wall contact with damage`

---

### Task 7: Neural network

**Files:**
- Create: `src/ml/nn.ts`
- Test: `tests/ml/nn.test.ts`

**Interfaces:**
- Consumes: `Rng`, `gaussian` (Task 1)
- Produces:
  - `LAYERS = [8, 10, 2]` (INPUT_SIZE → hidden → [steer, throttle])
  - `interface Brain { layers: number[]; weights: Float32Array }`: weights and biases packed layer by layer (per layer: `out × in` weights, then `out` biases)
  - `weightCount(layers: number[]): number`
  - `createBrain(layers: number[], rng: Rng): Brain` (init `gaussian · 1/sqrt(in)`, biases 0)
  - `forward(b: Brain, input: number[]): number[]` (tanh on every layer)
  - `cloneBrain(b: Brain): Brain`

- [ ] **Step 1: Write the failing tests**

```ts
test('weightCount', () => expect(weightCount([8, 10, 2])).toBe(8*10 + 10 + 10*2 + 2));
test('forward output shape and range', () => {
  const b = createBrain(LAYERS, makeRng(1)); const y = forward(b, new Array(8).fill(0.5));
  expect(y).toHaveLength(2); for (const v of y) { expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1); }
});
test('known weights give known output', () => {
  const b: Brain = { layers: [1, 1], weights: new Float32Array([2, 0.5]) }; // w=2, bias=0.5
  expect(forward(b, [1])[0]).toBeCloseTo(Math.tanh(2.5));
});
test('clone is independent', () => {
  const a = createBrain(LAYERS, makeRng(1)); const c = cloneBrain(a); c.weights[0] += 1;
  expect(c.weights[0]).not.toBe(a.weights[0]);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with *why* comments (why tanh, why small init). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(ml): from-scratch feedforward neural net`

---

### Task 8: Genetic algorithm

**Files:**
- Create: `src/ml/ga.ts`
- Test: `tests/ml/ga.test.ts`

**Interfaces:**
- Consumes: `Brain`, `cloneBrain`, `Rng`, `gaussian`
- Produces:
  - `interface GAParams { eliteCount: number; tournamentSize: number; mutationRate: number; mutationStd: number }`
  - `DEFAULT_GA: GAParams = { eliteCount: 5, tournamentSize: 4, mutationRate: 0.1, mutationStd: 0.3 }`
  - `nextGeneration(brains: Brain[], fitness: number[], rng: Rng, p?: GAParams): Brain[]`: same length; the top `eliteCount` are copied unchanged; the rest come from tournament selection, uniform crossover, then Gaussian mutation

- [ ] **Step 1: Write the failing tests**

```ts
const pop = (n: number, seed = 1) => { const r = makeRng(seed); return Array.from({ length: n }, () => createBrain(LAYERS, r)); };
test('keeps population size', () => { const p = pop(100); expect(nextGeneration(p, p.map((_, i) => i), makeRng(2))).toHaveLength(100); });
test('elite survive unchanged', () => {
  const p = pop(100); const f = p.map((_, i) => i); const next = nextGeneration(p, f, makeRng(2));
  expect(next.some(b => b.weights.every((w, i) => w === p[99].weights[i]))).toBe(true);
});
test('evolves toward a target output', () => {
  // fitness = -(forward(x)[0] - 0.7)^2; after 60 gens best should be close
  let p = pop(60); const r = makeRng(3); const x = new Array(8).fill(0.3);
  const fit = (b: Brain) => -((forward(b, x)[0] - 0.7) ** 2);
  for (let g = 0; g < 60; g++) p = nextGeneration(p, p.map(fit), r);
  expect(Math.max(...p.map(fit))).toBeGreaterThan(-0.001);
});
test('deterministic for same seed', () => {
  const p = pop(20); const f = p.map((_, i) => i);
  expect(nextGeneration(p, f, makeRng(9))[10].weights).toEqual(nextGeneration(p, f, makeRng(9))[10].weights);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with *why* comments. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(ml): genetic algorithm with elitism, tournament, crossover, mutation`

---

### Task 9: World, generation loop, fitness, frozen mode

**Files:**
- Create: `src/sim/world.ts`
- Test: `tests/sim/world.test.ts`, `tests/sim/learning.test.ts` (slow; may use `test.timeout(120_000)`)

**Interfaces:**
- Consumes: everything from Tasks 1–8
- Produces:
  - `const DT = 1/60`, `STALL_SECONDS = 4`, `MAX_GEN_SECONDS = 90`
  - `interface GenStats { generation: number; bestFitness: number; avgFitness: number; finishers: number; bestLapTicks: number | null }`
  - `class Population { kind: VehicleKind; brains: Brain[]; vehicles: VehicleState[]; generation: number; history: GenStats[]; firstLapGeneration: number | null; label: string; frozen: boolean }`
  - `interface WorldOptions { kinds: VehicleKind[]; seed: number; initialBrains?: Partial<Record<VehicleKind, Brain[]>>; frozen?: boolean; contenders?: { label: string; kind: VehicleKind; brains: Brain[] }[] }`. With `contenders`, each one becomes its own Population (used by test mode); otherwise there is one population per kind.
  - `class World { constructor(track: Track, opts: WorldOptions); track: Track; populations: Population[]; tick: number; step(): ContactEvent[]; leader(pop: Population): number /* vehicle index */; isAttemptOver(pop: Population): boolean; completionRate(pop: Population): number; totalSimSeconds: number }`
  - `fitness(s: VehicleState, track: Track): number = s.checkpointsPassed + progressToNext(s, track) − 3 · s.damage + (s.bestLapTicks ? 2000 / (s.bestLapTicks · DT) : 0)`

Behaviour of `step()` per alive vehicle: `sensorInputs` → `forward` → `stepVehicle` → `resolveWallContact` (collect events) → checkpoint crossing via `segmentIntersect` of the movement segment with `checkpoints[nextCheckpoint]`, **only counting a crossing in the forward direction** → on passing checkpoint 0 after all others: `laps++`, lap time and `firstLapTick` bookkeeping → stall check (`ticksSinceProgress > STALL_SECONDS/DT` → `alive = false`). When every vehicle in a non-frozen population is dead, or `MAX_GEN_SECONDS` has passed: push `GenStats`, then `nextGeneration`, reset vehicles to `track.start`. Set `firstLapGeneration` the first time any vehicle laps. Frozen populations never evolve; they stop after one attempt (`isAttemptOver`). `completionRate` = fraction of that population with `laps ≥ 1`.

- [ ] **Step 1: Write the failing tests** (world.test.ts)

```ts
test('generation advances when all vehicles die', () => {
  const w = new World(buildTrack(DEFAULT_TRACK), { kinds: ['car'], seed: 1 });
  const p = w.populations[0]; p.vehicles.forEach(v => (v.alive = false));
  w.step(); expect(p.generation).toBe(1); expect(p.history).toHaveLength(1);
  expect(p.vehicles.every(v => v.alive)).toBe(true);
});
test('reversing through a checkpoint earns no progress', () => {
  const tr = buildTrack(DEFAULT_TRACK); const w = new World(tr, { kinds: ['car'], seed: 1 });
  const v = w.populations[0].vehicles[0]; v.heading += Math.PI; v.speed = 20;
  const before = fitness(v, tr);
  for (let i = 0; i < 120; i++) { const prev = { ...v.pos }; stepVehicle(v, CAR, { steer: 0, throttle: 1 }, DT); advanceCheckpoints(v, prev, tr); }
  expect(v.checkpointsPassed).toBe(0); expect(fitness(v, tr)).toBeLessThanOrEqual(before + 1e-9);
});
test('stalled vehicle is removed', () => {
  const w = new World(buildTrack(DEFAULT_TRACK), { kinds: ['car'], seed: 1 });
  const v = w.populations[0].vehicles[0]; v.ticksSinceProgress = STALL_SECONDS / DT + 1;
  w.step(); expect(v.alive).toBe(false);
});
test('frozen population never evolves and reports completion rate', () => {
  const brains = Array.from({ length: 10 }, (_, i) => createBrain(LAYERS, makeRng(i)));
  const w = new World(buildTrack(DEFAULT_TRACK), { kinds: [], seed: 1, contenders: [{ label: 'x', kind: 'car', brains }], frozen: true });
  const p = w.populations[0];
  for (let i = 0; i < 100000 && !w.isAttemptOver(p); i++) w.step();
  expect(p.generation).toBe(0); expect(w.completionRate(p)).toBeGreaterThanOrEqual(0); expect(w.completionRate(p)).toBeLessThanOrEqual(1);
});
```

Expose `advanceCheckpoints(v: VehicleState, prevPos: Vec2, track: Track): void` from `world.ts` for the reversing test.

- [ ] **Step 2: Write the learning tests** (learning.test.ts): the success criteria in sim time

```ts
test('default track: first lap from random brains within 120 sim seconds', () => {
  const w = new World(buildTrack(DEFAULT_TRACK), { kinds: ['car', 'bike'], seed: 1 });
  while (w.totalSimSeconds < 120 && w.populations.every(p => p.firstLapGeneration === null)) w.step();
  expect(w.populations.some(p => p.firstLapGeneration !== null)).toBe(true);
}, 120_000);
test('5 random tracks: first lap within 300 sim seconds each', () => {
  for (let s = 0; s < 5; s++) {
    const w = new World(buildTrack(randomTrack(makeRng(100 + s))), { kinds: ['car', 'bike'], seed: s });
    while (w.totalSimSeconds < 300 && w.populations.every(p => p.firstLapGeneration === null)) w.step();
    expect(w.populations.some(p => p.firstLapGeneration !== null)).toBe(true);
  }
}, 300_000);
```

- [ ] **Step 3:** Run `npx vitest run tests/sim/world.test.ts` → FAIL.
- [ ] **Step 4:** Implement `World`.
- [ ] **Step 5:** Run world tests → PASS. Run learning tests. If they fail, tune `DEFAULT_GA`, `STALL_SECONDS`, `MAX_GEN_SECONDS`, the contact thresholds and the vehicle numbers (all marked builder's call in the spec) until they pass. Record the final values in a comment.
- [ ] **Step 6:** Commit: `feat(sim): world, generation loop, fitness, frozen mode; meets lap-time targets`

---

### Task 10: 2D view and app loop (Week-1 fallback product)

**Files:**
- Create: `src/render2d/view2d.ts`, `src/ui/controls.ts` (speed + reset only for now)
- Modify: `src/main.ts`, `index.html`

**Interfaces:**
- Consumes: `World`, `Track`, `ContactEvent`, `castRays`, `RAY_ANGLES`
- Produces:
  - `class View2D { constructor(canvas: HTMLCanvasElement); setTrack(t: Track): void; render(w: World, events: ContactEvent[], opts: { showRaysFor?: { pop: number; vehicle: number } }): void }`: auto-fits the track to the canvas; cars and bikes in different colours; dead vehicles hidden; contact flash
  - `interface AppState { world: World; speed: number /* 1..10 */; view: '2d' | '3d' }`
  - `main.ts`: on load, build `World` on `DEFAULT_TRACK` (`kinds: ['car','bike']`, `seed: Date.now()`), start the `requestAnimationFrame` loop running `speed` steps per frame, render, collect events
  - `controls.ts`: `mountControls(root: HTMLElement, app: AppState, actions: { reset(): void; setKinds(k: VehicleKind[]): void }): void` (speed slider 1–10, Reset training, Cars/Bikes on-off toggles; at least one must stay on; `setKinds` rebuilds the world on the current track)

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify in browser:** `npm run dev`, open the page. Expected: the default track draws immediately, vehicles move with no click needed, generations advance, at 1x a lap happens within ~2 minutes, the speed slider changes the pace, and there are no console errors.
- [ ] **Step 3:** `npm run build` → succeeds.
- [ ] **Step 4:** Commit: `feat: 2D view and app loop (week-1 fallback)`

---

### Task 11: Track editor

**Files:**
- Create: `src/editor/editor.ts`
- Modify: `src/ui/controls.ts`, `src/main.ts`

**Interfaces:**
- Consumes: `validateTrack`, `buildTrack`, `randomTrack`, `DEFAULT_TRACK`, `TrackError`
- Produces:
  - `const EDITOR_METERS_PER_PX = 2`
  - `strokeToControlPoints(stroke: Vec2[] /* px */, metersPerPx: number): Vec2[]`: simplify to ~10–40 points (Ramer–Douglas–Peucker, ε ≈ 6 m), scale to meters, drop the closing duplicate point
  - `class Editor { constructor(canvas: HTMLCanvasElement, onRace: (control: Vec2[]) => void); open(): void; close(): void }`: shows the freehand stroke and a live preview of the smoothed walls when valid. Pressing Race validates; on failure it shows a message for the `TrackError`: `too-few-points`/`too-short` "Draw a bigger loop", `too-long` "Track too long — draw smaller", `self-intersect` "Track crosses itself", `too-tight` "A corner is too tight — widen it". Buttons: Random track, Default track, Clear.
- Test: `tests/editor/stroke.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('circle stroke simplifies to a valid track', () => {
  const stroke = Array.from({ length: 400 }, (_, i) => ({ x: 300 + 120*Math.cos(2*Math.PI*i/400), y: 300 + 120*Math.sin(2*Math.PI*i/400) }));
  const pts = strokeToControlPoints(stroke, EDITOR_METERS_PER_PX);
  expect(pts.length).toBeGreaterThanOrEqual(4); expect(pts.length).toBeLessThanOrEqual(60);
  expect(validateTrack(pts)).toEqual({ ok: true });
});
test('scribble is rejected, not thrown', () => {
  const stroke = Array.from({ length: 50 }, (_, i) => ({ x: (i * 37) % 200, y: (i * 91) % 200 }));
  expect(() => validateTrack(strokeToControlPoints(stroke, EDITOR_METERS_PER_PX))).not.toThrow();
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `strokeToControlPoints` and `Editor`; "Draw track" in controls opens it; Race replaces the world with `new World(buildTrack(control), …)`. **Step 4:** Run → PASS.
- [ ] **Step 5: Verify in browser:** draw a loop → Race → learning starts on it. Draw a figure-eight → see "Track crosses itself" and no crash.
- [ ] **Step 6:** Commit: `feat: freehand track editor with validation`

---

### Task 12: 3D renderer and camera swoop

**Files:**
- Create: `src/render3d/scene.ts`, `src/render3d/camera.ts`
- Modify: `src/main.ts`, `src/ui/controls.ts`

**Interfaces:**
- Consumes: `World`, `Track`, `SPECS`
- Produces:
  - `class Scene3D { constructor(container: HTMLElement); setTrack(t: Track): void; render(w: World): void; dispose(): void }`: ground plane, track surface mesh, wall meshes (extruded from the inner/outer polylines), kerbs on high-curvature sections. Vehicles use **one `InstancedMesh` per kind** (low-poly car body + wheels; a bike as a thin body + rider block), built in code; dead vehicles get zero scale; per-population colour.
  - `type CameraMode = 'chase' | 'orbit' | 'top'`
  - `class CameraRig { constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement); setMode(m: CameraMode): void; follow(pos: Vec2, heading: number): void; swoopFromTop(track: Track, ms = 1800): Promise<void>; update(dt: number): void }`: chase follows the current leader; the swoop animates from a straight-down view fitting the track to a low 3D angle with ease-in-out
  - `main.ts`: the 3D view is the default on load. After the editor's Race: show the 2D top-down for one frame, then `swoopFromTop`. A view toggle (2D / 3D) and the camera mode go in controls.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify in browser:** on load the 3D view shows vehicles learning on the default track with no click. Draw a track → Race → the camera swoops from top-down into 3D. Chase / orbit / top modes work. 200 vehicles hold ~60 fps (check the DevTools performance panel or an fps counter).
- [ ] **Step 3:** `npm run build` → succeeds.
- [ ] **Step 4:** Commit: `feat: 3D renderer with instanced vehicles and 2D→3D swoop`

---

### Task 13: Sparks and scrape marks

**Files:**
- Create: `src/render3d/effects.ts`
- Modify: `src/render3d/scene.ts`

**Interfaces:**
- Consumes: `ContactEvent[]` from `World.step()`
- Produces: `class Effects { constructor(scene: THREE.Scene); setTrack(t: Track): void /* clears all */; add(events: ContactEvent[]): void; update(dt: number): void }`
  - Sparks: a pooled `THREE.Points` (≤ 2000 particles). Each scrape spawns `4 + 12·intensity` particles with short life and gravity; a crash spawns a larger burst.
  - Scrape marks: per wall segment, an accumulated count drives the vertex colour / opacity of a thin strip on the wall face, so the most-rubbed spots look darkest (the heatmap). Cleared on `setTrack`.

- [ ] **Step 1:** Implement and hook `Effects.add` into the main loop with the events from each step.
- [ ] **Step 2: Verify in browser:** early generations throw sparks on corners, scrape marks build up on the hardest corners, sparks visibly drop off as generations improve, and a track change clears the marks. Frame rate holds.
- [ ] **Step 3:** Commit: `feat: spark particles and scrape-mark heatmap`

---

### Task 14: HUD, chart, NN diagram, celebration; cars vs bikes tuning

**Files:**
- Create: `src/ui/hud.ts`, `src/ui/chart.ts`, `src/ui/nnview.ts`
- Modify: `src/main.ts`, `src/sim/vehicle.ts` (tuning values only)

**Interfaces:**
- Consumes: `World`, `Population`, `GenStats`, `Brain`, `forward`, `sensorInputs`
- Produces:
  - `class Hud { constructor(root: HTMLElement); update(w: World): void }`: per population: label, generation, alive count, best checkpoints, best lap time, and the leader's damage bar. Fires a celebration banner ("Car learned the track in gen N!") once per population when `firstLapGeneration` is first set.
  - `drawChart(canvas: HTMLCanvasElement, series: { label: string; color: string; points: number[] }[]): void`: best fitness per generation, hand-drawn on canvas
  - `drawNN(canvas: HTMLCanvasElement, brain: Brain, input: number[]): void`: nodes coloured by activation, edges by weight sign and magnitude, for the leader of the selected population
  - 3D and 2D views show the leader's sensor rays.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Tune `CAR`/`BIKE` so the two types visibly take different lines (bikes brake later and run wider through tight corners, or similar). Re-run `npx vitest run tests/sim/learning.test.ts` → still PASS.
- [ ] **Step 3: Verify in browser:** all HUD values update live, the chart grows each generation, the NN diagram animates, and the celebration fires once per type.
- [ ] **Step 4:** Commit: `feat: HUD, fitness chart, live NN diagram, first-lap celebration`

---

### Task 15: Brain storage and carry-over vehicles

**Files:**
- Create: `src/storage/brains.ts`
- Modify: `src/ui/controls.ts`, `src/ui/hud.ts`, `src/main.ts`
- Test: `tests/storage/brains.test.ts`

**Interfaces:**
- Consumes: `Brain`, `LAYERS`, `VehicleKind`, `World`
- Produces:
  - `interface PopulationFile { version: 1; kind: VehicleKind; layers: number[]; brains: number[][] }`
  - `toFile(kind: VehicleKind, brains: Brain[]): PopulationFile`, `fromFile(f: unknown): Brain[] | null`. Returns `null` unless version is 1, `layers` equals `LAYERS`, and every brain has `weightCount(LAYERS)` finite numbers.
  - `saveMyVehicles(kind: VehicleKind, brains: Brain[], storage?: Storage): boolean` (key `slv.my.<kind>`; returns false if storage throws)
  - `loadMyVehicles(kind: VehicleKind, storage?: Storage): Brain[] | null` (never throws)
  - `loadShipped(name: 'specialist' | 'generalist', kind: VehicleKind): Promise<Brain[] | null>` (fetches `/brains/<name>-<kind>.json`)
  - `type StartPoint = 'fresh' | 'mine' | 'generalist'`
  - Controls: a **Keep my vehicles** button (saves both kinds, shows a toast) and a **Starting point** picker used by Race. If the chosen source returns `null`, fall back to fresh and show "No saved vehicles found — starting fresh".
  - Transfer stat: `main.ts` remembers `firstLapGeneration` for fresh runs per track (key = rounded control-points hash, in memory). When the run started from `'mine'`, the HUD shows "First lap in X gens vs Y from scratch" (Y only if known).

- [ ] **Step 1: Write the failing tests**

```ts
const fakeStorage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage; };
test('round trip', () => {
  const s = fakeStorage(); const b = [createBrain(LAYERS, makeRng(1))];
  expect(saveMyVehicles('car', b, s)).toBe(true);
  expect(Array.from(loadMyVehicles('car', s)![0].weights)).toEqual(Array.from(b[0].weights));
});
test('corrupt JSON → null', () => { const s = fakeStorage(); s.setItem('slv.my.car', '{oops'); expect(loadMyVehicles('car', s)).toBeNull(); });
test('wrong layer shape → null', () => {
  const s = fakeStorage(); s.setItem('slv.my.car', JSON.stringify({ version: 1, kind: 'car', layers: [5, 3, 2], brains: [[0]] }));
  expect(loadMyVehicles('car', s)).toBeNull();
});
test('throwing storage → save false, load null', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } as unknown as Storage;
  expect(saveMyVehicles('car', [createBrain(LAYERS, makeRng(1))], bad)).toBe(false);
  expect(loadMyVehicles('car', bad)).toBeNull();
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement storage, then wire the UI. **Step 4:** Run → PASS.
- [ ] **Step 5: Verify in browser:** train on track A → Keep my vehicles → draw track B → Starting point "My vehicles" → Race. Familiar corners are taken cleanly, new ones scrape or crash, and the HUD shows the transfer stat after a fresh run on B.
- [ ] **Step 6:** Commit: `feat: save/load populations, starting-point picker, transfer stat`

---

### Task 16: Headless pre-training (specialist + generalist)

**Files:**
- Create: `scripts/pretrain.ts`, `public/brains/{specialist,generalist}-{car,bike}.json` (generated, committed)

**Interfaces:**
- Consumes: `World`, `buildTrack`, `DEFAULT_TRACK`, `randomTrack`, `toFile`
- Produces: four `PopulationFile` JSONs of `POP_SIZE` brains each.
  - Specialist: evolve on `DEFAULT_TRACK` for 150 generations.
  - Generalist: each generation runs on a fresh `randomTrack(makeRng(1000 + gen))` (seeds 1000+; **seeds 0–999 are reserved** for held-out test tracks), for 400 generations. It writes the final population.
  - Logs per 10 generations: best/avg fitness, finishers.

- [ ] **Step 1:** Implement. `npm run pretrain` writes the four files.
- [ ] **Step 2: Verify:** a quick check script inside `pretrain.ts` (run with `--check`) runs each generalist frozen on 10 held-out tracks (`randomTrack(makeRng(0..9))`) and prints the completion rate. Expected: the generalist rate is clearly above the specialist rate on most tracks. If not, raise the generation count or train on 2 tracks per generation (averaged fitness).
- [ ] **Step 3:** Commit: `feat: pretrain specialist and generalist populations`

---

### Task 17: "Test on unseen track" mode

**Files:**
- Modify: `src/ui/controls.ts`, `src/main.ts`, `src/ui/hud.ts`

**Interfaces:**
- Consumes: `loadShipped`, `loadMyVehicles`, `World` with `contenders` + `frozen: true`, `completionRate`, `isAttemptOver`
- Produces:
  - A **Test on unseen track** button: the user draws (or randomizes) a track, picks the vehicle kind, and contenders are Specialist, Generalist, plus My vehicles if saved. Each is colour-coded (fixed palette: specialist orange, generalist cyan, mine magenta).
  - The HUD shows each contender's live completion rate; when all attempts are over, a results card ("Generalist 74% · Specialist 6% · Yours 31%").
  - A **Keep training** button rebuilds the world on the same track with the same `contenders` (their current brains) and `frozen: false`, so each contender evolves as its own population.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify in browser:** on a random track the generalist finishes far more often than the specialist. The results card appears once. Keep training continues evolving all contenders.
- [ ] **Step 3:** Commit: `feat: unseen-track test mode with specialist/generalist/mine`

---

### Task 18: Experiments, Results page, README

**Files:**
- Create: `scripts/experiments.ts`, `public/results/experiments.json` (generated, committed), `README.md`
- Modify: `results.html`, `src/results.ts`

**Interfaces:**
- Consumes: `World`, shipped populations, `randomTrack`, `fitness`
- Produces: `experiments.json` = `{ exp1: { tracks: number; specialist: number[]; generalist: number[] } /* per-track completion rates, held-out seeds 0..49, frozen, same definition as test mode */, exp2: { car: number[]; bike: number[] } /* generations to first lap from fresh on 20 random tracks */, exp3: { fresh: number[]; transfer: number[]; corners: { similarity: number; scrapes: number; crashes: number }[] } }`
  - Exp 3: train fresh on track A (seed 500 + i) until first lap + 20 gens, then evolve on B (seed 600 + i), against fresh on B. Corner similarity = best cross-correlation of 60 m curvature profiles between each B corner and any A corner. Count scrapes/crashes per B corner in B's first generation.
  - `results.ts`: renders three charts (hand-drawn canvas, reuse `drawChart` where it fits) plus the write-up text: how the NN, GA and sensors work; why local sensors make transfer possible; what the numbers show.
  - `README.md`: live link, GIF placeholder (`docs/demo.gif`, recorded manually), architecture diagram in text, how to run (`npm run dev`, `npm test`, `npm run pretrain`, `npm run experiments`), and results summary.

- [ ] **Step 1:** Implement `experiments.ts`; `npm run experiments` writes the JSON.
- [ ] **Step 2:** Implement the Results page; link it from the main app header.
- [ ] **Step 3: Verify in browser:** `/results.html` renders all three charts from the committed JSON, with no console errors.
- [ ] **Step 4:** Write `README.md`.
- [ ] **Step 5:** Commit: `feat: experiments, results page, README`

---

### Task 19: Deploy and final checks

**Files:**
- Create: `vercel.json` only if needed (Vite's defaults usually suffice)

- [ ] **Step 1:** `npm test` → all PASS (including the learning tests). `npm run build` → succeeds.
- [ ] **Step 2:** `npx vite preview` → manual pass through the spec's goals 1–10 in a fresh browser profile (no saved vehicles).
- [ ] **Step 3:** Owner creates a GitHub repo and a Vercel project (needs their accounts). The builder gives the exact commands and does not push without the owner's go-ahead.
- [ ] **Step 4:** Commit: `chore: deploy config`
