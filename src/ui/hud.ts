import { gsap } from 'gsap';
import { DT, type World } from '../sim/world';
import { SPECS, type VehicleKind } from '../sim/vehicle';
import { RAY_ANGLES, sensorInputs } from '../sim/sensors';
import { LAYERS } from '../ml/nn';
import { popColor } from '../render2d/view2d';
import { drawChart } from './chart';
import { drawNN } from './nnview';

const NAMES: Record<string, string> = { car: 'Cars', bike: 'Bikes', specialist: 'Pre-trained', fresh: 'Fresh', mine: 'Yours' };
const name = (label: string) => NAMES[label] ?? label;
const secs = (ticks: number | null) => (ticks === null ? '–' : `${(ticks * DT).toFixed(1)} s`);
// after a full lap, show progress on the current lap instead of e.g. 219/200
const cps = (cp: number, n: number) => (cp < n ? `${cp}/${n}` : `lap ${Math.floor(cp / n) + 1}: ${cp % n}/${n}`);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

interface Card { done: HTMLElement; xfer: HTMLElement; gen: HTMLElement; alive: HTMLElement; cp: HTMLElement; best: HTMLElement; lap: HTMLElement; dmg: HTMLElement; dmgBar: HTMLElement }

/** Side panel: spec strip, one card per population, best-per-generation chart, the followed leader's live net. */
export class Hud {
  /** Population index the camera, rays and net diagram follow. */
  focus = 0;
  /** Where the controls put the training settings (start from, restart, save). */
  readonly trainingSlot: HTMLElement;
  /** Set when the run started from the user's saved vehicles: first-lap generation of a fresh run on this track, if known. */
  transfer: Partial<Record<VehicleKind, number>> | null = null;
  /** Called by the results card's Keep training button (test mode). */
  onKeepTraining: () => void = () => {};
  private results: HTMLElement; private resultsShown = false; private setOpen: (open: boolean) => void;
  private world: World | null = null;
  private cards: Card[] = [];
  private bestCp: number[] = [];
  private celebrated = new Set<number>();
  private chartLen = -1;
  private queue: string[] = [];
  private playing = false;
  private spec: HTMLElement; private pops: HTMLElement;
  private chart: HTMLCanvasElement; private nn: HTMLCanvasElement; private nnTitle: HTMLElement; private banner: HTMLElement; private status: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="panel-head"><p class="spec"></p><button type="button" class="btn panel-toggle" aria-controls="panel-body">Stats</button></div>
      <div class="panel-body" id="panel-body">
        <div class="training" role="group" aria-label="Training"></div>
        <div class="results" role="status" hidden><p></p><button type="button">Keep training</button></div>
        <div class="pops" role="radiogroup" aria-label="Follow population"></div>
        <h2>Best score per generation</h2>
        <canvas class="chart" role="img" aria-label="Bar chart of best fitness per generation"></canvas>
        <h2 class="nn-title"></h2>
        <canvas class="nn" role="img" aria-label="Live neural network of the followed leader"></canvas>
      </div>`;
    this.spec = root.querySelector('.spec')!;
    this.pops = root.querySelector('.pops')!;
    this.trainingSlot = root.querySelector('.training')!;
    this.results = root.querySelector('.results')!;
    this.results.querySelector('button')!.addEventListener('click', () => this.onKeepTraining());
    this.chart = root.querySelector('.chart')!;
    this.nn = root.querySelector('.nn')!;
    this.nnTitle = root.querySelector('.nn-title')!;
    const title = document.createElement('header');
    title.className = 'title';
    title.innerHTML = '<h1>Self-learning vehicles</h1><p></p>';
    this.status = title.querySelector('p')!;
    document.body.append(title);
    this.banner = document.createElement('div');
    this.banner.className = 'celebrate'; this.banner.setAttribute('role', 'status');
    document.body.append(this.banner);
    gsap.set(this.banner, { xPercent: -50, autoAlpha: 0 });

    const toggle = root.querySelector<HTMLButtonElement>('.panel-toggle')!;
    const setOpen = this.setOpen = (open: boolean) => {
      document.body.classList.toggle('panel-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Hide' : 'Stats';
      toggle.setAttribute('aria-label', open ? 'Hide stats' : 'Show stats');
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
    this.results.hidden = true; this.resultsShown = false;
    this.chartLen = -1;
    const total = w.populations.reduce((n, p) => n + p.vehicles.length, 0);
    this.spec.textContent = `${total} vehicles · ${RAY_ANGLES.length} distance sensors · neural net ${LAYERS.join('→')} · genetic algorithm, written from scratch`;
    this.pops.innerHTML = w.populations.map((p, i) => `
      <label class="card" style="--c:${popColor(p)}">
        <span class="head"><input type="radio" name="follow" value="${i}" ${i === this.focus ? 'checked' : ''}>
          <span class="dot"></span><b>${name(p.label)}</b><span class="follow"></span></span>
        <span class="figs">
          <span><small>${p.frozen ? 'Completed a lap' : 'Generation'}</small><b class="fig" data-k="${p.frozen ? 'done' : 'gen'}"></b></span>
          <span><small>Still driving</small><b class="fig" data-k="alive"></b></span>
        </span>
        <span hidden data-k="${p.frozen ? 'gen' : 'done'}"></span>
        <span class="row">Leader checkpoints <b class="fig" data-k="cp"></b></span>
        <span class="row">Best ever <b class="fig" data-k="best"></b></span>
        <span class="row">Best lap <b class="fig" data-k="lap"></b></span>
        <span class="row xfer" data-k="xfer" hidden></span>
        <span class="row">Leader damage <span class="dmg" role="meter" aria-label="Leader damage" aria-valuemin="0" aria-valuemax="100" data-k="dmg"><i></i></span></span>
      </label>`).join('');
    this.cards = [...this.pops.querySelectorAll('.card')].map((el) => {
      const q = <T extends HTMLElement>(k: string) => el.querySelector<T>(`[data-k="${k}"]`)!;
      const dmg = q('dmg');
      return { done: q('done'), xfer: q('xfer'), gen: q('gen'), alive: q('alive'), cp: q('cp'), best: q('best'), lap: q('lap'), dmg, dmgBar: dmg.querySelector('i')! };
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
      (card.alive.closest('.card')!.querySelector('.follow') as HTMLElement).textContent = i === this.focus ? 'Following' : 'Follow';
      card.cp.textContent = cps(lead.checkpointsPassed, n);
      card.best.textContent = cps(this.bestCp[i], n);
      card.lap.textContent = secs(lap);
      const d = Math.min(1, lead.damage);
      card.dmgBar.style.transform = `scaleX(${d})`; // transform, not width: no layout every frame
      card.dmg.dataset.level = d >= 0.7 ? 'bad' : d >= 0.4 ? 'warn' : '';
      card.dmg.setAttribute('aria-valuenow', String(Math.round(100 * d)));
      if (p.frozen) card.done.textContent = `${Math.round(100 * w.completionRate(p))}%`;
      card.xfer.hidden = !this.transfer;
      if (this.transfer) {
        const x = p.firstLapGeneration, y = this.transfer[p.kind];
        card.xfer.textContent = x === null ? 'Carried over: no lap yet'
          : `First lap in generation ${x + 1}` + (y === undefined ? '' : ` vs ${y + 1} from scratch`);
      }
      if (!p.frozen && p.firstLapGeneration !== null && !this.celebrated.has(i)) { // frozen = test, nothing learned
        this.celebrated.add(i);
        this.celebrate(`${name(p.label)} learned the track in generation ${p.firstLapGeneration + 1}`);
      }
    });
    const f = w.populations[this.focus];
    this.status.textContent = f.frozen
      ? `Test on an unseen track · one attempt, no learning · ${w.populations.filter((p) => !w.isAttemptOver(p)).length ? 'running' : 'done'}`
      : `${name(f.label)} · generation ${f.generation + 1} · ${f.vehicles.filter((v) => v.alive).length} of ${f.vehicles.length} still driving`;
    if (!this.resultsShown && w.populations[0]?.frozen && w.populations.every((p) => w.isAttemptOver(p))) {
      this.resultsShown = true; // once per test: the attempt is over and rates no longer change
      this.results.querySelector('p')!.textContent = 'Lap completion: ' + w.populations
        .map((p) => `${name(p.label)} ${Math.round(100 * w.completionRate(p))}%`).join(' · ');
      this.results.hidden = false;
      this.setOpen(true); // results live in the panel: make sure they are seen
    }
    if (!document.body.classList.contains('panel-open')) return; // hidden canvases: skip drawing
    const len = w.populations.reduce((s, p) => s + p.history.length, 0);
    if (len !== this.chartLen) { // only redraw when a generation ends
      this.chartLen = len;
      drawChart(this.chart, w.populations.map((p) => ({ label: name(p.label), color: popColor(p), points: p.history.map((g) => g.bestFitness) })));
    }
    const p = w.populations[this.focus], v = p.vehicles[w.leader(p)];
    this.nnTitle.textContent = `${name(p.label)} leader's brain, live`;
    drawNN(this.nn, p.brains[w.leader(p)], sensorInputs(v, SPECS[p.kind], w.track));
  }

  /** Short message in the banner slot, e.g. a save confirmation or a fallback notice. */
  notify(text: string): void { this.celebrate(text); }

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
    // one short fade and rise in, a fade out; no bounce (reduced motion: appear and fade only)
    const rise = reduceMotion.matches ? 0 : 8;
    tl.fromTo(this.banner, { autoAlpha: 0, y: -rise }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'expo.out' })
      .to(this.banner, { autoAlpha: 0, duration: 0.3, ease: 'power2.in' }, '+=3.5');
  }
}
