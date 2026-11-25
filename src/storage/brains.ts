import { LAYERS, weightCount, type Brain } from '../ml/nn';
import type { VehicleKind } from '../sim/vehicle';

/** One population on disk: same format for shipped brains (public/brains) and the user's saved ones (localStorage). */
export interface PopulationFile { version: 1; kind: VehicleKind; layers: number[]; brains: number[][] }
export type StartPoint = 'fresh' | 'mine' | 'generalist';

export function toFile(kind: VehicleKind, brains: Brain[]): PopulationFile {
  return { version: 1, kind, layers: LAYERS.slice(), brains: brains.map((b) => Array.from(b.weights)) };
}

/** Untrusted input (old saves, hand-edited storage, a bad fetch): anything not matching today's net shape is null. */
export function fromFile(f: unknown): Brain[] | null {
  const p = f as Partial<PopulationFile> | null;
  if (!p || p.version !== 1 || !Array.isArray(p.layers) || p.layers.join() !== LAYERS.join()) return null;
  if (!Array.isArray(p.brains) || !p.brains.length) return null;
  const n = weightCount(LAYERS);
  if (!p.brains.every((w) => Array.isArray(w) && w.length === n && w.every(Number.isFinite))) return null;
  return p.brains.map((w) => ({ layers: LAYERS.slice(), weights: Float32Array.from(w) }));
}

const key = (kind: VehicleKind) => `slv.my.${kind}`;
// localStorage itself can throw (private mode, disabled storage), so it is only touched inside try
const local = (): Storage | undefined => { try { return window.localStorage; } catch { return undefined; } };

export function saveMyVehicles(kind: VehicleKind, brains: Brain[], storage = local()): boolean {
  try { storage!.setItem(key(kind), JSON.stringify(toFile(kind, brains))); return true; } catch { return false; }
}

export function loadMyVehicles(kind: VehicleKind, storage = local()): Brain[] | null {
  try { return fromFile(JSON.parse(storage!.getItem(key(kind)) ?? 'null')); } catch { return null; }
}

export async function loadShipped(name: 'specialist' | 'generalist', kind: VehicleKind): Promise<Brain[] | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}brains/${name}-${kind}.json`);
    return r.ok ? fromFile(await r.json()) : null;
  } catch { return null; }
}
