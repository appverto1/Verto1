import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScopedSingleFlight } from '../src/utils/scopedSingleFlight';

function controlled<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const singleFlight = createScopedSingleFlight<{ items: number[] }>();
let reads = 0;
const pending = controlled<{ items: number[] }>();
const first = singleFlight.run('user-a:clinic-a:patient-a:2026-11', () => { reads++; return pending.promise; });
const second = singleFlight.run('user-a:clinic-a:patient-a:2026-11', () => { reads++; return pending.promise; });
assert.strictEqual(first, second, 'same scope and range must share one in-flight read');
await Promise.resolve();
assert.equal(reads, 1);
pending.resolve({ items: [1, 2] });
assert.deepEqual(await second, { items: [1, 2] });
await first;
const next = singleFlight.run('user-a:clinic-a:patient-a:2026-11', async () => { reads++; return { items: [3] }; });
assert.notStrictEqual(first, next, 'finished requests must not become a stale cache');
assert.deepEqual(await next, { items: [3] });

const stale = controlled<{ items: number[] }>();
const forced = controlled<{ items: number[] }>();
const oldRequest = singleFlight.run('clinic-a:patient-a', () => stale.promise);
const afterSave = singleFlight.run('clinic-a:patient-a', () => forced.promise, true);
assert.notStrictEqual(oldRequest, afterSave, 'explicit refresh must not share the old pre-save response');
stale.resolve({ items: [1] });
await oldRequest;
const afterOldFinished = singleFlight.run('clinic-a:patient-a', () => { throw Error('unexpected request'); });
assert.strictEqual(afterOldFinished, afterSave, 'old completion cannot evict the newer request');
forced.resolve({ items: [2] });
await afterSave;

const rejecter = controlled<{ items: number[] }>();
const failed = singleFlight.run('temporary', () => rejecter.promise);
rejecter.reject(new Error('network offline'));
await assert.rejects(failed, /network offline/);
assert.deepEqual(await singleFlight.run('temporary', async () => ({ items: [8] })), { items: [8] });

const pendingOldScope = controlled<{ items: number[] }>();
singleFlight.run('user-a:clinic-a:patient-a', () => pendingOldScope.promise);
singleFlight.clear();
assert.deepEqual(await singleFlight.run('user-b:clinic-b:patient-b', async () => ({ items: [9] })), { items: [9] });
pendingOldScope.resolve({ items: [7] });

const component = readFileSync('src/components/PatientDashboard.tsx', 'utf8');
assert.match(component, /createScopedSingleFlight/);
assert.match(component, /portalAppointmentsSingleFlightRef\.current\.clear\(\)/);
assert.match(component, /getPortalAppointments\(/);
assert.match(component, /loadPortalAppointments\(range, force\)/);
assert.match(component, /loadPortalAppointments\(getPortalCalendarMonthRange\(portalCalendarMonth\), true\)/);
console.log('scopedSingleFlight: PASS: in-flight dedupe, forced refresh, tenant reset, errors');
