import type Stripe from 'stripe';
import type { SalesSimulationInput, SalesUsageProfile } from '../src/utils/salesProfitability';
// Item 07: extract existing checkout core unchanged; server remains authoritative.
export function createModularCheckoutCore(deps: Record<string, any>) {
  const { MODULAR_COMMERCIAL_CONSENT_TEXT, MODULAR_COMMERCIAL_CONSENT_VERSION, SALES_CHECKOUT_LINK_SELECT, buildFrozenStripeCheckoutPlan, buildSalesCheckoutReturnContextToken, buildSalesModuleSetHash, buildSalesOfferPublicUrl, classifySalesProposalReview, crypto, deriveSalesCheckoutPublicToken, filterSalesCurrentOperatingTechnicalBlockers, getStripe, hashSalesOfferToken, isSalesInternalCommercialItemKey, resolveFrozenSalesOfferTrialDays, resolveStripeEnvironment, salesApplicationOrigin, salesCommercialExceptionApprovalMatches, salesOfferUsesCustomerFacingModulesOnly, sanitizeEmail, sanitizeString, serializeSalesCheckoutLink, supabase, validateStripeSecretForEnvironment } = deps;
  const createOrReuseModularCheckout = async (
    req: any,
    res: any,
    params: {
      offerId: string;
      actorUserId: string;
      idempotencyKey: string;
      regenerate?: boolean;
      publicMode?: boolean;
      publicOfferToken?: string;
    },
  ) => {
    const {
      offerId,
      actorUserId,
      idempotencyKey,
      regenerate = false,
      publicMode = false,
      publicOfferToken,
    } = params;
    try {
      const respondWithLink = (link: any, idempotent: boolean, statusCode = 200) => {
        if (publicMode) {
          return res.status(statusCode).json({
            success: true,
            url: sanitizeString(link?.checkout_url, 2000),
            idempotent,
          });
        }
        return res.status(statusCode).json({
          success: true,
          link: serializeSalesCheckoutLink(req, link),
          idempotent,
        });
      };
      const stripeEnvironment = resolveStripeEnvironment();
        validateStripeSecretForEnvironment(stripeEnvironment);
        const [offerResult, itemResult] = await Promise.all([
          supabase
            .from("sales_offers")
            .select(
              "id,lead_id,offer_type,status,accepted_at,accepted_terms_at,accepted_terms_snapshot,expires_at,revoked_at,currency,catalog_version_id,simulation_snapshot,modular_snapshot,internal_justification,modular_checkout_enabled,trial_days,contract_email",
            )
            .eq("id", offerId)
            .maybeSingle(),
          supabase
            .from("sales_offer_items")
            .select(
              "id,item_key,public_name_snapshot,pricing_mode_snapshot,gross_recurring_amount_cents,recurring_amount_cents,post_promotion_recurring_amount_cents,one_time_amount_cents,internal_result_snapshot,sort_order",
            )
            .eq("offer_id", offerId)
            .order("sort_order", { ascending: true }),
        ]);
        if (offerResult.error || itemResult.error) {
          throw offerResult.error || itemResult.error;
        }
        const offer = offerResult.data;
        if (!offer || sanitizeString(offer.offer_type, 30) !== "modular") {
          return res.status(404).json({
            success: false,
            code: "MODULAR_OFFER_NOT_FOUND",
            error: "Proposta modular não encontrada.",
          });
        }
        if (offer.modular_checkout_enabled !== true) {
          return res.status(409).json({
            success: false,
            code: "MODULAR_CHECKOUT_NOT_ENABLED",
            error: "O checkout modular não está habilitado para esta proposta.",
          });
        }
        if (!["ready", "sent", "opened", "checkout_created", "payment_pending"].includes(
          sanitizeString(offer.status, 40),
        )) {
          return res.status(409).json({
            success: false,
            code: "MODULAR_OFFER_STATE_INVALID",
            error: "O estado atual da proposta não permite gerar Checkout.",
          });
        }
        if (
          !offer.accepted_at
          || !offer.accepted_terms_at
          || offer.accepted_terms_snapshot?.version !== MODULAR_COMMERCIAL_CONSENT_VERSION
          || offer.accepted_terms_snapshot?.statement !== MODULAR_COMMERCIAL_CONSENT_TEXT
        ) {
          return res.status(409).json({
            success: false,
            code: "MODULAR_OFFER_ACCEPTANCE_REQUIRED",
            error: "Registre o aceite explícito antes de gerar o link.",
          });
        }
        if (
          offer.revoked_at
          || !Number.isFinite(Date.parse(String(offer.expires_at || "")))
          || Date.parse(String(offer.expires_at)) <= Date.now()
        ) {
          return res.status(409).json({
            success: false,
            code: "MODULAR_OFFER_EXPIRED",
            error: "A proposta está vencida ou revogada.",
          });
        }
        const contractEmail = sanitizeEmail(offer.contract_email);
        if (!contractEmail) {
          return res.status(409).json({
            success: false,
            code: "MODULAR_OFFER_CONTRACT_EMAIL_REQUIRED",
            error: "A proposta não possui e-mail contratual congelado. Gere uma nova proposta antes do Checkout.",
          });
        }
        let frozenTrialDays: 0 | 7 | 14 | 30;
        try {
          frozenTrialDays = resolveFrozenSalesOfferTrialDays(offer);
        } catch (trialError: any) {
          console.error('[Sales Modular] Reconciliação do trial bloqueou o Checkout.', {
            offerId,
            code: sanitizeString(trialError?.message || trialError?.code, 160),
          });
          return res.status(409).json({
            success: false,
            code: 'MODULAR_CHECKOUT_RECONCILIATION_FAILED',
            error: 'O período de teste congelado diverge entre os snapshots da proposta. Gere uma nova proposta antes de continuar.',
          });
        }
        const snapshot =
          offer.modular_snapshot && typeof offer.modular_snapshot === "object"
            ? offer.modular_snapshot
            : {};
        const frozenResults =
          offer.simulation_snapshot?.results
          && typeof offer.simulation_snapshot.results === "object"
            ? offer.simulation_snapshot.results
            : {};
        const phases = Array.isArray(snapshot.commercialPhases)
          ? snapshot.commercialPhases
          : Array.isArray(frozenResults.commercialPhases)
            ? frozenResults.commercialPhases
            : [];
        if (phases.length < 1 || !Array.isArray(itemResult.data) || itemResult.data.length < 1) {
          return res.status(422).json({
            success: false,
            code: "MODULAR_CHECKOUT_SNAPSHOT_INCOMPLETE",
            error: "O snapshot congelado não contém fases reconciliáveis.",
          });
        }
        const frozenReview = classifySalesProposalReview(frozenResults);
        const frozenTechnicalBlockingCodes = filterSalesCurrentOperatingTechnicalBlockers(
          frozenReview.technicalBlockingCodes,
        );
        if (frozenTechnicalBlockingCodes.length > 0) {
          return res.status(409).json({
            success: false,
            code: "MODULAR_CHECKOUT_TECHNICAL_BLOCKED",
            blockingCodes: frozenTechnicalBlockingCodes,
            error:
              "O snapshot congelado possui uma pendência estrutural de preço ou reconciliação.",
          });
        }
        if (
          frozenReview.requiresCommercialApproval
          && !salesCommercialExceptionApprovalMatches(
            frozenResults,
            frozenResults.commercialExceptionApproval,
          )
        ) {
          return res.status(409).json({
            success: false,
            code: "MODULAR_CHECKOUT_MARGIN_POLICY_REVIEW_REQUIRED",
            error:
              "A condição comercial congelada não possui uma aprovação excepcional válida.",
          });
        }
        const firstPhase = phases[0];
        const lastPhase = phases[phases.length - 1];
        const frozenItemsByKey = new Map(
          (itemResult.data || []).map((item: any) => [sanitizeString(item.item_key, 80), item]),
        );
        const phaseIsReconciled = (phase: any, phaseKind: "promotional" | "future") => {
          if (!phase || !Array.isArray(phase.lines)) return false;
          let recurringTotal = 0;
          let oneTimeTotal = 0;
          for (const line of phase.lines) {
            const itemKey = sanitizeString(line?.itemKey, 80);
            const stored: any = frozenItemsByKey.get(itemKey);
            const amount = Number(line?.activePriceCents);
            if (!stored || !Number.isSafeInteger(amount) || amount < 0) return false;
            if (sanitizeString(line?.billingInterval, 30) === "one_time") {
              if (phaseKind === "promotional") {
                oneTimeTotal += amount;
                if (amount !== Number(stored.one_time_amount_cents || 0)) return false;
              }
              continue;
            }
            recurringTotal += amount;
            const storedAmount = phaseKind === "promotional"
              ? Number(stored.recurring_amount_cents || 0)
              : Number(stored.post_promotion_recurring_amount_cents || stored.gross_recurring_amount_cents || 0);
            if (amount !== storedAmount) return false;
          }
          return recurringTotal === Number(phase.recurringRevenueCents)
            && (phaseKind !== "promotional" || recurringTotal + oneTimeTotal === Number(phase.invoiceAmountCents));
        };
        const everyPhaseIsInternallyReconciled = phases.every((phase: any, phaseIndex: number) => {
          if (!phase || !Array.isArray(phase.lines) || phase.lines.length < 1) return false;
          const itemKeys = new Set<string>();
          let recurringTotal = 0;
          let oneTimeTotal = 0;
          for (const line of phase.lines) {
            const itemKey = sanitizeString(line?.itemKey, 80);
            const amount = Number(line?.activePriceCents);
            if (
              !itemKey
              || itemKeys.has(itemKey)
              || !frozenItemsByKey.has(itemKey)
              || !Number.isSafeInteger(amount)
              || amount < 0
            ) {
              return false;
            }
            itemKeys.add(itemKey);
            if (sanitizeString(line?.billingInterval, 30) === "one_time") {
              const stored: any = frozenItemsByKey.get(itemKey);
              if (amount !== Number(stored?.one_time_amount_cents || 0)) return false;
              if (phaseIndex === 0) oneTimeTotal += amount;
            } else {
              recurringTotal += amount;
            }
          }
          return recurringTotal === Number(phase.recurringRevenueCents)
            && recurringTotal + oneTimeTotal === Number(phase.invoiceAmountCents);
        });
        if (
          !everyPhaseIsInternallyReconciled
          || !phaseIsReconciled(firstPhase, "promotional")
          || !phaseIsReconciled(lastPhase, "future")
        ) {
          return res.status(422).json({
            success: false,
            code: "MODULAR_CHECKOUT_RECONCILIATION_FAILED",
            error: "Os valores congelados da proposta não reconciliam com seus itens.",
          });
        }
        const customerFacingModulesOnly =
          salesOfferUsesCustomerFacingModulesOnly(snapshot);
        const internalStoredItemHasBillableValue = customerFacingModulesOnly
          && (itemResult.data || []).some((item: any) => {
            if (!isSalesInternalCommercialItemKey(item?.item_key)) return false;
            return [
              item?.gross_recurring_amount_cents,
              item?.recurring_amount_cents,
              item?.post_promotion_recurring_amount_cents,
              item?.one_time_amount_cents,
            ].some((value) => Number(value || 0) !== 0);
          });
        const internalPhaseHasBillableValue = customerFacingModulesOnly
          && phases.some((phase: any) =>
            Array.isArray(phase?.lines)
            && phase.lines.some(
              (line: any) =>
                isSalesInternalCommercialItemKey(line?.itemKey)
                && Number(line?.activePriceCents || 0) !== 0,
            )
          );
        if (internalStoredItemHasBillableValue || internalPhaseHasBillableValue) {
          return res.status(409).json({
            success: false,
            code: "MODULAR_CHECKOUT_INTERNAL_LINE_NONZERO",
            error:
              "A proposta contém um item interno com valor comercial. Gere uma nova versão antes do Checkout.",
          });
        }
        const checkoutPhases = customerFacingModulesOnly
          ? phases.map((phase: any) => ({
              ...phase,
              lines: Array.isArray(phase?.lines)
                ? phase.lines.filter(
                    (line: any) =>
                      !isSalesInternalCommercialItemKey(line?.itemKey),
                  )
                : [],
            }))
          : phases;
        const capacity =
          snapshot.capacity
          || snapshot.basePackage?.capacity
          || frozenResults.basePackage?.capacity
          || null;
        const exactPerPatientBilling = frozenResults?.input?.exactPerPatientBilling === true;
        const acceptedPatientQuantity = Number(frozenResults?.input?.patientQuantity);
        const checkoutPlan = buildFrozenStripeCheckoutPlan({
          currency: sanitizeString(offer.currency, 12) || "brl",
          phases: checkoutPhases,
          capacity,
          effectiveAt: new Date().toISOString(),
          exactPerPatientBilling,
          patientQuantity: acceptedPatientQuantity,
        });
        const requestHash = crypto
          .createHash("sha256")
          .update(JSON.stringify({
            offerId,
            environment: stripeEnvironment,
            trialDays: frozenTrialDays,
            checkoutPlan: checkoutPlan.reconciliationHashInput,
          }))
          .digest("hex");
        const moduleSetHash = buildSalesModuleSetHash(
          offerId,
          requestHash,
          (itemResult.data || []).map((item: any) => sanitizeString(item?.item_key, 80)),
        );
        const { data: latestExpiredLink, error: latestExpiredError } = await supabase
          .from("sales_checkout_links")
          .select("id,updated_at")
          .eq("offer_id", offerId)
          .eq("environment", stripeEnvironment)
          .eq("status", "expired")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestExpiredError) throw latestExpiredError;

        // A legitimate expiry opens a new deterministic idempotency generation.
        // Concurrent retries after the same expiry still converge on one Stripe
        // Session, while a later expiry gets a different generation key.
        let operationIdempotencyKey = latestExpiredLink?.id
          ? crypto
              .createHash("sha256")
              .update(`${idempotencyKey}:expired:${latestExpiredLink.id}`)
              .digest("hex")
          : idempotencyKey;
        let checkoutPublicToken = deriveSalesCheckoutPublicToken(
          offerId,
          `${requestHash}:${operationIdempotencyKey}`,
        );
        const { data: sameKey, error: sameKeyError } = await supabase
          .from("sales_checkout_links")
          .select(SALES_CHECKOUT_LINK_SELECT)
          .eq("created_by", actorUserId)
          .eq("idempotency_key", operationIdempotencyKey)
          .maybeSingle();
        if (sameKeyError) throw sameKeyError;
        if (sameKey) {
          if (sameKey.request_hash !== requestHash || sameKey.offer_id !== offerId) {
            return res.status(409).json({
              success: false,
              code: "MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT",
              error: "A chave já foi usada com outro payload.",
            });
          }
          if (!regenerate && ["active", "sent", "opened", "payment_pending"].includes(sanitizeString(sameKey.status, 40))) {
            return respondWithLink(sameKey, true);
          }
        }
        const { data: activeLink, error: activeLinkError } = await supabase
          .from("sales_checkout_links")
          .select(SALES_CHECKOUT_LINK_SELECT)
          .eq("offer_id", offerId)
          .eq("environment", stripeEnvironment)
          .in("status", ["active", "sent", "opened", "payment_pending"])
          .maybeSingle();
        if (activeLinkError) throw activeLinkError;
        if (activeLink && !regenerate) {
          return respondWithLink(activeLink, true);
        }
        if (!activeLink) {
          const { data: completedSubscriptionLink, error: completedSubscriptionError } = await supabase
            .from("sales_checkout_links")
            .select("id,stripe_subscription_id,status")
            .eq("offer_id", offerId)
            .eq("environment", stripeEnvironment)
            .eq("status", "completed")
            .not("stripe_subscription_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (completedSubscriptionError) throw completedSubscriptionError;
          if (completedSubscriptionLink?.stripe_subscription_id) {
            return res.status(409).json({
              success: false,
              code: "MODULAR_CHECKOUT_ALREADY_COMPLETED",
              error: "Esta proposta já originou uma assinatura confirmada.",
            });
          }
          const { data: failedSubscriptionLink, error: failedSubscriptionError } = await supabase
            .from("sales_checkout_links")
            .select("id,stripe_subscription_id,status")
            .eq("offer_id", offerId)
            .eq("environment", stripeEnvironment)
            .eq("status", "failed")
            .not("stripe_subscription_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (failedSubscriptionError) throw failedSubscriptionError;
          if (failedSubscriptionLink?.stripe_subscription_id) {
            return res.status(409).json({
              success: false,
              code: "MODULAR_CHECKOUT_PAYMENT_RECOVERY_REQUIRED",
              error: "A assinatura já existe e possui falha de cobrança. Regularize-a na Stripe sem criar outra assinatura.",
            });
          }
        }
        if (activeLink && regenerate) {
          operationIdempotencyKey = crypto
            .createHash("sha256")
            .update(`${idempotencyKey}:regenerate:${activeLink.id}`)
            .digest("hex");
          checkoutPublicToken = deriveSalesCheckoutPublicToken(
            offerId,
            `${requestHash}:${operationIdempotencyKey}`,
          );
          await supabase
            .from("sales_checkout_links")
            .update({
              status: "expired",
              logically_expired_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", activeLink.id)
            .in("status", ["active", "sent", "opened", "payment_pending"]);
          if (activeLink.stripe_checkout_session_id) {
            await getStripe().checkout.sessions.expire(
              activeLink.stripe_checkout_session_id,
            ).catch(() => undefined);
          }
        }
        const origin = salesApplicationOrigin(req);
        const stripeMetadata: Record<string, string> = {
          flowType: "sales_modular_assisted",
          ...(exactPerPatientBilling ? { billingModel: "modular_exact_per_patient_v1" } : {}),
          offerId,
          leadId: offer.lead_id,
          requestHash,
          catalogVersion: sanitizeString(
            snapshot.catalogVersion || offer.catalog_version_id,
            100,
          ),
          assumptionsVersion: sanitizeString(
            snapshot.assumptionsSnapshotVersion
              || offer.simulation_snapshot?.assumptionSetId,
            100,
          ),
          environment: stripeEnvironment,
          moduleSetHash,
          contractEmailHash: crypto
            .createHash("sha256")
            .update(contractEmail)
            .digest("hex"),
        };
        const session = await getStripe().checkout.sessions.create(
          {
            mode: "subscription",
            client_reference_id: offerId,
            customer_email: contractEmail,
            success_url: `${buildSalesOfferPublicUrl(
              req,
              buildSalesCheckoutReturnContextToken(checkoutPublicToken),
            )}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: publicOfferToken
              ? `${buildSalesOfferPublicUrl(req, publicOfferToken)}?payment=cancel`
              : `${origin}/oferta/pagamento?payment=cancelled`,
            expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
            metadata: stripeMetadata,
            ...(frozenTrialDays > 0
              ? { payment_method_collection: "always" as const }
              : {}),
            subscription_data: {
              metadata: stripeMetadata,
              ...(frozenTrialDays > 0
                ? { trial_period_days: frozenTrialDays }
                : {}),
            },
            line_items: checkoutPlan.initialLineItems.map((line) => ({
              quantity: Number(line.quantity || 1),
              price_data: {
                currency: checkoutPlan.currency,
                unit_amount: line.unitAmountCents,
                product_data: {
                  name: line.description,
                  metadata: line.metadata,
                },
                ...(line.recurring
                  ? { recurring: { interval: "month" as const } }
                  : {}),
              },
            })),
          },
          {
            idempotencyKey: crypto
              .createHash("sha256")
              .update(`modular-checkout:${stripeEnvironment}:${offerId}:${requestHash}:${operationIdempotencyKey}`)
              .digest("hex"),
          },
        );
        if (!session.url) throw new Error("STRIPE_CHECKOUT_URL_MISSING");
        const linkPayload = {
          offer_id: offerId,
          lead_id: offer.lead_id,
          environment: stripeEnvironment,
          status: "active",
          request_hash: requestHash,
          idempotency_key: operationIdempotencyKey,
          stripe_checkout_session_id: session.id,
          checkout_url: session.url,
          public_token_hash: hashSalesOfferToken(checkoutPublicToken),
          catalog_snapshot_version: sanitizeString(
            snapshot.catalogVersion || offer.catalog_version_id,
            100,
          ),
          assumptions_snapshot_version: sanitizeString(
            snapshot.assumptionsSnapshotVersion
              || offer.simulation_snapshot?.assumptionSetId,
            100,
          ),
          checkout_plan_snapshot: checkoutPlan,
          initial_amount_cents: checkoutPlan.initialAmountCents,
          promotional_monthly_cents: checkoutPlan.promotionalMonthlyCents,
          future_monthly_cents: checkoutPlan.futureMonthlyCents,
          one_time_cents: checkoutPlan.oneTimeCents,
          expires_at: new Date(Number(session.expires_at) * 1000).toISOString(),
          created_by: actorUserId,
        };
        const { data: storedLink, error: storeError } = await supabase
          .from("sales_checkout_links")
          .insert([linkPayload])
          .select(SALES_CHECKOUT_LINK_SELECT)
          .single();
        if (storeError) {
          await getStripe().checkout.sessions.expire(session.id).catch(() => undefined);
          if (String(storeError.code || "") === "23505") {
            const { data: racedLink, error: racedLinkError } = await supabase
              .from("sales_checkout_links")
              .select(SALES_CHECKOUT_LINK_SELECT)
              .eq("offer_id", offerId)
              .eq("environment", stripeEnvironment)
              .in("status", ["active", "sent", "opened", "payment_pending"])
              .maybeSingle();
            if (racedLinkError) throw racedLinkError;
            if (racedLink) {
              return respondWithLink(racedLink, true);
            }
          }
          throw storeError;
        }
        await Promise.all([
          supabase.from("sales_lead_events").upsert(
            [{
              lead_id: offer.lead_id,
              event_type: "checkout_created",
              actor_user_id: actorUserId,
              metadata: {
                offer_id: offerId,
                checkout_link_id: storedLink.id,
                environment: stripeEnvironment,
              },
              idempotency_key: `modular-checkout-created:${storedLink.id}`,
            }],
            { onConflict: "idempotency_key", ignoreDuplicates: true },
          ),
          supabase
            .from("sales_offers")
            .update({
              status: "checkout_created",
              stripe_checkout_session_id: session.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", offerId)
            .eq("lead_id", offer.lead_id)
            .in("status", ["ready", "sent", "opened", "checkout_created"]),
        ]);
        return respondWithLink(storedLink, false, 201);
      } catch (error: any) {
        console.error("[Sales Modular Checkout] Falha ao gerar link.", {
          offerId,
          actorUserId,
          code: sanitizeString(error?.code, 100),
          message: sanitizeString(error?.message || String(error), 220),
        });
        return res.status(500).json({
          success: false,
          code: "MODULAR_CHECKOUT_CREATION_FAILED",
          error: "Não foi possível gerar o link de pagamento.",
        });
      }
  };

  return createOrReuseModularCheckout;
}
