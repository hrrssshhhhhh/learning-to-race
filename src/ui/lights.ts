import { gsap } from 'gsap';

/**
 * Race start lights: five columns come on one per second, hold for a random moment, then all go out together and
 * the race starts. `mirror(n)` lets the 3D gantry show the same lights.
 */
export class StartLights {
  private el = document.createElement('div');
  private cols: HTMLElement[];
  private busy = false;

  constructor(private mirror: (lit: number) => void) {
    this.el.className = 'lights'; this.el.hidden = true;
    this.el.setAttribute('role', 'status'); this.el.setAttribute('aria-label', 'Start lights');
    this.el.innerHTML = Array.from({ length: 5 }, () => '<div class="col"><i></i><i></i></div>').join('');
    this.cols = [...this.el.querySelectorAll<HTMLElement>('.col')];
    document.body.append(this.el);
  }

  get running(): boolean { return this.busy; }

  run(go: () => void): void {
    if (this.busy) return;
    this.busy = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = reduce ? 0.25 : 0.8, hold = reduce ? 0.2 : 0.4 + Math.random() * 0.9; // the hold is random, as at a real start
    const light = (n: number) => { this.cols.forEach((c, i) => c.classList.toggle('on', i < n)); this.mirror(n); };
    light(0); this.el.hidden = false;
    const tl = gsap.timeline();
    for (let n = 1; n <= 5; n++) tl.call(() => light(n), [], step * n);
    tl.call(() => { light(0); go(); }, [], step * 5 + hold) // lights out
      .call(() => { this.el.hidden = true; this.busy = false; }, [], step * 5 + hold + 0.6);
  }
}
