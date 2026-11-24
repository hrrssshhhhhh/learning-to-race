import { Vec2 } from './vec';
import { Rng } from './rng';
import { validateTrack } from './track';

const MAX_TRIES = 200;

/** Gentle ellipse with a little radial jitter; far from any validity limit. */
export function fallbackTrack(rng: Rng): Vec2[] {
  const a = 250 + rng() * 100, b = 150 + rng() * 60, n = 10;
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n, j = 1 + (rng() - 0.5) * 0.06;
    return { x: a * j * Math.cos(t), y: b * j * Math.sin(t) };
  });
}

/** Valid closed-track control points: sorted random angles, varied radii (sweepers, hairpins, chicanes). Retries until valid. */
export function randomTrack(rng: Rng): Vec2[] {
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const n = 8 + Math.floor(rng() * 7);
    const pts: Vec2[] = [];
    let r = 150 + rng() * 300;
    for (let i = 0; i < n; i++) {
      // radius random walk, with occasional jumps that make hairpins/chicanes
      r += (rng() - 0.5) * (rng() < 0.3 ? 300 : 100);
      r = Math.min(450, Math.max(150, r));
      const t = (2 * Math.PI * (i + 0.5 * (rng() - 0.5))) / n;
      pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
    }
    if (validateTrack(pts).ok) return pts;
  }
  return fallbackTrack(rng);
}
