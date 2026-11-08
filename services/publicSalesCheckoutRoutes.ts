import type Stripe from 'stripe';
import { issueSalesCardCheckoutBrowserProof } from './salesCardCheckoutBrowserProof';
import type { SalesSimulationInput, SalesUsageProfile } from '../src/utils/salesProfitability';
// Item 07: original public accept and card Checkout handlers, in original registration order.
export function registerPublicSalesCheckoutRoutes(deps: Record<string, any>) {
  const { MODULAR_COMMERCIAL_CONSENT_TEXT, MODULAR_COMMERCIAL_CONSENT_VERSION, app, buildSalesOfferPublicUrl, createOrReuseModularCheckout, crypto, getStripe, isCouponDurationMonths, isSalesOfferStripeReady, isUuid, loadPublicSalesOffer, publicSalesLeadIpLimiter, resolveSalesStripeConfiguration, resolveStripeEnvironment, sanitizeEmail, sanitizeString, supabase, validateStripeSecretForEnvironment } = deps;
  // The public payment link is registered later by the legacy bridge.
  // This indexed lookup binds its *first browser* to the existing Checkout
  // before the bridge redirects to Stripe. No extra Stripe request or account
  // creation occurs.
  app.use('/api/public/sales-checkouts/:token', async (req: any, res: any, next: any) => {
    if (req.method !== 'GET') return next();
    const token = sanitizeString(req.params?.token, 300);
    if (token.length < 32) return next();
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const { data: link, error } = await supabase.from('sales_checkout_links')
        .select('offer_id,stripe_checkout_session_id,status,expires_at,logically_expired_at')
        .eq('public_token_hash', tokenHash).maybeSingle();
      if (error) throw error;
      if (link && !link.logically_expired_at &&
          ['active','sent','opened','payment_pending'].includes(String(link.status)) &&
          Date.parse(String(link.expires_at)) > Date.now()) {
        await issueSalesCardCheckoutBrowserProof(
          supabase, res, String(link.offer_id), String(link.stripe_checkout_session_id),
        );
      }
      return next();
    } catch {
      // Never mint a credential on lookup failure. The original checkout
      // handler still performs authorization; an email fallback remains.
      return next();
    }
  });

  app.post(
    "/api/public/sales-offers/:token/accept",
    publicSalesLeadIpLimiter,
    async (req: any, res) => {
      try {
        if (req.body?.commercialValuesConsent !== true) {
          return res.status(400).json({
            success: false,
            error: "COMMERCIAL_VALUES_CONSENT_REQUIRED",
            message:
              "Confirme os valores promocionais e os valores posteriores.",
          });
        }
        const loaded = await loadPublicSalesOffer(req.params?.token);
        if ("error" in loaded) {
          return res.status(404).json({
            success: false,
            error: "OFFER_UNAVAILABLE",
            message: "Esta proposta não está disponível ou expirou.",
          });
        }
        const { offer, lead } = loaded;
        if (sanitizeString((offer as any).offer_type, 30) !== "modular") {
          return res.status(409).json({
            success: false,
            error: "OFFER_ACCEPTANCE_FLOW_MISMATCH",
            message: "Esta proposta utiliza o fluxo de aceite legado.",
          });
        }
        const acceptedAt = offer.accepted_at || new Date().toISOString();
        const [offerResult, eventResult] = await Promise.all([
          supabase
            .from("sales_offers")
            .update({
              accepted_at: acceptedAt,
              accepted_terms_at: acceptedAt,
              accepted_terms_snapshot: {
                version: MODULAR_COMMERCIAL_CONSENT_VERSION,
                statement: MODULAR_COMMERCIAL_CONSENT_TEXT,
                source: "public_offer",
                capturedAt: acceptedAt,
              },
              updated_at: acceptedAt,
            })
            .eq("id", offer.id)
            .eq("lead_id", lead.id)
            .is("revoked_at", null)
            .select("id,accepted_at")
            .maybeSingle(),
          supabase.from("sales_lead_events").upsert(
            [{
              lead_id: lead.id,
              event_type: "lead_updated",
              metadata: {
                action: "modular_offer_accepted",
                offer_id: offer.id,
                commercial_values_consent: true,
              },
              idempotency_key: `modular-offer-accepted:${offer.id}`,
            }],
            { onConflict: "idempotency_key", ignoreDuplicates: true },
          ),
        ]);
        const persistenceError = offerResult.error || eventResult.error;
        if (persistenceError || !offerResult.data) throw persistenceError;
        return res.json({
          success: true,
          acceptedAt: offerResult.data.accepted_at || acceptedAt,
          message: "Aceite comercial registrado.",
        });
      } catch (error: any) {
        console.warn("[Sales Modular] Falha ao registrar aceite.", {
          message: sanitizeString(error?.message || String(error), 200),
        });
        return res.status(500).json({
          success: false,
          error: "OFFER_ACCEPTANCE_FAILED",
          message: "Não foi possível registrar o aceite agora.",
        });
      }
    },
  );

  app.post(
    "/api/public/sales-offers/:token/checkout",
    publicSalesLeadIpLimiter,
    async (req: any, res) => {
      try {
        if (req.body?.acceptTerms !== true) {
          return res.status(400).json({
            success: false,
            error: "TERMS_REQUIRED",
            message: "Confirme os termos para continuar.",
          });
        }
        const loaded = await loadPublicSalesOffer(req.params?.token);
        if ("error" in loaded) {
          return res.status(404).json({
            success: false,
            error: "OFFER_UNAVAILABLE",
            message: "Esta oferta não está disponível ou expirou.",
          });
        }
        const { offer, lead, token } = loaded;
        if (
          sanitizeString((offer as any).offer_type, 30) === "modular"
        ) {
          const forbiddenFields = [
            "amount", "price", "prices", "discount", "lineItems",
            "organizationId", "modules", "trialDays", "environment",
          ];
          if (forbiddenFields.some((field) => req.body?.[field] !== undefined)) {
            return res.status(400).json({
              success: false,
              error: "MODULAR_CHECKOUT_BROWSER_VALUES_REJECTED",
              message: "Preço, módulos, tenant, trial e ambiente são reconstruídos no servidor.",
            });
          }
          if (!offer.accepted_at) {
            return res.status(409).json({
              success: false,
              error: "MODULAR_OFFER_ACCEPTANCE_REQUIRED",
              message: "Aceite a proposta antes de continuar para o cartão.",
            });
          }
          const actorUserId = sanitizeString((offer as any).created_by, 120);
          if (!isUuid(actorUserId)) {
            return res.status(503).json({
              success: false,
              error: "MODULAR_CHECKOUT_RECONCILIATION_FAILED",
              message: "A proposta não possui autoria comercial reconciliável.",
            });
          }
          let stripeEnvironment: "test" | "live";
          try {
            stripeEnvironment = resolveStripeEnvironment();
            validateStripeSecretForEnvironment(stripeEnvironment);
          } catch {
            return res.status(503).json({
              success: false,
              error: "STRIPE_ENVIRONMENT_CONFIGURATION_INVALID",
              message: "Configuração Stripe indisponível para esta contratação.",
            });
          }
          const idempotencyKey = crypto
            .createHash("sha256")
            .update(`public-modular-checkout:${offer.id}:${stripeEnvironment}:${loaded.tokenHash}`)
            .digest("hex");
          return createOrReuseModularCheckout(req, res, {
            offerId: String(offer.id),
            actorUserId,
            idempotencyKey,
            publicMode: true,
            publicOfferToken: token,
          });
        }
        const duration = Number(offer.discount_duration_months || 0) || null;
        const stripeConfig = resolveSalesStripeConfiguration();
        if (!isSalesOfferStripeReady(offer, stripeConfig)) {
          return res.status(503).json({
            success: false,
            error: "STRIPE_SALES_CONFIGURATION_PENDING",
            message: "Configuração Stripe pendente.",
          });
        }

        const stripe = getStripe();
        const persistCheckoutSession = async (
          checkoutSession: Stripe.Checkout.Session,
        ) => {
          const now = new Date().toISOString();
          const [offerResult, leadResult, eventResult] = await Promise.all([
            supabase
              .from("sales_offers")
              .update({
                status: "checkout_created",
                stripe_checkout_session_id: checkoutSession.id,
                updated_at: now,
              })
              .eq("id", offer.id)
              .eq("lead_id", lead.id)
              .in("status", [
                "ready",
                "sent",
                "opened",
                "checkout_created",
                "payment_pending",
              ])
              .select("id,stripe_checkout_session_id")
              .maybeSingle(),
            supabase
              .from("sales_leads")
              .update({ status: "checkout_sent", updated_at: now })
              .eq("id", lead.id)
              .is("deleted_at", null),
            supabase.from("sales_lead_events").upsert(
              [
                {
                  lead_id: lead.id,
                  event_type: "checkout_created",
                  metadata: { offer_id: offer.id },
                  idempotency_key: `offer-checkout-created:${offer.id}:${checkoutSession.id}`,
                },
              ],
              { onConflict: "idempotency_key", ignoreDuplicates: true },
            ),
          ]);
          const persistenceError = [offerResult, leadResult, eventResult].find(
            (result: any) => result?.error,
          )?.error;
          if (
            persistenceError ||
            !offerResult.data ||
            offerResult.data.stripe_checkout_session_id !== checkoutSession.id
          ) {
            const error = new Error("CHECKOUT_PERSISTENCE_FAILED");
            (error as any).code = "CHECKOUT_PERSISTENCE_FAILED";
            (error as any).cause = persistenceError || null;
            throw error;
          }
        };
        if (offer.stripe_checkout_session_id) {
          try {
            const existingSession = await stripe.checkout.sessions.retrieve(
              String(offer.stripe_checkout_session_id),
            );
            if (existingSession.status === "open" && existingSession.url) {
              await persistCheckoutSession(existingSession);
              await issueSalesCardCheckoutBrowserProof(
                supabase, res, String(offer.id), existingSession.id,
              );
              return res.json({ success: true, url: existingSession.url });
            }
            return res.status(409).json({
              success: false,
              error: "CHECKOUT_SESSION_CLOSED",
              message:
                "A sessão de pagamento desta oferta foi encerrada. Solicite uma nova oferta à equipe da Verto.",
            });
          } catch (sessionError: any) {
            if (
              sanitizeString(
                sessionError?.code || sessionError?.message,
                120,
              ) === "CHECKOUT_PERSISTENCE_FAILED"
            ) {
              throw sessionError;
            }
            console.warn(
              "[Sales Offer] Sessão Stripe vinculada indisponível:",
              {
                offerId: sanitizeString(offer.id, 120),
                sessionId: sanitizeString(
                  offer.stripe_checkout_session_id,
                  120,
                ),
                message: sanitizeString(
                  sessionError?.message || String(sessionError),
                  200,
                ),
              },
            );
            return res.status(409).json({
              success: false,
              error: "CHECKOUT_SESSION_UNAVAILABLE",
              message:
                "Não foi possível reutilizar a sessão desta oferta. Solicite uma nova oferta à equipe da Verto.",
            });
          }
        }

        const customCouponId = sanitizeString(offer.stripe_coupon_id, 240);
        const legacyCouponId =
          duration && isCouponDurationMonths(duration)
            ? stripeConfig.couponIds[duration]
            : "";
        const discountCouponId = customCouponId || legacyCouponId;
        const discounts = discountCouponId
          ? [{ coupon: discountCouponId }]
          : undefined;
        const session = await stripe.checkout.sessions.create(
          {
            payment_method_types: ["card"],
            mode: "subscription",
            customer_email: sanitizeEmail(lead.email) || undefined,
            line_items: [
              {
                price: stripeConfig.basePriceId,
                quantity: Number(offer.initial_active_patient_quantity || 1),
              },
            ],
            discounts,
            success_url:
              buildSalesOfferPublicUrl(req, token) +
              "?payment=success&session_id={CHECKOUT_SESSION_ID}",
            cancel_url:
              buildSalesOfferPublicUrl(req, token) + "?payment=cancel",
            metadata: {
              flowType: "sales_assisted_signup",
              offerId: String(offer.id),
              leadId: String(lead.id),
              billingModel: "active_patients",
            },
            subscription_data: {
              metadata: {
                flowType: "sales_assisted_signup",
                offerId: String(offer.id),
                leadId: String(lead.id),
                billingModel: "active_patients",
              },
            },
          },
          {
            idempotencyKey: `sales-offer-checkout:${offer.id}`,
          },
        );
        if (!session.url) throw new Error("STRIPE_CHECKOUT_URL_MISSING");
        await persistCheckoutSession(session);
        await issueSalesCardCheckoutBrowserProof(
          supabase, res, String(offer.id), session.id,
        );
        return res.json({ success: true, url: session.url });
      } catch (error: any) {
        console.error("[Sales Offer] Falha ao criar checkout autorizado:", {
          message: sanitizeString(error?.message || String(error), 240),
          code: sanitizeString(error?.code, 80),
        });
        const persistenceFailure =
          sanitizeString(error?.code || error?.message, 120) ===
          "CHECKOUT_PERSISTENCE_FAILED";
        return res.status(persistenceFailure ? 503 : 502).json({
          success: false,
          error: persistenceFailure
            ? "CHECKOUT_PERSISTENCE_FAILED"
            : "CHECKOUT_CREATION_FAILED",
          message: persistenceFailure
            ? "O Checkout foi reservado, mas ainda não foi possível confirmar sua gravação. Tente novamente para reutilizar a mesma sessão."
            : "Não foi possível preparar o Checkout agora.",
        });
      }
    },
  );

}
