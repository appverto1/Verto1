import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patientFinanceClinicalStatusLabel } from '../src/utils/patientFinancialLedger.ts';

const translations = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  completed: 'Realizada',
  in_progress: 'Em andamento',
  'in-progress': 'Em andamento',
  canceled: 'Cancelada',
  cancelled: 'Cancelada',
  cancelled_clinic: 'Cancelada pela clínica',
  canceled_patient: 'Cancelada pelo paciente',
  no_show: 'Não compareceu',
  rescheduled: 'Remarcada',
  pending: 'Pendente',
  '  CONFIRMED  ': 'Confirmada'
};
for (const [raw, expected] of Object.entries(translations)) {
  assert.equal(patientFinanceClinicalStatusLabel(raw), expected, raw);
}
assert.equal(patientFinanceClinicalStatusLabel(null), 'Status não identificado');
assert.equal(patientFinanceClinicalStatusLabel('mysterious_backend_state'), 'Status não identificado');
assert.doesNotMatch(patientFinanceClinicalStatusLabel('mysterious_backend_state'), /mysterious/);

const source = readFileSync(new URL('../src/components/PatientFinanceWorkspace.tsx', import.meta.url), 'utf8');
const start = source.indexOf("{activeView === 'appointments' && (");
const end = source.indexOf("{(activeView === 'charges' || activeView === 'pending') && (", start);
assert.ok(start >= 0 && end > start, 'session section must exist');
const section = source.slice(start, end);
assert.match(section, /patientFinanceClinicalStatusLabel\(row\.clinicalStatus\)/);
assert.doesNotMatch(section, /\{row\.clinicalStatus\}/, 'raw backend status must not be visible');
assert.match(section, /space-y-3/);
assert.match(section, /rounded-2xl border border-slate-200 bg-white px-5 py-5/);
assert.match(section, /aria-label="Sessões e situação financeira"/);
assert.match(section, /Cobrança ainda não gerada/);
assert.match(section, /row\.chargeId \? currency\(row\.balance\) : '—'/);
for (const operation of ['charge', 'payment', 'partial_payment', 'split_payment', 'discount', 'courtesy', 'receipt', 'refund', 'due_date', 'cancel']) {
  assert.ok(section.includes("openOperation('" + operation + "', row)"), 'retained operation: ' + operation);
}
assert.match(section, /setExpandedChargeId\(row\.chargeId\)/);
assert.match(section, /sendChargeReminder\(row\.chargeId\)/);

console.log('patientFinanceSessionReadability.regression.test: PASS');
