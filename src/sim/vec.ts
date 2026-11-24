export type Vec2 = { x: number; y: number };

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const norm = (a: Vec2): Vec2 => { const l = len(a); return l === 0 ? { x: 0, y: 0 } : scale(a, 1 / l); };
export const rotate = (a: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b));

/** Intersection of segments a1-a2 and b1-b2; t,u in [0,1] are positions along each. */
export function segmentIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): { t: number; u: number } | null {
  const r = sub(a2, a1), s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const q = sub(b1, a1);
  const t = cross(q, s) / denom, u = cross(q, r) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}
