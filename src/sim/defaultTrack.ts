import type { Vec2 } from './vec';

/** Control points (m), ~2 km lap: long straight, fast sweeper, hairpin, chicane, return leg. */
export const DEFAULT_TRACK: Vec2[] = [
  { x: 0, y: 0 }, { x: 90, y: 0 }, { x: 180, y: 0 }, { x: 258, y: 0 },
  { x: 312, y: 15 }, { x: 348, y: 54 }, { x: 336, y: 102 }, { x: 288, y: 138 },
  { x: 228, y: 144 }, { x: 150, y: 144 }, { x: 90, y: 144 },
  { x: 60, y: 147 }, { x: 45, y: 162 }, { x: 60, y: 180 },
  { x: 96, y: 180 }, { x: 144, y: 186 }, { x: 174, y: 198 }, { x: 204, y: 174 }, { x: 234, y: 180 },
  { x: 312, y: 180 }, { x: 384, y: 180 }, { x: 432, y: 162 }, { x: 450, y: 120 }, { x: 450, y: 60 },
  { x: 444, y: -30 }, { x: 420, y: -60 },
  { x: 330, y: -60 }, { x: 180, y: -60 }, { x: 0, y: -60 },
  { x: -48, y: -54 }, { x: -78, y: -33 }, { x: -78, y: -9 }, { x: -54, y: 3 }, { x: -24, y: 2 },
];
