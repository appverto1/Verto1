import type Stripe from 'stripe';
// Item 10: statements preserved exactly from paid-Director backend in staging.
export function registerPublicSalesPostPaymentReconciliationRoute(deps: Record<string, any>) {
  const { app, getStripe, publicSalesPostPaymentLimiter, reconcileSalesAssistedCheckout, resolveSalesPostPaymentContextToken, sanitizeString, supabase } = deps;
  // ITEM10_SOURCE_BEGIN
  app.post(
    "/api/public/sales-offers/:token/prepare-activation",
    publicSalesPostPaymentLimiter,
    async (req: any, res) => {
      res.setHeader("Cache-Control", "no-store");
      const token = sanitizeString(req.params?.token, 256);
      const checkoutSessionId = sanitizeString(
        req.body?.sessionId || req.body?.session_id,
        200,
      );
      if (token.length < 32 || !checkoutSessionId) {
        return res.status(400).json({
          success: false,
          error: "SALES_DIRECTOR_PROVISIONING_CONTEXT_INVALID",
        });
      }

      try {
        const context = await resolveSalesPostPaymentContextToken(token, checkoutSessionId);
        if (!context) {
          return res.status(404).json({
            success: false,
            error: "SALES_DIRECTOR_PROVISIONING_CONTEXT_NOT_FOUND",
          });
        }
        const { data: offer, error: offerError } = await supabase
          .from("sales_offers")
          .select("id,lead_id,status,provisioning_status,stripe_checkout_session_id")
          .eq("id", context.offerId)
          .eq("lead_id", context.leadId)
          .eq("stripe_checkout_session_id", checkoutSessionId)
          .maybeSingle();
        if (offerError) throw offerError;
        if (!offer) {
          return res.status(404).json({
            success: false,
            error: "SALES_DIRECTOR_PROVISIONING_CONTEXT_NOT_FOUND",
          });
        }
        // Do not treat a stored review_required flag as permanently terminal here.
        // A concurrent webhook can temporarily mark review_required while another
        // idempotent provisioning attempt is still completing. Reconcile against
        // Stripe + the frozen contract again; genuine conflicts are re-established
        // by processSalesAssistedCheckoutCompleted and remain blocked.
        const stripe = getStripe();
        const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
        const metadata = (session.metadata || {}) as Record<string, string>;
        if (
          sanitizeString(metadata.offerId, 120) !== sanitizeString(offer.id, 120)
          || sanitizeString(metadata.leadId, 120) !== sanitizeString(offer.lead_id, 120)
        ) {
          return res.status(409).json({
            success: false,
            error: "SALES_CHECKOUT_RECONCILIATION_MISMATCH",
          });
        }
        const result: any = await reconcileSalesAssistedCheckout(stripe, session);
        const state = result.reviewRequired
          ? "review_required"
          : result.sessionClaimed
            ? "account_activated"
            : result.directorSessionReady && result.settledPaymentMethod === 'card'
              ? "card_ready"
              : result.directorSessionReady && result.activationEmailSent && result.settledPaymentMethod === 'boleto'
                ? "director_ready"
              : result.paymentConfirmed
                ? "provisioning"
                : "payment_pending";
        return res.status(state === "payment_pending" || state === "provisioning" ? 202 : 200).json({
          success: true,
          state,
          paymentConfirmed: result.paymentConfirmed === true,
          accountProvisioned: result.accountActivated === true,
          directorSessionReady: result.directorSessionReady === true && result.settledPaymentMethod === 'boleto' && result.activationEmailSent === true,
          cardActivationReady: result.directorSessionReady === true && result.settledPaymentMethod === 'card',
          activationEmailSent: result.activationEmailSent === true,
          sessionClaimed: result.sessionClaimed === true,
          accountActivated: result.sessionClaimed === true,
          reviewRequired: result.reviewRequired === true,
          message: result.directorSessionReady && result.settledPaymentMethod === 'card'
            ? "Cartão confirmado. Configure seu login agora neste navegador."
            : result.directorSessionReady && result.activationEmailSent
            ? "Pagamento confirmado. Confira o e-mail contratual para ativar seu acesso de Diretor."
            : result.paymentConfirmed
              ? "Pagamento confirmado. Concluindo a preparação do acesso conforme a forma de pagamento."
              : "Aguardando confirmação final da Stripe.",
        });
      } catch (error: any) {
        console.error("[Sales Director] Falha ao reconciliar provisionamento pós-pagamento.", {
          checkoutSessionId,
          code: sanitizeString(error?.code, 120) || null,
          message: sanitizeString(error?.message || String(error), 240),
        });
        return res.status(503).json({
          success: false,
          error: "SALES_DIRECTOR_PROVISIONING_FAILED",
        });
      }
    },
  );

  // ITEM10_SOURCE_END
}
