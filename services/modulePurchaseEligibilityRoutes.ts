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
import { normalizeModuleSet, isDemoSession, loadCanonicalDirectOffers } from './modulePurchaseEligibilitySupport';

type ModulePurchaseEligibilityRouteDeps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: any) => any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
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
