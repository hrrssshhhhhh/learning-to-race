import { segmentIntersect, rotate } from '../../src/sim/vec';

test('crossing segments intersect at midpoint', () => {
  const hit = segmentIntersect({x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0});
  expect(hit!.t).toBeCloseTo(0.5); expect(hit!.u).toBeCloseTo(0.5);
});
test('parallel segments do not intersect', () => {
  expect(segmentIntersect({x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1})).toBeNull();
});
test('rotate 90°', () => { const v = rotate({x:1,y:0}, Math.PI/2); expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(1); });
