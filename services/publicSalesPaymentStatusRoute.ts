import type { Express, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PublicSalesPaymentStatusDependencies {
  supabase: Pick<SupabaseClient, 'from'>;
  publicSalesPaymentStatusLimiter: RequestHandler;
  sanitizeString: (value: unknown, maxLength?: number) => string;
  resolveSalesPostPaymentContextToken: (
    token: unknown, checkoutSessionId: string,
  ) => Promise<{ offerId: string; leadId: string } | null>;
  isUuid: (value: string | null | undefined) => boolean;
  deriveSalesActivationToken: (checkoutSessionId: string) => string;
  hashSalesOfferToken: (token: string) => string;
}

// Read-only extraction: payment confirmation and provisioning remain server-authoritative.
export function registerPublicSalesPaymentStatusRoute(
  app: Express,
  deps: PublicSalesPaymentStatusDependencies,
): void {
  const {
    supabase,
    publicSalesPaymentStatusLimiter,
    sanitizeString,
    resolveSalesPostPaymentContextToken,
    isUuid,
    deriveSalesActivationToken,
    hashSalesOfferToken,
  } = deps;

  app.get(
    "/api/public/sales-offers/:token/payment-status",
    publicSalesPaymentStatusLimiter,
    async (req: any, res) => {
      res.setHeader("Cache-Control", "no-store");
      const token = sanitizeString(req.params?.token, 256);
      const checkoutSessionId = sanitizeString(req.query?.session_id, 200);
      if (token.length < 32 || !checkoutSessionId) {
        return res.status(400).json({
          success: false,
          error: "PAYMENT_STATUS_CONTEXT_INVALID",
        });
      }

      try {
        const context = await resolveSalesPostPaymentContextToken(token, checkoutSessionId);
        if (!context) {
          return res.status(404).json({
            success: false,
            error: "PAYMENT_STATUS_NOT_FOUND",
          });
        }
        const { data: offer, error: offerError } = await supabase
          .from("sales_offers")
          .select(
            "id,lead_id,status,payment_confirmed_at,provisioning_status,provisioning_error_code,offer_type,stripe_subscription_id",
          )
          .eq("id", context.offerId)
          .eq("lead_id", context.leadId)
          .eq("stripe_checkout_session_id", checkoutSessionId)
          .maybeSingle();
        if (offerError) throw offerError;
        if (!offer) {
          return res.status(404).json({
            success: false,
            error: "PAYMENT_STATUS_NOT_FOUND",
          });
        }

        const [leadResult, bootstrapResult] = await Promise.all([
          supabase
            .from("sales_leads")
            .select("id,converted_user_id,converted_clinic_id")
            .eq("id", offer.lead_id)
            .is("deleted_at", null)
            .maybeSingle(),
          supabase
            .from("pending_activations")
            .select("token,expires_at,used")
            .eq("source", "sales_assisted_signup")
            .eq("sales_offer_id", offer.id)
            .eq("sales_lead_id", offer.lead_id)
            .eq("stripe_checkout_session_id", checkoutSessionId)
            .limit(1)
            .maybeSingle(),
        ]);
        if (leadResult.error || bootstrapResult.error) {
          throw leadResult.error || bootstrapResult.error;
        }

        const paymentConfirmed =
          sanitizeString(offer.status, 40) === "paid" &&
          Boolean(offer.payment_confirmed_at);
        const reviewRequired =
          sanitizeString(offer.provisioning_status, 40) === "review_required";
        const convertedUserId = sanitizeString(leadResult.data?.converted_user_id, 120);
        const convertedClinicId = sanitizeString(leadResult.data?.converted_clinic_id, 120);
        const accountProvisioned = Boolean(
          paymentConfirmed
          && !reviewRequired
          && sanitizeString(offer.provisioning_status, 40) === "completed"
          && isUuid(convertedUserId)
          && isUuid(convertedClinicId)
          && convertedUserId === convertedClinicId,
        );
        const bootstrap = bootstrapResult.data as any;
        const expectedBootstrapToken = paymentConfirmed
          ? deriveSalesActivationToken(checkoutSessionId)
          : "";
        const directorSessionReady = Boolean(
          accountProvisioned
          && bootstrap
          && bootstrap.used !== true
          && sanitizeString(bootstrap.token, 128) === hashSalesOfferToken(expectedBootstrapToken)
          && (!bootstrap.expires_at || new Date(bootstrap.expires_at).getTime() > Date.now()),
        );
        const sessionClaimed = Boolean(accountProvisioned && bootstrap?.used === true);
        const state = reviewRequired
          ? "review_required"
          : sessionClaimed
            ? "account_activated"
            : directorSessionReady
              ? "director_ready"
              : paymentConfirmed
                ? "provisioning"
                : "payment_pending";

        return res.status(state === "payment_pending" || state === "provisioning" ? 202 : 200).json({
          success: true,
          state,
          paymentConfirmed,
          accountProvisioned,
          directorSessionReady,
          sessionClaimed,
          accountActivated: sessionClaimed,
          reviewRequired,
          provisioningErrorCode: sanitizeString(offer.provisioning_error_code, 120) || null,
          retryAfterMs:
            state === "payment_pending" || state === "provisioning"
              ? 1500
              : null,
        });
      } catch (error: any) {
        console.error("[Sales Offer] Falha ao consultar status do pagamento.", {
          message: sanitizeString(error?.message || String(error), 200),
        });
        return res.status(503).json({
          success: false,
          error: "PAYMENT_STATUS_UNAVAILABLE",
        });
      }
    },
  );
}
