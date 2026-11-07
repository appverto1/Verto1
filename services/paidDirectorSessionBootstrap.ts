import type Stripe from 'stripe';
// Item 10: statements preserved exactly from paid-Director backend in staging.
export function createPaidDirectorSessionBootstrap(deps: Record<string, any>) {
  const { SALES_ACTIVATION_TTL_DAYS, deriveSalesActivationToken, hashSalesOfferToken, isUuid, sanitizeEmail, sanitizeString, supabase } = deps;
  // ITEM10_SOURCE_BEGIN
  const preparePaidDirectorSessionBootstrap = async (params: {
    offerId: string;
    leadId: string;
    checkoutSessionId: string;
    email: string;
  }) => {
    const offerId = sanitizeString(params.offerId, 120);
    const leadId = sanitizeString(params.leadId, 120);
    const checkoutSessionId = sanitizeString(params.checkoutSessionId, 200);
    const email = sanitizeEmail(params.email);
    if (!isUuid(offerId) || !isUuid(leadId) || !checkoutSessionId || !email) {
      throw new Error("SALES_DIRECTOR_BOOTSTRAP_INPUT_INVALID");
    }

    const bootstrapToken = deriveSalesActivationToken(checkoutSessionId);
    const bootstrapTokenHash = hashSalesOfferToken(bootstrapToken);
    const expiresAt = new Date(
      Date.now() + SALES_ACTIVATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const readBootstrap = async () => {
      const result = await supabase
        .from("pending_activations")
        .select("id,email,token,used,expires_at,sales_offer_id,sales_lead_id,stripe_checkout_session_id")
        .eq("stripe_checkout_session_id", checkoutSessionId)
        .eq("source", "sales_assisted_signup")
        .limit(1)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data as any;
    };

    let bootstrap = await readBootstrap();
    if (bootstrap?.used === true) {
      return { bootstrapReady: false, sessionClaimed: true };
    }

    const repairPayload = {
      email,
      token: bootstrapTokenHash,
      used: false,
      source: "sales_assisted_signup",
      sales_offer_id: offerId,
      sales_lead_id: leadId,
      stripe_checkout_session_id: checkoutSessionId,
      expires_at: expiresAt,
    };

    if (bootstrap?.id) {
      const existingOfferId = sanitizeString(bootstrap.sales_offer_id, 120);
      const existingLeadId = sanitizeString(bootstrap.sales_lead_id, 120);
      if ((existingOfferId && existingOfferId !== offerId) || (existingLeadId && existingLeadId !== leadId)) {
        throw new Error("SALES_DIRECTOR_BOOTSTRAP_LINKAGE_CONFLICT");
      }
      const { error } = await supabase
        .from("pending_activations")
        .update(repairPayload)
        .eq("id", bootstrap.id)
        .eq("used", false);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("pending_activations").insert([repairPayload]);
      if (error) {
        bootstrap = await readBootstrap();
        if (!bootstrap?.id || bootstrap.used === true) throw error;
        const { error: retryError } = await supabase
          .from("pending_activations")
          .update(repairPayload)
          .eq("id", bootstrap.id)
          .eq("used", false);
        if (retryError) throw retryError;
      }
    }

    bootstrap = await readBootstrap();
    const ready = Boolean(
      bootstrap?.id
      && bootstrap.used !== true
      && sanitizeEmail(bootstrap.email) === email
      && sanitizeString(bootstrap.sales_offer_id, 120) === offerId
      && sanitizeString(bootstrap.sales_lead_id, 120) === leadId
      && sanitizeString(bootstrap.stripe_checkout_session_id, 200) === checkoutSessionId
      && sanitizeString(bootstrap.token, 128) === bootstrapTokenHash
      && (!bootstrap.expires_at || new Date(bootstrap.expires_at).getTime() > Date.now())
    );
    if (!ready) throw new Error("SALES_DIRECTOR_BOOTSTRAP_PREPARATION_FAILED");
    return { bootstrapReady: true, sessionClaimed: false };
  };

  // ITEM10_SOURCE_END
  return { preparePaidDirectorSessionBootstrap };
}
