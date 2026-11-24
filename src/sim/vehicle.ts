import type { Vec2 } from './vec';

export type VehicleKind = 'car' | 'bike';

export interface VehicleSpec {
  kind: VehicleKind;
  length: number; // m; also the wheelbase in the bicycle model
  width: number; // m; used for wall contact
  maxSpeed: number; // m/s
  accel: number; // m/s^2 at full throttle
  brake: number; // m/s^2 at full brake
  maxSteer: number; // rad, front wheel angle when slow
  steerAtSpeedFactor: number; // fraction of maxSteer still available at maxSpeed (grip proxy)
  drag: number; // 1/s, linear speed-proportional slowdown
}

export const CAR: VehicleSpec = { kind: 'car', length: 4.5, width: 1.9, maxSpeed: 55, accel: 9, brake: 20, maxSteer: 0.6, steerAtSpeedFactor: 0.35, drag: 0.02 };
// Bike: quicker off the line and narrower, but loses more steering as it speeds up.
export const BIKE: VehicleSpec = { kind: 'bike', length: 2.1, width: 0.8, maxSpeed: 55, accel: 12, brake: 16, maxSteer: 0.7, steerAtSpeedFactor: 0.2, drag: 0.02 };
export const SPECS: Record<VehicleKind, VehicleSpec> = { car: CAR, bike: BIKE };

/** Both in [-1, 1]. steer > 0 turns left; throttle < 0 brakes. */
export interface Controls { steer: number; throttle: number }

export interface VehicleState {
  pos: Vec2;
  heading: number; // radians, 0 = +x, counter-clockwise positive
  speed: number;
  alive: boolean;
  damage: number;
  // Bookkeeping below is owned by the world loop (Task 9), not by stepVehicle.
  nextCheckpoint: number;
  checkpointsPassed: number;
  laps: number;
  ticks: number;
  ticksSinceProgress: number;
  lapStartTick: number;
  bestLapTicks: number | null;
  firstLapTick: number | null;
}

export function newVehicleState(start: { pos: Vec2; heading: number }): VehicleState {
  return {
    pos: { x: start.pos.x, y: start.pos.y }, heading: start.heading, speed: 0, alive: true, damage: 0,
    nextCheckpoint: 0, checkpointsPassed: 0, laps: 0, ticks: 0, ticksSinceProgress: 0,
    lapStartTick: 0, bestLapTicks: null, firstLapTick: null,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Motion physics only (kinematic bicycle model). Does not touch ticks/checkpoint/lap fields: the world loop does. */
export function stepVehicle(s: VehicleState, spec: VehicleSpec, c: Controls, dt: number): void {
  const steer = clamp(c.steer, -1, 1);
  const throttle = clamp(c.throttle, -1, 1);

  // Positive throttle accelerates, negative brakes; drag always bleeds speed.
  const a = throttle >= 0 ? throttle * spec.accel : throttle * spec.brake;
  s.speed = clamp(s.speed + (a - spec.drag * s.speed) * dt, 0, spec.maxSpeed);

  // Less usable steering at speed, so fast corners must be taken early and gently.
  const t = s.speed / spec.maxSpeed;
  const wheel = steer * spec.maxSteer * (1 + (spec.steerAtSpeedFactor - 1) * t);

  s.heading += (s.speed / spec.length) * Math.tan(wheel) * dt;
  s.pos.x += Math.cos(s.heading) * s.speed * dt;
  s.pos.y += Math.sin(s.heading) * s.speed * dt;
}
