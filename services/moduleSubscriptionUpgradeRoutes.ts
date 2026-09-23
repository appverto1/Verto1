import crypto from 'crypto';
import type { Express } from 'express';
import { ORGANIZATION_MODULE_KEYS, type OrganizationModuleKey } from '../src/constants/organizationModules';

type Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: any) => any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
};

const ACTIVE = new Set(['active', 'trial', 'grace']);
const REVIEWABLE = new Set(['ready', 'sent', 'opened', 'accepted', 'checkout_created']);
const normalizeModules = (values: Iterable<unknown>): OrganizationModuleKey[] =>
  Array.from(new Set(Array.from(values)
    .map((value) => String(value || '').trim())
    .filter((value): value is OrganizationModuleKey =>
      ORGANIZATION_MODULE_KEYS.includes(value as OrganizationModuleKey)))).sort();

const sameModules = (left: Iterable<unknown>, right: Iterable<unknown>) => {
  const a = normalizeModules(left);
  const b = normalizeModules(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const isDemo = (user: any) => {
  const billingModel = String(user?.billingModel || user?.billing_model || '').trim().toLowerCase();
  const workspaceId = String(user?.activeWorkspaceId || user?.clinicId || user?.clinic_id || '').trim();
  const workspaces = Array.isArray(user?.workspaces) ? user.workspaces : [];
  const workspace = workspaces.find((item: any) =>
    String(item?.clinicId || item?.clinic_id || '').trim() === workspaceId);
  return Boolean(
    user?.isDemoUser === true ||
    user?.is_demo_user === true ||
    billingModel === 'demo' ||
    billingModel === 'demo_sandbox' ||
    workspace?.isDemo === true ||
    String(workspace?.billingModel || workspace?.billing_model || '').trim().toLowerCase() === 'demo_sandbox'
  );
};

const reviewSnapshot = (offer: any) => ({
  id: String(offer?.id || ''),
  currency: String(offer?.currency || '').toLowerCase(),
  baseUnitAmountCents: Number(offer?.base_unit_amount_cents || 0),
  initialActivePatientQuantity: Number(offer?.initial_active_patient_quantity || 0),
  discountDurationMonths: Number(offer?.discount_duration_months || 0),
  discountType: offer?.discount_type || null,
  discountPercentage: offer?.discount_percentage == null ? null : Number(offer.discount_percentage),
  promotionalMonthlyAmountCents: offer?.promotional_monthly_amount_cents == null
    ? null : Number(offer.promotional_monthly_amount_cents),
  postDiscountMonthlyAmountCents: offer?.post_discount_monthly_amount_cents == null
    ? null : Number(offer.post_discount_monthly_amount_cents),
  trialDays: Number(offer?.trial_days || 0),
  expiresAt: offer?.expires_at || null,
});

const offerSelect = 'id,lead_id,status,accepted_at,expires_at,revoked_at,offer_type,modular_checkout_enabled,currency,base_unit_amount_cents,initial_active_patient_quantity,discount_duration_months,discount_type,discount_percentage,promotional_monthly_amount_cents,post_discount_monthly_amount_cents,trial_days,modular_snapshot';

async function loadOffer(supabase: any, offerId: string) {
  const result = await supabase.from('sales_offers').select(offerSelect).eq('id', offerId).limit(1).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function materializeCanonicalReplacementOffer(params: {
  supabase: any;
  organizationId: string;
  moduleKey: OrganizationModuleKey;
  expectedModules: OrganizationModuleKey[];
  actorUserId: string;
  contractEmail: string;
}) {
  const { supabase, organizationId, moduleKey, expectedModules, actorUserId, contractEmail } = params;
  if (!actorUserId || !contractEmail || !contractEmail.includes('@')) {
    throw new Error('MODULE_UPGRADE_OFFER_MATERIALIZATION_IDENTITY_REQUIRED');
  }

  const leadResult = await supabase.from('sales_leads')
    .select('id')
    .eq('converted_clinic_id', organizationId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (leadResult.error) throw leadResult.error;
  const leadIds = (Array.isArray(leadResult.data) ? leadResult.data : [])
    .map((row: any) => String(row?.id || '').trim())
    .filter(Boolean);
  if (leadIds.length === 0) throw new Error('MODULE_UPGRADE_DIRECT_PRICE_UNAVAILABLE');

  const simulationResult = await supabase.from('sales_offer_simulations')
    .select('id,lead_id,request_hash,offer_validity_days,created_at')
    .in('lead_id', leadIds)
    .eq('simulation_type', 'modular')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (simulationResult.error) throw simulationResult.error;
  const simulations = Array.isArray(simulationResult.data) ? simulationResult.data : [];
  const simulationIds = simulations.map((row: any) => String(row?.id || '').trim()).filter(Boolean);
  if (simulationIds.length === 0) throw new Error('MODULE_UPGRADE_DIRECT_PRICE_UNAVAILABLE');

  const itemResult = await supabase.from('sales_offer_simulation_items')
    .select('simulation_id,item_key')
    .in('simulation_id', simulationIds)
    .limit(1000);
  if (itemResult.error) throw itemResult.error;
  const modulesBySimulation = new Map<string, OrganizationModuleKey[]>();
  for (const row of Array.isArray(itemResult.data) ? itemResult.data : []) {
    const simulationId = String(row?.simulation_id || '').trim();
    const itemKey = String(row?.item_key || '').trim() as OrganizationModuleKey;
    if (!simulationId || !ORGANIZATION_MODULE_KEYS.includes(itemKey)) continue;
    const values = modulesBySimulation.get(simulationId) || [];
    if (!values.includes(itemKey)) values.push(itemKey);
    modulesBySimulation.set(simulationId, values);
  }

  const simulation = simulations.find((row: any) =>
    sameModules(modulesBySimulation.get(String(row?.id || '').trim()) || [], expectedModules));
  if (!simulation?.id || !simulation?.request_hash) {
    throw new Error('MODULE_UPGRADE_DIRECT_PRICE_UNAVAILABLE');
  }

  const validityDays = Math.min(90, Math.max(1, Number(simulation.offer_validity_days || 14)));
  const expiresAt = new Date(Date.now() + validityDays * 86_400_000).toISOString();
  const stableOfferKey = `module-upgrade-offer:${organizationId}:${moduleKey}:${simulation.id}`.slice(0, 240);
  const publicTokenHash = crypto.createHash('sha256')
    .update(`module-upgrade-public:${organizationId}:${moduleKey}:${simulation.id}`)
    .digest('hex');
  const createResult = await supabase.rpc('create_sales_modular_offer_v3', {
    p_simulation_id: simulation.id,
    p_lead_id: simulation.lead_id,
    p_actor_user_id: actorUserId,
    p_idempotency_key: stableOfferKey,
    p_request_hash: simulation.request_hash,
    p_public_token_hash: publicTokenHash,
    p_expires_at: expiresAt,
    p_contract_email: contractEmail.toLowerCase(),
  });
  if (createResult.error) throw createResult.error;
  const offerId = String(createResult.data?.offer?.id || '').trim();
  if (!offerId) throw new Error('MODULE_UPGRADE_OFFER_MATERIALIZATION_FAILED');
  const offer = await loadOffer(supabase, offerId);
  if (!offer?.id) throw new Error('MODULE_UPGRADE_OFFER_MATERIALIZATION_FAILED');
  return offer;
}

export function registerModuleSubscriptionUpgradeRoutes(app: Express, deps: Deps) {
  const {
    supabase, noStoreDynamicResponse, checkAuth, requireClinicCapability,
    sanitizeString, currentClinicId
  } = deps;

  app.post(
    '/api/clinic/modules/:moduleKey/upgrade-intents',
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability('clinic.settings.edit'),
    async (req: any, res: any) => {
      try {
        const organizationId = sanitizeString(currentClinicId(req.session?.user), 120);
        const moduleKey = sanitizeString(req.params?.moduleKey, 80) as OrganizationModuleKey;
        const requestedOfferId = sanitizeString(req.body?.offerId, 120);
        const idempotencyKey = sanitizeString(req.body?.idempotencyKey, 200);
        const context = req.authorizationContext;
        const role = sanitizeString(context?.role, 40).toLowerCase();
        const capabilities = context?.capabilities instanceof Set
          ? context.capabilities
          : new Set(Array.isArray(context?.capabilities) ? context.capabilities : []);

        if (!organizationId) return res.status(403).json({ success: false, error: 'CLINIC_REQUIRED' });
        if (!ORGANIZATION_MODULE_KEYS.includes(moduleKey) || moduleKey === 'clinical_core') {
          return res.status(422).json({ success: false, error: 'MODULE_UPGRADE_NOT_SELLABLE' });
        }
        if (idempotencyKey.length < 8) {
          return res.status(422).json({ success: false, error: 'MODULE_UPGRADE_REQUEST_INVALID' });
        }
        if (!['director', 'coordinator'].includes(role) || !capabilities.has('clinic.settings.edit')) {
          return res.status(403).json({ success: false, error: 'MODULE_UPGRADE_COMMERCIAL_FORBIDDEN' });
        }
        if (isDemo(req.session?.user)) {
          return res.status(403).json({ success: false, error: 'MODULE_UPGRADE_DEMO_FORBIDDEN' });
        }

        const [profileResult, entitlementResult] = await Promise.all([
          supabase.from('organization_module_access_profiles')
            .select('organization_id,mode,version,stripe_subscription_id')
            .eq('organization_id', organizationId).limit(1).maybeSingle(),
          supabase.from('organization_module_entitlements')
            .select('module_key,status')
            .eq('organization_id', organizationId)
            .in('module_key', ORGANIZATION_MODULE_KEYS).limit(20),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (entitlementResult.error) throw entitlementResult.error;

        const profile = profileResult.data;
        const subscriptionId = sanitizeString(profile?.stripe_subscription_id, 180);
        if (!profile?.organization_id || profile.mode !== 'contract' ||
            !Number.isInteger(Number(profile.version)) || Number(profile.version) < 1 ||
            !subscriptionId) {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_ACCESS_PROFILE_STALE' });
        }

        const entitlements = Array.isArray(entitlementResult.data) ? entitlementResult.data : [];
        const target = entitlements.find((row: any) => String(row?.module_key || '') === moduleKey);
        const targetStatus = String(target?.status || '').toLowerCase();
        if (ACTIVE.has(targetStatus)) {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_ALREADY_ENTITLED' });
        }
        if (targetStatus === 'suspended') {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_BILLING_RECOVERY_REQUIRED' });
        }
        if (targetStatus === 'cancelled') {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_REACTIVATION_REQUIRED' });
        }

        const activeModules = entitlements
          .filter((row: any) => ACTIVE.has(String(row?.status || '').toLowerCase()))
          .map((row: any) => row?.module_key);
        const expectedModules = normalizeModules(['clinical_core', ...activeModules, moduleKey]);
        const actorUserId = sanitizeString(req.session?.user?.id || req.session?.user?.userId, 120);
        const contractEmail = sanitizeString(req.session?.user?.email, 254).toLowerCase();
        const offer = requestedOfferId
          ? await loadOffer(supabase, requestedOfferId)
          : await materializeCanonicalReplacementOffer({
              supabase,
              organizationId,
              moduleKey,
              expectedModules,
              actorUserId,
              contractEmail,
            });

        const offerStatus = String(offer?.status || '').toLowerCase();
        const expiresAt = Date.parse(String(offer?.expires_at || ''));
        if (!offer?.id || offer.offer_type !== 'modular' || offer.modular_checkout_enabled === false ||
            offer.revoked_at || !REVIEWABLE.has(offerStatus) ||
            !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_OFFER_STALE' });
        }

        const [leadResult, itemResult] = await Promise.all([
          supabase.from('sales_leads').select('id,converted_clinic_id')
            .eq('id', offer.lead_id).limit(1).maybeSingle(),
          supabase.from('sales_offer_items').select('offer_id,item_key')
            .eq('offer_id', offer.id).limit(50),
        ]);
        if (leadResult.error) throw leadResult.error;
        if (itemResult.error) throw itemResult.error;
        if (String(leadResult.data?.converted_clinic_id || '') !== organizationId) {
          return res.status(403).json({ success: false, error: 'MODULE_UPGRADE_OFFER_TENANT_MISMATCH' });
        }

        const offerModules = normalizeModules(
          (Array.isArray(itemResult.data) ? itemResult.data : []).map((row: any) => row?.item_key)
        );
        if (!sameModules(expectedModules, offerModules)) {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_OFFER_MODULE_SET_STALE' });
        }

        const intentResult = await supabase.rpc('acquire_module_subscription_upgrade_intent_v1', {
          p_organization_id: organizationId,
          p_sales_offer_id: offer.id,
          p_stripe_subscription_id: subscriptionId,
          p_expected_access_profile_version: Number(profile.version),
          p_expected_access_profile_mode: String(profile.mode),
          p_idempotency_key: idempotencyKey,
          p_claim_ttl_seconds: 900,
        });
        if (intentResult.error) throw intentResult.error;
        const intent = intentResult.data || {};

        return res.status(202).json({
          success: true,
          data: {
            moduleKey,
            intentId: sanitizeString(intent.id, 120),
            intentStatus: sanitizeString(intent.intent_status, 40),
            offer: reviewSnapshot(offer),
            offerMaterialized: !requestedOfferId,
            requiresAuthoritativeStripeConfirmation: true,
            entitlementGranted: false,
          },
        });
      } catch (error: any) {
        const message = sanitizeString(error?.message || error?.code || String(error), 260);
        if (/DIRECT_PRICE_UNAVAILABLE|MATERIALIZATION_IDENTITY_REQUIRED/i.test(message)) {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_DIRECT_PRICE_UNAVAILABLE', retryable: false });
        }
        if (/IDEMPOTENCY_CONFLICT/i.test(message)) {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_IDEMPOTENCY_CONFLICT' });
        }
        if (/UPGRADE_ALREADY_IN_PROGRESS/i.test(message)) {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_ALREADY_IN_PROGRESS' });
        }
        if (/STALE_ACCESS_PROFILE|BILLING_NOT_ACTIVE|OFFER_ORGANIZATION_MISMATCH/i.test(message)) {
          return res.status(409).json({ success: false, error: 'MODULE_UPGRADE_STALE_AUTHORITY' });
        }
        const schemaUnavailable =
          /module_subscription_upgrade_intents|acquire_module_subscription_upgrade_intent_v1|create_sales_modular_offer_v3|organization_module_access_profiles|organization_module_entitlements|sales_offer_simulation_items|sales_offer_simulations|sales_offer_items|sales_offers|sales_leads|PGRST202|42P01|42703|42883/i.test(message);
        console.warn('[ModulePurchase] upgrade intent failed', {
          code: sanitizeString(error?.code, 80),
          message,
        });
        return res.status(schemaUnavailable ? 503 : 500).json({
          success: false,
          error: schemaUnavailable ? 'MODULE_UPGRADE_SCHEMA_UNAVAILABLE' : 'MODULE_UPGRADE_INTENT_FAILED',
          retryable: !schemaUnavailable,
        });
      }
    }
  );
}
