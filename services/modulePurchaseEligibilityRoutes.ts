import type { Express } from 'express';
import {
  ORGANIZATION_MODULE_KEYS,
  type OrganizationModuleAccessMode,
  type OrganizationModuleEntitlementStatus,
  type OrganizationModuleKey,
} from '../src/constants/organizationModules';
import { resolveModulePurchaseEligibility } from '../src/utils/modulePurchaseEligibility';
import { registerModuleSubscriptionUpgradeRoutes } from './moduleSubscriptionUpgradeRoutes';
import { registerModuleSubscriptionUpgradeExecutionRoutes } from './moduleSubscriptionUpgradeExecutionRoutes';

type ModulePurchaseEligibilityRouteDeps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: any) => any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
};

const DIRECT_OFFER_STATUSES = new Set(['ready', 'sent', 'opened', 'accepted', 'checkout_created']);
const normalizeModuleSet = (values: Iterable<unknown>) => Array.from(new Set(Array.from(values).map((value) => String(value || '').trim()).filter((value): value is OrganizationModuleKey => ORGANIZATION_MODULE_KEYS.includes(value as OrganizationModuleKey)))).sort();
const sameModuleSet = (left: Iterable<unknown>, right: Iterable<unknown>) => { const a = normalizeModuleSet(left); const b = normalizeModuleSet(right); return a.length === b.length && a.every((value, index) => value === b[index]); };
const isDemoSession = (user: any) => { const billingModel = String(user?.billingModel || user?.billing_model || '').trim().toLowerCase(); const activeWorkspaceId = String(user?.activeWorkspaceId || user?.clinicId || user?.clinic_id || '').trim(); const workspaces = Array.isArray(user?.workspaces) ? user.workspaces : []; const activeWorkspace = workspaces.find((workspace: any) => String(workspace?.clinicId || workspace?.clinic_id || '').trim() === activeWorkspaceId); return Boolean(user?.isDemoUser === true || user?.is_demo_user === true || billingModel === 'demo' || billingModel === 'demo_sandbox' || activeWorkspace?.isDemo === true || String(activeWorkspace?.billingModel || activeWorkspace?.billing_model || '').trim().toLowerCase() === 'demo_sandbox'); };

