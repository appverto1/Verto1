import assert from 'node:assert/strict';
import fs from 'node:fs';

const onboarding = fs.readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');
const settings = fs.readFileSync('src/components/ClinicGlobalSettingsPanel.tsx', 'utf8');

// The guidance must appear only in the invited professional's availability step.
const availabilityStart = onboarding.indexOf('{step === 3 && isManagedMember && (');
const availabilityEnd = onboarding.indexOf('Concluir configuração', availabilityStart);
assert.ok(availabilityStart >= 0 && availabilityEnd > availabilityStart, 'managed member step should exist');
const availabilityStep = onboarding.slice(availabilityStart, availabilityEnd);
assert.match(availabilityStep, /Disponibilidade semanal/);
assert.match(availabilityStep, /horário geral para os dias selecionados/);
assert.match(availabilityStep, /Configurações &gt; Disponibilidade nesta clínica/);
assert.match(availabilityStep, /personalizar os horários de cada dia/);
assert.match(availabilityStep, /onClick=\{finish\}/);
assert.match(onboarding, /workSchedule: schedule/);

// The described destination really allows per-day edits and persists only on Save.
assert.match(settings, /title="Disponibilidade nesta clínica"/);
assert.match(settings, /PROFESSIONAL_WEEKDAYS\.filter/);
assert.match(settings, /onChange=\{\(event\) => updatePeriod\(key, periodIndex, 'start', event\.target\.value\)\}/);
assert.match(settings, /onChange=\{\(event\) => updatePeriod\(key, periodIndex, 'end', event\.target\.value\)\}/);
assert.match(settings, /const result = await dataService\.updateMemberWorkSchedule\(memberId, schedule\)/);
assert.match(settings, /onClick=\{\(\) => void saveSchedule\(\)\}/);

console.log('p3OnboardingAvailabilityGuidance.regression.test.mjs: PASS');
