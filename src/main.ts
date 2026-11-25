import { World } from './sim/world';
import { buildTrack } from './sim/track';
import { DEFAULT_TRACK } from './sim/defaultTrack';
import type { ContactEvent } from './sim/contact';
import type { VehicleKind } from './sim/vehicle';
import { View2D } from './render2d/view2d';
import { Scene3D } from './render3d/scene';
import { CameraRig } from './render3d/camera';
import { Editor } from './editor/editor';
import { mountControls, type AppState } from './ui/controls';
import { Hud } from './ui/hud';
import type { Vec2 } from './sim/vec';
import { LAYERS, createBrain, type Brain } from './ml/nn';
import { POP_SIZE } from './sim/world';
import { makeRng } from './sim/rng';
import { loadMyVehicles, loadShipped, saveMyVehicles, type StartPoint } from './storage/brains';

let track = buildTrack(DEFAULT_TRACK); // the track in play; Race replaces it
// Transfer stat: first-lap generation of fresh runs, per track (in memory; key = rounded control points)
const trackKey = (c: Vec2[]) => c.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';');
let key = trackKey(DEFAULT_TRACK), runStart: StartPoint = 'fresh';
let testKind: VehicleKind | null = null; // set by "Test on unseen track": the next editor Race runs a test instead
let testing = false; // the current world is a test (or continues one): not a from-scratch baseline
const scratch = new Map<string, Partial<Record<VehicleKind, number>>>();
const make = (kinds: VehicleKind[], initialBrains?: Partial<Record<VehicleKind, Brain[]>>) =>
  new World(track, { kinds, seed: Date.now(), initialBrains });
const app: AppState = { world: make(['car', 'bike']), speed: 1, view: '3d', camera: 'chase', start: 'fresh' };
let kinds: VehicleKind[] = ['car', 'bike'];

/** New run on the current track from the chosen starting point; any missing source falls back to fresh. */
async function restart(): Promise<void> {
  const start = app.start, at = track, brains: Partial<Record<VehicleKind, Brain[]>> = {};
  for (const k of kinds) {
    const b = start === 'fresh' ? null : start === 'mine' ? loadMyVehicles(k) : await loadShipped('specialist', k);
    if (b) brains[k] = b;
  }
  if (at !== track) return; // another Race replaced the track while the pre-trained file was loading
  const ok = start !== 'fresh' && kinds.every((k) => brains[k]);
  if (start !== 'fresh' && !ok) hud.notify('No saved vehicles found — starting fresh');
  runStart = ok ? start : 'fresh'; testing = false; controls.setTesting(false);
  app.world = make(kinds, ok ? brains : undefined);
  hud.transfer = runStart === 'mine' ? (scratch.get(key) ?? {}) : null;
}

const root = document.getElementById('app')!;
root.innerHTML = '<canvas id="stage"></canvas><div id="stage3d"></div><aside id="panel" aria-label="Training stats"></aside><div id="controls"></div><canvas id="editor"></canvas>';
const stage2d = root.querySelector<HTMLCanvasElement>('#stage')!, stage3d = root.querySelector<HTMLElement>('#stage3d')!;
const view = new View2D(stage2d);
view.setTrack(track);
let scene3d: Scene3D | null = null, rig: CameraRig | null = null;
try {
  scene3d = new Scene3D(stage3d);
  scene3d.setTrack(track);
  rig = new CameraRig(scene3d.camera, scene3d.renderer.domElement);
  rig.setTrack(track);
} catch (err) { // no WebGL: the 2D view is the fallback
  console.warn('3D view unavailable, using 2D', err);
  app.view = '2d';
}
if (import.meta.env.DEV) Object.assign(window, { slv: { app, scene3d, rig } }); // browser checks read renderer.info

