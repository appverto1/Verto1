import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  PORTAL_GUIDED_TUTORIAL_REVISION,
  portalGuidedTutorialKey,
  readPortalGuidedTutorial,
  persistPortalGuidedTutorial,
} from '../src/utils/portalGuidedTutorialProgress.mjs';

const coordinator = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
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

test('clinical guide retains prior progress while module entitlements change', () => {
  assert.match(coordinator, /GUIDED_TUTORIAL_REVISION = "p0-contextual-v1"/);
  assert.match(coordinator, /const guidedTutorialContextKey = \[/);
  assert.match(coordinator, /moduleAccessMode,[\s\S]*?guidedTutorialModuleSignature/);
  assert.match(coordinator, /const guidedTutorialRoleKey = \[[\s\S]*?String\(user\?\.id \|\| ""\)\.trim\(\),[\s\S]*?workspaceScopeKey[\s\S]*?normalizedRole/);
  const stableKeyStart = coordinator.indexOf('const guidedTutorialRoleKey = [');
  const stableKeyEnd = coordinator.indexOf('].join(":");', stableKeyStart);
  assert.ok(stableKeyStart > 0 && stableKeyEnd > stableKeyStart);
  assert.doesNotMatch(coordinator.slice(stableKeyStart, stableKeyEnd), /moduleAccessMode|guidedTutorialModuleSignature/);
  assert.match(coordinator, /window\.localStorage\.setItem\(guidedTutorialRoleKey, progress\)/);
  assert.match(coordinator, /window\.localStorage\.setItem\(guidedTutorialContextKey, progress\)/);
  assert.match(coordinator, /const stableRaw = window\.localStorage\.getItem\(guidedTutorialRoleKey\)/);
  assert.match(coordinator, /const legacyRaw = stableRaw \? null : window\.localStorage\.getItem\(guidedTutorialContextKey\)/);
  assert.match(coordinator, /if \(legacyRaw && stored\?\.revision === GUIDED_TUTORIAL_REVISION\)/);
  assert.match(coordinator, /if \(stored\.status === "active"\)/);
  assert.match(coordinator, /setRunGuidedTutorial\(false\);[\s\S]*?return;/);
  assert.match(coordinator, /reason === "skip" \? "skipped" : reason === "complete" \? "completed" : "active"/);
  assert.match(coordinator, /onOpenGuidedTutorial=\{startGuidedTutorial\}/);
  assert.match(coordinator, /authorizationHydrated &&/);
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
