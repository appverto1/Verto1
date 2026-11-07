import type { Express } from 'express';

// Task 06: server-owned public offer projection. The token lookup, expiry,
// status guards and frozen-snapshot sanitization remain in the original order.
// Checkout/acceptance and the DB loader remain separate and unchanged.
export const registerPublicSalesOfferReadRoute = (
  deps: { app: Express; [key: string]: any }
) => {
  const { app, publicSalesLeadIpLimiter, loadPublicSalesOffer, sanitizeString, salesOfferUsesCustomerFacingModulesOnly, isSalesInternalCommercialItemKey, sanitizePublicBasePackage, sanitizePublicOfferDiscount, sanitizePublicModularMetadata, sanitizePublicCommercialPhases, sanitizePublicCapacityBlockPhases, resolveStripeEnvironment, validateStripeSecretForEnvironment, resolveSalesStripeConfiguration, PUBLIC_ACTIVE_PATIENT_PRICE, isSalesOfferStripeReady, supabase } = deps;
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

};
