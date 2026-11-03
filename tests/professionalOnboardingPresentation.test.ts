import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEEKDAYS, roleLabel, buildProfessionalOnboardingSchedule } from '../src/utils/professionalOnboardingPresentation';

const weekdays = ['monday','tuesday','wednesday','thursday','friday'];
assert.deepEqual(WEEKDAYS.map(([key]) => key), [...weekdays,'saturday','sunday']);
const schedule = buildProfessionalOnboardingSchedule({
  selectedDays: weekdays, sessionDurationMinutes: '50', workStart: '08:00', workEnd: '18:00'
});
assert.equal(schedule.active, true);
assert.equal(schedule.stepMinutes, 50);
assert.equal(schedule.defaultSessionDurationMinutes, 50);
assert.equal(schedule.minLeadMinutes, 120);
assert.equal(schedule.maxSlotsPerDay, 8);
assert.equal(schedule.sessionBufferMinutes, 0);
assert.deepEqual(schedule.exceptions, []);
assert.deepEqual(schedule.days.monday, {enabled:true,periods:[{start:'08:00',end:'18:00'}],intervals:[]});
assert.deepEqual(schedule.days.saturday, {enabled:false,periods:[],intervals:[]});
assert.deepEqual(schedule.days.sunday, {enabled:false,periods:[],intervals:[]});
assert.deepEqual(buildProfessionalOnboardingSchedule({
  selectedDays: ['saturday'], sessionDurationMinutes: 'invalid', workStart: '09:00', workEnd: '13:00'
}).days.saturday, {enabled:true,periods:[{start:'09:00',end:'13:00'}],intervals:[]});
assert.equal(buildProfessionalOnboardingSchedule({
  selectedDays: [], sessionDurationMinutes: 'invalid', workStart: '08:00', workEnd: '18:00'
}).stepMinutes, 50, 'existing fallback for invalid duration');
assert.equal(roleLabel('director'),'Diretor');
assert.equal(roleLabel('supervisor'),'Profissional · Supervisor');
assert.equal(roleLabel('receptionist'),'Recepcionista/Assistente');
assert.equal(roleLabel('unknown_role'),'Profissional de atendimento');
const component = readFileSync('src/components/ProfessionalOnboarding.tsx','utf8');
assert.match(component, /buildProfessionalOnboardingSchedule\(\{/);
assert.match(component, /dataService\.completeProfessionalOnboarding\(/);
assert.match(component, /localStorage\.removeItem\(draftKey\)/);
assert.match(component, /isManagedMember \? memberPayload : ownerPayload/);
console.log('professionalOnboardingPresentation: PASS');
