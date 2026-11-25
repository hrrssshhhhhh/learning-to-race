import { gsap } from 'gsap';
import { DT, type World } from '../sim/world';
import { SPECS } from '../sim/vehicle';
import { RAY_ANGLES, sensorInputs } from '../sim/sensors';
import { LAYERS } from '../ml/nn';
import { COLORS } from '../render2d/view2d';
import { drawChart } from './chart';
import { drawNN } from './nnview';

const NAMES: Record<string, string> = { car: 'Car', bike: 'Bike' };
const name = (label: string) => NAMES[label] ?? label;
const secs = (ticks: number | null) => (ticks === null ? '–' : `${(ticks * DT).toFixed(1)} s`);
// after a full lap, show progress on the current lap instead of e.g. 219/200
const cps = (cp: number, n: number) => (cp < n ? `${cp}/${n}` : `lap ${Math.floor(cp / n) + 1}: ${cp % n}/${n}`);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

interface Card { gen: HTMLElement; alive: HTMLElement; cp: HTMLElement; best: HTMLElement; lap: HTMLElement; dmg: HTMLMeterElement }

/** Side panel: spec strip, one card per population, best-per-generation chart, the followed leader's live net. */
export class Hud {
  /** Population index the camera, rays and net diagram follow. */
  focus = 0;
  private world: World | null = null;
  private cards: Card[] = [];
  private bestCp: number[] = [];
  private celebrated = new Set<number>();
  private chartLen = -1;
  private queue: string[] = [];
  private playing = false;
  private spec: HTMLElement; private pops: HTMLElement;
  private chart: HTMLCanvasElement; private nn: HTMLCanvasElement; private nnTitle: HTMLElement; private banner: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <button type="button" class="panel-toggle" aria-controls="panel-body">Stats</button>
      <div class="panel-body" id="panel-body">
        <p class="spec"></p>
        <div class="pops" role="radiogroup" aria-label="Follow population"></div>
        <h2>Best fitness per generation</h2>
        <canvas class="chart" role="img" aria-label="Bar chart of best fitness per generation"></canvas>
        <h2 class="nn-title"></h2>
        <canvas class="nn" role="img" aria-label="Live neural network of the followed leader"></canvas>
      </div>`;
    this.spec = root.querySelector('.spec')!;
    this.pops = root.querySelector('.pops')!;
    this.chart = root.querySelector('.chart')!;
    this.nn = root.querySelector('.nn')!;
    this.nnTitle = root.querySelector('.nn-title')!;
    this.banner = document.createElement('div');
    this.banner.className = 'celebrate'; this.banner.setAttribute('role', 'status');
    document.body.append(this.banner);
    gsap.set(this.banner, { xPercent: -50, autoAlpha: 0 });

    const toggle = root.querySelector<HTMLButtonElement>('.panel-toggle')!;
    const setOpen = (open: boolean) => {
      document.body.classList.toggle('panel-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Hide stats' : 'Show stats';
      this.chartLen = -1; // canvas was hidden or resized: redraw
    };
    toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('panel-open')));
    setOpen(window.innerWidth > 760); // narrow screens: start collapsed so the track stays visible
    this.pops.addEventListener('change', (e) => { this.focus = +(e.target as HTMLInputElement).value; });
  }

  private rebuild(w: World): void {
    this.world = w;
    this.focus = Math.min(this.focus, w.populations.length - 1);
    this.bestCp = w.populations.map(() => 0);
    this.celebrated.clear();
    this.chartLen = -1;
    const total = w.populations.reduce((n, p) => n + p.vehicles.length, 0);
    this.spec.textContent = `${total} vehicles · ${RAY_ANGLES.length} distance sensors · neural net ${LAYERS.join('→')} · genetic algorithm`;
    this.pops.innerHTML = w.populations.map((p, i) => `
      <label class="card" style="--c:${COLORS[p.kind]}">
        <span class="head"><input type="radio" name="follow" value="${i}" ${i === this.focus ? 'checked' : ''}>
          <b>${name(p.label)}s</b> <small>follow</small></span>
        <span class="row">Generation <b data-k="gen"></b></span>
        <span class="row">Alive <b data-k="alive"></b></span>
        <span class="row">Leader checkpoints <b data-k="cp"></b></span>
        <span class="row">Best ever <b data-k="best"></b></span>
        <span class="row">Best lap <b data-k="lap"></b></span>
        <span class="row">Leader damage <meter data-k="dmg" min="0" max="1" low="0.4" high="0.7" optimum="0"></meter></span>
      </label>`).join('');
    this.cards = [...this.pops.querySelectorAll('.card')].map((el) => {
      const q = <T extends HTMLElement>(k: string) => el.querySelector<T>(`[data-k="${k}"]`)!;
      return { gen: q('gen'), alive: q('alive'), cp: q('cp'), best: q('best'), lap: q('lap'), dmg: q<HTMLMeterElement>('dmg') };
    });
  }

  update(w: World): void {
    if (w !== this.world) this.rebuild(w);
    const n = w.track.checkpoints.length;
    w.populations.forEach((p, i) => {
      const card = this.cards[i], lead = p.vehicles[w.leader(p)];
      this.bestCp[i] = Math.max(this.bestCp[i], lead.checkpointsPassed);
      let lap: number | null = null;
      for (const t of [...p.history.map((g) => g.bestLapTicks), ...p.vehicles.map((v) => v.bestLapTicks)])
        if (t !== null && (lap === null || t < lap)) lap = t;
      card.gen.textContent = String(p.generation + 1);
      card.alive.textContent = `${p.vehicles.filter((v) => v.alive).length}/${p.vehicles.length}`;
      card.cp.textContent = cps(lead.checkpointsPassed, n);
      card.best.textContent = cps(this.bestCp[i], n);
      card.lap.textContent = secs(lap);
      card.dmg.value = lead.damage;
      if (p.firstLapGeneration !== null && !this.celebrated.has(i)) {
        this.celebrated.add(i);
        this.celebrate(`${name(p.label)}s learned the track in generation ${p.firstLapGeneration + 1}!`);
      }
    });
    if (!document.body.classList.contains('panel-open')) return; // hidden canvases: skip drawing
    const len = w.populations.reduce((s, p) => s + p.history.length, 0);
    if (len !== this.chartLen) { // only redraw when a generation ends
      this.chartLen = len;
      drawChart(this.chart, w.populations.map((p) => ({ label: p.label, color: COLORS[p.kind], points: p.history.map((g) => g.bestFitness) })));
    }
    const p = w.populations[this.focus], v = p.vehicles[w.leader(p)];
    this.nnTitle.textContent = `${name(p.label)} leader's brain, live`;
    drawNN(this.nn, p.brains[w.leader(p)], sensorInputs(v, SPECS[p.kind], w.track));
  }

  /** Queued so two first laps in the same moment each get their own banner. */
  private celebrate(text: string): void {
    this.queue.push(text);
    if (!this.playing) this.next();
  }

  private next(): void {
    const text = this.queue.shift();
    if (text === undefined) { this.playing = false; return; }
    this.playing = true;
    this.banner.textContent = text;
    const tl = gsap.timeline({ onComplete: () => this.next() });
    if (reduceMotion.matches) tl.set(this.banner, { autoAlpha: 1, y: 0, scale: 1 }).to(this.banner, { autoAlpha: 0, duration: 0.3 }, '+=4');
    else tl.fromTo(this.banner, { autoAlpha: 0, y: -40, scale: 0.85 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.7)' })
      .to(this.banner, { scale: 1.06, duration: 0.25, yoyo: true, repeat: 1, ease: 'power1.inOut' })
      .to(this.banner, { autoAlpha: 0, y: -24, duration: 0.5, ease: 'power2.in' }, '+=3');
  }
}
