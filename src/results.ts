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
import { mean, median, bootstrapCI, wilcoxon, fmtP } from './stats';

type Kind = 'car' | 'bike';
type Gen = number | null; // null = milestone not reached within the generation cap
interface Milestones { first: Gen; half: Gen }
interface Results {
  generated: string;
  setup: { tracks: string; population: number; half: number; genCap: number; extraGens: number; cornerRadius: number; unseenTracks: number };
  exp1: { tracks: number; pretrained: Record<Kind, number[]>; fresh: Record<Kind, number[]> };
  exp2: { tracks: number } & Record<Kind, Milestones[]>;
  exp3: { pairs: number; fresh: Milestones[]; transfer: Milestones[]; corners: { radius: number; scrapes: number; crashes: number; tighterThanA: boolean }[] };
  exp4: { seeds: number; configs: Record<string, (Milestones & { unseen: number })[]> };
}

// Respect reduced-motion users: keep native scroll for them.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) new Lenis({ autoRaf: true });

const MUTED = '#7d7d88', TEXT_2 = '#b8b8c2', GRID = 'rgba(255,255,255,.06)', BASE = 'rgba(255,255,255,.16)', BASELINE = '#9b9ba5', RED = '#e10600';
const FONT = '600 12px "Barlow Condensed", sans-serif';
const NAME: Record<Kind, string> = { car: 'Cars', bike: 'Bikes' };
const KINDS: Kind[] = ['car', 'bike'];
const STACK = 7; // beeswarm slots per row (centre plus three each side) before a pile collapses to a count

