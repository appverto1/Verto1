import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');

const occurrences = (expression) => [...source.matchAll(expression)].length;

test('kids and adult patient menus render outside their clipping scroll containers', () => {
  assert.equal(occurrences(/createPortal\(\s*<AnimatePresence>/g), 2,
    'both patient portals must render the hamburger menu through document.body');
  assert.equal(occurrences(/id="patient-portal-navigation-menu"/g), 2);
  assert.equal(occurrences(/className="fixed z-\[80\] w-(?:56|60) /g), 2,
    'a fixed overlay cannot be cropped by a patient portal overflow ancestor');
  assert.equal(occurrences(/style=\{patientPortalMenuPosition\}/g), 2);
  assert.equal(occurrences(/overflow-y-auto overscroll-contain rounded-\[24px\]/g), 2,
    'long menus must scroll within the available viewport height');
});

test('both patient menu triggers anchor to the viewport and preserve accessibility', () => {
  assert.equal(occurrences(/ref=\{patientPortalMenuButtonRef\}/g), 2);
  assert.equal(occurrences(/aria-expanded=\{isMenuOpen\}/g), 2);
  assert.equal(occurrences(/onClick=\{togglePatientPortalMenu\}/g), 2);
  assert.match(source, /trigger\.getBoundingClientRect\(\)/);
  assert.match(source, /viewportWidth - menuWidth - 8/);
  assert.match(source, /spaceBelow < estimatedHeight && spaceAbove > spaceBelow/);
  assert.match(source, /maxHeight: availableHeight/);
  assert.match(source, /window\.addEventListener\('resize', positionPatientPortalMenu\)/);
  assert.match(source, /window\.addEventListener\('scroll', positionPatientPortalMenu, true\)/);
  assert.match(source, /window\.removeEventListener\('scroll', positionPatientPortalMenu, true\)/);
});

test('patient menu actions and authorization gates remain unchanged', () => {
  assert.match(source, /portalMenuItems\.map\(\(item\)/);
  assert.match(source, /setPortalSection\(item\.id\); setIsMenuOpen\(false\)/);
  assert.match(source, /!isReadOnlyMode && clinicalPortalEnabled && \(/);
  assert.match(source, /setIsFamilyLogOpen\(true\)/);
  assert.match(source, /onClick=\{openMessagesAndPersistRead\}/);
  assert.match(source, /onLogout\(\); setIsMenuOpen\(false\)/);
});
