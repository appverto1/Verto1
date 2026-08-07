import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync('src/components/PayerRequirementsPanel.tsx', 'utf8');

assert.match(panel, /setupCompetenceMonth/);
assert.match(panel, /formatDateInAppointmentTimezone\(new Date\(\)\)\.slice\(0, 7\)/);
assert.match(panel, /const setupTestDateRange = \(monthKey: string\)/);
assert.match(panel, /buildClinicDateRange\(/);
assert.doesNotMatch(
  panel.match(/const setupTestDateRange = \(monthKey: string\)[\s\S]*?\n  };/)?.[0] || '',
  /setDate\(|- 180|\+ 365/,
  'a faixa do teste deve ser a competência mensal explícita, não uma janela móvel ampla',
);
assert.match(panel, /const range = setupTestDateRange\(setupCompetenceMonth\)/);
assert.match(panel, /\[activeSetupStepKey, selectedPayerId, setupCompetenceMonth\]/);
assert.match(panel, /\[activeSetupStepKey, selectedPayerId, setupPatientId, setupCompetenceMonth\]/);
assert.match(panel, /type="month"/);
assert.match(panel, /aria-label="Competência mensal para o teste de Pré-guia"/);
assert.match(panel, /setSetupCompetenceMonth\(nextMonth\)/);
assert.match(panel, /setSetupAppointmentId\(""\)/);
assert.match(panel, /Nenhuma sessão encontrada para este paciente em/);

console.log('tissPreGuideMonthlyCompetenceFilter: ok');