const hud = new Hud(root.querySelector<HTMLElement>('#panel')!);
const controls = mountControls(root.querySelector<HTMLElement>('#controls')!, app, {
  reset: () => void restart(),
  setKinds: (k) => { kinds = k; void restart(); },
  draw: () => { testKind = null; editor.open(); },
  test: (k) => { testKind = k; editor.open(); },
  keep: () => {
    const ok = app.world.populations.every((p) => saveMyVehicles(p.kind, p.brains));
    hud.notify(ok ? 'Vehicles saved in this browser' : 'Could not save: browser storage is blocked');
  },
});
if (!scene3d) root.querySelector<HTMLFieldSetElement>('#view')!.disabled = true;
let swoopNext = false;

/** Frozen side-by-side test on the current track: pre-trained, fresh (random brains, the baseline) and yours if saved. */
async function startTest(kind: VehicleKind): Promise<void> {
  const at = track, pre = await loadShipped('specialist', kind), mine = loadMyVehicles(kind);
  if (at !== track) return;
  if (!pre) hud.notify('Pre-trained vehicles not found: testing without them');
  const rng = makeRng(Date.now()), fresh = Array.from({ length: POP_SIZE }, () => createBrain(LAYERS, rng));
  const contenders = [
    ...(pre ? [{ label: 'specialist', kind, brains: pre }] : []),
    { label: 'fresh', kind, brains: fresh },
    ...(mine ? [{ label: 'mine', kind, brains: mine }] : []),
  ];
  testing = true; hud.transfer = null; controls.setTesting(true);
  app.world = new World(track, { kinds: [], seed: Date.now(), frozen: true, contenders });
  // Keep training: same track, same contenders with their current brains, each now evolving as its own population
  hud.onKeepTraining = () => {
    if (!app.world.populations[0]?.frozen) return;
    app.world = new World(track, { kinds: [], seed: Date.now(), contenders: app.world.populations.map((p) => ({ label: p.label, kind: p.kind, brains: p.brains })) });
  };
}
const editor = new Editor(root.querySelector<HTMLCanvasElement>('#editor')!, (control) => {
  track = buildTrack(control); key = trackKey(control);
  if (testKind) { void startTest(testKind); testKind = null; } else void restart();
  view.setTrack(track);
  scene3d?.setTrack(track);
  rig?.setTrack(track);
  if (scene3d) { app.view = '2d'; swoopNext = true; controls.sync(); } // one 2D frame, then swoop into 3D
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; // camera only; the sim is fixed-step
  const events: ContactEvent[] = [];
  if (!editor.isOpen) for (let i = 0; i < app.speed; i++) events.push(...app.world.step()); // fixed timestep: speed = steps per frame
  scene3d?.effects.add(events, app.view === '3d'); // marks accumulate in 2D too; sparks only while visible
  const w = app.world;
  if (runStart === 'fresh' && !testing) for (const p of w.populations) { // remember the from-scratch baseline for this track
    const s = scratch.get(key) ?? {};
    if (p.firstLapGeneration !== null && s[p.kind] === undefined) { s[p.kind] = p.firstLapGeneration; scratch.set(key, s); }
  }
  hud.update(w); // first: clamps hud.focus when the world changes
  const focus = { pop: hud.focus, vehicle: w.leader(w.populations[hud.focus]) }, lead = w.populations[focus.pop].vehicles[focus.vehicle];
  // only the visible renderer draws
  stage2d.style.visibility = app.view === '2d' ? 'visible' : 'hidden';
  stage3d.style.visibility = app.view === '3d' ? 'visible' : 'hidden';
  if (app.view === '2d') {
    view.render(w, events, { showRaysFor: focus });
    if (swoopNext && !editor.isOpen) {
      swoopNext = false; app.view = '3d'; app.camera = 'chase'; controls.sync();
      rig!.swoopFromTop(track);
    }
  } else if (scene3d && rig && !editor.isOpen) {
    if (rig.mode !== app.camera) rig.setMode(app.camera);
    rig.follow(lead.pos, lead.heading);
    rig.update(dt);
    scene3d.render(w, dt, focus);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
