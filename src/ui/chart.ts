export interface Series { label: string; color: string; points: number[] }

const MAX_GENS = 30; // older generations scroll off so bars stay readable

/** Sizes the backing store to the CSS box (crisp on hi-dpi) and returns a context in CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement): { c: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return { c, w, h };
}

/** Best fitness per generation as grouped bars (one bar per series per generation). A line would be too noisy. */
export function drawChart(canvas: HTMLCanvasElement, series: Series[]): void {
  const { c, w, h } = fitCanvas(canvas);
  c.font = '11px system-ui, sans-serif'; c.fillStyle = '#9aa0ad';
  const n = Math.max(0, ...series.map((s) => s.points.length));
  if (!n) { c.fillText('Bars appear after the first generation ends', 4, h / 2); return; }
  const start = Math.max(0, n - MAX_GENS), gens = n - start;
  const top = Math.max(1, ...series.flatMap((s) => s.points.slice(start)));
  const L = 30, B = 16, T = 6, pw = w - L - 2, ph = h - B - T;
  c.textAlign = 'right';
  c.fillText(top.toFixed(0), L - 4, T + 9); c.fillText('0', L - 4, T + ph);
  c.textAlign = 'left'; c.fillText(`gen ${start + 1}`, L, h - 3);
  c.textAlign = 'right'; c.fillText(`gen ${n}`, w - 2, h - 3);
  c.strokeStyle = '#3a3f4b'; c.beginPath(); c.moveTo(L, T + ph + 0.5); c.lineTo(w - 2, T + ph + 0.5); c.stroke();
  const group = pw / gens, bar = (group * 0.8) / series.length;
  series.forEach((s, k) => {
    c.fillStyle = s.color;
    for (let g = 0; g < gens; g++) {
      const v = s.points[start + g];
      if (v === undefined) continue;
      const bh = (Math.max(0, v) / top) * ph; // damage can push fitness below 0; show as no bar
      c.fillRect(L + g * group + group * 0.1 + k * bar, T + ph - bh, Math.max(1, bar - 1), bh);
    }
  });
}
