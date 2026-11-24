import type { VehicleKind } from '../sim/vehicle';
import type { World } from '../sim/world';

export interface AppState { world: World; speed: number /* 1..10 */; view: '2d' | '3d' }

export function mountControls(
  root: HTMLElement, app: AppState, actions: { reset(): void; setKinds(k: VehicleKind[]): void },
): void {
  root.innerHTML = `
    <label for="speed">Speed <output id="speed-out">${app.speed}x</output></label>
    <input id="speed" type="range" min="1" max="10" step="1" value="${app.speed}">
    <button type="button" id="reset">Reset training</button>
    <fieldset><legend>Vehicles</legend>
      <label><input type="checkbox" value="car" checked> Cars</label>
      <label><input type="checkbox" value="bike" checked> Bikes</label>
    </fieldset>`;
  const speed = root.querySelector<HTMLInputElement>('#speed')!, out = root.querySelector('#speed-out')!;
  speed.addEventListener('input', () => { app.speed = +speed.value; out.textContent = app.speed + 'x'; });
  root.querySelector('#reset')!.addEventListener('click', () => actions.reset());
  const boxes = [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  const onChange = () => {
    const on = boxes.filter((b) => b.checked);
    on.forEach((b) => (b.disabled = on.length === 1)); // the last ticked box can't be unticked
    actions.setKinds(on.map((b) => b.value as VehicleKind));
  };
  boxes.forEach((b) => b.addEventListener('change', onChange));
}
