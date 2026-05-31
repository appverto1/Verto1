import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDefaultMaintenanceSchedulePreview,
  formatMaintenanceScheduleDueLabel,
  normalizeMaintenanceScheduleStatus
} from '../src/utils/abaMaintenanceScheduling.ts';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const migrationSql = readFileSync(join(root, 'supabase/migrations/20260531163000_aba_maintenance_pending_confirmation.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('status novos sao normalizados e rotulados sem quebrar legado', () => {
  assert.equal(normalizeMaintenanceScheduleStatus('PENDING_NEXT_SESSION'), 'PENDING_NEXT_SESSION');
  assert.equal(normalizeMaintenanceScheduleStatus('PENDING_CONFIRMATION'), 'PENDING_CONFIRMATION');
  assert.equal(normalizeMaintenanceScheduleStatus('PENDING_LINK'), 'PENDING_LINK');
  assert.equal(normalizeMaintenanceScheduleStatus('UNSCHEDULED'), 'UNSCHEDULED');
  assert.equal(formatMaintenanceScheduleDueLabel({ status: 'PENDING_NEXT_SESSION' }), 'Aguardando proxima sessao');
  assert.equal(formatMaintenanceScheduleDueLabel({ status: 'PENDING_CONFIRMATION' }), 'Pendente de confirmacao');
});

test('plano 7 14 30 60 deixa marco sem sessao como PENDING_LINK', () => {
  const preview = buildDefaultMaintenanceSchedulePreview({
    approvedAt: '2026-05-01T12:00:00.000Z',
    maintenanceDays: [7],
    appointments: []
  });
  assert.equal(preview[0].status, 'PENDING_LINK');
  assert.equal(preview[0].appointmentId, null);
});

test('backend registra proxima sessao pendente e confirmacao candidata', () => {
  assert.match(serverCode, /NEXT_SESSION_WITHOUT_APPOINTMENT/);
  assert.match(serverCode, /status:\s*'PENDING_NEXT_SESSION'/);
  assert.match(serverCode, /flagPendingMaintenanceProbesForAppointment/);
  assert.match(serverCode, /status:\s*'PENDING_CONFIRMATION'/);
  assert.match(serverCode, /confirm-link/);
  assert.match(serverCode, /skip-link/);
  assert.match(serverCode, /MAINTENANCE_PROBE_LINK_CONFIRMED/);
  assert.match(serverCode, /MAINTENANCE_PROBE_LINK_SKIPPED/);
  assert.doesNotMatch(serverCode, /select\('\*'\)/);
});

test('modal usa cards guiados e nao usa botao salvar generico', () => {
  const modalStart = sessionModeCode.indexOf('Agendar sondagem de manutencao');
  const modalEnd = sessionModeCode.indexOf('{pendingMaintenanceProbeTrial', modalStart);
  const modalCode = sessionModeCode.slice(modalStart, modalEnd);
  assert.match(modalCode, /Agendar sondagem de manutencao/);
  assert.match(modalCode, /Na proxima sessao/);
  assert.match(modalCode, /Plano 7\/14\/30\/60/);
  assert.match(modalCode, /Escolher uma data/);
  assert.match(modalCode, /Proximas sessoes do paciente/);
  assert.match(modalCode, /Agendar na proxima sessao/);
  assert.match(modalCode, /Criar plano de manutencao/);
  assert.match(modalCode, /Agendar nesta data/);
  assert.doesNotMatch(modalCode, /<option value="DEFAULT_SEQUENCE">Sequencia 7\/14\/30\/60<\/option>/);
  assert.doesNotMatch(modalCode, />\s*Salvar\s*</);
});

test('agenda mostra filtros e acoes de confirmacao de manutencao', () => {
  for (const filter of [
    'maintenance_only',
    'probes_pending',
    'probes_today',
    'probes_overdue',
    'maintenance_pending_confirmation',
    'maintenance_unlinked'
  ]) {
    assert.match(calendarCode, new RegExp(filter));
  }
  assert.match(calendarCode, /Confirmar vinculo/);
  assert.match(calendarCode, /Fazer depois/);
  assert.match(calendarCode, /confirmMaintenanceScheduleLink/);
  assert.match(calendarCode, /skipMaintenanceScheduleLink/);
});

test('dataService e migracao expõem fluxo aditivo', () => {
  assert.match(dataServiceCode, /getAbaFutureAppointmentsForMaintenance/);
  assert.match(dataServiceCode, /confirmMaintenanceScheduleLink/);
  assert.match(dataServiceCode, /skipMaintenanceScheduleLink/);
  assert.match(migrationSql, /candidate_appointment_id/);
  assert.match(migrationSql, /PENDING_NEXT_SESSION/);
  assert.match(migrationSql, /PENDING_CONFIRMATION/);
  assert.match(migrationSql, /trg_aba_mark_pending_next_session_probe_candidate/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] Maintenance Probe scheduling calendar checks: ${passed}/${tests.length}`);
