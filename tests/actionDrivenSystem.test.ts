import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  applyActionResult,
  buildActionResult,
  mergeActionItemsById,
  removeActionItemsById,
} from '../src/utils/actionResult';

const root = process.cwd();
const appCode = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const serverCode = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const appointmentUtilsCode = fs.readFileSync(path.join(root, 'src/utils/appointmentActionUpdates.ts'), 'utf8');

test('ActionResult normalizes item, items, removedIds, affected and events', () => {
  const result = buildActionResult({
    success: true,
    entity: 'appointment',
    action: 'created',
    item: { id: 'a', status: 'pending' },
    removedIds: ['x', 'x', ''],
    affected: { appointmentIds: ['a'] },
    events: [{ eventId: 'evt-1' }],
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.items, [{ id: 'a', status: 'pending' }]);
  assert.deepEqual(result.removedIds, ['x']);
  assert.deepEqual(result.affected?.appointmentIds, ['a']);
  assert.equal(result.events?.[0].eventId, 'evt-1');
});

test('applyActionResult inserts, updates and removes by id without mutating source', () => {
  const current = [
    { id: 'a', status: 'pending' },
    { id: 'b', status: 'pending' },
  ];
  const updated = applyActionResult({
    entity: 'appointment',
    current,
    result: {
      success: true,
      entity: 'appointment',
      action: 'updated',
      items: [{ id: 'a', status: 'confirmed' }],
      removedIds: ['b'],
    },
  });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.items, [{ id: 'a', status: 'confirmed' }]);
  assert.deepEqual(current, [
    { id: 'a', status: 'pending' },
    { id: 'b', status: 'pending' },
  ]);
});

test('generic merge/remove helpers are idempotent', () => {
  const merged = mergeActionItemsById([{ id: 'a', value: 1 }], [{ id: 'a', value: 2 }, { id: 'b', value: 3 }]);
  assert.deepEqual(merged, [{ id: 'a', value: 2 }, { id: 'b', value: 3 }]);
  const removed = removeActionItemsById(merged, ['a', 'a']);
  assert.deepEqual(removed, [{ id: 'b', value: 3 }]);
});

test('appointment frontend applies ActionResult before reporting success', () => {
  assert.match(appointmentUtilsCode, /applyAppointmentActionResult/);
  assert.match(appCode, /appointmentActionSequenceRef/);
  assert.match(appCode, /STALE_RESPONSE/);
  assert.match(appCode, /applyAppointmentResultToAgenda/);
  assert.match(appCode, /Registro salvo, mas a tela não atualizou automaticamente/);
  assert.match(appCode, /const applied = applyAppointmentResultToAgenda[\s\S]*?if \(!applied\.ok\)/);
});

test('appointment backend returns global ActionResult contract with legacy compatibility', () => {
  const appointmentRouteSlice = serverCode.slice(
    serverCode.indexOf('const persistAppointmentActionBatch'),
    serverCode.indexOf('const handleVapidPublicKey'),
  );
  assert.match(serverCode, /function buildActionResultPayload/);
  assert.match(appointmentRouteSlice, /entity:\s*'appointment'/);
  assert.match(appointmentRouteSlice, /action,\s*\n\s*item:/);
  assert.match(appointmentRouteSlice, /items:\s*persistedAppointments/);
  assert.match(appointmentRouteSlice, /affected,/);
  assert.match(appointmentRouteSlice, /events,/);
  assert.match(appointmentRouteSlice, /legacy:\s*\{/);
});

test('appointment status and delete routes return ActionResult metadata', () => {
  const statusSlice = serverCode.slice(
    serverCode.indexOf('const handleAppointmentStatusUpdate'),
    serverCode.indexOf("app.delete('/api/appointments/:appointmentId'"),
  );
  const deleteSlice = serverCode.slice(
    serverCode.indexOf("app.delete('/api/appointments/:appointmentId'"),
    serverCode.indexOf("app.post('/api/notifications/appointments/:appointmentId/respond'"),
  );
  assert.match(statusSlice, /buildActionResultPayload/);
  assert.match(statusSlice, /affectedPersistedAppointments/);
  assert.match(statusSlice, /queryKeys:\s*\['appointments'\]/);
  assert.match(deleteSlice, /buildActionResultPayload/);
  assert.match(deleteSlice, /removedIds:\s*affectedAppointmentIds/);
  assert.match(deleteSlice, /queryKeys:\s*\['appointments'\]/);
});

test('action-driven changes avoid polling and select star in altered appointment flow', () => {
  const appointmentRouteSlice = serverCode.slice(
    serverCode.indexOf('const persistAppointmentActionBatch'),
    serverCode.indexOf('const handleVapidPublicKey'),
  );
  assert.doesNotMatch(appointmentRouteSlice, /\.select\(['"]\*['"]\)/);
  assert.doesNotMatch(appCode, /setInterval\([^)]*appointments/i);
  assert.doesNotMatch(appCode, /refetchInterval/i);
});
