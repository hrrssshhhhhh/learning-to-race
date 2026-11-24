import { strokeToControlPoints, EDITOR_METERS_PER_PX } from '../../src/editor/editor';
import { validateTrack } from '../../src/sim/track';

const ellipse = (n: number, close = false) =>
  Array.from({ length: n + (close ? 1 : 0) }, (_, i) => ({ x: 300 + 120 * Math.cos((2 * Math.PI * i) / n), y: 300 + 120 * Math.sin((2 * Math.PI * i) / n) }));

test('circle stroke simplifies to a valid track', () => {
  const stroke = ellipse(400);
  const pts = strokeToControlPoints(stroke, EDITOR_METERS_PER_PX);
  expect(pts.length).toBeGreaterThanOrEqual(4); expect(pts.length).toBeLessThanOrEqual(60);
  expect(validateTrack(pts)).toEqual({ ok: true });
});
test('closing duplicate point is dropped and count stays in 10..40', () => {
  const pts = strokeToControlPoints(ellipse(400, true), EDITOR_METERS_PER_PX);
  expect(pts.length).toBeGreaterThanOrEqual(10); expect(pts.length).toBeLessThanOrEqual(40);
  expect(pts[0]).not.toEqual(pts[pts.length - 1]);
});
test('scribble is rejected, not thrown', () => {
  const stroke = Array.from({ length: 50 }, (_, i) => ({ x: (i * 37) % 200, y: (i * 91) % 200 }));
  expect(() => validateTrack(strokeToControlPoints(stroke, EDITOR_METERS_PER_PX))).not.toThrow();
});
test('degenerate input never throws', () => {
  const p = { x: 5, y: 5 };
  for (const s of [[], [p], [p, p, p], [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }], [{ x: NaN, y: 1 }, p]])
    expect(() => validateTrack(strokeToControlPoints(s, EDITOR_METERS_PER_PX))).not.toThrow();
});
test('huge noisy stroke is capped at 40 points', () => {
  const stroke = Array.from({ length: 2000 }, (_, i) => ({ x: i * 0.5, y: Math.sin(i) * 80 }));
  expect(strokeToControlPoints(stroke, 2).length).toBeLessThanOrEqual(40);
});
