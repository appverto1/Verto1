import type Stripe from 'stripe';
import crypto from 'crypto';
// Item 09: Stripe entitlements; original audited statements retained unchanged.
export const createSalesSubscriptionEntitlementTransitions = (deps: Record<string, any>) => {
  const { sanitizeString, supabase } = deps;
  // ITEM09_SOURCE_BEGIN
  const stripeSubscriptionToEntitlementStatus = (
    status: unknown,
  ): "active" | "trial" | "grace" | "suspended" | "cancelled" => {
    const normalized = sanitizeString(status, 40).toLowerCase();
    if (normalized === "trialing") return "trial";
    if (normalized === "active") return "active";
    if (normalized === "past_due") return "grace";
    if (normalized === "canceled") return "cancelled";
    return "suspended";
  };

  const applyModularEntitlementsForOrganization = async (params: {
    offerId: string;
    organizationId: string;
    stripeSubscriptionId: string;
    stripeEventId: string;
    stripeEventCreatedAt: string;
    status: "active" | "trial" | "grace" | "suspended" | "cancelled";
  }) => {
    const { error } = await supabase.rpc(
      "apply_sales_offer_module_entitlements_v2",
      {
        p_offer_id: params.offerId,
        p_organization_id: params.organizationId,
        p_stripe_subscription_id: params.stripeSubscriptionId,
        p_stripe_event_id: params.stripeEventId,
        p_stripe_event_created_at: params.stripeEventCreatedAt,
        p_status: params.status,
      },
    );
    if (error) {
      console.error("[Module Entitlement] Provisioning RPC failed:", {
        offerId: sanitizeString(params.offerId, 120),
        organizationId: sanitizeString(params.organizationId, 120),
        code: sanitizeString((error as any)?.code, 80) || null,
        message: sanitizeString((error as any)?.message || String(error), 240),
      });
      const wrapped = new Error("MODULE_ENTITLEMENT_PROVISIONING_FAILED");
      (wrapped as any).code = "MODULE_ENTITLEMENT_PROVISIONING_FAILED";
      (wrapped as any).cause = error;
      throw wrapped;
    }
  };

  // ITEM09_SOURCE_END
  return { stripeSubscriptionToEntitlementStatus, applyModularEntitlementsForOrganization };
};
