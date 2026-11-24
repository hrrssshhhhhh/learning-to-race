import { World } from './sim/world';
import { buildTrack } from './sim/track';
import { DEFAULT_TRACK } from './sim/defaultTrack';
import type { ContactEvent } from './sim/contact';
import type { VehicleKind } from './sim/vehicle';
import { View2D } from './render2d/view2d';
import { Editor } from './editor/editor';
import { mountControls, type AppState } from './ui/controls';

let track = buildTrack(DEFAULT_TRACK); // the track in play; Race replaces it
const make = (kinds: VehicleKind[]) => new World(track, { kinds, seed: Date.now() });
const app: AppState = { world: make(['car', 'bike']), speed: 1, view: '2d' };
let kinds: VehicleKind[] = ['car', 'bike'];

const root = document.getElementById('app')!;
root.innerHTML = '<canvas id="stage"></canvas><div id="hud"></div><div id="controls"></div><canvas id="editor"></canvas>';
const view = new View2D(root.querySelector('canvas')!);
view.setTrack(track);
const hud = root.querySelector<HTMLElement>('#hud')!;
mountControls(root.querySelector<HTMLElement>('#controls')!, app, {
  reset: () => { app.world = make(kinds); },
  setKinds: (k) => { kinds = k; app.world = make(k); },
  draw: () => editor.open(),
});
const editor = new Editor(root.querySelector<HTMLCanvasElement>('#editor')!, (control) => {
  track = buildTrack(control);
  app.world = make(kinds);
  view.setTrack(track);
});

function frame(): void {
  const events: ContactEvent[] = [];
  if (!editor.isOpen) for (let i = 0; i < app.speed; i++) events.push(...app.world.step()); // fixed timestep: speed = steps per frame
  const w = app.world, car = Math.max(0, w.populations.findIndex((p) => p.kind === 'car'));
  view.render(w, events, { showRaysFor: { pop: car, vehicle: w.leader(w.populations[car]) } });
  hud.textContent = w.populations
    .map((p) => `${p.label} gen ${p.generation} | alive ${p.vehicles.filter((v) => v.alive).length}/${p.vehicles.length}`)
    .join('   ') + `   | sim ${w.totalSimSeconds.toFixed(0)}s`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
