import type Stripe from 'stripe';
import type { StripeEnvironment } from './stripeEnvironment';

type EntitlementStatus = 'active' | 'trial' | 'grace' | 'suspended' | 'cancelled';
type EntitlementArgs = {
  offerId: string;
  organizationId: string;
  stripeSubscriptionId: string;
  stripeEventId: string;
  stripeEventCreatedAt: string;
  status: EntitlementStatus;
};

export interface SalesAssistedStripeEventDependencies {
  salesAssistedFlowType: (value: unknown) => boolean;
  stripeInvoiceSubscriptionId: (invoice: Stripe.Invoice) => string;
  reconcileSalesAssistedCheckout: (
    stripe: Stripe,
    session: Stripe.Checkout.Session,
    options?: { sendActivationEmail?: boolean },
  ) => Promise<any>;
  sanitizeString: (value: unknown, maxLength?: number) => string;
  supabase: { from: (table: string) => any };
  isUuid: (value: string | null | undefined) => boolean;
  resolveStripeEnvironment: () => StripeEnvironment;
  validateStripeSecretForEnvironment: (environment: StripeEnvironment) => string;
  persistPlatformBillingInvoiceLedger: (params: {
    invoice: Stripe.Invoice;
    subscription?: Stripe.Subscription | null;
    organizationId?: string | null;
    offerId?: string | null;
    leadId?: string | null;
    eventId?: string | null;
    failed?: boolean;
  }) => Promise<unknown>;
  persistPlatformSubscriptionFinancialState: (params: {
    subscription: Stripe.Subscription;
    organizationId?: string | null;
    offerId?: string | null;
    leadId?: string | null;
    invoice?: Stripe.Invoice | null;
    paid?: boolean;
  }) => Promise<unknown>;
  syncSalesSubscriptionDiscount: (subscription: Stripe.Subscription) => Promise<unknown>;
  applyModularEntitlementsForOrganization: (params: EntitlementArgs) => Promise<unknown>;
  stripeSubscriptionToEntitlementStatus: (status: unknown) => EntitlementStatus;
}

