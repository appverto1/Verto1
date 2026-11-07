import type Stripe from 'stripe';
import crypto from 'crypto';
// Item 09: Stripe schedule; original audited statements retained unchanged.
export const createSalesModularSubscriptionSchedule = (deps: Record<string, any>) => {
  const { processSalesAssistedCheckoutCompleted, resolveStripeEnvironment, resolveStripeSubscriptionCurrentPeriod, sanitizeString, supabase, validateStripeSecretForEnvironment } = deps;
  // ITEM09_SOURCE_BEGIN
  const stripeExpandableId = (value: unknown, maxLength = 200) => {
    if (typeof value === "string") return sanitizeString(value, maxLength);
    if (value && typeof value === "object") {
      return sanitizeString((value as any).id, maxLength);
    }
    return "";
  };

  const sanitizeStripeScheduleMetadata = (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .map(([key, value]) => [
          sanitizeString(key, 80),
          sanitizeString(value, 500),
        ])
        .filter(([key]) => Boolean(key)),
    );
  };

  const preserveStripeSchedulePhaseForUpdate = (phase: any) => {
    const startDate = Number(phase?.start_date || 0);
    const endDate = Number(phase?.end_date || 0);
    const sourceItems = Array.isArray(phase?.items) ? phase.items : [];
    if (!Number.isFinite(startDate) || startDate <= 0 || sourceItems.length === 0) {
      throw new Error("MODULAR_SCHEDULE_CURRENT_PHASE_INVALID");
    }

    const items = sourceItems.map((item: any) => {
      const priceId = stripeExpandableId(item?.price || item?.plan, 200);
      if (!priceId) throw new Error("MODULAR_SCHEDULE_PHASE_PRICE_MISSING");
      const quantity = Number(item?.quantity);
      const taxRates = Array.isArray(item?.tax_rates)
        ? item.tax_rates
            .map((rate: any) => stripeExpandableId(rate, 200))
            .filter(Boolean)
        : [];
      const itemMetadata = sanitizeStripeScheduleMetadata(item?.metadata);
      const preservedItem: Record<string, any> = {
        price: priceId,
        ...(Number.isFinite(quantity) && quantity > 0
          ? { quantity: Math.floor(quantity) }
          : {}),
        ...(taxRates.length > 0 ? { tax_rates: taxRates } : {}),
        ...(Object.keys(itemMetadata).length > 0
          ? { metadata: itemMetadata }
          : {}),
      };
      if (item?.billing_thresholds && typeof item.billing_thresholds === "object") {
        preservedItem.billing_thresholds = item.billing_thresholds;
      }
      if (Array.isArray(item?.discounts) && item.discounts.length > 0) {
        // The modular assisted Checkout currently prices discounts directly into
        // Stripe Prices. Silently dropping an externally attached item discount
        // here would change the contract, so fail closed instead.
        throw new Error("MODULAR_SCHEDULE_EXISTING_ITEM_DISCOUNT_REVIEW_REQUIRED");
      }
      return preservedItem;
    });

    const preserved: Record<string, any> = {
      start_date: startDate,
      ...(Number.isFinite(endDate) && endDate > startDate
        ? { end_date: endDate }
        : {}),
      items,
    };

    const prorationBehavior = sanitizeString(phase?.proration_behavior, 40);
    if (["create_prorations", "none", "always_invoice"].includes(prorationBehavior)) {
      preserved.proration_behavior = prorationBehavior;
    }
    const trialEnd = Number(phase?.trial_end || 0);
    if (Number.isFinite(trialEnd) && trialEnd > 0) {
      preserved.trial_end = trialEnd;
    }
    const collectionMethod = sanitizeString(phase?.collection_method, 40);
    if (["charge_automatically", "send_invoice"].includes(collectionMethod)) {
      preserved.collection_method = collectionMethod;
    }
    const defaultPaymentMethod = stripeExpandableId(
      phase?.default_payment_method,
      200,
    );
    if (defaultPaymentMethod) {
      preserved.default_payment_method = defaultPaymentMethod;
    }
    if (Array.isArray(phase?.default_tax_rates) && phase.default_tax_rates.length > 0) {
      preserved.default_tax_rates = phase.default_tax_rates
        .map((rate: any) => stripeExpandableId(rate, 200))
        .filter(Boolean);
    }
    if (phase?.billing_thresholds && typeof phase.billing_thresholds === "object") {
      preserved.billing_thresholds = phase.billing_thresholds;
    }
    if (phase?.invoice_settings && typeof phase.invoice_settings === "object") {
      preserved.invoice_settings = phase.invoice_settings;
    }
    if (typeof phase?.application_fee_percent === "number") {
      preserved.application_fee_percent = phase.application_fee_percent;
    }
    const onBehalfOf = stripeExpandableId(phase?.on_behalf_of, 200);
    if (onBehalfOf) preserved.on_behalf_of = onBehalfOf;
    if (phase?.transfer_data && typeof phase.transfer_data === "object") {
      preserved.transfer_data = phase.transfer_data;
    }
    const description = sanitizeString(phase?.description, 500);
    if (description) preserved.description = description;
    const phaseMetadata = sanitizeStripeScheduleMetadata(phase?.metadata);
    if (Object.keys(phaseMetadata).length > 0) {
      preserved.metadata = phaseMetadata;
    }
    if (Array.isArray(phase?.discounts) && phase.discounts.length > 0) {
      throw new Error("MODULAR_SCHEDULE_EXISTING_PHASE_DISCOUNT_REVIEW_REQUIRED");
    }
    if (Array.isArray(phase?.add_invoice_items) && phase.add_invoice_items.length > 0) {
      throw new Error("MODULAR_SCHEDULE_EXISTING_INVOICE_ITEM_REVIEW_REQUIRED");
    }
    return preserved;
  };

  const buildStripeScheduleContinuationPhase = (
    preservedCurrentPhase: Record<string, any>,
    startDate: number,
    endDate: number,
    metadata: Record<string, string>,
  ) => {
    const continuation: Record<string, any> = {
      ...preservedCurrentPhase,
      start_date: startDate,
      end_date: endDate,
      items: Array.isArray(preservedCurrentPhase.items)
        ? preservedCurrentPhase.items.map((item: any) => ({ ...item }))
        : [],
      metadata: {
        ...(preservedCurrentPhase.metadata || {}),
        ...metadata,
      },
    };
    if (
      Number(continuation.trial_end || 0) > 0
      && Number(continuation.trial_end) <= startDate
    ) {
      delete continuation.trial_end;
    }
    return continuation;
  };

  const normalizeModularSchedulePhaseBoundaries = (
    phases,
    stripeCurrentPeriodEnd,
    importedCurrentEnd,
  ) => {
    if (!Array.isArray(phases) || phases.length <= 1) {
      return {
        firstPlanEnd: null,
        effectiveFirstTransitionEnd: null,
        boundaryShiftSeconds: 0,
        futurePhases: [],
      };
    }

    const firstPlanEnd = phases[0]?.endsAt
      ? Math.floor(Date.parse(phases[0].endsAt) / 1000)
      : 0;
    if (!Number.isFinite(firstPlanEnd) || firstPlanEnd <= 0) {
      throw new Error("MODULAR_SCHEDULE_FIRST_PHASE_END_MISSING");
    }
    if (
      !Number.isFinite(stripeCurrentPeriodEnd)
      || stripeCurrentPeriodEnd <= 0
    ) {
      throw new Error("MODULAR_SUBSCRIPTION_CURRENT_PERIOD_END_MISSING");
    }
    if (!Number.isFinite(importedCurrentEnd) || importedCurrentEnd <= 0) {
      throw new Error("MODULAR_SCHEDULE_CURRENT_PHASE_END_MISSING");
    }

    // The imported Schedule can legitimately be longer than the Subscription's
    // current period when a previous idempotent reconciliation already added a
    // continuation. It must never be shorter than Stripe's canonical period.
    if (importedCurrentEnd < stripeCurrentPeriodEnd - 1) {
      throw new Error("MODULAR_SCHEDULE_CURRENT_PHASE_BEFORE_SUBSCRIPTION_PERIOD_END");
    }

    const effectiveFirstTransitionEnd = Math.max(
      firstPlanEnd,
      stripeCurrentPeriodEnd,
      importedCurrentEnd,
    );
    if (effectiveFirstTransitionEnd < stripeCurrentPeriodEnd - 1) {
      // Preserve the original safety invariant: a commercial phase may never
      // truncate the billing period already created and paid in Stripe.
      throw new Error("MODULAR_SCHEDULE_PHASE_BOUNDARY_BEFORE_CURRENT_PERIOD_END");
    }

    // Frozen commercial timestamps are based on the offer/Checkout preparation
    // instant (T0). Stripe anchors the real subscription when Checkout completes
    // (T1). If T1 is later, translate all future boundaries by the same delta so
    // durations and prices remain frozen while the first transition lands on the
    // real Stripe billing boundary. This changes no commercial amount or module.
    const boundaryShiftSeconds = Math.max(
      0,
      effectiveFirstTransitionEnd - firstPlanEnd,
    );
    const futurePhases = phases.slice(1).map((phase, index) => {
      const originalStart = phase?.startsAt
        ? Math.floor(Date.parse(phase.startsAt) / 1000)
        : 0;
      const originalEnd = phase?.endsAt
        ? Math.floor(Date.parse(phase.endsAt) / 1000)
        : null;
      if (!Number.isFinite(originalStart) || originalStart <= 0) {
        throw new Error("MODULAR_SCHEDULE_FUTURE_PHASE_START_INVALID");
      }
      const startDate = originalStart + boundaryShiftSeconds;
      const endDate = originalEnd === null
        ? null
        : originalEnd + boundaryShiftSeconds;
      if (endDate !== null && (!Number.isFinite(endDate) || endDate <= startDate)) {
        throw new Error("MODULAR_SCHEDULE_FUTURE_PHASE_END_INVALID");
      }
      return { phase, index, startDate, endDate };
    });

    return {
      firstPlanEnd,
      effectiveFirstTransitionEnd,
      boundaryShiftSeconds,
      futurePhases,
    };
  };

  const ensureModularSubscriptionSchedule = async (
    stripe: Stripe,
    session: Stripe.Checkout.Session,
  ) => {
    const metadata = (session.metadata || {}) as Record<string, string>;
    if (sanitizeString(metadata.flowType, 80) !== "sales_modular_assisted") {
      return null;
    }

    const stripeEnvironment = resolveStripeEnvironment();
    validateStripeSecretForEnvironment(stripeEnvironment);
    if (sanitizeString(metadata.environment, 20) !== stripeEnvironment) {
      throw new Error("MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH");
    }

    const subscriptionId = sanitizeString(String(session.subscription || ""), 200);
    if (!subscriptionId) throw new Error("MODULAR_SUBSCRIPTION_MISSING");

    const { data: link, error: linkError } = await supabase
      .from("sales_checkout_links")
      .select("id,offer_id,lead_id,status,environment,stripe_subscription_id,stripe_schedule_id,checkout_plan_snapshot")
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();
    if (linkError || !link) {
      throw linkError || new Error("MODULAR_CHECKOUT_LINK_MISSING");
    }

    if (
      sanitizeString(link.offer_id, 120) !== sanitizeString(metadata.offerId, 120)
      || sanitizeString(link.lead_id, 120) !== sanitizeString(metadata.leadId, 120)
      || sanitizeString(link.environment, 20) !== stripeEnvironment
    ) {
      throw new Error("MODULAR_CHECKOUT_RECONCILIATION_MISMATCH");
    }

    const storedSubscriptionId = sanitizeString(link.stripe_subscription_id, 200);
    if (storedSubscriptionId && storedSubscriptionId !== subscriptionId) {
      throw new Error("MODULAR_SUBSCRIPTION_LINKAGE_INVALID");
    }

    // Persist Checkout -> Subscription before touching a Schedule. This closes
    // the webhook-ordering window where invoice.paid can otherwise arrive while
    // the local checkout link still has no subscription id.
    const canonicalLinkStatus = sanitizeString(link.status, 40) === "completed"
      ? "completed"
      : "payment_pending";
    const { data: persistedLink, error: subscriptionPersistError } = await supabase
      .from("sales_checkout_links")
      .update({
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: sanitizeString(String(session.customer || ""), 200) || null,
        status: canonicalLinkStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id)
      .or(`stripe_subscription_id.is.null,stripe_subscription_id.eq.${subscriptionId}`)
      .select("id,stripe_subscription_id")
      .maybeSingle();
    if (subscriptionPersistError) throw subscriptionPersistError;
    if (
      !persistedLink
      || sanitizeString(persistedLink.stripe_subscription_id, 200) !== subscriptionId
    ) {
      throw new Error("MODULAR_SUBSCRIPTION_LINKAGE_CONFLICT");
    }

    const plan = link.checkout_plan_snapshot || {};
    const phases = Array.isArray(plan.schedulePhases) ? plan.schedulePhases : [];
    if (phases.length <= 1) return null;

    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price.product"],
    } as any);
    const subscriptionMetadata = (subscription.metadata || {}) as Record<string, string>;
    const subscriptionCustomerId = stripeExpandableId(subscription.customer, 200);
    const checkoutCustomerId = stripeExpandableId(session.customer, 200);
    if (
      sanitizeString(subscriptionMetadata.flowType, 80) !== "sales_modular_assisted"
      || sanitizeString(subscriptionMetadata.offerId, 120) !== sanitizeString(link.offer_id, 120)
      || sanitizeString(subscriptionMetadata.leadId, 120) !== sanitizeString(link.lead_id, 120)
      || sanitizeString(subscriptionMetadata.environment, 20) !== stripeEnvironment
      || (checkoutCustomerId && subscriptionCustomerId && checkoutCustomerId !== subscriptionCustomerId)
    ) {
      throw new Error("MODULAR_SUBSCRIPTION_METADATA_MISMATCH");
    }

    // P0000: recurring invoice webhooks must not reset the live seat quantity.
    if (sanitizeString(subscriptionMetadata.billingModel, 100) === "modular_exact_per_patient_v1") {
      const { data: activeExactContract, error: exactContractError } = await supabase
        .from("organization_billing_contracts")
        .select("id,organization_id,sales_offer_id,stripe_subscription_id,stripe_schedule_id,status,source_snapshot")
        .eq("sales_offer_id", sanitizeString(link.offer_id, 120))
        .eq("stripe_subscription_id", subscriptionId)
        .eq("status", "active")
        .maybeSingle();
      if (exactContractError) throw exactContractError;
      if (activeExactContract) {
        if (
          activeExactContract.source_snapshot?.billingModelVersion !== "modular_exact_per_patient_v1" ||
          sanitizeString(activeExactContract.sales_offer_id, 120) !== sanitizeString(link.offer_id, 120)
        ) throw new Error("MODULAR_EXACT_CONTRACT_REPLAY_SCOPE_INVALID");
        const liveScheduleId = stripeExpandableId((subscription as any)?.schedule, 200);
        const acceptedScheduleId = sanitizeString(activeExactContract.stripe_schedule_id, 200);
        const linkScheduleId = sanitizeString(link.stripe_schedule_id, 200);
        if (
          (acceptedScheduleId && liveScheduleId && acceptedScheduleId !== liveScheduleId) ||
          (linkScheduleId && liveScheduleId && linkScheduleId !== liveScheduleId)
        ) throw new Error("MODULAR_EXACT_SCHEDULE_REPLAY_LINKAGE_CONFLICT");
        const scheduleId = liveScheduleId || acceptedScheduleId || linkScheduleId;
        if (!scheduleId) throw new Error("MODULAR_EXACT_SCHEDULE_REPLAY_MISSING");
        const existingSchedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
        if (
          stripeExpandableId((existingSchedule as any)?.subscription, 200) !== subscriptionId ||
          Boolean((existingSchedule as any)?.livemode) !== (stripeEnvironment === "live")
        ) throw new Error("MODULAR_EXACT_SCHEDULE_REPLAY_SCOPE_INVALID");
        return scheduleId;
      }
    }

    const currentByItem = new Map<
      string,
      { priceId: string; productId: string; amount: number; quantity: number }
    >();
    for (const subscriptionItem of subscription.items.data) {
      const product = subscriptionItem.price.product as Stripe.Product;
      const itemKey = sanitizeString(product?.metadata?.revenue_line, 80);
      const extension = sanitizeString(product?.metadata?.extension, 80);
      const normalizedKey = extension === "capacity_blocks"
        ? "clinical_core_capacity"
        : itemKey;
      if (normalizedKey) {
        currentByItem.set(normalizedKey, {
          priceId: subscriptionItem.price.id,
          productId: sanitizeString(product?.id || subscriptionItem.price.product, 200),
          amount: Number(subscriptionItem.price.unit_amount || 0),
          quantity: Number(subscriptionItem.quantity || 1),
        });
      }
    }

    const expectedInitialItems = Array.isArray(phases[0]?.items)
      ? phases[0].items
      : [];
    if (expectedInitialItems.length !== currentByItem.size) {
      throw new Error("MODULAR_CURRENT_PHASE_RECONCILIATION_FAILED");
    }
    for (const item of expectedInitialItems) {
      const itemKey = sanitizeString(item?.itemKey, 80);
      const expectedAmount = Number(item?.unitAmountCents || 0);
      const current = currentByItem.get(itemKey);
      if (!current || current.amount !== expectedAmount || current.quantity !== Number(item?.quantity || 1)) {
        throw new Error(`MODULAR_CURRENT_PHASE_RECONCILIATION_FAILED:${itemKey}`);
      }
    }

    const requestedPrices = new Map<string, Promise<string>>();
    const resolvePhasePrice = (itemKey: string, amount: number) => {
      const current = currentByItem.get(itemKey);
      if (!current?.productId) {
        throw new Error(`MODULAR_PHASE_PRODUCT_MISSING:${itemKey}`);
      }
      if (current.amount === amount) return Promise.resolve(current.priceId);
      const priceKey = `${itemKey}:${amount}`;
      if (!requestedPrices.has(priceKey)) {
        requestedPrices.set(
          priceKey,
          stripe.prices.create(
            {
              currency: sanitizeString(plan.currency, 12) || "brl",
              unit_amount: amount,
              recurring: { interval: "month" },
              product: current.productId,
              metadata: {
                flowType: "sales_modular_assisted",
                offerId: link.offer_id,
                revenueLine: itemKey,
              },
            },
            {
              idempotencyKey: crypto
                .createHash("sha256")
                .update(`modular-phase-price:${link.offer_id}:${itemKey}:${amount}`)
                .digest("hex"),
            },
          ).then((price) => price.id),
        );
      }
      return requestedPrices.get(priceKey)!;
    };

    const subscriptionScheduleId = stripeExpandableId(
      (subscription as any)?.schedule,
      200,
    );
    const storedScheduleId = sanitizeString(link.stripe_schedule_id, 200);
    if (
      storedScheduleId
      && subscriptionScheduleId
      && storedScheduleId !== subscriptionScheduleId
    ) {
      throw new Error("MODULAR_SCHEDULE_LINKAGE_CONFLICT");
    }

    let schedule: Stripe.SubscriptionSchedule;
    const reusableScheduleId = subscriptionScheduleId || storedScheduleId;
    if (reusableScheduleId) {
      schedule = await stripe.subscriptionSchedules.retrieve(
        reusableScheduleId,
        { expand: ["phases.items.price.product"] } as any,
      );
    } else {
      // Stripe forbids metadata/phases together with from_subscription. Create
      // only from the existing subscription, then configure in a second call.
      schedule = await stripe.subscriptionSchedules.create(
        { from_subscription: subscriptionId },
        {
          idempotencyKey: crypto
            .createHash("sha256")
            .update(`modular-schedule:${link.id}:${subscriptionId}`)
            .digest("hex"),
        },
      );
      schedule = await stripe.subscriptionSchedules.retrieve(
        schedule.id,
        { expand: ["phases.items.price.product"] } as any,
      );
    }

    const scheduleStatus = sanitizeString((schedule as any)?.status, 40).toLowerCase();
    const scheduleSubscriptionId = stripeExpandableId(
      (schedule as any)?.subscription,
      200,
    );
    if (
      Boolean((schedule as any)?.livemode) !== (stripeEnvironment === "live")
      || scheduleSubscriptionId !== subscriptionId
      || ["completed", "canceled", "released"].includes(scheduleStatus)
    ) {
      throw new Error("MODULAR_SCHEDULE_REUSE_VALIDATION_FAILED");
    }

    const existingScheduleMetadata = ((schedule as any)?.metadata || {}) as Record<string, string>;
    for (const [key, expectedValue] of Object.entries({
      flowType: "sales_modular_assisted",
      offerId: sanitizeString(link.offer_id, 120),
      leadId: sanitizeString(link.lead_id, 120),
      checkoutLinkId: sanitizeString(link.id, 120),
      environment: stripeEnvironment,
    })) {
      const actualValue = sanitizeString(existingScheduleMetadata[key], 200);
      if (actualValue && actualValue !== expectedValue) {
        throw new Error(`MODULAR_SCHEDULE_METADATA_CONFLICT:${key}`);
      }
    }

    const importedPhases = Array.isArray((schedule as any)?.phases)
      ? (schedule as any).phases
      : [];
    const currentPhaseBounds = (schedule as any)?.current_phase;
    const importedCurrentPhase = currentPhaseBounds
      ? importedPhases.find((phase: any) =>
          Number(phase?.start_date || 0) === Number(currentPhaseBounds.start_date || 0)
          && Number(phase?.end_date || 0) === Number(currentPhaseBounds.end_date || 0))
      : importedPhases[0];
    if (!importedCurrentPhase) {
      throw new Error("MODULAR_SCHEDULE_CURRENT_PHASE_MISSING");
    }

    // This is deliberately based on Stripe's imported phase. Do not reconstruct
    // the current phase from Verto dates or use start_date:'now': that can alter
    // trial/billing anchors and other live subscription properties.
    const preservedCurrentPhase = preserveStripeSchedulePhaseForUpdate(
      importedCurrentPhase,
    );
    const importedCurrentEnd = Number(preservedCurrentPhase.end_date || 0);
    if (!Number.isFinite(importedCurrentEnd) || importedCurrentEnd <= 0) {
      throw new Error("MODULAR_SCHEDULE_CURRENT_PHASE_END_MISSING");
    }
    const { currentPeriodEnd: stripeCurrentPeriodEnd } =
      resolveStripeSubscriptionCurrentPeriod(subscription);
    const normalizedBoundaries = normalizeModularSchedulePhaseBoundaries(
      phases,
      Number(stripeCurrentPeriodEnd || 0),
      importedCurrentEnd,
    );
    const effectiveFirstTransitionEnd = Number(
      normalizedBoundaries.effectiveFirstTransitionEnd || 0,
    );

    const configuredPhases: Record<string, any>[] = [preservedCurrentPhase];
    if (effectiveFirstTransitionEnd > importedCurrentEnd + 1) {
      configuredPhases.push(
        buildStripeScheduleContinuationPhase(
          preservedCurrentPhase,
          importedCurrentEnd,
          effectiveFirstTransitionEnd,
          {
            flowType: "sales_modular_assisted",
            offerId: sanitizeString(link.offer_id, 120),
            phase: "1-continuation",
          },
        ),
      );
    }

    const futurePhases = await Promise.all(
      normalizedBoundaries.futurePhases.map(async ({ phase, index, startDate, endDate }) => {
        return {
          start_date: startDate,
          ...(endDate !== null ? { end_date: endDate } : {}),
          items: await Promise.all((phase.items || []).map(async (item: any) => ({
            price: await resolvePhasePrice(
              sanitizeString(item.itemKey, 80),
              Number(item.unitAmountCents || 0),
            ),
            quantity: Number(item.quantity || 1),
          }))),
          metadata: {
            flowType: "sales_modular_assisted",
            offerId: link.offer_id,
            phase: String(index + 2),
          },
        };
      }),
    );
    configuredPhases.push(...futurePhases);

    if (configuredPhases.length > 10) {
      throw new Error("MODULAR_SCHEDULE_PHASE_LIMIT_EXCEEDED");
    }
    for (let index = 1; index < configuredPhases.length; index += 1) {
      const previousEnd = Number(configuredPhases[index - 1]?.end_date || 0);
      const currentStart = Number(configuredPhases[index]?.start_date || 0);
      if (!previousEnd || !currentStart || Math.abs(previousEnd - currentStart) > 1) {
        throw new Error("MODULAR_SCHEDULE_PHASE_SEQUENCE_INVALID");
      }
    }

    await stripe.subscriptionSchedules.update(
      schedule.id,
      {
        end_behavior: "release",
        phases: configuredPhases,
        metadata: {
          flowType: "sales_modular_assisted",
          offerId: link.offer_id,
          leadId: link.lead_id,
          checkoutLinkId: link.id,
          environment: stripeEnvironment,
        },
        // Current billing configuration is preserved byte-for-semantics; this
        // prevents schedule setup itself from producing an unexpected proration.
        proration_behavior: "none",
      } as unknown as Stripe.SubscriptionScheduleUpdateParams,
      {
        idempotencyKey: crypto
          .createHash("sha256")
          .update(`modular-schedule-configure:${link.id}:${subscriptionId}:${schedule.id}`)
          .digest("hex"),
      },
    );

    const { error: persistError } = await supabase
      .from("sales_checkout_links")
      .update({
        stripe_subscription_id: subscriptionId,
        stripe_schedule_id: schedule.id,
        stripe_customer_id: sanitizeString(String(session.customer || ""), 200) || null,
        status: canonicalLinkStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id)
      .eq("stripe_subscription_id", subscriptionId);
    if (persistError) throw persistError;
    return schedule.id;
  };

  const reconcileSalesAssistedCheckout = async (
    stripe: Stripe,
    session: Stripe.Checkout.Session,
    options: { sendActivationEmail?: boolean } = {},
  ) => {
    await ensureModularSubscriptionSchedule(stripe, session);
    return await processSalesAssistedCheckoutCompleted(stripe, session, options);
  };

  // ITEM09_SOURCE_END
  return { stripeExpandableId, sanitizeStripeScheduleMetadata, preserveStripeSchedulePhaseForUpdate, buildStripeScheduleContinuationPhase, normalizeModularSchedulePhaseBoundaries, ensureModularSubscriptionSchedule, reconcileSalesAssistedCheckout };
};
