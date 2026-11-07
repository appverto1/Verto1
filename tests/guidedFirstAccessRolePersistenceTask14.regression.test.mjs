import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  PORTAL_GUIDED_TUTORIAL_REVISION,
  portalGuidedTutorialKey,
  readPortalGuidedTutorial,
  persistPortalGuidedTutorial,
  portalGuidedTutorialIsVisible,
} from '../src/utils/portalGuidedTutorialProgress.mjs';

const coordinator = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const clinicalHook = readFileSync('src/hooks/useClinicalGuidedTutorial.ts', 'utf8');
const clinicalProgress = readFileSync('src/utils/clinicalGuidedTutorialProgress.mjs', 'utf8');
const biller = readFileSync('src/components/BillerWorkspace.tsx', 'utf8');
const patient = readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const portal = readFileSync('src/components/PortalFirstAccessTutorial.tsx', 'utf8');
const overlay = readFileSync('src/components/Tutorial.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, value),
    get count() { return map.size; },
  };
}

test('roles, users, clinics and patient portal contexts cannot share tutorial completion', () => {
  const storage = memoryStorage();
  const director = { userId: 'u1', clinicId: 'clinic-a', portal: 'biller' };
  const billerKey = portalGuidedTutorialKey(director);
  const otherUserKey = portalGuidedTutorialKey({ ...director, userId: 'u2' });
  const otherClinicKey = portalGuidedTutorialKey({ ...director, clinicId: 'clinic-b' });
  const patientKey = portalGuidedTutorialKey({ ...director, portal: 'patient', patientId: 'p1' });
  const otherPatientKey = portalGuidedTutorialKey({ ...director, portal: 'patient', patientId: 'p2' });
  assert.equal(new Set([billerKey, otherUserKey, otherClinicKey, patientKey, otherPatientKey]).size, 5);
  assert.equal(persistPortalGuidedTutorial(storage, billerKey, 'completed'), true);
  assert.equal(readPortalGuidedTutorial(storage, billerKey), 'completed');
  for (const key of [otherUserKey, otherClinicKey, patientKey, otherPatientKey]) {
    assert.equal(readPortalGuidedTutorial(storage, key), null, 'another context must see initial tutorial');
  }
  assert.equal(storage.count, 1, 'only one local status write, no backend calls');
});

test('an active guide cannot be displayed in a different user, clinic, patient or portal context', () => {
  const key = portalGuidedTutorialKey({ userId: 'u1', clinicId: 'clinic-a', portal: 'patient', patientId: 'p1' });
  const active = { key, active: true };
  assert.equal(portalGuidedTutorialIsVisible(active, key), true);
  for (const context of [
    { userId: 'u2', clinicId: 'clinic-a', portal: 'patient', patientId: 'p1' },
    { userId: 'u1', clinicId: 'clinic-b', portal: 'patient', patientId: 'p1' },
    { userId: 'u1', clinicId: 'clinic-a', portal: 'patient', patientId: 'p2' },
    { userId: 'u1', clinicId: 'clinic-a', portal: 'biller' },
  ]) {
    assert.equal(portalGuidedTutorialIsVisible(active, portalGuidedTutorialKey(context)), false);
  }
  assert.equal(portalGuidedTutorialIsVisible(active, ''), false);
  assert.equal(portalGuidedTutorialIsVisible({ key, active: false }, key), false);
  assert.equal(portalGuidedTutorialIsVisible(null, key), false);
  assert.match(portal, /const isActive = portalGuidedTutorialIsVisible\(tutorialState, progressKey\)/);
  assert.match(portal, /setTutorialState\(\{ key: '', active: false \}\)/);
  assert.doesNotMatch(portal, /const \[isActive, setIsActive\]/);
});

test('completion, pause and restart survive simulated refresh and logout/login', () => {
  const storage = memoryStorage();
  const key = portalGuidedTutorialKey({ userId: 'director-1', clinicId: 'clinic-a', portal: 'biller' });
  assert.equal(readPortalGuidedTutorial(storage, key), null);
  assert.equal(persistPortalGuidedTutorial(storage, key, 'active'), true);
  assert.equal(readPortalGuidedTutorial(storage, key), 'active');
  assert.equal(persistPortalGuidedTutorial(storage, key, 'completed'), true);
  assert.equal(readPortalGuidedTutorial(storage, key), 'completed');
  // Recreate the reader as a fresh login while retaining browser storage.
  const newLoginStorage = { getItem: storage.getItem, setItem: storage.setItem };
  assert.equal(readPortalGuidedTutorial(newLoginStorage, key), 'completed');
  assert.equal(persistPortalGuidedTutorial(newLoginStorage, key, 'active'), true);
  assert.equal(readPortalGuidedTutorial(storage, key), 'active');
  assert.equal(persistPortalGuidedTutorial(storage, key, 'skipped'), true);
  assert.equal(readPortalGuidedTutorial(newLoginStorage, key), 'skipped');
});

