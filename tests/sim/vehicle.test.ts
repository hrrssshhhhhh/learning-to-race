import { BIKE, CAR, newVehicleState, stepVehicle } from '../../src/sim/vehicle';

test('throttle accelerates, clamped at maxSpeed', () => {
  const s = newVehicleState({ pos: { x: 0, y: 0 }, heading: 0 });
  for (let i = 0; i < 6000; i++) stepVehicle(s, CAR, { steer: 0, throttle: 1 }, 1 / 60);
  expect(s.speed).toBeLessThanOrEqual(CAR.maxSpeed);
  expect(s.speed).toBeGreaterThan(CAR.maxSpeed * 0.8);
  expect(s.pos.x).toBeGreaterThan(0);
  expect(Math.abs(s.pos.y)).toBeLessThan(1e-6);
});
test('brake never makes speed negative', () => {
  const s = newVehicleState({ pos: { x: 0, y: 0 }, heading: 0 });
  for (let i = 0; i < 600; i++) stepVehicle(s, CAR, { steer: 0, throttle: -1 }, 1 / 60);
  expect(s.speed).toBe(0);
});
test('positive steer turns left (heading increases)', () => {
  const s = newVehicleState({ pos: { x: 0, y: 0 }, heading: 0 });
  s.speed = 10;
  stepVehicle(s, CAR, { steer: 1, throttle: 0 }, 1 / 60);
  expect(s.heading).toBeGreaterThan(0);
});
test('bike accelerates faster but turns less at top speed', () => {
  expect(BIKE.accel).toBeGreaterThan(CAR.accel);
  expect(BIKE.width).toBeLessThan(CAR.width);
  expect(BIKE.steerAtSpeedFactor).toBeLessThan(CAR.steerAtSpeedFactor);
});
