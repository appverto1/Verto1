import type { Express } from 'express';

/**
 * Item 06 — server-authoritative, anonymous offer read.
 * Original public projection, status changes, expiry checks and compatibility
 * fallbacks preserved exactly; registration occurs at the same point in server.ts.
 * The existing checkout/acceptance routes reuse the returned token loader.
 */
export const registerPublicSalesOfferReadRoute = (
  deps: { app: Express; [name: string]: any }
) => {
  const { app, supabase, publicSalesLeadIpLimiter, sanitizeString, hashSalesOfferToken, extractMissingColumnName, isMissingRelationError, salesOfferPublicStatusAllowed, salesOfferUsesCustomerFacingModulesOnly, isSalesInternalCommercialItemKey, PUBLIC_ACTIVE_PATIENT_PRICE, resolveStripeEnvironment, validateStripeSecretForEnvironment, resolveSalesStripeConfiguration, isSalesOfferStripeReady } = deps;

  const sanitizePublicOfferDiscount = (raw: any) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return {
      type: sanitizeString(raw.type, 30),
      percentageBasisPoints:
        raw.percentageBasisPoints == null
          ? undefined
          : Number(raw.percentageBasisPoints),
      amountOffCents:
        raw.amountOffCents == null ? undefined : Number(raw.amountOffCents),
      startsAt: sanitizeString(raw.startsAt, 80),
      endsAt: sanitizeString(raw.endsAt, 80) || null,
      durationCount:
        raw.durationCount == null ? undefined : Number(raw.durationCount),
      durationUnit: sanitizeString(raw.durationUnit, 30) || undefined,
      priceBeforeDiscountCents: Number(raw.priceBeforeDiscountCents || 0),
      discountedPriceCents: Number(raw.discountedPriceCents || 0),
      priceAfterExpirationCents: Number(
        raw.priceAfterExpirationCents || 0,
      ),
      reason: sanitizeString(raw.reason, 300),
      status: sanitizeString(raw.status, 30),
    };
  };

  const sanitizePublicModularMetadata = (raw: any) => {
    const source =
      raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      tierName: sanitizeString(source.tierName, 120) || null,
      unitName: sanitizeString(source.unitName, 80) || null,
      includedQuantity:
        source.includedQuantity == null
          ? null
          : Number(source.includedQuantity),
      maximumQuantity:
        source.maximumQuantity == null
          ? null
          : Number(source.maximumQuantity),
      pricePerPatientCents:
        source.pricePerPatientCents == null
          ? null
          : Number(source.pricePerPatientCents),
      billedCapacityPatients:
        source.billedCapacityPatients == null
          ? null
          : Number(source.billedCapacityPatients),
      pricingBasis:
        sanitizeString(source.pricingBasis, 40) || "catalog_snapshot",
      features: Array.isArray(source.features)
        ? source.features
            .map((feature: unknown) => sanitizeString(feature, 160))
            .filter(Boolean)
            .slice(0, 30)
        : [],
    };
  };

  const sanitizePublicCommercialPhases = (raw: any) =>
    Array.isArray(raw)
      ? raw.slice(0, 50).map((phase: any, index: number) => ({
          phaseNumber: Number(phase?.phaseNumber || index + 1),
          startsAt: sanitizeString(phase?.startsAt, 80),
          endsAt: sanitizeString(phase?.endsAt, 80) || null,
          lines: Array.isArray(phase?.lines)
            ? phase.lines.slice(0, 50).map((line: any) => ({
                itemKey: sanitizeString(line?.itemKey, 80),
                publicName: sanitizeString(line?.publicName, 120),
                billingInterval:
                  sanitizeString(line?.billingInterval, 30) === "one_time"
                    ? "one_time"
                    : "monthly",
                normalPriceCents: Number(line?.normalPriceCents || 0),
                activePriceCents: Number(line?.activePriceCents || 0),
                discountCents: Number(line?.discountCents || 0),
                itemDiscountCents: Number(line?.itemDiscountCents || 0),
                globalDiscountCents: Number(
                  line?.globalDiscountCents || 0,
                ),
                discount: sanitizePublicOfferDiscount(line?.discount),
              }))
            : [],
          recurringRevenueCents: Number(phase?.recurringRevenueCents || 0),
          invoiceAmountCents: Number(phase?.invoiceAmountCents || 0),
        }))
      : [];

  const sanitizePublicCapacityBlockPhases = (raw: any) =>
    Array.isArray(raw)
      ? raw.slice(0, 50).map((phase: any, index: number) => ({
          schemaVersion: 1,
          phaseNumber: Number(phase?.phaseNumber || index + 1),
          startsAt: sanitizeString(phase?.startsAt, 80),
          endsAt: sanitizeString(phase?.endsAt, 80) || null,
          baseCapacityPatients: Number(
            phase?.baseCapacityPatients || 0,
          ),
          contractedCapacityPatients: Number(
            phase?.contractedCapacityPatients || 0,
          ),
          blockSizePatients: Number(phase?.blockSizePatients || 0),
          selectedBlocks: Number(phase?.selectedBlocks || 0),
          effectivePricePerPatientCents: Number(
            phase?.effectivePricePerPatientCents || 0,
          ),
          contractedMonthlyRevenueCents: Number(
            phase?.contractedMonthlyRevenueCents || 0,
          ),
          blockPriceCents: Number(phase?.blockPriceCents || 0),
          blocksRevenueCents: Number(phase?.blocksRevenueCents || 0),
          modules: Array.isArray(phase?.modules)
            ? phase.modules.slice(0, 50).map((module: any) => ({
                itemKey: sanitizeString(module?.itemKey, 80),
                publicName: sanitizeString(module?.publicName, 120),
                normalPricePerPatientCents: Number(
                  module?.normalPricePerPatientCents || 0,
                ),
                effectivePricePerPatientCents: Number(
                  module?.effectivePricePerPatientCents || 0,
                ),
                normalBlockRevenueCents: Number(
                  module?.normalBlockRevenueCents || 0,
                ),
                blockRevenueCents: Number(
                  module?.blockRevenueCents || 0,
                ),
                subsidizedBlockRevenueCents: Number(
                  module?.subsidizedBlockRevenueCents || 0,
                ),
              }))
            : [],
        }))
      : [];

  const sanitizePublicBasePackage = (raw: any) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const capacity =
      raw.capacity
      && typeof raw.capacity === "object"
      && !Array.isArray(raw.capacity)
        ? raw.capacity
        : null;
    return {
      itemKey: "clinical_core",
      tierId: sanitizeString(raw.tierId, 120),
      name: sanitizeString(raw.name, 120),
      limitQuantity:
        raw.limitQuantity == null ? null : Number(raw.limitQuantity),
      includedStorageMb:
        raw.includedStorageMb == null ? null : Number(raw.includedStorageMb),
      occupiedQuantity: Number(raw.occupiedQuantity || 0),
      availableQuantity:
        raw.availableQuantity == null ? null : Number(raw.availableQuantity),
      capacity: capacity
        ? {
            schemaVersion: Number(capacity.schemaVersion || 1),
            demandPatients: Number(capacity.demandPatients || 0),
            baseLimitPatients: Number(capacity.baseLimitPatients || 0),
            basePriceCents: Number(capacity.basePriceCents || 0),
            minimumBlocks: Number(capacity.minimumBlocks || 0),
            selectedBlocks: Number(capacity.selectedBlocks || 0),
            selectionMode:
              sanitizeString(capacity.selectionMode, 20) === "manual"
                ? "manual"
                : "automatic",
            addedCapacityPatients: Number(
              capacity.addedCapacityPatients || 0,
            ),
            totalContractedLimitPatients: Number(
              capacity.totalContractedLimitPatients || 0,
            ),
            includedStorageMb: Number(capacity.includedStorageMb || 0),
            blocksMonthlyRevenueCents: Number(
              capacity.blocksMonthlyRevenueCents || 0,
            ),
            effectiveBlockPriceCents:
              capacity.effectiveBlockPriceCents != null
                ? Number(capacity.effectiveBlockPriceCents)
                : capacity.policy?.blockPriceCents != null
                  ? Number(capacity.policy.blockPriceCents)
                  : null,
            blockPricingBasis:
              sanitizeString(capacity.blockPricingBasis, 80)
              || "catalog_fixed",
            blockSizePatients: Number(
              capacity.policy?.blockSizePatients || 0,
            ),
            gracePeriodDays: Number(
              capacity.policy?.gracePeriodDays || 0,
            ),
            billingAdjustment: "next_cycle",
          }
        : null,
    };
  };

  const loadPublicSalesOffer = async (token: string) => {
    const safeToken = sanitizeString(token, 256);
    if (safeToken.length < 32) return { error: "invalid_token" as const };
    const tokenHash = hashSalesOfferToken(safeToken);
    const extendedOfferSelect =
      "id,lead_id,status,base_unit_amount_cents,currency,initial_active_patient_quantity,discount_duration_months,discount_type,discount_percentage,stripe_coupon_id,promotional_unit_amount_cents,promotional_monthly_amount_cents,post_discount_monthly_amount_cents,stripe_checkout_session_id,expires_at,revoked_at,accepted_at,offer_type,proposal_name,public_notes,modular_checkout_enabled,modular_snapshot,catalog_version_id,trial_days,created_by";
    const legacyOfferSelect =
      "id,lead_id,status,base_unit_amount_cents,currency,initial_active_patient_quantity,discount_duration_months,discount_type,discount_percentage,stripe_coupon_id,promotional_unit_amount_cents,promotional_monthly_amount_cents,post_discount_monthly_amount_cents,stripe_checkout_session_id,expires_at,revoked_at,accepted_at";
    let offerResult = await supabase
      .from("sales_offers")
      .select(extendedOfferSelect)
      .eq("public_token_hash", tokenHash)
      .maybeSingle();
    if (
      offerResult.error
      && (extractMissingColumnName(offerResult.error)
        || isMissingRelationError(offerResult.error))
    ) {
      offerResult = await supabase
        .from("sales_offers")
        .select(legacyOfferSelect)
        .eq("public_token_hash", tokenHash)
        .maybeSingle();
    }
    const { data: offer, error } = offerResult;
    if (error || !offer) return { error: "not_found" as const };
    const isModularOffer =
      sanitizeString((offer as any).offer_type, 30) === "modular";
    const expiresAt = new Date(String(offer.expires_at || "")).getTime();
    if (
      !salesOfferPublicStatusAllowed(offer.status) ||
      offer.revoked_at ||
      (offer.accepted_at && !isModularOffer) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return { error: "unavailable" as const };
    }
    const { data: lead } = await supabase
      .from("sales_leads")
      .select("id,name,email,clinic_name,normalized_email,normalized_phone")
      .eq("id", offer.lead_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lead) return { error: "not_found" as const };
    let modularItems: any[] = [];
    if (sanitizeString((offer as any).offer_type, 30) === "modular") {
      const { data: itemRows, error: itemError } = await supabase
        .from("sales_offer_items")
        .select(
          "item_key,public_name_snapshot,public_description_snapshot,pricing_mode_snapshot,quantity,limit_quantity,included_quantity,gross_recurring_amount_cents,recurring_amount_cents,post_promotion_recurring_amount_cents,one_time_amount_cents,item_discount_basis_points,allocated_global_discount_cents,public_metadata,sort_order",
        )
        .eq("offer_id", offer.id)
        .order("sort_order", { ascending: true });
      if (itemError) return { error: "not_found" as const };
      modularItems = itemRows || [];
    }
    return {
      offer,
      lead,
      modularItems,
      tokenHash,
      token: safeToken,
    };
  };

  app.get(
    "/api/public/sales-offers/:token",
    publicSalesLeadIpLimiter,
    async (req: any, res) => {
      try {
        const loaded = await loadPublicSalesOffer(req.params?.token);
        if ("error" in loaded) {
          return res.status(loaded.error === "invalid_token" ? 400 : 404).json({
            success: false,
            error: "OFFER_UNAVAILABLE",
            message: "Esta oferta não está disponível ou expirou.",
          });
        }
        const { offer, lead, modularItems } = loaded;
        const offerType = sanitizeString(
          (offer as any).offer_type,
          30,
        ) || "legacy";
        if (offerType === "modular") {
          const modularSnapshot =
            (offer as any).modular_snapshot
            && typeof (offer as any).modular_snapshot === "object"
              ? (offer as any).modular_snapshot
              : {};
          const customerFacingModulesOnly =
            salesOfferUsesCustomerFacingModulesOnly(modularSnapshot);
          const customerFacingItems = customerFacingModulesOnly
            ? (modularItems || []).filter(
                (item: any) =>
                  !isSalesInternalCommercialItemKey(item?.item_key),
              )
            : modularItems || [];
          const internalItemHasBillableValue = customerFacingModulesOnly
            && (modularItems || []).some((item: any) => {
              if (!isSalesInternalCommercialItemKey(item?.item_key)) return false;
              return [
                item?.gross_recurring_amount_cents,
                item?.recurring_amount_cents,
                item?.post_promotion_recurring_amount_cents,
                item?.one_time_amount_cents,
              ].some((value) => Number(value || 0) !== 0);
            });
          const customerFacingCommercialPhases = customerFacingModulesOnly
            && Array.isArray(modularSnapshot.commercialPhases)
              ? modularSnapshot.commercialPhases.map((phase: any) => ({
                  ...phase,
                  lines: Array.isArray(phase?.lines)
                    ? phase.lines.filter(
                        (line: any) =>
                          !isSalesInternalCommercialItemKey(line?.itemKey),
                      )
                    : [],
                }))
              : modularSnapshot.commercialPhases;
          if (internalItemHasBillableValue) {
            console.error(
              "[Sales Offer] Item interno com valor comercial em proposta customer-facing.",
              { offerId: sanitizeString(offer.id, 120) },
            );
            return res.status(409).json({
              success: false,
              error: "OFFER_UNAVAILABLE",
              message:
                "Esta proposta precisa ser regenerada antes de ser apresentada ao cliente.",
            });
          }
          if (
            sanitizeString(offer.status, 40) === "ready"
            || sanitizeString(offer.status, 40) === "sent"
          ) {
            await supabase
              .from("sales_offers")
              .update({
                status: "opened",
                updated_at: new Date().toISOString(),
              })
              .eq("id", offer.id)
              .in("status", ["ready", "sent"]);
          }
          return res.json({
            success: true,
            offer: {
              offerType: "modular",
              proposalName:
                sanitizeString((offer as any).proposal_name, 120)
                || "Proposta Verto",
              leadName: sanitizeString(lead.name, 180),
              clinicName: sanitizeString(lead.clinic_name, 180) || null,
              currency:
                sanitizeString(offer.currency, 12)
                || PUBLIC_ACTIVE_PATIENT_PRICE.currency,
              initialActivePatientQuantity: Number(
                offer.initial_active_patient_quantity || 1,
              ),
              basePackage: sanitizePublicBasePackage(
                modularSnapshot.basePackage,
              ),
              items: customerFacingItems.map((item: any) => ({
                itemKey: sanitizeString(item.item_key, 80),
                publicName: sanitizeString(
                  item.public_name_snapshot,
                  120,
                ),
                description: sanitizeString(
                  item.public_description_snapshot,
                  4000,
                ),
                pricingMode: sanitizeString(
                  item.pricing_mode_snapshot,
                  40,
                ),
                quantity: Number(item.quantity || 0),
                limitQuantity:
                  item.limit_quantity == null
                    ? null
                    : Number(item.limit_quantity),
                includedQuantity:
                  item.included_quantity == null
                    ? null
                    : Number(item.included_quantity),
                grossRecurringAmountCents: Number(
                  item.gross_recurring_amount_cents || 0,
                ),
                promotionalRecurringAmountCents: Number(
                  item.recurring_amount_cents || 0,
                ),
                postPromotionRecurringAmountCents: Number(
                  item.post_promotion_recurring_amount_cents || 0,
                ),
                oneTimeAmountCents: Number(
                  item.one_time_amount_cents || 0,
                ),
                itemDiscountBasisPoints: Number(
                  item.item_discount_basis_points || 0,
                ),
                offerDiscount:
                  item.public_metadata?.offerDiscount
                  && typeof item.public_metadata.offerDiscount === "object"
                    ? sanitizePublicOfferDiscount(
                        item.public_metadata.offerDiscount,
                      )
                    : null,
                publicMetadata: sanitizePublicModularMetadata(
                  item.public_metadata,
                ),
              })),
              promotionalMonthlyAmountCents: Number(
                modularSnapshot.promotionalRecurringRevenueCents || 0,
              ),
              postDiscountMonthlyAmountCents: Number(
                modularSnapshot.postPromotionRecurringRevenueCents || 0,
              ),
              oneTimeAmountCents: Number(
                modularSnapshot.oneTimeRevenueCents || 0,
              ),
              globalDiscountCents: Number(
                modularSnapshot.globalDiscountCents || 0,
              ),
              globalDiscountPercentage:
                offer.discount_percentage == null
                  ? 0
                  : Number(offer.discount_percentage),
              discountDurationMonths: Number(
                modularSnapshot.discountDurationMonths || 0,
              ),
              onboardingInstallments: Number(
                modularSnapshot.onboardingInstallments || 1,
              ),
              publicNotes:
                sanitizeString((offer as any).public_notes, 1500) || null,
              expiresAt: offer.expires_at,
              status: offer.status,
              acceptedAt: offer.accepted_at || null,
              commercialPhases: sanitizePublicCommercialPhases(
                modularSnapshot.commercialPhases,
              ),
              capacityBlockPhases: sanitizePublicCapacityBlockPhases(
                modularSnapshot.commercialPricing?.capacityBlockPhases,
              ),
              modularCheckoutEnabled:
                (offer as any).modular_checkout_enabled === true,
              stripeReady: (() => {
                try {
                  const stripeEnvironment = resolveStripeEnvironment();
                  validateStripeSecretForEnvironment(stripeEnvironment);
                  return (offer as any).modular_checkout_enabled === true;
                } catch {
                  return false;
                }
              })(),
              trialDays: [0, 7, 14, 30].includes(Number((offer as any).trial_days || 0))
                ? Number((offer as any).trial_days || 0)
                : 0,
            },
          });
        }
        const stripeConfig = resolveSalesStripeConfiguration();
        const duration = Number(offer.discount_duration_months || 0) || null;
        const baseUnitAmountCents = Number(
          offer.base_unit_amount_cents ||
            PUBLIC_ACTIVE_PATIENT_PRICE.unitAmountCents,
        );
        const quantity = Number(offer.initial_active_patient_quantity || 1);
        const discountPercentage =
          offer.discount_percentage == null
            ? null
            : Number(offer.discount_percentage);
        const promotionalUnitAmountCents = Number(
          offer.promotional_unit_amount_cents ??
            Math.round(
              baseUnitAmountCents
                * (100 - Number(discountPercentage || 0))
                / 100,
            ),
        );
        const promotionalMonthlyAmountCents = Number(
          offer.promotional_monthly_amount_cents ??
            promotionalUnitAmountCents * quantity,
        );
        const postDiscountMonthlyAmountCents = Number(
          offer.post_discount_monthly_amount_cents ??
            baseUnitAmountCents * quantity,
        );
        if (
          sanitizeString(offer.status, 40) === "ready" ||
          sanitizeString(offer.status, 40) === "sent"
        ) {
          await supabase
            .from("sales_offers")
            .update({ status: "opened", updated_at: new Date().toISOString() })
            .eq("id", offer.id)
            .in("status", ["ready", "sent"]);
          await supabase
            .from("sales_lead_events")
            .upsert(
              [
                {
                  lead_id: lead.id,
                  event_type: "proposal_sent",
                  metadata: { source: "public_offer_opened" },
                  idempotency_key: `offer-opened:${offer.id}`,
                },
              ],
              { onConflict: "idempotency_key", ignoreDuplicates: true },
            )
            .then(
              () => undefined,
              () => undefined,
            );
        }
        return res.json({
          success: true,
          offer: {
            offerType: "legacy",
            leadName: sanitizeString(lead.name, 180),
            clinicName: sanitizeString(lead.clinic_name, 180) || null,
            baseUnitAmountCents,
            currency:
              sanitizeString(offer.currency, 12) ||
              PUBLIC_ACTIVE_PATIENT_PRICE.currency,
            initialActivePatientQuantity: quantity,
            discountType:
              sanitizeString(offer.discount_type, 20) === "coupon"
                ? "coupon"
                : "none",
            discountDurationMonths: duration,
            discountPercentage,
            promotionalUnitAmountCents,
            promotionalMonthlyAmountCents,
            postDiscountMonthlyAmountCents,
            expiresAt: offer.expires_at,
            status: offer.status,
            stripeReady: isSalesOfferStripeReady(offer, stripeConfig),
          },
        });
      } catch (error: any) {
        console.warn(
          "[Sales Offer] Falha ao carregar oferta pública:",
          sanitizeString(error?.message || String(error), 240),
        );
        return res.status(404).json({
          success: false,
          error: "OFFER_UNAVAILABLE",
          message: "Esta oferta não está disponível.",
        });
      }
    },
  );

  return loadPublicSalesOffer;
};
