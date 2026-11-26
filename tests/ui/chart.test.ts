import { niceStep, shade } from '../../src/ui/chart';

test('niceStep picks 1/2/5 x 10^k steps', () => {
  expect(niceStep(10, 4)).toBe(5);
  expect(niceStep(41, 3)).toBe(20);
  expect(niceStep(250, 3)).toBe(100);
  expect(niceStep(0.6, 3)).toBeCloseTo(0.2);
  expect(niceStep(29, 4)).toBe(10);
});

test('shade mixes toward white or black', () => {
  expect(shade('#ff8000', 0)).toBe('rgb(255,128,0)');
  expect(shade('#ff8000', 1)).toBe('rgb(255,255,255)');
  expect(shade('#ff8000', -1)).toBe('rgb(0,0,0)');
  expect(shade('#000000', 0.5)).toBe('rgb(128,128,128)');
});
