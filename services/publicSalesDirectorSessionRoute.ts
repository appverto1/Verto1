import type { Express, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

// Only registration is extracted. Server-owned Stripe/payment, user, clinic and
// contract checks remain byte-for-byte unchanged in the handler below.
export interface PublicSalesDirectorSessionRouteDeps {
  supabase: Pick<SupabaseClient, 'from' | 'auth'>;
  publicSalesPostPaymentLimiter: RequestHandler;
  sanitizeString: (value: unknown, maxLength?: number) => string;
  sanitizeEmail: (value: unknown) => string | null;
  isUuid: (value: string | null | undefined) => boolean;
  resolveSalesPostPaymentContextToken: (
    token: unknown, checkoutSessionId: string,
  ) => Promise<{ offerId: string; leadId: string } | null>;
  hashSalesOfferToken: (token: string) => string;
  deriveSalesActivationToken: (checkoutSessionId: string) => string;
  verifySalesDirectorContractAccess: (params: {
    offerId: string; userId: string; organizationId: string; stripeSubscriptionId: string;
  }) => Promise<unknown>;
}

export function registerPublicSalesDirectorSessionRoute(
  app: Express, deps: PublicSalesDirectorSessionRouteDeps,
): void {
  const {
    supabase, publicSalesPostPaymentLimiter, sanitizeString, sanitizeEmail,
    isUuid, resolveSalesPostPaymentContextToken, hashSalesOfferToken,
    deriveSalesActivationToken, verifySalesDirectorContractAccess,
  } = deps;

  app.post(
    "/api/public/sales-offers/:token/director-session",
    publicSalesPostPaymentLimiter,
    async (req: any, res) => {
      res.setHeader("Cache-Control", "no-store");
      const token = sanitizeString(req.params?.token, 256);
      const checkoutSessionId = sanitizeString(
        req.body?.sessionId || req.body?.session_id,
        200,
      );
      if (token.length < 32 || !checkoutSessionId) {
        return res.status(400).json({ success: false, error: "SALES_DIRECTOR_SESSION_CONTEXT_INVALID" });
      }

      try {
        const context = await resolveSalesPostPaymentContextToken(token, checkoutSessionId);
        if (!context) {
          return res.status(404).json({ success: false, error: "SALES_DIRECTOR_SESSION_CONTEXT_NOT_FOUND" });
        }
        const { data: offer, error: offerError } = await supabase
          .from("sales_offers")
          .select("id,lead_id,status,payment_confirmed_at,provisioning_status,offer_type,contract_email,stripe_subscription_id")
          .eq("id", context.offerId)
          .eq("lead_id", context.leadId)
          .eq("stripe_checkout_session_id", checkoutSessionId)
          .maybeSingle();
        if (offerError) throw offerError;
        if (
          !offer
          || sanitizeString(offer.status, 40) !== "paid"
          || !offer.payment_confirmed_at
          || sanitizeString(offer.provisioning_status, 40) !== "completed"
        ) {
          return res.status(409).json({ success: false, error: "SALES_DIRECTOR_SESSION_NOT_READY" });
        }

        const { data: lead, error: leadError } = await supabase
          .from("sales_leads")
          .select("id,email,normalized_email,converted_user_id,converted_clinic_id")
          .eq("id", offer.lead_id)
          .is("deleted_at", null)
          .maybeSingle();
        if (leadError) throw leadError;
        const userId = sanitizeString(lead?.converted_user_id, 120);
        const clinicId = sanitizeString(lead?.converted_clinic_id, 120);
        if (!lead || !isUuid(userId) || !isUuid(clinicId) || userId !== clinicId) {
          return res.status(409).json({ success: false, error: "SALES_DIRECTOR_SESSION_LINKAGE_INVALID" });
        }

        const directorEmail = sanitizeString(offer.offer_type, 30) === "modular"
          ? sanitizeEmail(offer.contract_email)
          : sanitizeEmail(lead.normalized_email || lead.email);
        if (!directorEmail) {
          return res.status(409).json({ success: false, error: "SALES_DIRECTOR_SESSION_EMAIL_MISSING" });
        }

        const { data: bootstrap, error: bootstrapError } = await supabase
          .from("pending_activations")
          .select("id,email,token,used,expires_at")
          .eq("source", "sales_assisted_signup")
          .eq("sales_offer_id", offer.id)
          .eq("sales_lead_id", offer.lead_id)
          .eq("stripe_checkout_session_id", checkoutSessionId)
          .limit(1)
          .maybeSingle();
        if (bootstrapError) throw bootstrapError;
        if (!bootstrap || bootstrap.used === true) {
          return res.status(409).json({
            success: false,
            error: bootstrap?.used === true
              ? "SALES_DIRECTOR_SESSION_ALREADY_CLAIMED"
              : "SALES_DIRECTOR_SESSION_BOOTSTRAP_MISSING",
          });
        }
        const expectedBootstrapHash = hashSalesOfferToken(
          deriveSalesActivationToken(checkoutSessionId),
        );
        if (
          sanitizeEmail(bootstrap.email) !== directorEmail
          || sanitizeString(bootstrap.token, 128) !== expectedBootstrapHash
          || (bootstrap.expires_at && new Date(bootstrap.expires_at).getTime() <= Date.now())
        ) {
          return res.status(409).json({ success: false, error: "SALES_DIRECTOR_SESSION_BOOTSTRAP_INVALID" });
        }

        if (sanitizeString(offer.offer_type, 30) === "modular") {
          const subscriptionId = sanitizeString(offer.stripe_subscription_id, 200);
          if (!subscriptionId) {
            return res.status(409).json({ success: false, error: "SALES_SUBSCRIPTION_LINKAGE_MISSING" });
          }
          await verifySalesDirectorContractAccess({
            offerId: offer.id,
            userId,
            organizationId: clinicId,
            stripeSubscriptionId: subscriptionId,
          });
        }

        const { data: authUserResult, error: authUserError } =
          await supabase.auth.admin.getUserById(userId);
        if (authUserError || !authUserResult?.user) throw authUserError || new Error("SALES_DIRECTOR_AUTH_USER_NOT_FOUND");
        if (sanitizeEmail(authUserResult.user.email) !== directorEmail) {
          return res.status(409).json({ success: false, error: "SALES_DIRECTOR_AUTH_EMAIL_MISMATCH" });
        }

        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
          type: "magiclink",
          email: directorEmail,
        });
        if (linkError) throw linkError;
        const otpTokenHash = sanitizeString((linkData as any)?.properties?.hashed_token, 1000);
        if (!otpTokenHash) throw new Error("SALES_DIRECTOR_SESSION_TOKEN_MISSING");

        await supabase.from("sales_lead_events").upsert(
          [{
            lead_id: offer.lead_id,
            event_type: "lead_updated",
            metadata: {
              action: "director_session_issued_after_payment",
              offer_id: offer.id,
              checkout_session_id: checkoutSessionId,
              user_id: userId,
              clinic_id: clinicId,
            },
            idempotency_key: `director-session-issued:${offer.id}:${checkoutSessionId}`,
          }],
          { onConflict: "idempotency_key", ignoreDuplicates: true },
        );

        return res.json({
          success: true,
          role: "director",
          otpType: "magiclink",
          tokenHash: otpTokenHash,
          message: "Acesso de Diretor autorizado pela confirmação de pagamento.",
        });
      } catch (error: any) {
        console.error("[Sales Director] Falha ao emitir sessão pós-pagamento.", {
          checkoutSessionId,
          code: sanitizeString(error?.code, 120) || null,
          message: sanitizeString(error?.message || String(error), 240),
        });
        return res.status(503).json({ success: false, error: "SALES_DIRECTOR_SESSION_FAILED" });
      }
    },
  );

}

// The route body above is intentionally verbatim from staging before extraction.
