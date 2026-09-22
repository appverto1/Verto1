import type { Express } from 'express';
import { executeOrReconcileModuleSubscriptionUpgrade } from './moduleSubscriptionUpgradeStripe';

type Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: any) => any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
};

export function registerModuleSubscriptionUpgradeExecutionRoutes(app: Express, deps: Deps) {
  const { supabase, noStoreDynamicResponse, checkAuth, requireClinicCapability, sanitizeString, currentClinicId } = deps;

  app.post(
    '/api/clinic/modules/upgrade-intents/:intentId/execute',
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability('clinic.settings.edit'),
    async (req: any, res: any) => {
      try {
        const organizationId = sanitizeString(currentClinicId(req.session?.user), 120);
        const intentId = sanitizeString(req.params?.intentId, 120);
        const context = req.authorizationContext;
        const role = sanitizeString(context?.role, 40).toLowerCase();
        const capabilities = context?.capabilities instanceof Set
          ? context.capabilities
          : new Set(Array.isArray(context?.capabilities) ? context.capabilities : []);
        if (!organizationId) return res.status(403).json({ success: false, error: 'CLINIC_REQUIRED' });
        if (!intentId) return res.status(422).json({ success: false, error: 'MODULE_UPGRADE_INTENT_REQUIRED' });
        if (!['director', 'coordinator'].includes(role) || !capabilities.has('clinic.settings.edit')) {
          return res.status(403).json({ success: false, error: 'MODULE_UPGRADE_COMMERCIAL_FORBIDDEN' });
        }

        const result = await executeOrReconcileModuleSubscriptionUpgrade({ supabase, organizationId, intentId });
        const statusCode = result.state === 'provisioned' ? 200 : 202;
        return res.status(statusCode).json({
          success: true,
          data: {
            state: result.state,
            intentStatus: result.intentStatus,
            entitlementGranted: result.entitlementGranted,
            invoiceId: result.invoiceId,
            paymentIntentStatus: result.paymentIntentStatus,
            requiresAuthoritativeStripeConfirmation: result.state !== 'provisioned',
          },
        });
      } catch (error: any) {
        const message = sanitizeString(error?.message || error?.code || String(error), 260);
        const stale = /ACCESS_PROFILE_STALE|OFFER_STALE|SUBSCRIPTION_STALE|ENTITLEMENT_STALE|STRIPE_ITEM_IDENTITY_STALE|DUPLICATE_STRIPE_LINE/i.test(message);
        const unsupported = /SCHEDULE_PHASE_RECONCILIATION_REQUIRED|ONE_TIME_CHARGE_UNSUPPORTED/i.test(message);
        const notAccepted = /OFFER_NOT_ACCEPTED/i.test(message);
        const notFound = /INTENT_NOT_FOUND/i.test(message);
        console.warn('[ModulePurchase] upgrade execution failed', { code: sanitizeString(error?.code, 80), message });
        return res.status(notFound ? 404 : notAccepted || stale ? 409 : unsupported ? 422 : 500).json({
          success: false,
          error: notFound
            ? 'MODULE_UPGRADE_INTENT_NOT_FOUND'
            : notAccepted
              ? 'MODULE_UPGRADE_OFFER_NOT_ACCEPTED'
              : stale
                ? 'MODULE_UPGRADE_STALE_AUTHORITY'
                : unsupported
                  ? 'MODULE_UPGRADE_SAFE_EXECUTION_UNAVAILABLE'
                  : 'MODULE_UPGRADE_EXECUTION_FAILED',
          retryable: !unsupported && !stale && !notAccepted,
        });
      }
    },
  );
}
