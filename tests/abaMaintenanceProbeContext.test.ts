import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getActiveMaintenanceProbeForTarget,
  normalizeRegularAbaTrialType,
  resolveContextualTrialTypeForTarget
} from '../src/utils/abaMaintenanceProbeContext.ts';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const now = new Date('2026-06-02T15:00:00.000Z');
const root = process.cwd();
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');

test('DTT volta quando target comum e Maintenance Probe nao contamina o contexto', () => {
  const activeProbe = getActiveMaintenanceProbeForTarget({
    targetId: 'target-maintenance',
    schedules: [{ id: 'schedule-1', target_id: 'target-maintenance', status: 'DUE_TODAY', target_due_date: now.toISOString() }],
    now
  });

  assert.equal(resolveContextualTrialTypeForTarget({
    requestedTrialType: 'dtt',
    lastRegularTrialType: 'dtt',
    activeProbe
  }), 'maintenance_probe');

  assert.equal(resolveContextualTrialTypeForTarget({
    requestedTrialType: 'maintenance_probe',
    lastRegularTrialType: 'dtt',
    activeProbe: null
  }), 'dtt');
});

test('NET volta ao selecionar target comum depois de target em manutencao nesta consulta', () => {
  const activeProbe = getActiveMaintenanceProbeForTarget({
    targetId: 'target-maintenance',
    activeAppointmentId: 'appointment-1',
    schedules: [{ id: 'schedule-2', target_id: 'target-maintenance', appointment_id: 'appointment-1', status: 'SCHEDULED', target_due_date: '2026-06-05T12:00:00.000Z' }],
    now
  });

  assert.equal(resolveContextualTrialTypeForTarget({
    requestedTrialType: 'net',
    lastRegularTrialType: 'net',
    activeProbe
  }), 'maintenance_probe');

  assert.equal(resolveContextualTrialTypeForTarget({
    requestedTrialType: 'maintenance_probe',
    lastRegularTrialType: 'net',
    activeProbe: null
  }), 'net');
});

test('Maintenance Probe nao sobrescreve lastRegularTrialType', () => {
  assert.equal(normalizeRegularAbaTrialType('maintenance_probe', 'net'), 'net');
  assert.equal(normalizeRegularAbaTrialType('maintenance_probe', ''), 'dtt');
});

test('selecionar target com probe futura nao reativa Maintenance Probe automaticamente', () => {
  const schedules = [{ id: 'schedule-3', target_id: 'target-maintenance', status: 'PENDING_NEXT_SESSION', target_due_date: '2026-06-03T12:00:00.000Z' }];
  const commonType = resolveContextualTrialTypeForTarget({
    requestedTrialType: 'maintenance_probe',
    lastRegularTrialType: 'dtt',
    activeProbe: null
  });
  const activeProbe = getActiveMaintenanceProbeForTarget({ targetId: 'target-maintenance', schedules, now });

  assert.equal(commonType, 'dtt');
  assert.equal(activeProbe, null);
  assert.equal(resolveContextualTrialTypeForTarget({
    requestedTrialType: commonType,
    lastRegularTrialType: 'dtt',
    activeProbe
  }), 'dtt');
});

test('probe futura fica informativa quando pertence a outra consulta', () => {
  const activeProbe = getActiveMaintenanceProbeForTarget({
    targetId: 'target-maintenance',
    activeAppointmentId: 'appointment-current',
    schedules: [{ id: 'schedule-future', target_id: 'target-maintenance', appointment_id: 'appointment-future', status: 'SCHEDULED', target_due_date: '2026-06-10T12:00:00.000Z' }],
    now
  });

  assert.equal(activeProbe, null);
});

test('override manual permite DTT/NET em target com probe sem cancelar schedule', () => {
  const activeProbe = getActiveMaintenanceProbeForTarget({
    targetId: 'target-maintenance',
    schedules: [{ id: 'schedule-4', target_id: 'target-maintenance', status: 'DUE_TODAY', target_due_date: now.toISOString() }],
    now
  });

  assert.equal(resolveContextualTrialTypeForTarget({
    requestedTrialType: 'net',
    lastRegularTrialType: 'net',
    activeProbe,
    manualRegularOverride: true
  }), 'net');
  assert.equal(activeProbe?.scheduleId, 'schedule-4');
});

test('ativacao manual de Maintenance Probe e contextual ao target', () => {
  const manualActivations = {
    'target-manual': { targetId: 'target-manual', status: 'MANUAL', activatedAt: now.toISOString() }
  };

  assert.equal(getActiveMaintenanceProbeForTarget({ targetId: 'target-manual', manualActivations, now })?.manuallyActivated, true);
  assert.equal(getActiveMaintenanceProbeForTarget({ targetId: 'target-common', manualActivations, now }), null);
});

test('SessionMode usa lastRegularTrialType e cria resultado de maintenance probe ao registrar', () => {
  assert.match(sessionModeCode, /const \[lastRegularTrialType, setLastRegularTrialType\] = useState\('dtt'\)/);
  assert.match(sessionModeCode, /resolveContextualTrialTypeForTarget/);
  assert.match(sessionModeCode, /const trialContext = syncTrialTypeForGoal\(goal\)/);
  assert.match(sessionModeCode, /dataService\.saveAbaMaintenanceProbeResult/);
  assert.match(sessionModeCode, /maintenanceProbeFeedback && maintenanceProbeActiveForGoal/);
});

test('backend valida maintenance_schedule_id no escopo do paciente e target', () => {
  assert.match(serverCode, /maintenanceScheduleId[\s\S]*?\.from\('aba_maintenance_schedules'\)[\s\S]*?\.eq\('id', maintenanceScheduleId\)[\s\S]*?\.eq\('patient_id', patientId\)[\s\S]*?\.eq\('target_id', targetId\)/m);
  assert.match(serverCode, /Sondagem de manutenção fora do escopo do paciente/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] ABA maintenance probe context checks: ${passed}/${tests.length}`);
