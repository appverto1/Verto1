import type { Express, RequestHandler } from 'express';
import { verifySalesCardCheckoutBrowserProof } from './salesCardCheckoutBrowserProof';

// The public Checkout return is not proof of email ownership or chosen login
// method. Keep the legacy route fail-closed; use the verified email activation.
export interface PublicSalesDirectorSessionRouteDeps {
  supabase: Pick<import('@supabase/supabase-js').SupabaseClient, 'from' | 'auth'>;
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
  app.post(
    "/api/public/sales-offers/:token/director-session",
    deps.publicSalesPostPaymentLimiter,
    (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      return res.status(410).json({
        success: false,
        error: "SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED",
        message: "Conclua seu primeiro acesso pelo link enviado ao e-mail contratual após o pagamento.",
      });
    },
  );

  // Card: paid Checkout + verified settled method + originating browser +
  // frozen commercial contract + correct Director/clinic entitlements.
  // This only hands the browser a one-use activation choice, not an Auth session.
  app.post(
    "/api/public/sales-offers/:token/card-activation",
    deps.publicSalesPostPaymentLimiter,
    async (req: any, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8') > 2048)
        return res.status(413).json({ success:false, error:'PAYLOAD_TOO_LARGE' });

      const appOrigin = String(process.env.VERTO_APP_BASE_URL ||
        `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
      if (String(req.get('origin') || '') !== new URL(appOrigin).origin)
        return res.status(403).json({ success:false, error:'CARD_ACTIVATION_ORIGIN_INVALID' });
      const token = deps.sanitizeString(req.params?.token, 300);
      const checkoutSessionId = deps.sanitizeString(req.body?.sessionId, 200);
      if (token.length < 32 || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(checkoutSessionId))
        return res.status(400).json({ success:false, error:'CARD_ACTIVATION_CONTEXT_INVALID' });

      try {
        const context = await deps.resolveSalesPostPaymentContextToken(token, checkoutSessionId);
        if (!context) return res.status(404).json({ success:false, error:'CARD_ACTIVATION_UNAVAILABLE' });
        const { data: offer, error: offerError } = await deps.supabase
          .from('sales_offers')
          .select('id,lead_id,status,payment_confirmed_at,provisioning_status,offer_type,contract_email,stripe_subscription_id,settled_payment_method')
          .eq('id', context.offerId).eq('lead_id', context.leadId)
          .eq('stripe_checkout_session_id', checkoutSessionId).maybeSingle();
        if (offerError) throw offerError;
        if (!offer || offer.status !== 'paid' || !offer.payment_confirmed_at ||
            offer.provisioning_status !== 'completed' || offer.settled_payment_method !== 'card' ||
            offer.offer_type !== 'modular') {
          return res.status(409).json({ success:false, error:'CARD_PAYMENT_NOT_READY' });
        }

        const browserVerified = await verifySalesCardCheckoutBrowserProof(
          deps.supabase, req.headers.cookie, offer.id, checkoutSessionId,
        );
        if (!browserVerified)
          return res.status(403).json({ success:false, error:'CARD_BROWSER_PROOF_REQUIRED',
            message:'Para proteger seu acesso, conclua a ativação no navegador que iniciou o pagamento.' });

        const [leadResult, activationResult] = await Promise.all([
          deps.supabase.from('sales_leads')
            .select('converted_user_id,converted_clinic_id')
            .eq('id', offer.lead_id).is('deleted_at', null).maybeSingle(),
          deps.supabase.from('pending_activations')
            .select('email,token,used,expires_at')
            .eq('sales_offer_id', offer.id).eq('sales_lead_id', offer.lead_id)
            .eq('stripe_checkout_session_id', checkoutSessionId)
            .eq('source','sales_assisted_signup').limit(1).maybeSingle(),
        ]);
        if (leadResult.error || activationResult.error)
          throw leadResult.error || activationResult.error;
        const userId = deps.sanitizeString(leadResult.data?.converted_user_id, 120);
        const clinicId = deps.sanitizeString(leadResult.data?.converted_clinic_id, 120);
        const pending = activationResult.data;
        const activationToken = deps.deriveSalesActivationToken(checkoutSessionId);
        if (!deps.isUuid(userId) || !deps.isUuid(clinicId) || userId !== clinicId ||
            !pending || pending.used === true ||
            deps.sanitizeEmail(pending.email) !== deps.sanitizeEmail(offer.contract_email) ||
            pending.token !== deps.hashSalesOfferToken(activationToken) ||
            !pending.expires_at || Date.parse(pending.expires_at) <= Date.now()) {
          return res.status(403).json({ success:false, error:'CARD_DIRECTOR_IDENTITY_INVALID' });
        }
        await deps.verifySalesDirectorContractAccess({
          offerId: offer.id, userId, organizationId: clinicId,
          stripeSubscriptionId: deps.sanitizeString(offer.stripe_subscription_id, 200),
        });
        return res.json({
          success: true,
          // The existing activation route lets the buyer choose Google or
          // password; its one-use token never grants a Director role by itself.
          activationPath: `/ativacao-comercial/${encodeURIComponent(activationToken)}`,
        });
      } catch (error: any) {
        console.warn('[Sales Card] Secure browser activation could not be verified.', {
          code: deps.sanitizeString(error?.code || error?.message, 120),
        });
        return res.status(503).json({ success:false, error:'CARD_ACTIVATION_UNAVAILABLE' });
      }
    },
  );
}