const pct = (v: number) => `${Math.round(v * 100)}%`;

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
  const { exp1: e1, exp2: e2, exp3: e3, exp4: e4, setup } = d, cap = setup.genCap;
  const gen = (g: Gen) => g ?? cap + 1; // censored runs rank after every run that made it
  const genTxt = (g: Gen) => (g === null ? `not within ${cap}` : String(g));
  const range = ([lo, hi]: [number, number], f: (v: number) => string) => `95% CI ${f(lo)} to ${f(hi)}`;
  const one = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  // 01: completion on unseen tracks
  const preCI = KINDS.map((k) => bootstrapCI(e1.pretrained[k]));
  const e1test = wilcoxon([...e1.pretrained.car, ...e1.pretrained.bike], [...e1.fresh.car, ...e1.fresh.bike]);
  // 02: cars vs bikes, paired by track
  const half2 = (k: Kind) => e2[k].map((m) => gen(m.half)), first2 = (k: Kind) => e2[k].map((m) => gen(m.first));
  const d2 = half2('car').map((v, i) => v - half2('bike')[i]), t2 = wilcoxon(half2('car'), half2('bike')), dCI2 = bootstrapCI(d2, median);
  const md2 = median(d2);
  const verdict2 = t2.p >= 0.05 ? `The difference is not statistically significant (${fmtP(t2.p)}): with ${e2.tracks} tracks, cars and bikes learn at about the same speed.`
    : `${md2 > 0 ? 'Bikes' : 'Cars'} learn faster (${fmtP(t2.p)}). The network is identical, so the gap comes from how each vehicle handles.`;
  // 03: transfer, paired by track pair
  const hf = e3.fresh.map((m) => gen(m.half)), ht = e3.transfer.map((m) => gen(m.half));
  const t3 = wilcoxon(hf, ht), d3 = hf.map((v, i) => v - ht[i]), dCI3 = bootstrapCI(d3, median);
  const sooner = d3.filter((v) => v > 0).length, ties = d3.filter((v) => v === 0).length;
  const tight = e3.corners.filter((k) => k.tighterThanA), rest = e3.corners.filter((k) => !k.tighterThanA);
  const crashes = (ks: typeof tight) => ks.reduce((n, k) => n + k.crashes, 0), allCrashes = crashes(e3.corners);
  const contacts = (ks: typeof tight) => mean(ks.map((k) => k.scrapes + k.crashes));
  // 04: sensor ablation, paired by training track
  const cfgs = Object.keys(e4.configs).sort((a, b) => +a - +b), full = cfgs.at(-1)!;
  const unseen = (c: string) => e4.configs[c].map((r) => r.unseen), halfs = (c: string) => e4.configs[c].map((r) => gen(r.half));
  const vsFull = Object.fromEntries(cfgs.filter((c) => c !== full).map((c) => [c, wilcoxon(unseen(c), unseen(full))]));

  const app = document.getElementById('app')!;
  app.innerHTML = `
  <header class="top"><a class="mark" href="./">Self-learning vehicles</a><a class="back" href="./">Back to the race</a></header>
  <main>
    <section class="intro">
      <p class="tag">Results</p>
      <h1>What the vehicles learned</h1>
      <p class="lede">Four experiments, run headless with the same simulation the browser uses, on a harder family of random tracks than the app's
        (more and tighter corners). A population counts as having <em>learned</em> a track when half of it (${setup.half} of ${setup.population}) completes a lap
        in one generation. Every run is seeded, so <code>npm run experiments</code> reproduces these numbers. Data generated ${d.generated}.</p>
      <p class="method">Intervals are 95% bootstrap confidence intervals. Paired comparisons use the Wilcoxon signed-rank test (two-sided).
        Runs that miss a milestone within ${cap} generations are ranked last.</p>
    </section>

    <section class="exp" aria-labelledby="e1">
      <p class="num fig">01</p>
      <h2 id="e1">Does pre-training carry over to tracks it has never seen?</h2>
      <p>The shipped pre-trained population learned on the default track only. Here it gets one attempt on ${e1.tracks} hard random tracks
        it has never seen, next to ${POP_SIZE} random brains on the same tracks. Each dot is one track: the share of the population that completed a lap.</p>
      <div class="figs">${KINDS.map((k, i) => `<div><b class="fig">${pct(mean(e1.pretrained[k]))}</b><span>${NAME[k].toLowerCase()} pre-trained, mean completion</span><small>${range(preCI[i], pct)}</small></div>`).join('')}
        <div><b class="fig">${pct(mean([...e1.fresh.car, ...e1.fresh.bike]))}</b><span>random brains, mean completion</span><small>${fmtP(e1test.p)} vs pre-trained</small></div></div>
      <canvas class="chart c1" role="img" aria-label="Completion rate per unseen track, pre-trained vs random brains, for cars and bikes"></canvas>
      <ul class="legend"><li><i style="background:${COLORS.car}"></i>Pre-trained cars</li><li><i style="background:${COLORS.bike}"></i>Pre-trained bikes</li><li><i style="background:${BASELINE}"></i>Random brains</li><li><i class="tick"></i>Median</li></ul>
      ${table(['Track', 'Cars pre-trained', 'Cars random', 'Bikes pre-trained', 'Bikes random'],
        e1.pretrained.car.map((_, i) => [i + 1, pct(e1.pretrained.car[i]), pct(e1.fresh.car[i]), pct(e1.pretrained.bike[i]), pct(e1.fresh.bike[i])]))}
    </section>

    <section class="exp" aria-labelledby="e2">
      <p class="num fig">02</p>
      <h2 id="e2">Who learns faster, cars or bikes?</h2>
      <p>Both start from random brains on the same ${e2.tracks} tracks with the same seeds. Each dot is one track: the generation in which half the
        population first completed a lap. ${verdict2}</p>
      <div class="figs">${KINDS.map((k) => `<div><b class="fig">${one(median(half2(k)))}</b><span>${NAME[k].toLowerCase()}, median generation to learn a track</span><small>first lap: median ${one(median(first2(k)))}</small></div>`).join('')}
        <div><b class="fig">${md2 > 0 ? '+' : ''}${one(md2)}</b><span>median difference, cars minus bikes</span><small>${range(dCI2, one)} · ${fmtP(t2.p)}</small></div></div>
      <canvas class="chart c2" role="img" aria-label="Generations until half the population laps, per track, cars vs bikes"></canvas>
      <ul class="legend"><li><i style="background:${COLORS.car}"></i>Cars</li><li><i style="background:${COLORS.bike}"></i>Bikes</li><li><i class="tick"></i>Median</li>${KINDS.some((k) => e2[k].some((m) => m.half === null)) ? `<li><i class="ring"></i>Not within ${cap} generations</li>` : ''}</ul>
      ${table(['Track', 'Cars: first lap', 'Cars: half lap', 'Bikes: first lap', 'Bikes: half lap'], e2.car.map((c, i) => [i + 1, genTxt(c.first), genTxt(c.half), genTxt(e2.bike[i].first), genTxt(e2.bike[i].half)]))}
    </section>

    <section class="exp" aria-labelledby="e3">
      <p class="num fig">03</p>
      <h2 id="e3">Does learning one track help on the next?</h2>
      <p>Cars learn track A, then train ${setup.extraGens} more generations. That population moves to a new track B and keeps evolving, next to random brains
        starting on B. ${e3.pairs} pairs of tracks. Each row is one pair: generations until half the population laps B.</p>
      <div class="figs"><div><b class="fig">${sooner}/${e3.pairs}</b><span>pairs where the trained cars learned B sooner</span><small>${ties} ties</small></div>
        <div><b class="fig">${one(median(ht))} vs ${one(median(hf))}</b><span>median generation to learn B, trained vs from scratch</span></div>
        <div><b class="fig">${one(median(d3))}</b><span>median generations saved</span><small>${range(dCI3, one)} · ${fmtP(t3.p)}</small></div></div>
      <canvas class="chart c3" role="img" aria-label="Generations until half the population laps track B, per pair, from scratch vs after training on track A"></canvas>
      <ul class="legend"><li><i style="background:${BASELINE}"></i>From scratch on B</li><li><i style="background:${COLORS.car}"></i>After training on A</li></ul>
      <h3>Which corners still cause trouble</h3>
      <p>Every corner of B (tighter than a ${setup.cornerRadius} m radius), with the wall contacts the trained cars made there on their first attempt.
        Red corners are tighter than anything on A: they are ${pct(tight.length / (e3.corners.length || 1))} of all corners and drew
        ${allCrashes ? pct(crashes(tight) / allCrashes) : 'none'} of the ${allCrashes} crash contacts.
        Contacts per corner, scrapes included: ${contacts(tight).toFixed(1)} at red corners, ${contacts(rest).toFixed(1)} elsewhere.</p>
      <canvas class="chart c4" role="img" aria-label="Wall contacts per corner of track B by corner radius; corners tighter than any on track A highlighted"></canvas>
      <ul class="legend"><li><i style="background:${RED}"></i>Tighter than any corner on A (${tight.length})</li><li><i class="ring"></i>Within what A taught (${rest.length})</li></ul>
      ${table(['Pair', 'From scratch', 'After A'], e3.fresh.map((f, i) => [i + 1, genTxt(f.half), genTxt(e3.transfer[i].half)]))}
    </section>

    <section class="exp" aria-labelledby="e4">
      <p class="num fig">04</p>
      <h2 id="e4">How much does each sensor matter?</h2>
      <p>The same experiment with fewer eyes: networks that see ${cfgs.join(', ')} of the ${RAY_ANGLES.length} rays (plus speed). Each learns one track
        (${e4.seeds} training tracks, shared across settings), trains ${setup.extraGens} more generations, then gets one attempt on each of ${setup.unseenTracks} tracks
        it has never seen. Each dot is one training track: the mean completion on the unseen ones.</p>
      <div class="figs">${cfgs.map((c) => `<div><b class="fig">${pct(mean(unseen(c)))}</b><span>${c} rays, completion on unseen tracks</span><small>${c === full ? range(bootstrapCI(unseen(c)), pct) : `${fmtP(vsFull[c].p)} vs ${full} rays`}</small></div>`).join('')}</div>
      <canvas class="chart c5" role="img" aria-label="Completion on unseen tracks per training track, by number of sensor rays"></canvas>
      <ul class="legend"><li><i style="background:${COLORS.car}"></i>Mean over ${setup.unseenTracks} unseen tracks</li><li><i class="tick"></i>Median</li></ul>
      ${table(['Training track', ...cfgs.flatMap((c) => [`${c} rays: learned in`, `${c} rays: unseen`])],
        Array.from({ length: e4.seeds }, (_, i) => [i + 1, ...cfgs.flatMap((c) => [genTxt(e4.configs[c][i].half), pct(e4.configs[c][i].unseen)])]))}
      <p class="small">Median generations to learn the training track: ${cfgs.map((c) => `${c} rays ${one(median(halfs(c)))}`).join(', ')}.</p>
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
      <p class="why">Why transfer can work at all: the sensors are local, so a brain never learns <em>this track</em>. It learns how to react to
        walls at a given distance and speed, and a left-hander on track B looks the same as one on A. Experiments 01 and 03 test that idea;
        the red corners show where it stops holding.</p>
      <p class="method">The full write-up, with method and limitations: <a href="https://github.com/hrrssshhhhhh/learning-to-race/blob/main/docs/report.md">project report</a>. Code: <a href="https://github.com/hrrssshhhhhh/learning-to-race">GitHub</a>.</p>
    </section>
  </main>`;
  app.append(tip);

  const draw = () => {
    const q = (s: string) => app.querySelector<HTMLCanvasElement>(s)!;
    stripChart(q('.c1'), KINDS.flatMap((k) => [
      { label: `${NAME[k]} pre-trained`, color: COLORS[k], values: e1.pretrained[k], fmt: pct },
      { label: `${NAME[k]} random`, color: BASELINE, values: e1.fresh[k], fmt: pct },
    ]), { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: pct });
    const reached = (k: Kind) => e2[k].map((m) => m.half).filter((g): g is number => g !== null);
    const gmax = Math.max(5, ...KINDS.flatMap(reached)), gstep = gmax > 20 ? 5 : gmax > 10 ? 2 : 1;
    stripChart(q('.c2'), KINDS.map((k) => ({
      label: NAME[k], color: COLORS[k], values: reached(k), dnf: e2.tracks - reached(k).length, fmt: (v: number) => `generation ${v}`,
    })), { max: gmax, ticks: Array.from({ length: Math.floor(gmax / gstep) + 1 }, (_, i) => i * gstep), fmt: String, dnfLabel: `not in ${cap}` });
    pairsChart(q('.c3'), e3.fresh.map((m) => m.half), e3.transfer.map((m) => m.half), cap);
    cornersChart(q('.c4'), e3.corners, setup.cornerRadius);
    stripChart(q('.c5'), cfgs.map((c) => ({ label: `${c} rays`, color: COLORS.car, values: unseen(c), fmt: pct })), { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: pct });
  };
  void document.fonts.ready.then(draw);
  let raf = 0;
  addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
}

const fail = (msg: string) => { document.getElementById('app')!.innerHTML = `<main><section class="intro"><p class="lede">${msg}</p></section></main>`; };
fetch(`${import.meta.env.BASE_URL}results/experiments.json`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then(
    (d: Results) => {
      // a results file from an older version of the experiments has a different shape; say so instead of half-rendering
      if (!d.setup || !d.exp4) return fail('These results were generated by an older version of the experiments. Run <code>npm run experiments</code> to regenerate them.');
      try { render(d); } catch (e) { console.error(e); fail('The results could not be displayed. See the browser console for details.'); }
    },
    () => fail('No results yet. Run <code>npm run experiments</code> to generate them.'),
  );
