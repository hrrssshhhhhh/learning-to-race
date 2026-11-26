import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { fitCanvas } from './ui/chart';
import { COLORS } from './render2d/view2d';
import { LAYERS, weightCount } from './ml/nn';
import { DEFAULT_GA } from './ml/ga';
import { RAY_ANGLES, RAY_LENGTH } from './sim/sensors';
import { POP_SIZE } from './sim/world';

type Kind = 'car' | 'bike';
interface Results {
  generated: string;
  exp1: { tracks: number; pretrained: Record<Kind, number[]>; fresh: Record<Kind, number[]> };
  exp2: { tracks: number; cap: number; car: (number | null)[]; bike: (number | null)[] };
  exp3: {
    pairs: number; cap: number; extraGensOnA: number; cornerRadius: number;
    fresh: (number | null)[]; transfer: (number | null)[];
    corners: { radius: number; scrapes: number; crashes: number; tighterThanA: boolean }[];
  };
}

// Respect reduced-motion users: keep native scroll for them.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) new Lenis({ autoRaf: true });

const MUTED = '#7d7d88', TEXT_2 = '#b8b8c2', GRID = 'rgba(255,255,255,.06)', BASE = 'rgba(255,255,255,.16)', BASELINE = '#9b9ba5', RED = '#e10600';
const FONT = '600 12px "Barlow Condensed", sans-serif';
const NAME: Record<Kind, string> = { car: 'Cars', bike: 'Bikes' };
const KINDS: Kind[] = ['car', 'bike'];
const STACK = 7; // beeswarm slots per row (centre plus three each side) before a pile collapses to a count

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const done = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);

/** Hover layer: every chart registers its marks; the nearest one within reach gets a tooltip. */
const tip = document.createElement('div');
tip.className = 'tip'; tip.hidden = true; tip.setAttribute('role', 'status');
function hover(canvas: HTMLCanvasElement, marks: { x: number; y: number; text: string }[]): void {
  canvas.onpointermove = (e) => {
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    let best: (typeof marks)[number] | null = null, bd = 14 ** 2;
    for (const m of marks) { const d = (m.x - px) ** 2 + (m.y - py) ** 2; if (d < bd) { bd = d; best = m; } }
    tip.hidden = !best;
    if (best) { tip.textContent = best.text; tip.style.left = `${r.left + best.x}px`; tip.style.top = `${r.top + best.y + window.scrollY}px`; }
  };
  canvas.onpointerleave = () => (tip.hidden = true);
}

function dot(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, hollow = false): void {
  c.beginPath(); c.arc(x, y, r + 2, 0, Math.PI * 2); c.fillStyle = '#101016'; c.fill(); // surface ring keeps overlapping dots apart
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  if (hollow) { c.strokeStyle = fill; c.lineWidth = 1.5; c.stroke(); } else { c.fillStyle = fill; c.fill(); }
}

/**
 * Rows of dots on a shared x axis, one dot per track (a beeswarm: close values step into the nearest free slot
 * above or below the row line). Values identical beyond STACK slots collapse into a "+n" count.
 */
