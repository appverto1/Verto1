import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const menu = readFileSync('src/components/SettingsMenu.tsx', 'utf8');
const notifications = readFileSync('src/components/ClinicalMentionNotifications.tsx', 'utf8');
const marketplace = readFileSync('src/components/PartnerMarketplace.tsx', 'utf8');
// Staging mounts the partner router through the extracted sales module.
const salesRoutes = readFileSync('services/salesProspectingRoutes.ts', 'utf8');
const partnerRoutes = readFileSync('services/partnerships/partnershipRoutes.ts', 'utf8');

const contains = (source, needle, what) =>
  assert.ok(source.includes(needle), what + ': ' + needle);

assert.equal((dashboard.match(/\/\* Mobile Menu Drawer \*\//g) || []).length, 2,
  'two mobile drawers remain: main and patient record');
assert.equal(dashboard.split('w-[calc(100vw-12px)] max-w-[360px]').length - 1, 2,
  'both mobile drawers use tested responsive width');
assert.equal(dashboard.split('<ProfessionalMobileDrawerHeader').length - 1, 2,
  'identity comes first in both drawers');
assert.equal(dashboard.split('mobileDrawer: true,').length - 1, 2,
  'the two mobile navigation groups filter duplicate settings');
contains(dashboard, '.filter((group) => !mobileDrawer || !group.some((item) => item.id === "settings-root"))',
  'mobile settings are separate from clinical modules');
assert.equal(dashboard.split('renderMobileDrawerUtilities(').length - 1, 2,
  'both drawers show utilities and settings after their modules');
assert.equal(dashboard.split('{!isMobileHeader && <ClinicalMentionNotifications').length - 1, 2,
  'headers show clinical notifications only on desktop');
assert.equal(dashboard.split('{!isMobileHeader && hasCapability("communication.billing_updates.view")').length - 1, 2,
  'billing notifications cannot appear as extra mobile header icons');
contains(dashboard, 'hidden lg:inline-flex shrink-0 rounded-full', 'patient back button hidden on mobile');
assert.equal(dashboard.split('aria-label="Abrir menu"').length - 1, 2,
  'both clinical headers have accessible hamburgers');
assert.equal((dashboard.match(/className="hidden lg:flex">\s*<SettingsMenu/g) || []).length, 2,
  'desktop account menu is hidden on mobile and remains available on desktop');

const identity = menu.slice(menu.indexOf('export function ProfessionalMobileDrawerHeader('),
  menu.indexOf('export function SettingsMenu('));
contains(identity, '<ProfessionalAccountIdentity user={user} />', 'real photo/name/role kept');
contains(menu, 'Configurações do profissional', 'professional settings shown in final footer');
contains(menu, 'data-mobile-account-settings', 'mobile footer has separate section');
contains(menu, '{profileSettingsAction}', 'professional setting follows footer heading');
contains(menu, '{clinicSettingsAction}', 'authorized clinic setting follows professional');
contains(menu, 'canManageClinicSettings && onViewClinicSettings', 'clinic settings remain guarded');
contains(menu, 'const teamSettingsAction = canManageTeam ? (', 'team management remains role gated');
contains(menu, 'const billingSettingsAction = canSeeBilling ? (', 'billing remains role gated');
contains(menu, 'onViewRooms &&', 'rooms remain capability-gated by dashboard');
contains(menu, 'onViewLogs &&', 'logs remain capability-gated by dashboard');
contains(dashboard, 'onViewRooms={canAccessTab("rooms") ?', 'backend-derived room access');
contains(dashboard, 'onViewLogs={canAccessTab("logs") ?', 'backend-derived log access');
contains(menu, 'Central de ajuda e tutoriais', 'help tool retained');
contains(menu, 'Reiniciar tutorial guiado', 'guided tutorial retained');
contains(menu, 'Trocar clínica ou acesso', 'authorized context switch retained');
contains(dashboard, 'inMobileDrawer onOpenNotification=', 'mobile clinical notifications retained');
contains(notifications, 'createPortal(notificationsPanel, document.body)', 'notification overlay cannot be clipped');

// The drawer unmounts on close. Marketplace must stay owned by the dashboard
// and close only through explicit modal action, also when opened from a record.
contains(dashboard, 'const [isMobileMarketplaceOpen, setIsMobileMarketplaceOpen] = useState(false)', 'persistent marketplace state');
contains(dashboard, 'onOpenMarketplace={() => setIsMobileMarketplaceOpen(true)}', 'mobile partners action');
contains(dashboard, 'const mobileMarketplaceOverlay = isMobileMarketplaceOpen', 'popup outside disappearing drawer');
contains(dashboard, 'createPortal(\n        <PartnerMarketplace', 'popup portal to document body');
assert.equal(dashboard.split('{mobileMarketplaceOverlay}').length - 1, 2,
  'popup must be rendered independently in both workspace and record branches');
contains(menu, 'if (onOpenMarketplace) onOpenMarketplace();', 'parent controls mobile popup');
contains(menu, 'else setMarketplaceOpen(true);', 'desktop fallback still works');
contains(marketplace, "credentials:'include'", 'marketplace uses authenticated API');
contains(partnerRoutes, "app.post('/api/partnerships/apply'", 'partner application backend preserved');
contains(partnerRoutes, "app.patch('/api/owner/partnerships/accounts/:id'", 'partner approval backend preserved');
contains(salesRoutes, 'registerPartnershipRoutes(app,{supabase,checkAuth,checkPlatformAdmin});',
  'partner API remains mounted');

assert.equal(existsSync('src/components/StackedDomainStatusChart.tsx'), false,
  'retired chart component not available in production branch');
assert.doesNotMatch(dashboard, /StackedDomainStatusChart|Status das habilidades por domínio/i,
  'removed chart not rendered for any clinical role');
contains(dashboard, '{renderAgendaContent()}', 'existing agenda intact');

console.log('mainMobileClinicalMenuPromotion.regression.test.mjs: PASS');
