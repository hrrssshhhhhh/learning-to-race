import { saveMyVehicles, loadMyVehicles, toFile, fromFile } from '../../src/storage/brains';
import { LAYERS, createBrain } from '../../src/ml/nn';
import { makeRng } from '../../src/sim/rng';

const fakeStorage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage; };
test('round trip', () => {
  const s = fakeStorage(); const b = [createBrain(LAYERS, makeRng(1))];
  expect(saveMyVehicles('car', b, s)).toBe(true);
  expect(Array.from(loadMyVehicles('car', s)![0].weights)).toEqual(Array.from(b[0].weights));
});
test('corrupt JSON → null', () => { const s = fakeStorage(); s.setItem('slv.my.car', '{oops'); expect(loadMyVehicles('car', s)).toBeNull(); });
test('wrong layer shape → null', () => {
  const s = fakeStorage(); s.setItem('slv.my.car', JSON.stringify({ version: 1, kind: 'car', layers: [5, 3, 2], brains: [[0]] }));
  expect(loadMyVehicles('car', s)).toBeNull();
});
test('throwing storage → save false, load null', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } as unknown as Storage;
  expect(saveMyVehicles('car', [createBrain(LAYERS, makeRng(1))], bad)).toBe(false);
  expect(loadMyVehicles('car', bad)).toBeNull();
});
test('fromFile rejects non-finite weights, wrong count, wrong version, empty population', () => {
  const ok = toFile('bike', [createBrain(LAYERS, makeRng(2))]);
  expect(fromFile(ok)).not.toBeNull();
  expect(fromFile({ ...ok, version: 2 })).toBeNull();
  expect(fromFile({ ...ok, brains: [] })).toBeNull();
  expect(fromFile({ ...ok, brains: [ok.brains[0].slice(1)] })).toBeNull();
  expect(fromFile({ ...ok, brains: [[...ok.brains[0].slice(1), null]] })).toBeNull();
  expect(fromFile(null)).toBeNull();
});
