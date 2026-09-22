import assert from 'node:assert/strict';
import fs from 'node:fs';

const clinic = fs.readFileSync('src/components/ClinicGlobalSettingsPanel.tsx', 'utf8');
const tiss = fs.readFileSync('src/components/BillingTissSettingsPanel.tsx', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const preMain = fs.readFileSync('scripts/pre-main-gate.mjs', 'utf8');

// Generic clinic save buttons: local loading/success state, explicit authoritative
// result, two-second reset, accessibility and same-action double-submit guard.
assert.match(clinic, /function SaveButton\([\s\S]*feedback = false[\s\S]*useState<['"]idle['"] \| ['"]saving['"] \| ['"]saved['"]>[\s\S]*inFlightRef[\s\S]*await onSave\(\)[\s\S]*result === true \|\| result\?\.success === true[\s\S]*2000[\s\S]*aria-live="polite"[\s\S]*Salvando\.\.\.[\s\S]*Salvo/);
assert.match(clinic, /<SaveButton feedback=\{!isProfessionalView\} onSave=\{onSave\}>\{isProfessionalView \? "Salvar meu perfil" : "Salvar configurações da clínica"\}<\/SaveButton>/);
assert.match(clinic, /<SaveButton feedback onSave=\{onSave\}>Salvar dados da clínica<\/SaveButton>/);
assert.match(clinic, /<SaveButton feedback onSave=\{onSave\}>Salvar contato<\/SaveButton>/);
assert.match(clinic, /<SaveButton feedback onSave=\{onSave\}>Salvar preferências da clínica<\/SaveButton>/);
assert.match(clinic, /<SaveButton onSave=\{onSave\}>Salvar perfil profissional<\/SaveButton>/);
assert.doesNotMatch(clinic, /saveSucceeded|globalSaveSuccess/);

// No-show policy: validation precedes persistence and Saved only follows a
// successful authoritative response. The feedback is local and reset after 2s.
const attendanceStart = clinic.indexOf('const saveAttendancePolicy = async');
const attendanceEnd = clinic.indexOf('const saving = state.savingReschedule', attendanceStart);
assert.ok(attendanceStart >= 0 && attendanceEnd > attendanceStart);
const attendance = clinic.slice(attendanceStart, attendanceEnd);
assert.ok(attendance.indexOf('Number.isInteger(tolerance)') < attendance.indexOf('dataService.updateClinicAppointmentPolicy'));
assert.match(attendance, /if \(!result\?\.success\)[\s\S]*return;[\s\S]*setAttendanceSaved\(true\)/);
assert.match(clinic, /attendanceSavedTimerRef[\s\S]*window\.clearTimeout[\s\S]*2000/);
assert.match(clinic, /state\.savingAttendance \? "Salvando\.\.\." : attendanceSaved \? "Salvo" : "Salvar política de falta"/);

// ABA editor: only explicit success may emit Saved; each action is guarded and
// timers are cleaned to avoid late updates.
assert.match(clinic, /const savedTimerRef = useRef[\s\S]*const savePromptType = async[\s\S]*if \(savingId === id\) return null;[\s\S]*result\?\.success === true[\s\S]*setSavedId\(id\)[\s\S]*2000/);
assert.match(clinic, /savedTimerRef[\s\S]*window\.clearTimeout/);
assert.match(clinic, /renderSaveLabel[\s\S]*Salvando\.\.\.[\s\S]*Salvo/);

// TISS payer/professional feedback is keyed per action, not a shared success bit.
assert.match(tiss, /type SaveKind = "payer" \| "professional"/);
assert.match(tiss, /savingKinds[\s\S]*savedKinds[\s\S]*savedTimers[\s\S]*2000/);
assert.match(tiss, /if \(!selectedPayerId \|\| savingKinds\.payer\) return;/);
assert.match(tiss, /if \(!selectedProfessionalId \|\| savingKinds\.professional\) return;/);
assert.match(tiss, /finishSaveFeedback\("payer", true\)/);
assert.match(tiss, /finishSaveFeedback\("professional", true\)/);
assert.match(tiss, /aria-live="polite"[\s\S]*Salvando\.\.\.[\s\S]*Salvo/);

// The common clinic handler must await the real persistence callback and reject
// non-success before logging/toasting success or returning true.
const clinicHandlerStart = coordinator.indexOf('const handleSaveClinicSettings');
assert.ok(clinicHandlerStart >= 0);
const clinicHandlerEnd = coordinator.indexOf('\n  };', clinicHandlerStart);
const clinicHandler = coordinator.slice(clinicHandlerStart, clinicHandlerEnd > clinicHandlerStart ? clinicHandlerEnd + 5 : clinicHandlerStart + 12000);
assert.match(clinicHandler, /const result = await onUpdateProfile\(\{[\s\S]*profileSaveScope: "clinic"[\s\S]*clinicSettings: nextClinicSettings[\s\S]*\}\);/);
assert.match(clinicHandler, /if \(!result\?\.success\)[\s\S]*throw new Error[\s\S]*showToast\('Configurações da clínica atualizadas!'\)[\s\S]*return true;/);

// The focused test itself must run in the canonical pre-main CI gate.
assert.match(preMain, /tests\/clinicSettingsSaveFeedback\.regression\.test\.mjs/);

console.log('clinicSettingsSaveFeedback.regression.test.mjs: ok');