function stripChart(canvas: HTMLCanvasElement, rows: { label: string; color: string; values: number[]; dnf?: number; fmt: (v: number) => string }[],
  axis: { max: number; ticks: number[]; fmt: (v: number) => string; dnfLabel?: string; grid?: boolean }): void {
  const { c, w } = fitCanvas(canvas);
  c.font = FONT; c.textBaseline = 'middle';
  const dnf = !!axis.dnfLabel && rows.some((r) => (r.dnf ?? 0) > 0);
  const L = 120, R = dnf ? 72 : 16, rowH = 64, T = 8, pw = w - L - R, SLOT = 8, GAP = 8; // dots touch ring to ring, never overlap
  const x = (v: number) => L + (v / axis.max) * pw, marks: { x: number; y: number; text: string }[] = [];
  const bottom = T + rows.length * rowH;
  for (const t of axis.ticks) {
    c.strokeStyle = t === 0 ? BASE : GRID; c.beginPath(); c.moveTo(Math.round(x(t)) + 0.5, T); c.lineTo(Math.round(x(t)) + 0.5, bottom); c.stroke();
    c.fillStyle = MUTED; c.textAlign = 'center'; c.fillText(axis.fmt(t), x(t), bottom + 12);
  }
  if (dnf) { c.fillStyle = MUTED; c.textAlign = 'center'; c.fillText(axis.dnfLabel!, L + pw + R / 2, bottom + 12); }
  const slots = Array.from({ length: STACK }, (_, n) => (n % 2 ? 1 : -1) * Math.ceil(n / 2) * SLOT); // 0, -8, 8, -16, ...
  rows.forEach((row, ri) => {
    const cy = T + ri * rowH + rowH / 2, m = median(row.values);
    c.textAlign = 'left';
    c.fillStyle = TEXT_2; c.fillText(row.label, 0, cy - 8);
    if (Number.isFinite(m)) { c.fillStyle = MUTED; c.fillText(`median ${row.fmt(m)}`, 0, cy + 8); }
    const placed: [number, number][] = [], over = new Map<number, number>();
    if (axis.grid) { // whole-number data far apart on the axis: each pile becomes a small grid centred on its value
      const piles = new Map<number, number>();
      for (const v of row.values) piles.set(v, (piles.get(v) ?? 0) + 1);
      for (const [v, n] of piles) {
        const cols = Math.min(n, 5), lines = Math.ceil(n / 5);
        for (let k = 0; k < n; k++) {
          const px = x(v) + ((k % 5) - (cols - 1) / 2) * GAP, py = cy + (Math.floor(k / 5) - (lines - 1) / 2) * GAP;
          dot(c, px, py, 4, row.color);
          marks.push({ x: px, y: py, text: `${row.label}: ${row.fmt(v)} (${n} track${n > 1 ? 's' : ''})` });
        }
      }
    }
    for (const v of axis.grid ? [] : [...row.values].sort((a, b) => a - b)) {
      const px = x(v), dy = slots.find((o) => placed.every(([qx, qy]) => (qx - px) ** 2 + (qy - cy - o) ** 2 >= GAP ** 2));
      if (dy === undefined) { const k = Math.round(px); over.set(k, (over.get(k) ?? 0) + 1); continue; }
      placed.push([px, cy + dy]);
      dot(c, px, cy + dy, 4, row.color);
      marks.push({ x: px, y: cy + dy, text: `${row.label}: ${row.fmt(v)}` });
    }
    c.fillStyle = TEXT_2; c.textAlign = 'center';
    // one count per cluster of overflowing values, so neighbouring piles never print over each other
    const groups: { n: number; right: number }[] = [];
    for (const [px, n] of [...over].sort((a, b) => a[0] - b[0])) {
      const g = groups.at(-1);
      if (g && px - g.right < 28) { g.n += n; g.right = px; } else groups.push({ n, right: px });
    }
    c.textAlign = 'left'; // count sits to the right of its cluster's widest dots
    for (const g of groups) {
      const edge = Math.max(g.right, ...placed.filter(([qx]) => Math.abs(qx - g.right) < 80).map(([qx]) => qx));
      c.fillText(`+${g.n} more`, edge + 10, cy);
    }
    for (let k = 0; k < (row.dnf ?? 0); k++) {
      const px = L + pw + R / 2 + ((k % 6) - 2.5) * 9, py = cy + (Math.floor(k / 6) - 0.5) * 9;
      dot(c, px, py, 3.5, row.color, true);
      marks.push({ x: px, y: py, text: `${row.label}: did not lap within the cap` });
    }
    if (Number.isFinite(m)) { c.strokeStyle = '#ffffff'; c.lineWidth = 2; c.beginPath(); c.moveTo(x(m), cy - 28); c.lineTo(x(m), cy + 28); c.stroke(); c.lineWidth = 1; }
  });
  hover(canvas, marks);
}