test('missing identity, malformed records and unavailable storage fail safely', () => {
  const storage = memoryStorage();
  const key = portalGuidedTutorialKey({ userId: 'u', clinicId: 'clinic-a', portal: 'patient' });
  assert.equal(portalGuidedTutorialKey({ userId: '', clinicId: 'clinic-a', portal: 'patient' }), '');
  assert.equal(portalGuidedTutorialKey({ userId: 'u', clinicId: 'clinic-a', portal: 'admin' }), '');
  assert.equal(persistPortalGuidedTutorial(storage, '', 'completed'), false);
  assert.equal(persistPortalGuidedTutorial(storage, key, 'injected-role'), false);
  storage.setItem(key, '{broken JSON');
  assert.equal(readPortalGuidedTutorial(storage, key), null);
  storage.setItem(key, JSON.stringify({ revision: 'old', status: 'completed' }));
  assert.equal(readPortalGuidedTutorial(storage, key), null);
  assert.equal(PORTAL_GUIDED_TUTORIAL_REVISION, 'portal-v1');
  const unavailableStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readPortalGuidedTutorial(unavailableStorage, key), null);
  assert.equal(persistPortalGuidedTutorial(unavailableStorage, key, 'completed'), false);
});

test('clinical guide is modularized without losing role/clinic keys or legacy progress', () => {
  assert.match(clinicalProgress, /CLINICAL_GUIDED_TUTORIAL_REVISION = 'p0-contextual-v1'/);
  assert.match(clinicalProgress, /'verto:guided-tutorial:role'/);
  assert.match(clinicalProgress, /'verto:guided-tutorial'/);
  assert.match(clinicalProgress, /moduleSignature \|\| 'baseline'/);
  assert.match(clinicalProgress, /storage\.setItem\(roleKey, legacyRaw\)/);
  assert.match(clinicalProgress, /storage\.setItem\(roleKey, progress\)/);
  assert.match(clinicalProgress, /storage\.setItem\(contextKey, progress\)/);
  assert.match(clinicalHook, /readClinicalGuidedTutorial\(window\.localStorage, roleKey, contextKey\)/);
  assert.match(clinicalHook, /persistClinicalGuidedTutorial\(window\.localStorage, roleKey, contextKey, status, step\)/);
  assert.match(clinicalHook, /if \(initializedRoleKeyRef\.current === roleKey\) return;/);
  assert.match(clinicalHook, /active: stored\.status === 'active'/);
  assert.match(clinicalHook, /runGuidedTutorial = canRun && portalGuidedTutorialIsVisible\(tutorialState, roleKey\)/);
  assert.match(coordinator, /const guidedTutorialModuleSignature = Array\.from\(organizationModules\)\.sort\(\)\.join\(","\)/);
  assert.match(coordinator, /useClinicalGuidedTutorial\(\{[\s\S]*?userId: String\(user\?\.id \|\| ""\)\.trim\(\),[\s\S]*?clinicId: workspaceScopeKey,[\s\S]*?role: normalizedRole/);
  assert.match(coordinator, /moduleSignature: guidedTutorialModuleSignature/);
  assert.match(coordinator, /authorizationHydrated,/);
  assert.match(coordinator, /closeGuidedTutorial\(reason\)/);
  assert.match(coordinator, /onOpenGuidedTutorial=\{startGuidedTutorial\}/);
  assert.doesNotMatch(coordinator, /const \[runGuidedTutorial, setRunGuidedTutorial\]/);
});

test('biller and pediatric/adult patient portals have a scoped first-use guide and manual replay', () => {
  assert.match(biller, /<HelpButton \/>/);
  assert.match(portal, /user\?\.activeAccessContext\?\.clinicId/, 'billing guide must isolate the selected clinic workspace');
  assert.match(biller, /<PortalFirstAccessTutorial user=\{user\} portal="biller" targetId="help-center" \/>/);
  assert.match(patient, /<PortalFirstAccessTutorial user=\{user\} portal="patient" targetId="patient-portal-menu" \/>/);
  assert.doesNotMatch(portal, /portalPatientId/, 'async patient record resolution must not reset the tour key');
  assert.equal((patient.match(/data-tutorial-anchor="patient-portal-menu"/g) || []).length, 2, 'both child and adult menu buttons anchored');
  assert.match(portal, /aria-label=\{portal === 'patient' \? 'Rever tutorial do portal do paciente' : 'Rever tutorial do faturamento'\}/);
  assert.match(portal, /onClick=\{restart\}/);
  assert.match(portal, /readPortalGuidedTutorial\(window\.localStorage, progressKey\)/);
  assert.match(portal, /persistPortalGuidedTutorial\(window\.localStorage, progressKey, status\)/);
  assert.match(portal, /<TutorialOverlay/);
  assert.match(portal, /reason === 'complete' \? 'completed' : reason === 'skip' \? 'skipped' : 'active'/);
  assert.match(overlay, /onClose\('complete'\)/);
});

test('tutorials do not alter role or clinic authorization and main app routes remain isolated', () => {
  assert.match(app, /user\.role === 'biller' \? \(/);
  assert.match(app, /<BillerWorkspace user=\{user\} onLogout=\{handleLogout\} \/>/);
  assert.match(app, /user\.role === 'patient' \? \(/);
  assert.match(app, /<PatientDashboard/);
  assert.match(app, /<CoordinatorDashboard/);
  for (const source of [portal, coordinator.slice(coordinator.indexOf('const guidedTutorialModuleSignature'), coordinator.indexOf('const isFinancialBreadcrumbActive'))]) {
    assert.doesNotMatch(source, /supabase\.from\(|fetch\(|checkout|stripe\.checkout|setRole\(|updatePatient\(|savePatient\(/i);
  }
  // Logout only clears sensitive clinical caches, not role-scoped tutorial progress.
  const logout = app.slice(app.indexOf('const handleLogout = async'), app.indexOf('useEffect(() => {', app.indexOf('const handleLogout = async')));
  assert.doesNotMatch(logout, /localStorage\.clear\(\)|guided-tutorial/);
});
