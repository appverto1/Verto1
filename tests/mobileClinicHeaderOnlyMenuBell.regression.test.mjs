import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Both clinic headers (main workspace and patient record) must leave exactly
// two visible top-bar actions below lg: the hamburger and clinical bell.
// Secondary features remain reachable through the same mobile drawer.
const source = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const headers = [...source.matchAll(/\{\/\* Header \*\/\}([\s\S]*?)\{\/\* Mobile Menu Drawer \*\/\}/g)];
assert.equal(headers.length, 2, 'workspace and patient-record headers must be covered');

for (const [index, match] of headers.entries()) {
  const header = match[1];
  const label = index === 0 ? 'patient record' : 'workspace';
  assert.equal((header.match(/<Menu size=\{20\}/g) || []).length, 1, label + ': one hamburger');
  assert.equal((header.match(/<ClinicalMentionNotifications/g) || []).length, 1, label + ': one bell');
  assert.match(header, /aria-label="Abrir menu"/, label + ': hamburger accessible label');
  assert.match(header, /hidden lg:inline-flex[^\n]*p-2/, label + ': desktop-only theme');
  assert.match(header, /!isMobileHeader && hasCapability\("communication\.billing_updates\.view"\)/,
    label + ': billing inbox is outside the mobile header');
  assert.match(header, /<div className="hidden lg:flex">\s*<SettingsMenu/,
    label + ': account/help controls hidden in mobile header');
  assert.match(header, /hidden lg:inline-flex[^\n]*transition-all|hidden lg:inline-flex[^\n]*rounded-xl/,
    label + ': desktop-only back action');
}
assert.match(headers[1][1], /className="relative hidden lg:block"/,
  'search stays hidden throughout the mobile/tablet header');

assert.match(source, /const \[isMobileHeader, setIsMobileHeader\] = useState/);
assert.match(source, /window\.matchMedia\("\(max-width: 1023px\)"\)/);
assert.match(source, /media\.addEventListener\("change", sync\)/);
assert.match(source, /media\.removeEventListener\("change", sync\)/);

assert.match(source, /renderMobileDrawerUtilities\(true\)/);
assert.match(source, /renderMobileDrawerUtilities\(false\)/);
assert.match(source, /onClick=\{\(\) => \{ setIsMobileMenuOpen\(false\); goBackFromPatientRecord\(\); \}\}/);
assert.match(source, /onViewClinicSettings=\{\(\) => navigateFromDrawer\("settings"\)\}/);
assert.match(source, /onViewBilling=\{\(\) => navigateFromDrawer\("billing"\)\}/);
assert.match(source, /onLogout=\{onLogout\}/);
assert.match(source, /openBillingCommunicationThread\(threadId\)/);
assert.match(source, /isMobileHeader && hasCapability\("communication\.billing_updates\.view"\)/);
assert.match(source, /setIsMobileMenuOpen\(false\);/);
console.log('mobileClinicHeaderOnlyMenuBell: PASS');
