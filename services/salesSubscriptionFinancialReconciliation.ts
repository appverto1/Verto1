import type Stripe from 'stripe';
import crypto from 'crypto';
// Item 09: Stripe financial; original audited statements retained unchanged.
export const createSalesSubscriptionFinancialReconciliation = (deps: Record<string, any>) => {
  const { cleanObject, isMissingRelationError, isUuid, resolveStripeSubscriptionCurrentPeriod, sanitizeString, stripePositivePeriodTimestamp, supabase } = deps;
  // ITEM09_SOURCE_BEGIN
  const stripeInvoiceSubscriptionId = (invoice: Stripe.Invoice) =>
    sanitizeString(
      String(
        (invoice as any)?.subscription ||
          (invoice as any)?.parent?.subscription_details?.subscription ||
          "",
      ),
      200,
    );

  const stripeTimestampToIso = (value: unknown): string | null => {
    const seconds = stripePositivePeriodTimestamp(value);
    if (seconds === null) return null;
    return new Date(seconds * 1000).toISOString();
  };

  const stripeInvoicePeriodBounds = (invoice: Stripe.Invoice) => {
    const lines = Array.isArray((invoice as any)?.lines?.data)
      ? (invoice as any).lines.data
      : [];
    const starts = lines
      .map((line: any) => Number(line?.period?.start || 0))
      .filter((value: number) => Number.isFinite(value) && value > 0);
    const ends = lines
      .map((line: any) => Number(line?.period?.end || 0))
      .filter((value: number) => Number.isFinite(value) && value > 0);
    return {
      periodStart: starts.length ? new Date(Math.min(...starts) * 1000).toISOString() : null,
      periodEnd: ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null,
    };
  };

  const persistPlatformSubscriptionFinancialState = async (params: {
    subscription: Stripe.Subscription;
    organizationId?: string | null;
    offerId?: string | null;
    leadId?: string | null;
    invoice?: Stripe.Invoice | null;
    paid?: boolean;
  }) => {
    const subscription = params.subscription;
    const subscriptionId = sanitizeString(subscription?.id, 200);
    if (!subscriptionId) return;
    const { currentPeriodStart, currentPeriodEnd } =
      resolveStripeSubscriptionCurrentPeriod(subscription);
    const invoice = params.invoice || null;
    const nowIso = new Date().toISOString();
    const organizationId = sanitizeString(
      params.organizationId || (subscription.metadata as any)?.clinicId,
      120,
    );
    const offerId = sanitizeString(
      params.offerId || (subscription.metadata as any)?.offerId,
      120,
    );
    const leadId = sanitizeString(
      params.leadId || (subscription.metadata as any)?.leadId,
      120,
    );
    const paidAt = invoice
      ? (stripeTimestampToIso((invoice as any)?.status_transitions?.paid_at)
        || (params.paid && Number((invoice as any)?.amount_paid || 0) > 0 ? nowIso : null))
      : null;
    const payload = cleanObject({
      organization_id: isUuid(organizationId) ? organizationId : null,
      sales_offer_id: isUuid(offerId) ? offerId : null,
      sales_lead_id: isUuid(leadId) ? leadId : null,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: sanitizeString(String(subscription.customer || ''), 200) || null,
      stripe_status: sanitizeString(subscription.status, 50) || 'unknown',
      trial_start_at: stripeTimestampToIso((subscription as any)?.trial_start),
      trial_ends_at: stripeTimestampToIso((subscription as any)?.trial_end),
      current_period_start: stripeTimestampToIso(currentPeriodStart),
      current_period_end: stripeTimestampToIso(currentPeriodEnd),
      cancel_at_period_end: Boolean((subscription as any)?.cancel_at_period_end),
      cancel_at: stripeTimestampToIso((subscription as any)?.cancel_at),
      canceled_at: stripeTimestampToIso((subscription as any)?.canceled_at),
      last_invoice_id: invoice ? sanitizeString(invoice.id, 200) || null : undefined,
      last_invoice_status: invoice ? sanitizeString((invoice as any)?.status, 50) || null : undefined,
      last_invoice_amount_due_cents: invoice ? Math.max(0, Number((invoice as any)?.amount_due || 0)) : undefined,
      last_invoice_amount_paid_cents: invoice ? Math.max(0, Number((invoice as any)?.amount_paid || 0)) : undefined,
      ...(params.paid && paidAt ? {
        first_paid_at: paidAt,
        last_paid_at: paidAt,
      } : {}),
      updated_at: nowIso,
    });
    const { data: existing, error: existingError } = await supabase
      .from('platform_subscription_financial_state')
      .select('id,first_paid_at,last_paid_at')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();
    if (existingError && isMissingRelationError(existingError)) return;
    if (existingError) throw existingError;
    if (params.paid && paidAt && existing?.first_paid_at) {
      (payload as any).first_paid_at = existing.first_paid_at;
    }
    const { error } = await supabase
      .from('platform_subscription_financial_state')
      .upsert([{
        ...(existing?.id ? { id: existing.id } : {}),
        ...payload,
      }], { onConflict: 'stripe_subscription_id' });
    if (error && !isMissingRelationError(error)) throw error;
  };

  const persistPlatformBillingInvoiceLedger = async (params: {
    invoice: Stripe.Invoice;
    subscription?: Stripe.Subscription | null;
    organizationId?: string | null;
    offerId?: string | null;
    leadId?: string | null;
    eventId?: string | null;
    failed?: boolean;
  }) => {
    const invoice = params.invoice;
    const invoiceId = sanitizeString(invoice?.id, 200);
    if (!invoiceId) return;
    const subscriptionId = stripeInvoiceSubscriptionId(invoice)
      || sanitizeString(params.subscription?.id, 200);
    const subscription = params.subscription || null;
    const organizationId = sanitizeString(
      params.organizationId || (subscription?.metadata as any)?.clinicId,
      120,
    );
    const offerId = sanitizeString(
      params.offerId || (subscription?.metadata as any)?.offerId,
      120,
    );
    const leadId = sanitizeString(
      params.leadId || (subscription?.metadata as any)?.leadId,
      120,
    );
    const discountCents = Math.max(0, Number(
      (invoice as any)?.total_discount_amounts?.reduce(
        (sum: number, item: any) => sum + Number(item?.amount || 0),
        0,
      ) || 0,
    ));
    const taxCents = Math.max(0, Number(
      (invoice as any)?.total_tax_amounts?.reduce(
        (sum: number, item: any) => sum + Number(item?.amount || 0),
        0,
      ) || 0,
    ));
    const period = stripeInvoicePeriodBounds(invoice);
    const paidAt = stripeTimestampToIso((invoice as any)?.status_transitions?.paid_at);
    const failedAt = params.failed ? new Date().toISOString() : null;
    const payload = {
      stripe_invoice_id: invoiceId,
      stripe_subscription_id: subscriptionId || null,
      stripe_customer_id: sanitizeString(String((invoice as any)?.customer || subscription?.customer || ''), 200) || null,
      organization_id: isUuid(organizationId) ? organizationId : null,
      sales_offer_id: isUuid(offerId) ? offerId : null,
      sales_lead_id: isUuid(leadId) ? leadId : null,
      status: sanitizeString((invoice as any)?.status, 50) || (params.failed ? 'payment_failed' : 'unknown'),
      currency: sanitizeString((invoice as any)?.currency, 12).toLowerCase() || 'brl',
      billing_reason: sanitizeString((invoice as any)?.billing_reason, 80) || null,
      subtotal_cents: Math.max(0, Number((invoice as any)?.subtotal || 0)),
      total_cents: Math.max(0, Number((invoice as any)?.total || 0)),
      amount_due_cents: Math.max(0, Number((invoice as any)?.amount_due || 0)),
      amount_paid_cents: Math.max(0, Number((invoice as any)?.amount_paid || 0)),
      amount_remaining_cents: Math.max(0, Number((invoice as any)?.amount_remaining || 0)),
      discount_cents: discountCents,
      tax_cents: taxCents,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      paid_at: paidAt,
      failed_at: failedAt,
      source_event_id: sanitizeString(params.eventId, 200) || null,
      metadata: {
        collectionMethod: sanitizeString((invoice as any)?.collection_method, 40) || null,
        attemptCount: Math.max(0, Number((invoice as any)?.attempt_count || 0)),
      },
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('platform_billing_invoice_ledger')
      .upsert([payload], { onConflict: 'stripe_invoice_id' });
    if (error && !isMissingRelationError(error)) throw error;
  };

  const salesAssistedFlowType = (value: unknown) => {
    const flow = sanitizeString(value, 80);
    return flow === "sales_assisted_signup" || flow === "sales_modular_assisted";
  };

  // ITEM09_SOURCE_END
  return { stripeInvoiceSubscriptionId, stripeTimestampToIso, stripeInvoicePeriodBounds, persistPlatformSubscriptionFinancialState, persistPlatformBillingInvoiceLedger, salesAssistedFlowType };
};