/** Dumbbells: per track pair, generations to a first lap on B from scratch vs after training on A. */
function pairsChart(canvas: HTMLCanvasElement, fresh: (number | null)[], transfer: (number | null)[], cap: number): void {
  const { c, w, h } = fitCanvas(canvas);
  c.font = FONT; c.textBaseline = 'middle';
  const rows = fresh.map((f, i) => ({ i, f: f ?? cap + 1, t: transfer[i] ?? cap + 1 })).sort((a, b) => (b.f - b.t) - (a.f - a.t));
  const max = Math.max(4, ...rows.flatMap((r) => [r.f, r.t]));
  const L = 64, R = 16, T = 8, B = 24, pw = w - L - R, rh = (h - T - B) / rows.length;
  const x = (v: number) => L + ((v - 1) / (max - 1)) * pw, marks: { x: number; y: number; text: string }[] = [];
  const step = max > 20 ? 5 : max > 8 ? 2 : 1;
  for (let v = 1; v <= max; v += v === 1 && step > 1 ? step - 1 : step) {
    c.strokeStyle = GRID; c.beginPath(); c.moveTo(Math.round(x(v)) + 0.5, T); c.lineTo(Math.round(x(v)) + 0.5, h - B); c.stroke();
    c.fillStyle = MUTED; c.textAlign = 'center'; c.fillText(String(v), x(v), h - 10);
  }
  rows.forEach((r, k) => {
    const cy = T + (k + 0.5) * rh;
    c.fillStyle = MUTED; c.textAlign = 'left'; c.fillText(`Pair ${r.i + 1}`, 0, cy);
    c.strokeStyle = BASE; c.lineWidth = 2; c.beginPath(); c.moveTo(x(r.f), cy); c.lineTo(x(r.t), cy); c.stroke(); c.lineWidth = 1;
    dot(c, x(r.f), cy, 4, BASELINE); dot(c, x(r.t), cy, 4, COLORS.car);
    const g = (v: number) => (v > cap ? 'did not lap' : `generation ${v}`);
    marks.push({ x: x(r.f), y: cy, text: `Pair ${r.i + 1}, from scratch: ${g(r.f)}` }, { x: x(r.t), y: cy, text: `Pair ${r.i + 1}, after track A: ${g(r.t)}` });
  });
  hover(canvas, marks);
}

/** Scatter: each corner of track B by tightness (x) and wall contacts in the first attempt (y). */
function cornersChart(canvas: HTMLCanvasElement, corners: Results['exp3']['corners'], limit: number): void {
  const { c, w, h } = fitCanvas(canvas);
  c.font = FONT; c.textBaseline = 'middle';
  const L = 40, R = 16, T = 12, B = 36, pw = w - L - R, ph = h - T - B;
  const ys = corners.map((k) => k.scrapes + k.crashes), maxY = Math.max(10, ...ys);
  const yStep = 10 ** Math.floor(Math.log10(maxY)) * (maxY / 10 ** Math.floor(Math.log10(maxY)) > 5 ? 2 : 1);
  const top = Math.ceil(maxY / yStep) * yStep, minR = 8;
  const x = (r: number) => L + (Math.log(r / minR) / Math.log(limit / minR)) * pw, y = (v: number) => T + ph - (v / top) * ph;
  for (let v = 0; v <= top; v += yStep) {
    c.strokeStyle = v ? GRID : BASE; c.beginPath(); c.moveTo(L, Math.round(y(v)) + 0.5); c.lineTo(L + pw, Math.round(y(v)) + 0.5); c.stroke();
    c.fillStyle = MUTED; c.textAlign = 'right'; c.fillText(String(v), L - 8, y(v));
  }
  c.textAlign = 'center';
  for (const r of [10, 15, 20, 30, 40].filter((r) => r <= limit)) c.fillText(`${r} m`, x(r), h - 24);
  c.fillText('corner radius (log scale), tighter to the left', L + pw / 2, h - 6);
  const marks: { x: number; y: number; text: string }[] = [];
  for (const k of [...corners].sort((a, b) => Number(a.tighterThanA) - Number(b.tighterThanA))) { // highlighted corners on top
    const px = x(Math.max(minR, Math.min(limit, k.radius))), py = y(k.scrapes + k.crashes);
    dot(c, px, py, 4, k.tighterThanA ? RED : BASELINE, !k.tighterThanA);
    marks.push({ x: px, y: py, text: `${k.radius} m corner${k.tighterThanA ? ', tighter than any on A' : ''}: ${k.scrapes} scrape, ${k.crashes} crash contacts` });
  }
  hover(canvas, marks);
}

