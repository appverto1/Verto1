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
  assert.ok(header.indexOf('<ClinicalMentionNotifications') < header.indexOf('<Menu size={20}'),
    label + ': clinical bell comes before hamburger on mobile');
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
// The hamburger contains a single navigation list: account and settings
// actions must be its final section, rather than a gear opening a second menu.
const drawers = [...source.matchAll(/<nav className="min-h-0 flex-1 overflow-y-auto no-scrollbar">([\\s\\S]*?)<\\/nav>/g)];
assert.equal(drawers.length, 2, 'both mobile drawers must share unified navigation and settings');
for (const [index, match] of drawers.entries()) {
  const drawer = match[1];
  assert.ok(drawer.indexOf('renderNavigationGroups({') < drawer.indexOf('renderMobileDrawerUtilities('),
    'drawer ' + index + ': settings after navigation at end');
}
assert.match(source, /<section className="mt-6 border-t border-slate-200 pt-4"[^>]*data-mobile-drawer-settings>/);
assert.match(source, /<SettingsMenu\\s+inline\\s+onAction=\\{\\(\\) => setIsMobileMenuOpen\\(false\\)\\}/);
assert.match(source, /onClick=\\{\\(\\) => \\{ setIsMobileMenuOpen\\(false\\); goBackFromPatientRecord\\(\\); \\}\\}/);

const settings = readFileSync('src/components/SettingsMenu.tsx', 'utf8');
assert.match(settings, /inline\\?: boolean/, 'inline mode exists');
assert.match(settings, /const accountActions = \\(/, 'menu actions are shared');
assert.match(settings, /\\{inline \\? \\(/, 'inline actions rendered directly');
assert.match(settings, /onAction\\?\\.\\(\\)/, 'navigating away closes hamburger');
assert.match(settings, /canManageClinicSettings && onViewClinicSettings/, 'clinic settings preserve authorization');
assert.match(settings, /canSwitchAccessContext &&/, 'context switching remains conditional');
assert.match(settings, /canManageTeam &&/, 'team actions remain conditional');
assert.match(settings, /canSeeBilling &&/, 'subscription remains conditional');
assert.match(settings, /handleLogout\\(\\)/, 'logout remains supported');
assert.match(settings, /Central de ajuda e tutoriais/, 'help is directly accessible');
assert.match(settings, /\\{inline \\? \\(/, 'no nested trigger on mobile');
console.log('mobileClinicHeaderOnlyMenuBell: PASS');
