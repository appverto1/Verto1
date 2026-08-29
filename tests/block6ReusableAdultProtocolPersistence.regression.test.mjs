import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const coordinator = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');

const serverRouteStart = server.indexOf("app.post('/api/clinic/protocols/reusable-adult'");
const serverRouteEnd = server.indexOf("app.post('/api/clinic/state'", serverRouteStart);
assert.ok(serverRouteStart >= 0 && serverRouteEnd > serverRouteStart, 'focused reusable adult protocol route must exist');
const route = server.slice(serverRouteStart, serverRouteEnd);
assert.match(route, /requireClinicCapability\('clinical\.evolution\.create'\)/);
assert.match(route, /operation === 'create_protocol'/);
assert.match(route, /operation === 'append_skill'/);
assert.match(route, /\.select\('protocols,section_versions'\)/);
assert.match(route, /p_expected_section_versions: \{ protocols: currentProtocolVersion \}/);
assert.match(route, /p_protocols: nextProtocols/);
assert.match(route, /p_rooms: null/);
assert.match(route, /p_appointments: null/);
assert.match(route, /REUSABLE_PROTOCOL_CONCURRENT_EDIT/);
assert.match(route, /ageGroup === 'senior'/);
assert.match(route, /\{ min: 19, max: 59/);
assert.match(route, /category,/);
assert.doesNotMatch(route, /delete\s+from/i);
assert.doesNotMatch(route, /truncate\s+/i);

assert.match(dataService, /async saveReusableAdultProtocol\(/);
assert.match(dataService, /\/api\/clinic\/protocols\/reusable-adult/);
assert.match(dataService, /writeClinicProtocolsBackup\(result\?\.data\?\.clinicId, result\.data\.protocols\)/);

const scheduleStart = patientDetail.indexOf('const handleSchedule = async');
const scheduleEnd = patientDetail.indexOf('const resolveAssignedTaskEvaluationContext', scheduleStart);
assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'adult scheduling section must exist');
const schedule = patientDetail.slice(scheduleStart, scheduleEnd);
const protocolSaveIndex = schedule.indexOf('dataService.saveReusableAdultProtocol');
const assignedTaskIndex = schedule.indexOf('dataService.addAssignedTask');
assert.ok(protocolSaveIndex >= 0 && assignedTaskIndex > protocolSaveIndex, 'protocol must be durably saved before assigned task creation');
assert.match(schedule, /operation: 'create_protocol'/);
assert.match(schedule, /operation: 'append_skill'/);
assert.match(schedule, /category: planType === 'intervention' \? 'intervention' : 'evaluation'/);
assert.match(schedule, /ageGroup: patientAgeYears !== null && patientAgeYears >= 60 \? 'senior' : 'adult'/);
assert.match(schedule, /protocolId: resolvedScheduledProtocol\?\.id \|\| taskPayload\.protocolId/);
assert.match(schedule, /domainId: pendingAdultClinicalTaskContext\?\.domainId \|\| resolvedScheduledDomain\?\.id/);
assert.match(schedule, /skillId: resolvedScheduledSkill\?\.id/);
assert.match(schedule, /O agendamento não foi criado/);
assert.match(schedule, /if \(isKidsProfile\) \{[\s\S]*safeSetProtocols\?\.\(updatedProtocols\)/);

assert.match(patientDetail, /onProtocolsPersisted/);
assert.match(coordinator, /onProtocolsPersisted=\{onProtocolsPersisted\}/);
assert.match(app, /const handleProtocolsPersisted = \(nextProtocols: any\[], sectionVersions\?: Record<string, number>\)/);
assert.match(app, /clinicStatePersistedSnapshotRef\.current\.protocols = JSON\.stringify\(persistedProtocols\)/);
assert.match(app, /clinicStateSectionVersionsRef\.current = \{/);
assert.match(app, /onProtocolsPersisted=\{handleProtocolsPersisted\}/);

console.log('block6ReusableAdultProtocolPersistence.regression: PASS');