function table(head: string[], rows: (string | number)[][]): string {
  return `<details class="data"><summary>Show the data</summary><div class="scroll"><table>
    <thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

function render(d: Results): void {
  const e1 = d.exp1, e2 = d.exp2, e3 = d.exp3;
  const faster = e3.fresh.filter((f, i) => (e3.transfer[i] ?? e3.cap + 1) < (f ?? e3.cap + 1)).length;
  const ties = e3.fresh.filter((f, i) => (e3.transfer[i] ?? e3.cap + 1) === (f ?? e3.cap + 1)).length;
  const tight = e3.corners.filter((k) => k.tighterThanA), rest = e3.corners.filter((k) => !k.tighterThanA);
  const contacts = (ks: typeof tight) => mean(ks.map((k) => k.scrapes + k.crashes));
  const crashes = (ks: typeof tight) => ks.reduce((n, k) => n + k.crashes, 0);
  const [mc, mb] = KINDS.map((k) => median(done(e2[k])));
  const quicker = mc === mb ? 'Neither kind is clearly quicker to learn.'
    : `${mb < mc ? 'Bikes' : 'Cars'} usually get there a little sooner, which says more about their handling than their brains: the network is identical.`;
  const app = document.getElementById('app')!;
  app.innerHTML = `
  <header class="top"><a class="mark" href="./">Self-learning vehicles</a><a class="back" href="./">Back to the race</a></header>
  <main>
    <section class="intro">
      <p class="tag">Results</p>
      <h1>What the vehicles learned</h1>
      <p class="lede">Three experiments, all run headless with the same simulation the browser uses. Every run is seeded, so
        <code>npm run experiments</code> reproduces these numbers. Data generated ${d.generated}.</p>
    </section>

    <section class="exp" aria-labelledby="e1">
      <p class="num fig">01</p>
      <h2 id="e1">Does pre-training carry over to tracks it has never seen?</h2>
      <p>The shipped pre-trained population learned on the default track only. Here it gets one attempt on ${e1.tracks} random tracks
        it has never seen, next to ${POP_SIZE} random brains on the same tracks. Each dot is one track: the share of the population that completed a lap.</p>
      <div class="figs">${KINDS.map((k) => `<div><b class="fig">${pct(mean(e1.pretrained[k]))}</b><span>${NAME[k].toLowerCase()} pre-trained, mean completion</span></div>`).join('')}
        <div><b class="fig">${pct(mean([...e1.fresh.car, ...e1.fresh.bike]))}</b><span>random brains, mean completion</span></div></div>
      <canvas class="chart c1" role="img" aria-label="Completion rate per unseen track, pre-trained vs random brains, for cars and bikes"></canvas>
      <ul class="legend"><li><i style="background:${COLORS.car}"></i>Pre-trained cars</li><li><i style="background:${COLORS.bike}"></i>Pre-trained bikes</li><li><i style="background:${BASELINE}"></i>Random brains</li><li><i class="tick"></i>Median</li></ul>
      ${table(['Track', 'Cars pre-trained', 'Cars random', 'Bikes pre-trained', 'Bikes random'],
        e1.pretrained.car.map((_, i) => [i + 1, pct(e1.pretrained.car[i]), pct(e1.fresh.car[i]), pct(e1.pretrained.bike[i]), pct(e1.fresh.bike[i])]))}
    </section>

    <section class="exp" aria-labelledby="e2">
      <p class="num fig">02</p>
      <h2 id="e2">Who learns faster, cars or bikes?</h2>
      <p>Both start from random brains on the same ${e2.tracks} random tracks with the same seeds. Each dot is one track: the generation in which
        the first vehicle completed a lap. ${quicker}</p>
      <div class="figs">${KINDS.map((k) => `<div><b class="fig">${median(done(e2[k]))}</b><span>${NAME[k].toLowerCase()}, median generation to a first lap</span></div>`).join('')}
        <div><b class="fig">${KINDS.map((k) => done(e2[k]).length).join(' · ')}</b><span>of ${e2.tracks} tracks lapped within ${e2.cap} generations, cars · bikes</span></div></div>
      <canvas class="chart c2" role="img" aria-label="Generations to a first lap per track, cars vs bikes"></canvas>
      <ul class="legend"><li><i style="background:${COLORS.car}"></i>Cars</li><li><i style="background:${COLORS.bike}"></i>Bikes</li><li><i class="tick"></i>Median</li>${KINDS.some((k) => e2[k].includes(null)) ? `<li><i class="ring"></i>Did not lap within ${e2.cap} generations</li>` : ''}</ul>
      ${table(['Track', 'Cars', 'Bikes'], e2.car.map((_, i) => [i + 1, e2.car[i] ?? 'did not lap', e2.bike[i] ?? 'did not lap']))}
    </section>

    <section class="exp" aria-labelledby="e3">
      <p class="num fig">03</p>
      <h2 id="e3">Does learning one track help on the next?</h2>
      <p>Cars evolve on track A until their first lap, plus ${e3.extraGensOnA} more generations. That population then moves to a new track B and keeps
        evolving, next to random brains starting on B. ${e3.pairs} pairs of random tracks.</p>
      <div class="figs"><div><b class="fig">${faster}/${e3.pairs}</b><span>pairs where the trained cars lapped B sooner</span></div>
        <div><b class="fig">${ties}</b><span>ties</span></div>
        <div><b class="fig">${median(done(e3.transfer))} vs ${median(done(e3.fresh))}</b><span>median generation to a first lap on B, trained vs from scratch</span></div></div>
      <canvas class="chart c3" role="img" aria-label="Generations to a first lap on track B per pair, from scratch vs after training on track A"></canvas>
      <ul class="legend"><li><i style="background:${BASELINE}"></i>From scratch on B</li><li><i style="background:${COLORS.car}"></i>After training on A</li></ul>
      <h3>Which corners still cause scrapes</h3>
      <p>Every corner of B (tighter than a ${e3.cornerRadius} m radius), with the wall contacts the trained cars made there on their first attempt.
        Red corners are tighter than anything on A. ${crashes(rest) === 0 && crashes(tight) > 0
          ? `All ${crashes(tight)} crash contacts happened there; corners A had already taught drew none.`
          : `They drew ${crashes(tight)} crash contacts, against ${crashes(rest)} at corners A had already taught.`}
        Scrapes are spread across both (${contacts(tight).toFixed(1)} vs ${contacts(rest).toFixed(1)} contacts per corner on average).</p>
      <canvas class="chart c4" role="img" aria-label="Wall contacts per corner of track B by corner radius; corners tighter than any on track A highlighted"></canvas>
      <ul class="legend"><li><i style="background:${RED}"></i>Tighter than any corner on A (${tight.length})</li><li><i class="ring"></i>Within what A taught (${rest.length})</li></ul>
      ${table(['Pair', 'From scratch', 'After A'], e3.fresh.map((f, i) => [i + 1, f ?? 'did not lap', e3.transfer[i] ?? 'did not lap']))}
    </section>

    <section class="how" aria-labelledby="how">
      <h2 id="how">How it works</h2>
      <div class="cols">
        <div><h3>Sensors</h3><p>Each vehicle sees the world through ${RAY_ANGLES.length} distance rays, from ${RAY_ANGLES[0]}° to +${RAY_ANGLES.at(-1)}°, each reaching ${RAY_LENGTH} m,
          plus its own speed. Nothing else: no map, no position, no idea where the track goes next.</p></div>
        <div><h3>Neural network</h3><p>Those ${LAYERS[0]} numbers feed a ${LAYERS.join(' → ')} network, ${weightCount(LAYERS)} weights in all, written from scratch.
          Its two outputs are steering and throttle, every simulation tick.</p></div>
        <div><h3>Genetic algorithm</h3><p>No gradients and no labelled data. Each generation, ${POP_SIZE} vehicles drive and are scored on distance, lap time and damage.
          The top ${DEFAULT_GA.eliteCount} survive unchanged; the rest are bred from tournament winners (${DEFAULT_GA.tournamentSize} at a time) and ${Math.round(DEFAULT_GA.mutationRate * 100)}% of their weights mutated.</p></div>
      </div>
      <p class="why">Why transfer works at all: because the sensors are local, a brain never learns <em>this track</em>. It learns how to react to
        walls at a given distance and speed, and a left-hander on track B looks the same as one on A. Where it still slips is a corner tighter
        than anything it has met, which is where the red corners above drew their crashes.</p>
    </section>
  </main>`;
  app.append(tip);

  const draw = () => {
    const q = (s: string) => app.querySelector<HTMLCanvasElement>(s)!;
    stripChart(q('.c1'), KINDS.flatMap((k) => [
      { label: `${NAME[k]} pre-trained`, color: COLORS[k], values: e1.pretrained[k], fmt: pct },
      { label: `${NAME[k]} random`, color: BASELINE, values: e1.fresh[k], fmt: pct },
    ]), { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: pct });
    const gmax = Math.max(5, ...done([...e2.car, ...e2.bike]));
    const gstep = gmax > 20 ? 5 : gmax > 10 ? 2 : 1;
    stripChart(q('.c2'), KINDS.map((k) => ({
      label: NAME[k], color: COLORS[k], values: done(e2[k]), dnf: e2[k].length - done(e2[k]).length,
      fmt: (v: number) => `generation ${v}`,
    })), { grid: true, max: gmax, ticks: Array.from({ length: Math.floor(gmax / gstep) + 1 }, (_, i) => i * gstep).filter((v) => v > 0), fmt: String, dnfLabel: 'did not lap' });
    pairsChart(q('.c3'), e3.fresh, e3.transfer, e3.cap);
    cornersChart(q('.c4'), e3.corners, e3.cornerRadius);
  };
  void document.fonts.ready.then(draw);
  let raf = 0;
  addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
}

fetch(`${import.meta.env.BASE_URL}results/experiments.json`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .then(render)
  .catch(() => { document.getElementById('app')!.innerHTML = '<main><p class="lede">No results yet. Run <code>npm run experiments</code> to generate them.</p></main>'; });