const loadCanonicalDirectOffers = async (supabase: any, organizationId: string, currentModules: readonly OrganizationModuleKey[]) => {
  const leadResult = await supabase.from('sales_leads').select('id').eq('converted_clinic_id', organizationId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(20);
  if (leadResult.error) throw leadResult.error;
  const leadIds = (Array.isArray(leadResult.data) ? leadResult.data : []).map((row: any) => String(row?.id || '').trim()).filter(Boolean);
  if (leadIds.length === 0) return new Map<OrganizationModuleKey, string>();
  const offerResult = await supabase.from('sales_offers').select('id,lead_id,status,expires_at,revoked_at,offer_type,modular_checkout_enabled,created_at').in('lead_id', leadIds).eq('offer_type', 'modular').is('revoked_at', null).order('created_at', { ascending: false }).limit(50);
  if (offerResult.error) throw offerResult.error;
  const now = Date.now();
  const offers = (Array.isArray(offerResult.data) ? offerResult.data : []).filter((offer: any) => { const status = String(offer?.status || '').trim().toLowerCase(); const expiresAt = Date.parse(String(offer?.expires_at || '')); return DIRECT_OFFER_STATUSES.has(status) && offer?.modular_checkout_enabled !== false && Number.isFinite(expiresAt) && expiresAt > now; });
  const offerIds = offers.map((offer: any) => String(offer?.id || '').trim()).filter(Boolean);
  if (offerIds.length === 0) return new Map<OrganizationModuleKey, string>();
  const itemResult = await supabase.from('sales_offer_items').select('offer_id,item_key').in('offer_id', offerIds).limit(500);
  if (itemResult.error) throw itemResult.error;
  const moduleSetByOffer = new Map<string, OrganizationModuleKey[]>();
  for (const row of Array.isArray(itemResult.data) ? itemResult.data : []) { const offerId = String(row?.offer_id || '').trim(); const itemKey = String(row?.item_key || '').trim() as OrganizationModuleKey; if (!offerId || !ORGANIZATION_MODULE_KEYS.includes(itemKey)) continue; const list = moduleSetByOffer.get(offerId) || []; if (!list.includes(itemKey)) list.push(itemKey); moduleSetByOffer.set(offerId, list); }
  const currentSet = normalizeModuleSet(['clinical_core', ...currentModules]);
  const directByModule = new Map<OrganizationModuleKey, string>();
  for (const moduleKey of ORGANIZATION_MODULE_KEYS) { if (moduleKey === 'clinical_core' || currentSet.includes(moduleKey)) continue; const expectedSet = normalizeModuleSet([...currentSet, moduleKey]); const matchingOffer = offers.find((offer: any) => sameModuleSet(moduleSetByOffer.get(String(offer?.id || '').trim()) || [], expectedSet)); if (matchingOffer?.id) directByModule.set(moduleKey, String(matchingOffer.id)); }
  return directByModule;
};

export function registerModulePurchaseEligibilityRoutes(app: Express, deps: ModulePurchaseEligibilityRouteDeps) {
  const { supabase, noStoreDynamicResponse, checkAuth, requireClinicCapability, sanitizeString, currentClinicId } = deps;
  app.get('/api/clinic/modules/purchase-eligibility', noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.view'), async (req: any, res: any) => {
    try {
      const organizationId = sanitizeString(currentClinicId(req.session?.user), 120);
      if (!organizationId) return res.status(403).json({ success: false, error: 'CLINIC_REQUIRED' });
      const context = req.authorizationContext;
      const role = sanitizeString(context?.role, 40).toLowerCase();
      const capabilities = context?.capabilities instanceof Set ? context.capabilities : new Set(Array.isArray(context?.capabilities) ? context.capabilities : []);
      const canManageCommercial = ['director', 'coordinator'].includes(role) && capabilities.has('clinic.settings.edit');
      const [accessResult, entitlementResult] = await Promise.all([
        supabase.rpc('get_organization_module_access_v1', { p_organization_id: organizationId }),
        supabase.from('organization_module_entitlements').select('module_key,status,starts_at,ends_at').eq('organization_id', organizationId).in('module_key', ORGANIZATION_MODULE_KEYS).limit(20),
      ]);
      if (accessResult.error) throw accessResult.error;
      if (entitlementResult.error) throw entitlementResult.error;
      const access = accessResult.data && typeof accessResult.data === 'object' ? accessResult.data : {};
      const accessMode: OrganizationModuleAccessMode = access.mode === 'contract' ? 'contract' : 'legacy_full';
      const accessVersion = Number(access.version || 0);
      const currentModules = normalizeModuleSet(Array.isArray(access.modules) ? access.modules : []);
      if (!Number.isInteger(accessVersion) || accessVersion < 1) return res.status(503).json({ success: false, error: 'MODULE_PURCHASE_ACCESS_PROFILE_STALE', retryable: false });
      const entitlementByModule = new Map<OrganizationModuleKey, OrganizationModuleEntitlementStatus>();
      for (const row of Array.isArray(entitlementResult.data) ? entitlementResult.data : []) { const moduleKey = String(row?.module_key || '').trim() as OrganizationModuleKey; const status = String(row?.status || '').trim().toLowerCase() as OrganizationModuleEntitlementStatus; if (!ORGANIZATION_MODULE_KEYS.includes(moduleKey)) continue; if (!['active', 'trial', 'grace', 'suspended', 'cancelled'].includes(status)) continue; entitlementByModule.set(moduleKey, status); }
      const directOfferByModule = accessMode === 'contract' ? await loadCanonicalDirectOffers(supabase, organizationId, currentModules) : new Map<OrganizationModuleKey, string>();
      const demo = isDemoSession(req.session?.user);
      const modules = ORGANIZATION_MODULE_KEYS.map((moduleKey) => { const directOfferId = directOfferByModule.get(moduleKey) || null; const base = resolveModulePurchaseEligibility({ moduleKey, accessMode, entitlementStatus: entitlementByModule.get(moduleKey) || null, actorCapabilities: capabilities, isDemo: demo, directOfferAvailable: Boolean(directOfferId) }); return { ...base, canPurchase: base.canPurchase && canManageCommercial, directOfferId: base.state === 'eligible' && canManageCommercial ? directOfferId : null, commercialCapability: canManageCommercial }; });
      return res.json({ success: true, data: { organizationId, accessMode, accessVersion, modules } });
    } catch (error: any) {
      const message = sanitizeString(error?.message || error?.code || String(error), 220);
      const schemaUnavailable = /get_organization_module_access_v1|organization_module_entitlements|sales_offer_items|sales_offers|sales_leads|PGRST202|42P01|42703|42883/i.test(message);
      console.warn('[ModulePurchase] eligibility failed', { code: sanitizeString(error?.code, 80), message });
      return res.status(schemaUnavailable ? 503 : 500).json({ success: false, error: schemaUnavailable ? 'MODULE_PURCHASE_SCHEMA_UNAVAILABLE' : 'MODULE_PURCHASE_ELIGIBILITY_FAILED', retryable: !schemaUnavailable });
    }
  });

  registerModuleSubscriptionUpgradeRoutes(app, {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability,
    sanitizeString,
    currentClinicId,
  });
  registerModuleSubscriptionUpgradeExecutionRoutes(app, {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability,
    sanitizeString,
    currentClinicId,
  });
}
