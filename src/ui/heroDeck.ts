import { forward, type Brain } from '../ml/nn';
import { DEFAULT_GA } from '../ml/ga';
import { RAY_ANGLES, RAY_LENGTH } from '../sim/sensors';
import { POP_SIZE } from '../sim/world';
import { loadShipped } from '../storage/brains';
import { COLORS } from '../render2d/view2d';
import { fitCanvas } from './chart';

const STEPS: [string, string][] = [
  ['Drive', `${POP_SIZE} vehicles race until they crash or stall`],
  ['Score', 'checkpoints, plus lap time, minus damage'],
  ['Keep', `top ${DEFAULT_GA.eliteCount} copied over unchanged`],
  ['Breed', `parents picked by a tournament of ${DEFAULT_GA.tournamentSize}`],
  ['Mutate', `${Math.round(DEFAULT_GA.mutationRate * 100)}% of weights nudged at random`],
];
const STEP_MS = 1400;

/**
 * Sensor readings for a car threading an endless S-bend: the rays on the inside of the corner shorten.
 * Synthetic on purpose (no track runs behind the hero), but shaped like real castRays output: 0..1 per ray, plus speed.
 */
export function cornerInputs(t: number): number[] {
  const bend = Math.sin(t * 0.55) * 0.8 + Math.sin(t * 1.3) * 0.2; // > 0 = turning left
  const rays = RAY_ANGLES.map((deg) => {
    const side = Math.sign(deg) * bend, reach = Math.abs(deg) / 90; // how much this ray faces the inside wall
    const v = deg === 0 ? 1 - 0.55 * Math.abs(bend) : 0.62 - 0.4 * side * (0.4 + 0.6 * reach) - 0.18 * reach;
    return Math.min(1, Math.max(0.08, v));
  });
  return [...rays, 0.75 - 0.3 * Math.abs(bend)];
}

/** Telemetry cards around the hero: a vehicle's sensors (steered by the real pre-trained net) and the evolution loop. */
export function mountHeroDeck(hero: HTMLElement): void {
  const deck = document.createElement('div');
  deck.className = 'hero-deck';
  deck.innerHTML = `
    <section class="tele tele-eyes" aria-label="What each vehicle senses">
      <h2><span>What it sees</span><small>${RAY_ANGLES.length} rays · ${RAY_LENGTH} m</small></h2>
      <canvas class="tele-rays" aria-hidden="true"></canvas>
      <div class="tele-out fig">
        <span>Steer <b class="bar mid"><i data-o="0"></i></b></span>
        <span>Throttle <b class="bar"><i data-o="1"></i></b></span>
      </div>
    </section>
    <section class="tele tele-evo" aria-label="How a generation evolves">
      <h2><span>How it evolves</span><small class="fig">gen <b data-gen>01</b></small></h2>
      <ol>${STEPS.map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join('')}</ol>
    </section>`;
  hero.append(deck);

  const rays = deck.querySelector<HTMLCanvasElement>('.tele-rays')!;
  const outs = [...deck.querySelectorAll<HTMLElement>('[data-o]')], steps = [...deck.querySelectorAll('li')];
  const gen = deck.querySelector<HTMLElement>('[data-gen]')!;
  let brain: Brain | null = null;
  void loadShipped('specialist', 'car').then((b) => { brain = b?.[0] ?? null; }); // without it the car just holds straight

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = (ms: number) => {
    const t = reduce ? 2 : ms / 1000, input = cornerInputs(t);
    const out = brain ? forward(brain, input) : [0, 0];
    drawRays(rays, input.slice(0, RAY_ANGLES.length), out[0]);
    outs[0].style.transform = `translateX(${(out[0] * 50).toFixed(1)}%) scaleX(.08)`; // steer: a marker either side of centre
    outs[1].style.transform = `scaleX(${Math.max(0, out[1]).toFixed(3)})`;
    const step = reduce ? -1 : Math.floor(ms / STEP_MS);
    steps.forEach((li, i) => li.classList.toggle('on', step % STEPS.length === i));
    gen.textContent = String(Math.max(1, Math.floor(step / STEPS.length) + 1)).padStart(2, '0');
  };
  const loop = (ms: number) => {
    // the hero fades out with the scroll; once hidden there is nothing to animate
    if (getComputedStyle(hero).visibility !== 'hidden' && +getComputedStyle(deck).opacity > 0) draw(ms);
    requestAnimationFrame(loop);
  };
  if (reduce) { draw(0); void loadShipped('specialist', 'car').then(() => draw(0)); } else requestAnimationFrame(loop);
}

/** Top-down car, nose up, with its distance rays: short rays (a wall close by) turn red. */
function drawRays(canvas: HTMLCanvasElement, hits: number[], steer: number): void {
  const { c, w, h } = fitCanvas(canvas);
  const cx = w / 2, cy = h - 16, reach = Math.min(w / 2 - 12, h - 28);
  c.save(); c.translate(cx, cy); c.rotate(-steer * 0.12); // positive steer = left
  c.lineWidth = 1.5; c.lineCap = 'round';
  RAY_ANGLES.forEach((deg, i) => {
    const a = (deg * Math.PI) / 180, len = hits[i] * reach, x = -Math.sin(a) * len, y = -Math.cos(a) * len;
    const near = hits[i] < 0.35;
    c.strokeStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(-Math.sin(a) * reach, -Math.cos(a) * reach); c.stroke();
    c.strokeStyle = near ? 'rgba(225,6,0,.9)' : 'rgba(255,255,255,.55)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(x, y); c.stroke();
    c.fillStyle = near ? '#ff1e1a' : '#ffffff'; c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill();
  });
  c.fillStyle = COLORS.car; c.beginPath(); c.roundRect(-6, -10, 12, 20, 3); c.fill();
  c.fillStyle = '#0b0b0f'; c.fillRect(-4, -5, 8, 4); // windscreen
  c.restore();
}
