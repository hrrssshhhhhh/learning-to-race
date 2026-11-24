import { buildTrack, validateTrack, TRACK_WIDTH } from '../../src/sim/track';
import { DEFAULT_TRACK } from '../../src/sim/defaultTrack';
import { dist, dot, sub } from '../../src/sim/vec';

const circle = (r: number, n = 24) => Array.from({ length: n }, (_, i) => ({ x: r * Math.cos(2*Math.PI*i/n), y: r * Math.sin(2*Math.PI*i/n) }));
test('default track is valid', () => expect(validateTrack(DEFAULT_TRACK)).toEqual({ ok: true }));
test('rejects too few points', () => expect(validateTrack(circle(100, 3))).toEqual({ ok: false, reason: 'too-few-points' }));
test('rejects tiny loop', () => expect(validateTrack(circle(20))).toEqual({ ok: false, reason: 'too-short' }));
test('rejects figure-eight', () => {
  const eight = Array.from({ length: 32 }, (_, i) => { const t = 2*Math.PI*i/32; return { x: 300*Math.sin(t), y: 150*Math.sin(2*t) }; });
  expect(validateTrack(eight)).toEqual({ ok: false, reason: 'self-intersect' });
});
test('rejects impossibly tight hairpin', () => {
  const pin = [{x:0,y:0},{x:300,y:0},{x:300,y:6},{x:0,y:6}];
  expect(validateTrack(pin).ok).toBe(false);
});
test('clockwise and counter-clockwise give same checkpoint count and forward start', () => {
  const ccw = buildTrack(circle(150)); const cw = buildTrack([...circle(150)].reverse());
  expect(cw.checkpoints.length).toBe(ccw.checkpoints.length);
  for (const t of [ccw, cw]) {
    const fwd = { x: Math.cos(t.start.heading), y: Math.sin(t.start.heading) };
    const toNext = sub(t.center[5], t.center[0]);
    expect(dot(fwd, toNext)).toBeGreaterThan(0);
  }
});
test('start is placed on the straightest section', () => {
  // long straight along y=0 from x=0..600, then a loop back
  const stadium = [{x:0,y:0},{x:600,y:0},{x:700,y:100},{x:600,y:200},{x:0,y:200},{x:-100,y:100}];
  const rotated = [...stadium.slice(2), ...stadium.slice(0, 2)]; // first point mid-corner
  const t = buildTrack(rotated);
  expect(Math.abs(t.start.pos.y - 0) < 20 || Math.abs(t.start.pos.y - 200) < 20).toBe(true);
});
test('walls are width apart', () => {
  const t = buildTrack(DEFAULT_TRACK);
  for (let i = 0; i < t.center.length; i += 50) expect(dist(t.inner[i], t.outer[i])).toBeCloseTo(TRACK_WIDTH, 1);
});
test('rejects too-long loop', () => expect(validateTrack(circle(800, 48))).toEqual({ ok: false, reason: 'too-long' }));
test('reports too-tight for a ~6 m radius corner', () => {
  // long loop whose one corner is a ~6 m radius semicircle (below the 9 m minimum)
  const pts = [{x:0,y:0},{x:300,y:0},{x:306,y:6},{x:300,y:12},{x:0,y:12},{x:-100,y:6}];
  const r = validateTrack(pts);
  expect(r).toEqual({ ok: false, reason: 'too-tight' });
});
