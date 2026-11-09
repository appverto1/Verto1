import type Stripe from 'stripe';
import type { SalesSimulationInput, SalesUsageProfile } from '../src/utils/salesProfitability';

// Item 05: offer preparation and the existing owner route; behavior preserved.
export type OwnerSalesOfferCreationDependencies = {
  PUBLIC_ACTIVE_PATIENT_PRICE: any;
  SALES_ESTIMATED_ACTIVE_PATIENTS_MAX: any;
  SALES_MODULAR_SIMULATION_SELECT: any;
  app: any;
  buildSalesOfferPublicUrl: any;
  calculateSalesModularProposal: any;
  calculateSalesProfitability: any;
  checkAuth: any;
  checkPlatformAdmin: any;
  classifySalesProposalReview: any;
  crypto: any;
  deriveSalesOfferPublicToken: any;
  extractMissingColumnName: any;
  extractSupabaseErrorMessage: any;
  filterSalesCurrentOperatingTechnicalBlockers: any;
  getStripe: any;
  hasVerifiedMfaSession: any;
  hashSalesOfferToken: any;
  isCouponDurationMonths: any;
  isCustomCouponDurationMonths: any;
  isSalesOfferStripeReady: any;
  isUuid: any;
  loadSalesPricingCatalog: any;
  maskEmail: any;
  normalizeSalesInteger: any;
  normalizeSalesModularProposalRequest: any;
  normalizeSalesTrialDays: any;
  normalizeStoredSalesAssumptionSnapshot: any;
  resolveSalesStripeConfiguration: any;
  resolveStripeEnvironment: any;
  salesCatalogHasVersionedProfitabilityPolicy: any;
  salesCommercialExceptionApprovalMatches: any;
  salesModularProposalRequiresVersionedProfitabilityPolicy: any;
  salesModularResultMatches: any;
  sanitizeEmail: any;
  sanitizeString: any;
  sendSalesProfitabilityPolicyRequired: any;
  sendSalesProfitabilityPolicySchemaPending: any;
  supabase: any;
  validateSalesProfitabilityPolicy: any;
  validateStripeSecretForEnvironment: any;
};
export const registerOwnerSalesOfferCreationRoute = (deps: OwnerSalesOfferCreationDependencies): void => {
  const { PUBLIC_ACTIVE_PATIENT_PRICE, SALES_ESTIMATED_ACTIVE_PATIENTS_MAX, SALES_MODULAR_SIMULATION_SELECT, app, buildSalesOfferPublicUrl, calculateSalesModularProposal, calculateSalesProfitability, checkAuth, checkPlatformAdmin, classifySalesProposalReview, crypto, deriveSalesOfferPublicToken, extractMissingColumnName, extractSupabaseErrorMessage, filterSalesCurrentOperatingTechnicalBlockers, getStripe, hasVerifiedMfaSession, hashSalesOfferToken, isCouponDurationMonths, isCustomCouponDurationMonths, isSalesOfferStripeReady, isUuid, loadSalesPricingCatalog, maskEmail, normalizeSalesInteger, normalizeSalesModularProposalRequest, normalizeSalesTrialDays, normalizeStoredSalesAssumptionSnapshot, resolveSalesStripeConfiguration, resolveStripeEnvironment, salesCatalogHasVersionedProfitabilityPolicy, salesCommercialExceptionApprovalMatches, salesModularProposalRequiresVersionedProfitabilityPolicy, salesModularResultMatches, sanitizeEmail, sanitizeString, sendSalesProfitabilityPolicyRequired, sendSalesProfitabilityPolicySchemaPending, supabase, validateSalesProfitabilityPolicy, validateStripeSecretForEnvironment } = deps;
  // BEGIN ITEM05 ORIGINAL PREPARATION
  const prepareSalesModularOffer = async (
    req: any,
    res: any,
    params: {
      leadId: string;
      simulationId: string;
      actorUserId: string;
      idempotencyKey: string;
      contractEmail: string;
    },
  ) => {
    const {
      leadId,
      simulationId,
      actorUserId,
      idempotencyKey,
      contractEmail,
    } = params;
    if (
      req.session?.user?.isPlatformAdmin !== true
      || !hasVerifiedMfaSession(req.session?.user)
    ) {
      return res.status(403).json({
        success: false,
        code: "PROPOSAL_ACCESS_DENIED",
        error: "Esta ação exige administração da plataforma com MFA validado.",
      });
    }
    if (
      !isUuid(leadId)
      || !isUuid(simulationId)
      || !isUuid(actorUserId)
      || idempotencyKey.length < 12
    ) {
      return res.status(400).json({
        success: false,
        code: "PROPOSAL_SIMULATION_INVALID",
        error: "Selecione um cenário modular salvo.",
      });
    }
    if (!contractEmail) {
      return res.status(422).json({
        success: false,
        code: "PROPOSAL_CONTRACT_EMAIL_REQUIRED",
        error: "Informe um e-mail válido do responsável pela contratação.",
      });
    }
    try {
      const [leadResult, simulationResult] = await Promise.all([
        supabase
          .from("sales_leads")
          .select("id")
          .eq("id", leadId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("sales_offer_simulations")
          .select(SALES_MODULAR_SIMULATION_SELECT)
          .eq("id", simulationId)
          .eq("lead_id", leadId)
          .eq("simulation_type", "modular")
          .is("deleted_at", null)
          .maybeSingle(),
      ]);
      if (leadResult.error) throw leadResult.error;
      if (!leadResult.data) {
        return res.status(404).json({
          success: false,
          code: "PROPOSAL_ACCESS_DENIED",
          error: "Lead não encontrado.",
        });
      }
      if (simulationResult.error) throw simulationResult.error;
      const simulation = simulationResult.data;
      if (!simulation) {
        return res.status(404).json({
          success: false,
          code: "PROPOSAL_SIMULATION_INVALID",
          error: "Cenário modular não encontrado.",
        });
      }
      if (!["selected", "offered"].includes(
        sanitizeString(simulation.status, 30),
      )) {
        return res.status(409).json({
          success: false,
          code: "PROPOSAL_SIMULATION_INVALID",
          error: "Selecione o cenário antes de gerar a proposta pública.",
        });
      }
      const historicalPublishedOffer =
        sanitizeString(simulation.status, 30) === "offered";
      if (historicalPublishedOffer) {
        const { data: existingOffer, error: existingOfferError } =
          await supabase
            .from("sales_offers")
            .select(
              "id,simulation_id,status,expires_at,created_by,idempotency_key,modular_checkout_enabled,trial_days,contract_email,created_at",
            )
            .eq("simulation_id", simulationId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (existingOfferError) throw existingOfferError;
        const offerCreatedBy = sanitizeString(
          existingOffer?.created_by,
          120,
        );
        const offerIdempotencyKey = sanitizeString(
          existingOffer?.idempotency_key,
          240,
        );
        if (!existingOffer || !offerCreatedBy || !offerIdempotencyKey) {
          return res.status(409).json({
            success: false,
            code: "PROPOSAL_SNAPSHOT_CONFLICT",
            error:
              "A proposta publicada não possui os dados congelados necessários para recuperar o link original.",
          });
        }
        const publicToken = deriveSalesOfferPublicToken(
          offerCreatedBy,
          offerIdempotencyKey,
        );
        const expectedTrialDays = normalizeSalesTrialDays(
          simulation.modular_input_snapshot?.trialDays,
          0,
        );
        const persistedTrialDays = normalizeSalesTrialDays(
          existingOffer.trial_days,
          0,
        );
        if (persistedTrialDays !== expectedTrialDays) {
          console.error('[Sales Modular] Trial congelado diverge da proposta persistida.', {
            offerId: existingOffer.id,
            simulationId,
            expectedTrialDays,
            persistedTrialDays,
          });
          return res.status(409).json({
            success: false,
            code: 'PROPOSAL_TRIAL_SNAPSHOT_MISMATCH',
            error: 'O período de teste congelado diverge da proposta persistida. Gere uma nova versão do cenário antes do Checkout.',
          });
        }
        const persistedContractEmail = sanitizeEmail(existingOffer.contract_email);
        if (!persistedContractEmail) {
          return res.status(409).json({
            success: false,
            code: 'PROPOSAL_CONTRACT_EMAIL_REQUIRED',
            error: 'Esta proposta histórica não possui identidade contratual congelada. Duplique o cenário e gere uma nova proposta.',
          });
        }
        if (persistedContractEmail !== contractEmail) {
          return res.status(409).json({
            success: false,
            code: 'PROPOSAL_CONTRACT_EMAIL_MISMATCH',
            error: 'O e-mail informado difere da identidade congelada nesta proposta. Use a proposta original ou gere uma nova versão.',
          });
        }
        let stripeReady = false;
        if (existingOffer.modular_checkout_enabled === true) {
          try {
            const stripeEnvironment = resolveStripeEnvironment();
            validateStripeSecretForEnvironment(stripeEnvironment);
            stripeReady = true;
          } catch {
            stripeReady = false;
          }
        }
        return res.status(200).json({
          success: true,
          offer: existingOffer,
          publicUrl: buildSalesOfferPublicUrl(req, publicToken),
          stripeReady,
          modularCheckoutEnabled: existingOffer.modular_checkout_enabled === true,
          trialDays: [0, 7, 14, 30].includes(Number(existingOffer.trial_days || 0))
            ? Number(existingOffer.trial_days || 0)
            : 0,
          idempotent: true,
          message:
            "A proposta modular já existia; o mesmo link foi recuperado.",
        });
      }
      const [catalog, assumptionResult] = await Promise.all([
        loadSalesPricingCatalog(
          sanitizeString(simulation.catalog_version_id, 120),
        ),
        supabase
          .from("sales_financial_assumption_sets")
          .select("id,version,name,effective_at,values,source_metadata")
          .eq("id", simulation.assumption_set_id)
          .maybeSingle(),
      ]);
      if (assumptionResult.error) throw assumptionResult.error;
      if (!assumptionResult.data) {
        return res.status(409).json({
          success: false,
          code: "PROPOSAL_SNAPSHOT_CONFLICT",
          error: "As premissas congeladas não estão disponíveis.",
        });
      }
      const input = normalizeSalesModularProposalRequest(
        simulation.modular_input_snapshot,
      );
      const requiresVersionedProfitabilityPolicy =
        salesModularProposalRequiresVersionedProfitabilityPolicy(
          input,
          catalog,
        );
      const hasVersionedEconomicSnapshot =
        validateSalesProfitabilityPolicy(
          simulation.results_snapshot?.economics?.policy,
        );
      if (
        !historicalPublishedOffer
        && requiresVersionedProfitabilityPolicy
        && (
          !salesCatalogHasVersionedProfitabilityPolicy(catalog)
          || !hasVersionedEconomicSnapshot
        )
      ) {
        return sendSalesProfitabilityPolicyRequired(res);
      }
      const assumptions = normalizeStoredSalesAssumptionSnapshot(
        simulation.assumptions_snapshot,
      );
      const recalculated = calculateSalesModularProposal(
        input,
        catalog,
        assumptions,
      );
      if (
        sanitizeString(simulation.model_version, 80)
          !== recalculated.modelVersion
        || !salesModularResultMatches(
          simulation.results_snapshot,
          recalculated,
        )
      ) {
        return res.status(409).json({
          success: false,
          code: "PROPOSAL_SNAPSHOT_CONFLICT",
          error:
            "O cenário divergiu do catálogo congelado. Duplique e salve uma nova versão.",
        });
      }
      if (
        recalculated.commercialPricing.enabled
        && recalculated.commercialPricing.missingPriceItemKeys.length > 0
      ) {
        return res.status(422).json({
          success: false,
          code: "PROPOSAL_PRICE_PER_PATIENT_MISSING",
          fields: recalculated.commercialPricing.missingPriceItemKeys,
          error:
            "Informe o preço por paciente dos módulos selecionados antes de gerar a proposta.",
          });
      }
      const proposalReview = classifySalesProposalReview(recalculated);
      const proposalTechnicalBlockingCodes = filterSalesCurrentOperatingTechnicalBlockers(
        proposalReview.technicalBlockingCodes,
      );
      if (proposalTechnicalBlockingCodes.length > 0) {
        return res.status(422).json({
          success: false,
          code: "PROPOSAL_TECHNICAL_BLOCKED",
          blockingCodes: proposalTechnicalBlockingCodes,
          error:
            "Corrija os valores comerciais e a reconciliação obrigatória antes de gerar a proposta.",
        });
      }
      if (
        proposalReview.requiresCommercialApproval
        && !salesCommercialExceptionApprovalMatches(
          recalculated,
          simulation.results_snapshot?.commercialExceptionApproval,
        )
      ) {
        return res.status(422).json({
          success: false,
          code: "PROPOSAL_MARGIN_POLICY_REVIEW_REQUIRED",
          alertCodes: proposalReview.commercialAlertCodes,
          error:
            "Esta condição comercial exige aprovação explícita de owner com MFA e justificativa.",
        });
      }
      const requestHash = crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            leadId,
            simulationId,
            contractEmail,
            catalogVersionId: catalog.id,
            resultModelVersion: recalculated.modelVersion,
            commercialExceptionResultHash:
              simulation.results_snapshot?.commercialExceptionApproval
                ?.resultHash || null,
          }),
        )
        .digest("hex");
      const provisionalToken = deriveSalesOfferPublicToken(
        actorUserId,
        idempotencyKey,
      );
      const expiresAt = new Date(
        Date.now()
          + input.offerValidityDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data, error } = await supabase.rpc(
        "create_sales_modular_offer_v3",
        {
          p_simulation_id: simulationId,
          p_lead_id: leadId,
          p_actor_user_id: actorUserId,
          p_idempotency_key: idempotencyKey,
          p_request_hash: requestHash,
          p_public_token_hash: hashSalesOfferToken(provisionalToken),
          p_expires_at: expiresAt,
          p_contract_email: contractEmail,
        },
      );
      if (error) throw error;
      const offer = data?.offer || data;
      const expectedTrialDays = normalizeSalesTrialDays(input.trialDays, 0);
      const persistedTrialDays = normalizeSalesTrialDays(offer?.trial_days, 0);
      if (persistedTrialDays !== expectedTrialDays) {
        console.error('[Sales Modular] Trial não foi congelado corretamente na proposta.', {
          offerId: sanitizeString(offer?.id, 120),
          simulationId,
          expectedTrialDays,
          persistedTrialDays,
        });
        return res.status(409).json({
          success: false,
          code: 'PROPOSAL_TRIAL_SNAPSHOT_MISMATCH',
          error: 'O período de teste não foi congelado corretamente. Salve e selecione uma nova versão do cenário.',
        });
      }
      const persistedContractEmail = sanitizeEmail(offer?.contract_email);
      if (!persistedContractEmail || persistedContractEmail !== contractEmail) {
        console.error('[Sales Modular] Identidade contratual não foi congelada corretamente.', {
          offerId: sanitizeString(offer?.id, 120),
          simulationId,
          expectedEmail: maskEmail(contractEmail),
          persistedEmail: persistedContractEmail ? maskEmail(persistedContractEmail) : null,
        });
        return res.status(409).json({
          success: false,
          code: 'PROPOSAL_CONTRACT_EMAIL_MISMATCH',
          error: 'O e-mail da contratação não foi congelado corretamente. Gere uma nova proposta antes de continuar.',
        });
      }
      const publicToken = deriveSalesOfferPublicToken(
        sanitizeString(offer?.created_by, 120) || actorUserId,
        sanitizeString(offer?.idempotency_key, 240) || idempotencyKey,
      );
      let stripeReady = false;
      try {
        const stripeEnvironment = resolveStripeEnvironment();
        validateStripeSecretForEnvironment(stripeEnvironment);
        stripeReady = true;
      } catch {
        stripeReady = false;
      }
      return res.status(data?.idempotent ? 200 : 201).json({
        success: true,
        offer,
        publicUrl: buildSalesOfferPublicUrl(req, publicToken),
        stripeReady,
        modularCheckoutEnabled: offer?.modular_checkout_enabled === true,
        trialDays: [0, 7, 14, 30].includes(Number(offer?.trial_days || 0))
          ? Number(offer?.trial_days || 0)
          : 0,
        idempotent: data?.idempotent === true,
        message: data?.idempotent
          ? "A proposta modular já existia; o mesmo link foi recuperado."
          : "Proposta pública modular criada sem acessar a API da Stripe.",
      });
    } catch (error: any) {
      if (sendSalesProfitabilityPolicySchemaPending(res, error)) return;
      const rawCode = sanitizeString(
        error?.message || error?.code,
        220,
      );
      const dbCode = sanitizeString(error?.code, 40).toUpperCase();
      const dbMessage = extractSupabaseErrorMessage(error);
      const schemaDiagnostic = `${dbMessage} ${sanitizeString(error?.details, 800)}`;
      const positiveBaseSchemaDrift = dbCode === '23514'
        && /sales_offers_(?:amount_positive|base_amount_check)/i.test(schemaDiagnostic);
      const schemaPending =
        dbCode === 'PGRST202'
        || dbCode === '42883'
        || extractMissingColumnName(error) === 'contract_email'
        || positiveBaseSchemaDrift
        || /create_sales_modular_offer_v3|contract_email|schema cache|function .* does not exist/i.test(dbMessage);
      const conflict = rawCode.includes("PROPOSAL_SNAPSHOT_CONFLICT");

      console.error('[Owner Sales] Falha ao preparar proposta modular.', {
        leadId,
        simulationId,
        code: dbCode || null,
        message: sanitizeString(dbMessage, 500) || null,
        details: sanitizeString(error?.details, 500) || null,
        hint: sanitizeString(error?.hint, 500) || null,
        schemaPending,
      });

      if (schemaPending) {
        return res.status(503).json({
          success: false,
          code: 'PROPOSAL_SCHEMA_MIGRATION_REQUIRED',
          error: 'A atualização de persistência das propostas ainda não foi aplicada neste ambiente.',
        });
      }
      return res.status(conflict ? 409 : 500).json({
        success: false,
        code: conflict
          ? "PROPOSAL_SNAPSHOT_CONFLICT"
          : "PROPOSAL_PREPARATION_FAILED",
        error: conflict
          ? "A chave ou o snapshot diverge da proposta já criada."
          : "Não foi possível gerar a proposta modular.",
      });
    }
  };

  const prepareSalesOfferFromSimulation = async (
    req: any,
    res: any,
    params: {
      leadId: string;
      simulationId: string;
      actorUserId: string;
      idempotencyKey: string;
    },
  ) => {
    const { leadId, simulationId, actorUserId, idempotencyKey } = params;
    if (
      req.session?.user?.isPlatformAdmin !== true
      || !hasVerifiedMfaSession(req.session?.user)
    ) {
      return res.status(403).json({
        success: false,
        code: "SIMULATION_ACCESS_DENIED",
        error: "Esta ação exige administração da plataforma com MFA validado.",
      });
    }
    if (
      !isUuid(leadId)
      || !isUuid(simulationId)
      || !isUuid(actorUserId)
      || idempotencyKey.length < 12
    ) {
      return res.status(400).json({
        success: false,
        code: "OFFER_SIMULATION_REQUIRED",
        error: "Selecione uma simulação salva antes de preparar a oferta.",
      });
    }

    const offerSelect =
      "id,lead_id,simulation_id,status,base_unit_amount_cents,currency,initial_active_patient_quantity,discount_duration_months,discount_type,discount_percentage,stripe_coupon_id,promotional_unit_amount_cents,promotional_monthly_amount_cents,post_discount_monthly_amount_cents,expires_at,created_by,idempotency_key,created_at";
    const stripeConfig = resolveSalesStripeConfiguration();

    const ensureStripeDiscount = async (offer: any, simulation: any) => {
      const discountPercentage = Number(
        simulation.discount_percentage || 0,
      );
      const duration = Number(
        simulation.discount_duration_months || 0,
      );
      const requiresCoupon =
        sanitizeString(simulation.discount_type, 20) === "coupon";
      if (!requiresCoupon) {
        if (sanitizeString(offer.status, 40) !== "ready") {
          const { data, error } = await supabase
            .from("sales_offers")
            .update({
              status: "ready",
              updated_at: new Date().toISOString(),
            })
            .eq("id", offer.id)
            .eq("simulation_id", simulation.id)
            .select(offerSelect)
            .single();
          if (error) throw error;
          return data;
        }
        return offer;
      }
      if (
        !Number.isFinite(discountPercentage)
        || discountPercentage <= 0
        || discountPercentage > 100
        || !isCustomCouponDurationMonths(duration)
      ) {
        const error = new Error("CUSTOM_DISCOUNT_INVALID");
        (error as any).code = "CUSTOM_DISCOUNT_INVALID";
        throw error;
      }
      if (!stripeConfig.enabled || !stripeConfig.basePriceId) {
        const error = new Error("CUSTOM_DISCOUNT_STRIPE_UNAVAILABLE");
        (error as any).code = "CUSTOM_DISCOUNT_STRIPE_UNAVAILABLE";
        throw error;
      }
      if (sanitizeString(offer.stripe_coupon_id, 240)) {
        if (sanitizeString(offer.status, 40) === "ready") return offer;
        const { data, error } = await supabase
          .from("sales_offers")
          .update({
            status: "ready",
            updated_at: new Date().toISOString(),
          })
          .eq("id", offer.id)
          .eq("simulation_id", simulation.id)
          .select(offerSelect)
          .single();
        if (error) throw error;
        return data;
      }

      const stripe = getStripe();
      let price: Stripe.Price;
      try {
        price = await stripe.prices.retrieve(stripeConfig.basePriceId);
      } catch (error: any) {
        const wrapped = new Error(
          error?.code === "resource_missing"
            ? "CUSTOM_DISCOUNT_MODE_MISMATCH"
            : "CUSTOM_DISCOUNT_STRIPE_UNAVAILABLE",
        );
        (wrapped as any).code = wrapped.message;
        throw wrapped;
      }
      if (
        !price.active
        || price.type !== "recurring"
        || Number(price.unit_amount || 0)
          !== PUBLIC_ACTIVE_PATIENT_PRICE.unitAmountCents
      ) {
        const error = new Error("CUSTOM_DISCOUNT_MODE_MISMATCH");
        (error as any).code = "CUSTOM_DISCOUNT_MODE_MISMATCH";
        throw error;
      }
      const productId =
        typeof price.product === "string" ? price.product : price.product?.id;
      let coupon: Stripe.Coupon;
      try {
        coupon = await stripe.coupons.create(
          {
            percent_off: discountPercentage,
            duration: "repeating",
            duration_in_months: duration,
            name: `Oferta Verto ${String(offer.id).slice(0, 8)}`,
            applies_to: productId
              ? { products: [productId] }
              : undefined,
            metadata: {
              flowType: "sales_assisted_signup",
              offerId: String(offer.id),
              leadId,
              simulationId,
            },
          },
          {
            idempotencyKey: `sales-offer-coupon:${offer.id}`,
          },
        );
      } catch (error: any) {
        const wrapped = new Error("CUSTOM_DISCOUNT_CREATION_FAILED");
        (wrapped as any).code = "CUSTOM_DISCOUNT_CREATION_FAILED";
        (wrapped as any).cause = error;
        throw wrapped;
      }
      const { data: persistedOffer, error: persistenceError } =
        await supabase
          .from("sales_offers")
          .update({
            stripe_coupon_id: coupon.id,
            status: "ready",
            updated_at: new Date().toISOString(),
          })
          .eq("id", offer.id)
          .eq("simulation_id", simulation.id)
          .select(offerSelect)
          .single();
      if (persistenceError || !persistedOffer) {
        const error = new Error("CUSTOM_DISCOUNT_PERSISTENCE_FAILED");
        (error as any).code = "CUSTOM_DISCOUNT_PERSISTENCE_FAILED";
        (error as any).cause = persistenceError || null;
        throw error;
      }
      return persistedOffer;
    };

    const serializePreparedOffer = (
      offer: any,
      rawToken: string,
      idempotent: boolean,
    ) => {
      const stripeReady = isSalesOfferStripeReady(offer, stripeConfig);
      return res.status(idempotent ? 200 : 201).json({
        success: true,
        offerId: offer.id,
        offer,
        publicUrl: stripeReady
          ? buildSalesOfferPublicUrl(req, rawToken)
          : null,
        status: offer.status,
        stripeReady,
        idempotent,
        message: idempotent
          ? "A mesma proposta individual foi recuperada."
          : "Proposta individual criada e pronta para envio.",
      });
    };
    const finalizePreparedOffer = async (
      offer: any,
      storedInput: SalesSimulationInput,
      recalculated: ReturnType<typeof calculateSalesProfitability>,
    ) => {
      const now = new Date().toISOString();
      const [simulationUpdate, leadUpdate, eventUpsert] =
        await Promise.all([
          supabase
            .from("sales_offer_simulations")
            .update({ status: "offered", updated_at: now })
            .eq("id", simulationId)
            .eq("lead_id", leadId)
            .in("status", ["saved", "selected", "offered"]),
          supabase
            .from("sales_leads")
            .update({
              status: "proposal_preparing",
              updated_at: now,
            })
            .eq("id", leadId)
            .is("deleted_at", null),
          supabase
            .from("sales_lead_events")
            .upsert(
              [
                {
                  lead_id: leadId,
                  event_type: "proposal_created",
                  actor_user_id: actorUserId,
                  metadata: {
                    offer_id: offer.id,
                    simulation_id: simulationId,
                    discount_percentage:
                      storedInput.discountBasisPoints / 100,
                    duration_months:
                      storedInput.discountDurationMonths || null,
                    profitability_rating: recalculated.rating,
                  },
                  idempotency_key: `proposal-created:${offer.id}`,
                },
              ],
              { onConflict: "idempotency_key", ignoreDuplicates: true },
            ),
        ]);
      const persistenceError = [
        simulationUpdate,
        leadUpdate,
        eventUpsert,
      ].find((result: any) => result?.error)?.error;
      if (persistenceError) {
        const error = new Error("CUSTOM_DISCOUNT_PERSISTENCE_FAILED");
        (error as any).code = "CUSTOM_DISCOUNT_PERSISTENCE_FAILED";
        (error as any).cause = persistenceError;
        throw error;
      }
    };

    try {
      const [leadResult, simulationResult, offerBySimulationResult] =
        await Promise.all([
          supabase
            .from("sales_leads")
            .select("id,status")
            .eq("id", leadId)
            .is("deleted_at", null)
            .maybeSingle(),
          supabase
            .from("sales_offer_simulations")
            .select(
              "id,lead_id,created_by,status,assumption_set_id,model_version,initial_active_patient_quantity,base_unit_amount_cents,currency,discount_type,discount_percentage,discount_duration_months,offer_validity_days,usage_profile,custom_monthly_cost_cents,onboarding_cost_cents,assumptions_snapshot,results_snapshot,profitability_rating,internal_justification,internal_notes,selected_for_offer_at,created_at,updated_at",
            )
            .eq("id", simulationId)
            .eq("lead_id", leadId)
            .is("deleted_at", null)
            .maybeSingle(),
          supabase
            .from("sales_offers")
            .select(offerSelect)
            .eq("simulation_id", simulationId)
            .maybeSingle(),
        ]);
      if (leadResult.error) throw leadResult.error;
      if (!leadResult.data) {
        return res.status(404).json({
          success: false,
          code: "SIMULATION_LEAD_NOT_FOUND",
          error: "Lead não encontrado.",
        });
      }
      if (simulationResult.error) throw simulationResult.error;
      const simulation = simulationResult.data;
      if (!simulation) {
        return res.status(404).json({
          success: false,
          code: "OFFER_SIMULATION_REQUIRED",
          error: "Simulação não encontrada.",
        });
      }
      if (offerBySimulationResult.error) {
        throw offerBySimulationResult.error;
      }

      const storedAssumptions = normalizeStoredSalesAssumptionSnapshot(
        simulation.assumptions_snapshot,
      );
      const storedInput: SalesSimulationInput = {
        initialActivePatientQuantity: Number(
          simulation.initial_active_patient_quantity,
        ),
        baseUnitAmountCents: Number(simulation.base_unit_amount_cents),
        discountBasisPoints: Math.round(
          Number(simulation.discount_percentage || 0) * 100,
        ),
        discountDurationMonths: Number(
          simulation.discount_duration_months || 0,
        ),
        offerValidityDays: Number(simulation.offer_validity_days || 14),
        usageProfile: sanitizeString(
          simulation.usage_profile,
          30,
        ) as SalesUsageProfile,
        customMonthlyCostCents: Number(
          simulation.custom_monthly_cost_cents || 0,
        ),
        onboardingCostCents: Number(
          simulation.onboarding_cost_cents || 0,
        ),
      };
      const recalculated = calculateSalesProfitability(
        storedInput,
        storedAssumptions,
      );
      const storedResult = simulation.results_snapshot || {};
      const snapshotMatches =
        simulation.model_version === recalculated.modelVersion
        && Number(storedResult.promotionalUnitAmountCents)
          === recalculated.promotionalUnitAmountCents
        && Number(storedResult.promotionalMonthlyRevenueCents)
          === recalculated.promotionalMonthlyRevenueCents
        && sanitizeString(storedResult.rating, 40) === recalculated.rating
        && Number(storedResult?.input?.discountBasisPoints)
          === storedInput.discountBasisPoints;
      if (!snapshotMatches) {
        return res.status(409).json({
          success: false,
          code: "OFFER_SIMULATION_CHANGED",
          error:
            "O snapshot da simulação divergiu. Duplique e salve uma nova simulação.",
        });
      }
      if (
        recalculated.rating === "insufficient_data"
        || recalculated.missingAssumptions.length > 0
      ) {
        return res.status(422).json({
          success: false,
          code: "SIMULATION_FINANCIAL_DATA_INSUFFICIENT",
          error:
            "Complete as premissas financeiras obrigatórias antes de preparar a oferta.",
        });
      }
      if (
        recalculated.requiresJustification
        && sanitizeString(
          simulation.internal_justification,
          1500,
        ).length < 12
      ) {
        return res.status(422).json({
          success: false,
          code: "SIMULATION_JUSTIFICATION_REQUIRED",
          error:
            "Esta oferta exige uma justificativa administrativa antes do preparo.",
        });
      }

      if (offerBySimulationResult.data) {
        const existingOffer = offerBySimulationResult.data;
        const existingToken = deriveSalesOfferPublicToken(
          sanitizeString(existingOffer.created_by, 120),
          sanitizeString(existingOffer.idempotency_key, 240),
        );
        const readyOffer = await ensureStripeDiscount(
          existingOffer,
          simulation,
        );
        await finalizePreparedOffer(
          readyOffer,
          storedInput,
          recalculated,
        );
        return serializePreparedOffer(readyOffer, existingToken, true);
      }

      const token = deriveSalesOfferPublicToken(
        actorUserId,
        idempotencyKey,
      );
      const expiresAt = new Date(
        Date.now()
          + storedInput.offerValidityDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data: insertedOffer, error: insertError } = await supabase
        .from("sales_offers")
        .insert([
          {
            lead_id: leadId,
            simulation_id: simulationId,
            simulation_snapshot: {
              modelVersion: recalculated.modelVersion,
              assumptionSet: storedAssumptions,
              input: storedInput,
              results: recalculated,
              createdAt: simulation.created_at,
            },
            status: "draft",
            base_unit_amount_cents:
              PUBLIC_ACTIVE_PATIENT_PRICE.unitAmountCents,
            currency: PUBLIC_ACTIVE_PATIENT_PRICE.currency,
            initial_active_patient_quantity:
              storedInput.initialActivePatientQuantity,
            discount_duration_months:
              storedInput.discountBasisPoints > 0
                ? storedInput.discountDurationMonths
                : null,
            discount_type:
              storedInput.discountBasisPoints > 0 ? "coupon" : "none",
            discount_percentage: storedInput.discountBasisPoints / 100,
            promotional_unit_amount_cents:
              recalculated.promotionalUnitAmountCents,
            promotional_monthly_amount_cents:
              recalculated.promotionalMonthlyRevenueCents,
            post_discount_monthly_amount_cents:
              recalculated.officialMonthlyRevenueCents,
            internal_justification:
              sanitizeString(
                simulation.internal_justification,
                1500,
              ) || null,
            public_token_hash: hashSalesOfferToken(token),
            commercial_notes:
              sanitizeString(simulation.internal_notes, 1500) || null,
            expires_at: expiresAt,
            created_by: actorUserId,
            idempotency_key: idempotencyKey,
          },
        ])
        .select(offerSelect)
        .single();
      if (insertError) {
        if (String(insertError.code || "") === "23505") {
          const { data: concurrentOffer, error: concurrentError } =
            await supabase
              .from("sales_offers")
              .select(offerSelect)
              .eq("simulation_id", simulationId)
              .maybeSingle();
          if (concurrentError) throw concurrentError;
          if (concurrentOffer) {
            const concurrentToken = deriveSalesOfferPublicToken(
              sanitizeString(concurrentOffer.created_by, 120),
              sanitizeString(concurrentOffer.idempotency_key, 240),
            );
            const readyConcurrent = await ensureStripeDiscount(
              concurrentOffer,
              simulation,
            );
            await finalizePreparedOffer(
              readyConcurrent,
              storedInput,
              recalculated,
            );
            return serializePreparedOffer(
              readyConcurrent,
              concurrentToken,
              true,
            );
          }
        }
        throw insertError;
      }

      const readyOffer = await ensureStripeDiscount(
        insertedOffer,
        simulation,
      );
      await finalizePreparedOffer(
        readyOffer,
        storedInput,
        recalculated,
      );
      return serializePreparedOffer(readyOffer, token, false);
    } catch (error: any) {
      const code = sanitizeString(
        error?.code || error?.message,
        160,
      );
      const expectedCodes = new Set([
        "CUSTOM_DISCOUNT_INVALID",
        "CUSTOM_DISCOUNT_STRIPE_UNAVAILABLE",
        "CUSTOM_DISCOUNT_MODE_MISMATCH",
        "CUSTOM_DISCOUNT_CREATION_FAILED",
        "CUSTOM_DISCOUNT_PERSISTENCE_FAILED",
        "OFFER_SIMULATION_CHANGED",
      ]);
      const publicCode = expectedCodes.has(code)
        ? code
        : "OFFER_SIMULATION_PREPARATION_FAILED";
      console.error(
        "[Owner Sales] Falha ao preparar oferta da simulação.",
        {
          leadId,
          simulationId,
          code: publicCode,
          message: sanitizeString(error?.message || String(error), 220),
        },
      );
      const status =
        code === "CUSTOM_DISCOUNT_INVALID"
          ? 422
          : code === "OFFER_SIMULATION_CHANGED"
            ? 409
            : code === "CUSTOM_DISCOUNT_STRIPE_UNAVAILABLE"
              || code === "CUSTOM_DISCOUNT_MODE_MISMATCH"
              || code === "CUSTOM_DISCOUNT_CREATION_FAILED"
              || code === "CUSTOM_DISCOUNT_PERSISTENCE_FAILED"
                ? 503
                : 500;
      const messages: Record<string, string> = {
        CUSTOM_DISCOUNT_INVALID:
          "O percentual ou a duração do desconto é inválido.",
        CUSTOM_DISCOUNT_STRIPE_UNAVAILABLE:
          "A Stripe está indisponível para preparar este desconto.",
        CUSTOM_DISCOUNT_MODE_MISMATCH:
          "O Price configurado não pertence ao mesmo ambiente Stripe.",
        CUSTOM_DISCOUNT_CREATION_FAILED:
          "Não foi possível criar o desconto personalizado. A simulação foi preservada.",
        CUSTOM_DISCOUNT_PERSISTENCE_FAILED:
          "A oferta foi reservada, mas sua persistência ainda precisa ser confirmada. Tente novamente.",
        OFFER_SIMULATION_CHANGED:
          "A simulação mudou. Salve uma nova versão antes de preparar a oferta.",
      };
      return res.status(status).json({
        success: false,
        code: publicCode,
        error:
          messages[publicCode]
          || "Não foi possível preparar a oferta agora.",
      });
    }
  };

  // END ITEM05 ORIGINAL PREPARATION

  // BEGIN ITEM05 ORIGINAL ROUTE
  app.post(
    "/api/owner/sales/offers",
    checkAuth,
    checkPlatformAdmin,
    async (req: any, res) => {
      const leadId = sanitizeString(req.body?.leadId, 120);
      const simulationId = sanitizeString(req.body?.simulationId, 120);
      const actorUserId = sanitizeString(req.session?.user?.id, 120);
      const contractEmail = sanitizeEmail(req.body?.contractEmail);
      const requestIdempotencyKey = sanitizeString(
        req.headers?.["x-idempotency-key"] || req.body?.idempotencyKey,
        180,
      );
      if (
        req.body?.stripeCouponId ||
        req.body?.couponId ||
        req.body?.stripePriceId ||
        req.body?.priceId
      ) {
        return res.status(400).json({
          success: false,
          error: "IDs Stripe não são aceitos pelo cliente.",
        });
      }
      if (simulationId) {
        const { data: simulationKind, error: simulationKindError } =
          await supabase
            .from("sales_offer_simulations")
            .select("simulation_type")
            .eq("id", simulationId)
            .eq("lead_id", leadId)
            .is("deleted_at", null)
            .maybeSingle();
        if (
          simulationKindError
          && !extractMissingColumnName(simulationKindError)
        ) {
          return res.status(500).json({
            success: false,
            code: "PROPOSAL_PREPARATION_FAILED",
            error: "Não foi possível validar o tipo da simulação.",
          });
        }
        if (
          sanitizeString(simulationKind?.simulation_type, 30)
            === "modular"
        ) {
          return prepareSalesModularOffer(req, res, {
            leadId,
            simulationId,
            actorUserId,
            idempotencyKey: requestIdempotencyKey,
            contractEmail,
          });
        }
        return prepareSalesOfferFromSimulation(req, res, {
          leadId,
          simulationId,
          actorUserId,
          idempotencyKey: requestIdempotencyKey,
        });
      }
      const quantity = normalizeSalesInteger(
        req.body?.initialActivePatientQuantity,
        SALES_ESTIMATED_ACTIVE_PATIENTS_MAX,
        true,
      );
      const rawDuration = req.body?.discountDurationMonths;
      const duration =
        rawDuration == null || Number(rawDuration) === 0
          ? null
          : Number(rawDuration);
      const expiresInDays = Math.max(
        1,
        Math.min(90, Number(req.body?.expiresInDays || 14)),
      );
      if (
        !isUuid(leadId) ||
        !isUuid(actorUserId) ||
        requestIdempotencyKey.length < 12 ||
        quantity === null ||
        quantity < 1 ||
        (duration !== null && !isCouponDurationMonths(duration))
      ) {
        return res
          .status(400)
          .json({ success: false, error: "Dados da oferta inválidos." });
      }
      try {
        const { data: lead } = await supabase
          .from("sales_leads")
          .select("id,status")
          .eq("id", leadId)
          .is("deleted_at", null)
          .maybeSingle();
        if (!lead)
          return res
            .status(404)
            .json({ success: false, error: "Lead não encontrado." });

        const token = deriveSalesOfferPublicToken(
          actorUserId,
          requestIdempotencyKey,
        );
        const tokenHash = hashSalesOfferToken(token);
        const stripeConfig = resolveSalesStripeConfiguration();
        const ready =
          stripeConfig.enabled && stripeConfig.readyForDuration(duration);

        const serializeOfferResponse = (offer: any, idempotent: boolean) => {
          const offerStatus = sanitizeString(offer?.status, 40);
          const linkAllowed =
            ready &&
            ["ready", "sent", "opened", "checkout_created"].includes(
              offerStatus,
            );
          return res.status(idempotent ? 200 : 201).json({
            success: true,
            offer,
            publicUrl: linkAllowed
              ? buildSalesOfferPublicUrl(req, token)
              : null,
            stripeReady: ready,
            idempotent,
            message: linkAllowed
              ? idempotent
                ? "Oferta já criada. O mesmo link individual foi recuperado."
                : "Oferta criada. O link individual está pronto para envio."
              : offerStatus === "draft"
                ? "Oferta salva como rascunho. Configuração Stripe pendente."
                : "Oferta já processada e preservada.",
          });
        };

        const offerSelect =
          "id,lead_id,status,base_unit_amount_cents,currency,initial_active_patient_quantity,discount_duration_months,discount_type,expires_at,created_at";
        const { data: existingOffer, error: existingOfferError } =
          await supabase
            .from("sales_offers")
            .select(offerSelect)
            .eq("created_by", actorUserId)
            .eq("idempotency_key", requestIdempotencyKey)
            .maybeSingle();
        if (existingOfferError) throw existingOfferError;
        if (existingOffer) return serializeOfferResponse(existingOffer, true);

        const expiresAt = new Date(
          Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: offer, error } = await supabase
          .from("sales_offers")
          .insert([
            {
              lead_id: leadId,
              status: ready ? "ready" : "draft",
              base_unit_amount_cents:
                PUBLIC_ACTIVE_PATIENT_PRICE.unitAmountCents,
              currency: PUBLIC_ACTIVE_PATIENT_PRICE.currency,
              initial_active_patient_quantity: quantity,
              discount_duration_months: duration,
              discount_type: duration ? "coupon" : "none",
              discount_percentage: null,
              public_token_hash: tokenHash,
              expires_at: expiresAt,
              created_by: actorUserId,
              idempotency_key: requestIdempotencyKey,
              commercial_notes: sanitizeString(req.body?.notes, 1500) || null,
            },
          ])
          .select(offerSelect)
          .single();
        if (error) {
          if (String(error?.code || "") === "23505") {
            const { data: concurrentOffer, error: concurrentError } =
              await supabase
                .from("sales_offers")
                .select(offerSelect)
                .eq("created_by", actorUserId)
                .eq("idempotency_key", requestIdempotencyKey)
                .maybeSingle();
            if (concurrentError) throw concurrentError;
            if (concurrentOffer)
              return serializeOfferResponse(concurrentOffer, true);
          }
          throw error;
        }
        await Promise.all([
          supabase
            .from("sales_leads")
            .update({
              status: "proposal_preparing",
              updated_at: new Date().toISOString(),
            })
            .eq("id", leadId),
          supabase.from("sales_lead_events").insert([
            {
              lead_id: leadId,
              event_type: "proposal_created",
              actor_user_id: actorUserId,
              metadata: { offer_id: offer.id, duration_months: duration },
              idempotency_key: `proposal-created:${offer.id}`,
            },
          ]),
        ]);
        return serializeOfferResponse(offer, false);
      } catch (error: any) {
        console.error(
          "[Owner Sales] Falha ao criar oferta:",
          sanitizeString(error?.message || String(error), 240),
        );
        return res
          .status(500)
          .json({ success: false, error: "Não foi possível criar a oferta." });
      }
    },
  );

  // END ITEM05 ORIGINAL ROUTE
};
