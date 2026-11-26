import { corners } from '../../scripts/experiments';

/** Closed loop: two long straights joined by two half-circles of radius r, sampled every ~2 m. */
function stadium(r: number, straight: number) {
  const pts: { x: number; y: number }[] = [];
  for (let x = 0; x < straight; x += 2) pts.push({ x, y: -r });
  for (let a = -Math.PI / 2; a < Math.PI / 2; a += 2 / r) pts.push({ x: straight + r * Math.cos(a), y: r * Math.sin(a) });
  for (let x = straight; x > 0; x -= 2) pts.push({ x, y: r });
  for (let a = Math.PI / 2; a < 1.5 * Math.PI; a += 2 / r) pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  return pts;
}

test('corners finds both hairpins of a stadium, with their radius', () => {
  const cs = corners(stadium(20, 200));
  expect(cs).toHaveLength(2);
  for (const c of cs) expect(c.radius).toBeGreaterThan(17), expect(c.radius).toBeLessThan(23);
});
test('wide bends are not corners', () => {
  expect(corners(stadium(80, 200))).toHaveLength(0);
});
