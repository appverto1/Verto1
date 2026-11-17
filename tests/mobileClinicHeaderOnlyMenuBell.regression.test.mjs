import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Both clinic headers (main workspace and patient record) expose only a
// hamburger below lg. Notifications and account tools move inside the drawer.
const source = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const headers = [...source.matchAll(/\{\/\* Header \*\/\}([\s\S]*?)\{\/\* Mobile Menu Drawer \*\/\}/g)];
assert.equal(headers.length, 2, 'workspace and patient-record headers must be covered');

for (const [index, match] of headers.entries()) {
  const header = match[1];
  const label = index === 0 ? 'patient record' : 'workspace';
  assert.match(header, /\{!isMobileHeader && <ClinicalMentionNotifications/, label + ': clinical bell is desktop-only');
  assert.equal((header.match(/<Menu size=\{20\}/g) || []).length, 1, label + ': one hamburger');
  assert.equal((header.match(/<ClinicalMentionNotifications/g) || []).length, 1, label + ': desktop bell preserved');
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
// Mobile drawer should not show the billing message bubble for now.
const utilities = source.slice(
  source.indexOf('const renderMobileDrawerUtilities ='),
  source.indexOf('if (view === "patient" && selectedPatientId)'),
);
assert.doesNotMatch(utilities, /BillingCommunicationNotifications|openBillingCommunicationThread/,
  'no billing message bubble inside the mobile drawer');
assert.match(source, /!isMobileHeader && hasCapability\("communication\.billing_updates\.view"\)/,
  'desktop billing notifications stay available');
assert.match(source, /setIsMobileMenuOpen\(false\);/);
// The hamburger contains a single navigation list: account and settings
// actions must be its final section, rather than a gear opening a second menu.
const drawers = [...source.matchAll(/<nav className="min-h-0 flex-1 overflow-y-auto no-scrollbar overflow-x-hidden">([\s\S]*?)<\/nav>/g)];
assert.equal(drawers.length, 2, 'both mobile drawers must share unified navigation and settings');
for (const [index, match] of drawers.entries()) {
  const drawer = match[1];
  assert.ok(drawer.indexOf('renderNavigationGroups({') < drawer.indexOf('renderMobileDrawerUtilities('),
    'drawer ' + index + ': settings after navigation at end');
}
assert.match(source, /<section className="mt-6 border-t border-slate-200 pt-4"[^>]*data-mobile-drawer-settings>/);
assert.match(source, /<SettingsMenu\s+inline\s+showAccountIdentity=\{false\}/,
  'account actions below navigation no longer duplicate the professional header');
assert.match(source, /onClick=\{\(\) => \{ setIsMobileMenuOpen\(false\); goBackFromPatientRecord\(\); \}\}/);

const settings = readFileSync('src/components/SettingsMenu.tsx', 'utf8');
assert.match(settings, /inline\?: boolean/, 'inline mode exists');
assert.match(settings, /const accountActions = \(/, 'menu actions are shared');
assert.match(settings, /\{inline \? \(/, 'inline actions rendered directly');
assert.match(settings, /onAction\?\.\(\)/, 'navigating away closes hamburger');
assert.match(settings, /canManageClinicSettings && onViewClinicSettings/, 'clinic settings preserve authorization');
assert.match(settings, /canSwitchAccessContext &&/, 'context switching remains conditional');
assert.match(settings, /const teamSettingsAction = canManageTeam \? \(/, 'team actions remain conditional');
assert.match(settings, /const billingSettingsAction = canSeeBilling \? \(/, 'subscription remains conditional');
assert.match(settings, /handleLogout\(\)/, 'logout remains supported');
assert.match(settings, /Central de ajuda e tutoriais/, 'help is directly accessible');
assert.match(settings, /\{inline \? \(/, 'no nested trigger on mobile');
// Each drawer starts with identity (portrait, name, role) and close button.
// Theme control now lives after modules with the account tools.
const mobileProfessionalHeaders = [...source.matchAll(/<ProfessionalMobileDrawerHeader[\s\S]*?onClose=\{\(\) => setIsMobileMenuOpen\(false\)\}/g)];
assert.equal(mobileProfessionalHeaders.length, 2,
  'both mobile drawers begin with the same reusable professional header');
assert.match(settings, /export function ProfessionalMobileDrawerHeader\(/);
assert.match(settings, /data-mobile-professional-header/);
const identityPosition = settings.indexOf('<ProfessionalAccountIdentity user={user} />');
const headerSection = settings.slice(settings.indexOf('export function ProfessionalMobileDrawerHeader('), settings.indexOf('export function SettingsMenu('));
assert.ok(identityPosition !== -1, 'shared header keeps user identity');
assert.doesNotMatch(headerSection, /onClick=\{onToggleTheme\}/, 'no theme button before modules');
assert.match(settings, /onClick=\{onToggleTheme\}/, 'theme is available in account tools');
const footerStart = settings.indexOf('data-mobile-account-settings');
const profileAction = settings.indexOf('{profileSettingsAction}', footerStart);
const clinicAction = settings.indexOf('{clinicSettingsAction}', footerStart);
const teamAction = settings.indexOf('{teamSettingsAction}', footerStart);
const billingAction = settings.indexOf('{billingSettingsAction}', footerStart);
const utilitiesStart = settings.indexOf('const accountActions =');
assert.ok(footerStart > utilitiesStart, 'settings footer follows the main actions');
assert.ok(settings.indexOf('Central de ajuda e tutoriais', utilitiesStart) < footerStart,
  'help remains before final settings');
assert.ok(settings.indexOf('onClick={onToggleTheme}', utilitiesStart) < footerStart,
  'theme remains after modules but before final settings');
assert.ok(profileAction > footerStart && clinicAction > profileAction &&
  teamAction > clinicAction && billingAction > teamAction,
  'professional and clinic settings preserve visual, keyboard and screen-reader order');
assert.match(settings, /\{!inline && profileSettingsAction\}/, 'desktop profile stays in original menu position');
assert.match(settings, /\{!inline && clinicSettingsAction\}/, 'desktop clinic settings stay in original menu position');
assert.match(settings, /themeMode\?: 'light' \| 'dark'/);
assert.match(settings, /onToggleTheme\?: \(\) => void/);
assert.match(settings, /themeMode === 'light' \? 'Tema escuro' : 'Tema claro'/);
assert.match(settings, /profileImageUrl && !profileImageFailed/, 'professional image retained');
assert.match(settings, /\{roleLabel\}/);
assert.match(settings, /\{organizationName\}/);
assert.match(settings, /showAccountIdentity && \(/);
assert.doesNotMatch(source, /className="flex items-center justify-between mb-2">\s*<div className="flex items-center gap-3">\s*<LogoVerto size=\{32\} showText=\{true\}/,
  'the old logo-only header is replaced by professional identity in both drawers');
assert.match(source, /mobileDrawer: true/, 'mobile nav excludes duplicate settings group');
assert.match(source, /!mobileDrawer \|\| !group\.some\(\(item\) => item\.id === "settings-root"\)/);
assert.match(source, /<ClinicalMentionNotifications themeMode=\{theme\} inMobileDrawer/, 'notifications relocated into drawer');
assert.match(source, /onViewRooms=\{canAccessTab\("rooms"\)/, 'rooms remain capability-gated');
assert.match(source, /onViewLogs=\{canAccessTab\("logs"\)/, 'logs remain capability-gated');
// Layout regression: both clinical drawers must use the responsive width,
// rather than the 280px panel that forced long menu labels onto two lines.
const responsiveDrawer = 'w-[calc(100vw-12px)] max-w-[360px]';
assert.equal(source.split(responsiveDrawer).length - 1, 2,
  'patient-record and workspace drawers must share the wider mobile width');
assert.doesNotMatch(source, /fixed top-0 right-0 bottom-0 w-\\[280px\\]/,
  'do not restore the narrow clinical mobile drawer');
assert.equal(source.split('lg:hidden shadow-2xl flex flex-col p-4').length - 1, 2,
  'mobile drawer uses compact outer padding without altering desktop');
assert.match(settings, /whitespace-nowrap text-\\[13px\\] font-medium" : "text-sm font-medium"\\}>Módulos e recursos/,
  'the mobile module label stays on one line without changing desktop typography');
assert.match(settings, /shrink-0 text-\\[8px\\] bg-purple-100/,
  'the module badge keeps its own space beside the label');
assert.match(settings, /inline \\? "text-\\[13px\\] font-medium" : "text-sm font-medium"\\}>Configurações da clínica/,
  'clinic settings keep a legible compact mobile label');
assert.match(settings, /Central de ajuda e tutoriais/,
  'help stays available and legible');

console.log('mobileClinicHeaderOnlyMenuBell: PASS');
