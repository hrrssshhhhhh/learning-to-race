import type { VehicleKind } from '../sim/vehicle';
import type { World } from '../sim/world';
import type { CameraMode } from '../render3d/camera';
import type { StartPoint } from '../storage/brains';

export interface AppState { world: World; speed: number /* 1..10 */; view: '2d' | '3d'; camera: CameraMode; start: StartPoint }

export function mountControls(
  root: HTMLElement, training: HTMLElement, app: AppState, actions: { reset(): void; setKinds(k: VehicleKind[]): void; draw(): void; keep(): void; test(kind: VehicleKind): void },
): { sync(): void; setTesting(on: boolean): void } {
  // radios and checkboxes render as segmented toggles; the legend stays for screen readers, the label span is visual
  const seg = (name: string, legend: string, type: 'radio' | 'checkbox', opts: [string, string][], checked = false) =>
    `<fieldset id="${name}" class="seg"><legend class="sr-only">${legend}</legend>${opts.map(([v, l]) =>
      `<label><input type="${type}" name="${name}" value="${v}"${checked ? ' checked' : ''}>${l}</label>`).join('')}</fieldset>`;
  root.innerHTML = `
    <div class="group" role="group" aria-label="Track">
      <button type="button" class="btn primary" id="draw">Draw track</button>
      <button type="button" class="btn" id="test">Test on new track</button>
      <label for="test-kind" class="sr-only">Test with</label>
      <select id="test-kind" class="btn"><option value="car">with cars</option><option value="bike">with bikes</option></select>
    </div>
    <div class="group">
      <label for="speed" class="sr-only">Simulation speed</label>
      <input id="speed" type="range" min="1" max="10" step="1" value="${app.speed}">
      <output id="speed-out" class="fig" for="speed">${app.speed}x</output>
    </div>
    <div class="group">
      ${seg('kinds', 'Vehicles', 'checkbox', [['car', 'Cars'], ['bike', 'Bikes']], true)}
    </div>`;
  // training settings live in the stats panel: set once per run, not touched every few seconds
  training.innerHTML = `
    <label for="start" class="lbl">Start from</label>
    <select id="start" class="btn">
      <option value="fresh">Fresh</option>
      <option value="mine">My vehicles</option>
      <option value="specialist">Pre-trained</option>
    </select>
    <button type="button" class="btn" id="reset">Restart</button>
    <button type="button" class="btn" id="keep">Save vehicles</button>`;
  // view controls sit on the canvas (top right), next to what they change, so the bottom bar fits one row
  const viewbar = document.createElement('div');
  viewbar.className = 'viewbar'; viewbar.setAttribute('role', 'group'); viewbar.setAttribute('aria-label', 'View');
  viewbar.innerHTML = seg('view', 'View', 'radio', [['3d', '3D'], ['2d', '2D']]) + seg('camera', 'Camera', 'radio', [['chase', 'Chase'], ['orbit', 'Orbit'], ['top', 'Top']]);
  root.before(viewbar);
  const speed = root.querySelector<HTMLInputElement>('#speed')!, out = root.querySelector('#speed-out')!;
  speed.addEventListener('input', () => { app.speed = +speed.value; out.textContent = app.speed + 'x'; });
  training.querySelector('#reset')!.addEventListener('click', () => actions.reset());
  root.querySelector('#draw')!.addEventListener('click', () => actions.draw());
  training.querySelector('#keep')!.addEventListener('click', () => actions.keep());
  const testKind = root.querySelector<HTMLSelectElement>('#test-kind')!;
  root.querySelector('#test')!.addEventListener('click', () => actions.test(testKind.value as VehicleKind));
  const start = training.querySelector<HTMLSelectElement>('#start')!;
  start.value = app.start; // applies to the next Restart or Race, not the run in progress
  start.addEventListener('change', () => { app.start = start.value as StartPoint; });
  const view = viewbar.querySelector<HTMLFieldSetElement>('#view')!, cam = viewbar.querySelector<HTMLFieldSetElement>('#camera')!;
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
  const kinds = root.querySelector<HTMLFieldSetElement>('#kinds')!;
  // a test runs one kind chosen by "with cars/bikes"; ticking these would silently end it
  const setTesting = (on: boolean) => {
    kinds.disabled = on;
    kinds.title = on ? 'Running a test on one vehicle type. Restart to leave it.' : '';
  };
  return { sync, setTesting };
}
