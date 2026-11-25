import type { VehicleKind } from '../sim/vehicle';
import type { World } from '../sim/world';
import type { CameraMode } from '../render3d/camera';
import type { StartPoint } from '../storage/brains';

export interface AppState { world: World; speed: number /* 1..10 */; view: '2d' | '3d'; camera: CameraMode; start: StartPoint }

export function mountControls(
  root: HTMLElement, app: AppState, actions: { reset(): void; setKinds(k: VehicleKind[]): void; draw(): void; keep(): void },
): { sync(): void } {
  const radios = (name: string, legend: string, opts: [string, string][]) =>
    `<fieldset id="${name}"><legend class="show">${legend}</legend>${opts.map(([v, l]) =>
      `<label><input type="radio" name="${name}" value="${v}"> ${l}</label>`).join('')}</fieldset>`;
  root.innerHTML = `
    <label for="speed">Speed <output id="speed-out">${app.speed}x</output></label>
    <input id="speed" type="range" min="1" max="10" step="1" value="${app.speed}">
    <label for="start">Start from</label>
    <select id="start">
      <option value="fresh">Fresh (random brains)</option>
      <option value="mine">My vehicles</option>
      <option value="generalist">Generalist</option>
    </select>
    <button type="button" id="reset">Reset training</button>
    <button type="button" id="keep">Keep my vehicles</button>
    <button type="button" id="draw">Draw track</button>
    <fieldset><legend>Vehicles</legend>
      <label><input type="checkbox" value="car" checked> Cars</label>
      <label><input type="checkbox" value="bike" checked> Bikes</label>
    </fieldset>
    ${radios('view', 'View', [['3d', '3D'], ['2d', '2D']])}
    ${radios('camera', 'Camera', [['chase', 'Chase'], ['orbit', 'Orbit'], ['top', 'Top']])}`;
  const speed = root.querySelector<HTMLInputElement>('#speed')!, out = root.querySelector('#speed-out')!;
  speed.addEventListener('input', () => { app.speed = +speed.value; out.textContent = app.speed + 'x'; });
  root.querySelector('#reset')!.addEventListener('click', () => actions.reset());
  root.querySelector('#draw')!.addEventListener('click', () => actions.draw());
  root.querySelector('#keep')!.addEventListener('click', () => actions.keep());
  const start = root.querySelector<HTMLSelectElement>('#start')!;
  start.value = app.start; // applies to the next Restart or Race, not the run in progress
  start.addEventListener('change', () => { app.start = start.value as StartPoint; });
  const view = root.querySelector<HTMLFieldSetElement>('#view')!, cam = root.querySelector<HTMLFieldSetElement>('#camera')!;
  // main changes view/camera too (Race swoops into 3D chase), so radios mirror app state rather than own it
  const sync = () => {
    view.querySelector<HTMLInputElement>(`[value="${app.view}"]`)!.checked = true;
    cam.querySelector<HTMLInputElement>(`[value="${app.camera}"]`)!.checked = true;
    cam.disabled = app.view === '2d';
  };
  view.addEventListener('change', (e) => { app.view = (e.target as HTMLInputElement).value as AppState['view']; sync(); });
  cam.addEventListener('change', (e) => { app.camera = (e.target as HTMLInputElement).value as CameraMode; });
  sync();
  const boxes = [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  const onChange = () => {
    const on = boxes.filter((b) => b.checked);
    on.forEach((b) => (b.disabled = on.length === 1)); // the last ticked box can't be unticked
    actions.setKinds(on.map((b) => b.value as VehicleKind));
  };
  boxes.forEach((b) => b.addEventListener('change', onChange));
  return { sync };
}
