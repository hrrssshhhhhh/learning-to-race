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

let track = buildTrack(DEFAULT_TRACK); // the track in play; Race replaces it
const make = (kinds: VehicleKind[]) => new World(track, { kinds, seed: Date.now() });
const app: AppState = { world: make(['car', 'bike']), speed: 1, view: '3d', camera: 'chase' };
let kinds: VehicleKind[] = ['car', 'bike'];

const root = document.getElementById('app')!;
root.innerHTML = '<canvas id="stage"></canvas><div id="stage3d"></div><div id="hud"></div><div id="controls"></div><canvas id="editor"></canvas>';
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

const hud = root.querySelector<HTMLElement>('#hud')!;
const controls = mountControls(root.querySelector<HTMLElement>('#controls')!, app, {
  reset: () => { app.world = make(kinds); },
  setKinds: (k) => { kinds = k; app.world = make(k); },
  draw: () => editor.open(),
});
if (!scene3d) root.querySelector<HTMLFieldSetElement>('#view')!.disabled = true;
let swoopNext = false;
const editor = new Editor(root.querySelector<HTMLCanvasElement>('#editor')!, (control) => {
  track = buildTrack(control);
  app.world = make(kinds);
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
  const w = app.world, car = Math.max(0, w.populations.findIndex((p) => p.kind === 'car'));
  const li = w.leader(w.populations[car]), lead = w.populations[car].vehicles[li];
  // only the visible renderer draws
  stage2d.style.visibility = app.view === '2d' ? 'visible' : 'hidden';
  stage3d.style.visibility = app.view === '3d' ? 'visible' : 'hidden';
  if (app.view === '2d') {
    view.render(w, events, { showRaysFor: { pop: car, vehicle: li } });
    if (swoopNext && !editor.isOpen) {
      swoopNext = false; app.view = '3d'; app.camera = 'chase'; controls.sync();
      rig!.swoopFromTop(track);
    }
  } else if (scene3d && rig && !editor.isOpen) {
    if (rig.mode !== app.camera) rig.setMode(app.camera);
    rig.follow(lead.pos, lead.heading);
    rig.update(dt);
    scene3d.render(w);
  }
  hud.textContent = w.populations
    .map((p) => `${p.label} gen ${p.generation} | alive ${p.vehicles.filter((v) => v.alive).length}/${p.vehicles.length}`)
    .join('   ') + `   | sim ${w.totalSimSeconds.toFixed(0)}s`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