export function createSalesAssistedStripeEventHandlers(
  deps: SalesAssistedStripeEventDependencies,
) {
  const {
    salesAssistedFlowType, stripeInvoiceSubscriptionId,
    reconcileSalesAssistedCheckout, sanitizeString, supabase, isUuid,
    resolveStripeEnvironment, validateStripeSecretForEnvironment,
    persistPlatformBillingInvoiceLedger, persistPlatformSubscriptionFinancialState,
    syncSalesSubscriptionDiscount, applyModularEntitlementsForOrganization,
    stripeSubscriptionToEntitlementStatus,
  } = deps;

  const isSalesAssistedStripeEvent = async (
    stripe: Stripe,
    event: Stripe.Event,
  ): Promise<boolean> => {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.expired"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      return (
        salesAssistedFlowType((session.metadata as any)?.flowType)
      );
    }
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      return (
        salesAssistedFlowType((subscription.metadata as any)?.flowType)
      );
    }
    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_succeeded" ||
      event.type === "invoice.payment_failed"
    ) {
      const subscriptionId = stripeInvoiceSubscriptionId(
        event.data.object as Stripe.Invoice,
      );
      if (!subscriptionId) return false;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return (
        salesAssistedFlowType((subscription.metadata as any)?.flowType)
      );
    }
    if (event.type.startsWith("subscription_schedule.")) {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      return salesAssistedFlowType((schedule.metadata as any)?.flowType);
    }
    return false;
  };

  const processSalesAssistedStripeEvent = async (
    stripe: Stripe,
    event: Stripe.Event,
  ): Promise<{ handled: boolean; result?: Record<string, any> }> => {
    if (!(await isSalesAssistedStripeEvent(stripe, event))) {
      return { handled: false };
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const completedSession = event.data.object as Stripe.Checkout.Session;
      const result = await reconcileSalesAssistedCheckout(
        stripe,
        completedSession,
        {
          // Card payments keep the current immediate browser handoff. Delayed
          // payment methods complete later, so the activation e-mail becomes the
          // durable path back to first access and onboarding.
          sendActivationEmail:
            event.type === "checkout.session.async_payment_succeeded",
        },
      );
      if (
        sanitizeString((completedSession.metadata as any)?.flowType, 80)
          === "sales_modular_assisted"
      ) {
        const completedAt = new Date().toISOString();
        const { error } = await supabase
          .from("sales_checkout_links")
          .update({
            status: result.paymentConfirmed ? "completed" : "payment_pending",
            payment_completed_at: result.paymentConfirmed ? completedAt : null,
            updated_at: completedAt,
          })
          .eq("stripe_checkout_session_id", completedSession.id);
        if (error) throw error;
      }
      return { handled: true, result };
    }

    if (event.type.startsWith("subscription_schedule.")) {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      const offerId = sanitizeString((schedule.metadata as any)?.offerId, 120);
      const leadId = sanitizeString((schedule.metadata as any)?.leadId, 120);
      if (!isUuid(offerId) || !isUuid(leadId)) {
        throw new Error("MODULAR_SCHEDULE_METADATA_INVALID");
      }
      const terminal = [
        "subscription_schedule.completed",
        "subscription_schedule.canceled",
      ].includes(event.type);
      const [linkResult, eventResult] = await Promise.all([
        supabase
          .from("sales_checkout_links")
          .update({
            stripe_schedule_id: schedule.id,
            ...(terminal ? { updated_at: new Date().toISOString() } : {}),
          })
          .eq("offer_id", offerId),
        supabase.from("sales_lead_events").upsert(
          [{
            lead_id: leadId,
            event_type: "lead_updated",
            metadata: {
              action: "subscription_schedule_lifecycle",
              offer_id: offerId,
              stripe_event_type: event.type,
              schedule_status: schedule.status,
            },
            idempotency_key: `modular-schedule-event:${event.id}`,
          }],
          { onConflict: "idempotency_key", ignoreDuplicates: true },
        ),
      ]);
      if (linkResult.error || eventResult.error) {
        throw linkResult.error || eventResult.error;
      }
      return { handled: true };
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const offerId = sanitizeString((session.metadata as any)?.offerId, 120);
      const leadId = sanitizeString((session.metadata as any)?.leadId, 120);
      const modularFlow = sanitizeString((session.metadata as any)?.flowType, 80)
        === "sales_modular_assisted";
      if (!isUuid(offerId) || !isUuid(leadId)) {
        throw new Error("SALES_CHECKOUT_METADATA_INVALID");
      }
      const [offerResult, eventResult, checkoutLinkResult] = await Promise.all([
        supabase
          .from("sales_offers")
          .update({
            status: modularFlow ? "opened" : "expired",
            updated_at: new Date().toISOString(),
          })
          .eq("id", offerId)
          .eq("lead_id", leadId)
          .eq("stripe_checkout_session_id", session.id)
          .neq("status", "paid"),
        supabase.from("sales_lead_events").upsert(
          [
            {
              lead_id: leadId,
              event_type: "checkout_expired",
              metadata: {
                offer_id: offerId,
                checkout_session_id: session.id,
              },
              idempotency_key: `checkout-expired:${session.id}`,
            },
          ],
          { onConflict: "idempotency_key", ignoreDuplicates: true },
        ),
        supabase
          .from("sales_checkout_links")
          .update({
            status: "expired",
            logically_expired_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_checkout_session_id", session.id)
          .neq("status", "completed"),
      ]);
      const error = offerResult.error || eventResult.error || checkoutLinkResult.error;
      if (error) throw error;
      return { handled: true };
    }

    let subscription: Stripe.Subscription;
    let invoice: Stripe.Invoice | null = null;
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      subscription = event.data.object as Stripe.Subscription;
    } else {
      invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = stripeInvoiceSubscriptionId(invoice);
      if (!subscriptionId) {
        throw new Error("SALES_SUBSCRIPTION_LINKAGE_INVALID");
      }
      subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["discounts", "items.data.price"],
      } as any);
    }

    const metadata = (subscription.metadata || {}) as Record<string, string>;
    if (sanitizeString(metadata.flowType, 80) === "sales_modular_assisted") {
      const stripeEnvironment = resolveStripeEnvironment();
      validateStripeSecretForEnvironment(stripeEnvironment);
      if (sanitizeString(metadata.environment, 20) !== stripeEnvironment) {
        throw new Error("MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH");
      }
    }
    const offerId = sanitizeString(metadata.offerId, 120);
    const leadId = sanitizeString(metadata.leadId, 120);
    if (!isUuid(offerId) || !isUuid(leadId)) {
      throw new Error("SALES_SUBSCRIPTION_METADATA_INVALID");
    }
    const { data: offer, error: offerError } = await supabase
      .from("sales_offers")
      .select("id,lead_id,status,stripe_checkout_session_id,stripe_subscription_id,offer_type,modular_snapshot,simulation_snapshot")
      .eq("id", offerId)
      .eq("lead_id", leadId)
      .maybeSingle();
    if (offerError || !offer) {
      throw offerError || new Error("SALES_OFFER_NOT_FOUND");
    }
    if (
      offer.stripe_subscription_id &&
      offer.stripe_subscription_id !== subscription.id
    ) {
      throw new Error("SALES_SUBSCRIPTION_LINKAGE_INVALID");
    }

    const { data: billingLead, error: billingLeadError } = await supabase
      .from("sales_leads")
      .select("id,converted_clinic_id")
      .eq("id", leadId)
      .is("deleted_at", null)
      .maybeSingle();
    if (billingLeadError) throw billingLeadError;
    const billingOrganizationId = sanitizeString(
      billingLead?.converted_clinic_id,
      120,
    );

    if (invoice) {
      await persistPlatformBillingInvoiceLedger({
        invoice,
        subscription,
        organizationId: billingOrganizationId,
        offerId,
        leadId,
        eventId: event.id,
        failed: event.type === "invoice.payment_failed",
      });
    }
    await persistPlatformSubscriptionFinancialState({
      subscription,
      organizationId: billingOrganizationId,
      offerId,
      leadId,
      invoice,
      paid: event.type === "invoice.paid" || event.type === "invoice.payment_succeeded",
    });

    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_succeeded"
    ) {
      if (sanitizeString(offer.status, 40) !== "paid") {
        const checkoutSessionId = sanitizeString(
          offer.stripe_checkout_session_id,
          200,
        );
        if (!checkoutSessionId) {
          throw new Error("SALES_CHECKOUT_SESSION_LINKAGE_MISSING");
        }
        const checkoutSession = await stripe.checkout.sessions.retrieve(
          checkoutSessionId,
        );
        const result = await reconcileSalesAssistedCheckout(
          stripe,
          checkoutSession,
          { sendActivationEmail: true },
        );
        return { handled: true, result };
      }
    }

    if (event.type !== "invoice.payment_failed") {
      await syncSalesSubscriptionDiscount(subscription);
    }

    if (sanitizeString(metadata.flowType, 80) === "sales_modular_assisted") {
      const linkStatus = event.type === "invoice.payment_failed"
        ? "failed"
        : event.type === "invoice.paid" || event.type === "invoice.payment_succeeded"
          ? "completed"
          : event.type === "customer.subscription.deleted"
            ? "expired"
            : "payment_pending";
      let linkLifecycleQuery = supabase
        .from("sales_checkout_links")
        .update({
          status: linkStatus,
          ...(linkStatus === "completed"
            ? { payment_completed_at: new Date().toISOString() }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("offer_id", offerId)
        .eq("stripe_subscription_id", subscription.id);
      if (linkStatus !== "completed") {
        // A later subscription.updated/payment_failed event must never roll a
        // successfully completed checkout link back to a non-terminal state.
        linkLifecycleQuery = linkLifecycleQuery.neq("status", "completed");
      }
      const { error: linkLifecycleError } = await linkLifecycleQuery;
      if (linkLifecycleError) throw linkLifecycleError;

      const organizationId = billingOrganizationId;
      if (isUuid(organizationId)) {
        await applyModularEntitlementsForOrganization({
          offerId,
          organizationId,
          stripeSubscriptionId: subscription.id,
          stripeEventId: event.id,
          stripeEventCreatedAt: new Date(event.created * 1000).toISOString(),
          status: event.type === "customer.subscription.deleted"
            ? "cancelled"
            : stripeSubscriptionToEntitlementStatus(subscription.status),
        });
      }
    }

    const lifecycleEvent = await supabase.from("sales_lead_events").upsert(
      [
        {
          lead_id: leadId,
          event_type: "lead_updated",
          metadata: {
            offer_id: offerId,
            stripe_event_type: event.type,
            invoice_payment_failed: event.type === "invoice.payment_failed",
            subscription_status: sanitizeString(subscription.status, 40),
          },
          idempotency_key: `sales-stripe-lifecycle:${event.id}`,
        },
      ],
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );
    if (lifecycleEvent.error) throw lifecycleEvent.error;

    return { handled: true };
  };

  return { isSalesAssistedStripeEvent, processSalesAssistedStripeEvent };
}
