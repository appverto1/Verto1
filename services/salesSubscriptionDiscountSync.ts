import type Stripe from 'stripe';
import crypto from 'crypto';
// Item 09: Stripe discount; original audited statements retained unchanged.
export const createSalesSubscriptionDiscountSync = (deps: Record<string, any>) => {
  const { PUBLIC_ACTIVE_PATIENT_PRICE, isCustomCouponDurationMonths, isUuid, resolveStripeSubscriptionCurrentPeriod, sanitizeString, supabase } = deps;
  // ITEM09_SOURCE_BEGIN
  const syncSalesSubscriptionDiscount = async (
    subscription: Stripe.Subscription,
  ) => {
    const metadata = (subscription.metadata || {}) as Record<string, string>;
    if (sanitizeString(metadata.flowType, 80) !== "sales_assisted_signup")
      return;
    const offerId = sanitizeString(metadata.offerId, 120);
    const leadId = sanitizeString(metadata.leadId, 120);
    if (!isUuid(offerId) || !isUuid(leadId)) return;

    const rawSubscription = subscription as any;
    const discount = Array.isArray(rawSubscription.discounts)
      ? rawSubscription.discounts.find(
          (item: any) => item && typeof item !== "string",
        )
      : rawSubscription.discount && typeof rawSubscription.discount !== "string"
        ? rawSubscription.discount
        : null;
    const coupon =
      discount?.coupon && typeof discount.coupon !== "string"
        ? discount.coupon
        : null;
    const discountEndsAt =
      Number(discount?.end || 0) > 0
        ? new Date(Number(discount.end) * 1000).toISOString()
        : null;
    const discountStartsAt =
      Number(discount?.start || 0) > 0
        ? new Date(Number(discount.start) * 1000).toISOString()
        : null;
    const { currentPeriodEnd } = resolveStripeSubscriptionCurrentPeriod(subscription);
    const nextBillingAt = currentPeriodEnd
      ? new Date(currentPeriodEnd * 1000).toISOString()
      : null;
    const durationMonths = Number(coupon?.duration_in_months || 0) || null;
    const percentage =
      coupon?.percent_off == null ? null : Number(coupon.percent_off);
    const status =
      eventTypeSubscriptionIsActive(subscription.status) && discount
        ? "active"
        : discount
          ? "inactive"
          : "ended";
    const now = new Date().toISOString();

    const { error: discountUpsertError } = await supabase.from("sales_subscription_discounts").upsert(
      [
        {
          offer_id: offerId,
          lead_id: leadId,
          stripe_subscription_id: subscription.id,
          stripe_discount_id: sanitizeString(discount?.id, 200) || null,
          stripe_coupon_id: sanitizeString(coupon?.id, 200) || null,
          stripe_promotion_code_id:
            sanitizeString(discount?.promotion_code, 200) || null,
          discount_type: discount ? "coupon" : "none",
          discount_percentage: percentage,
          discount_duration_months: isCustomCouponDurationMonths(durationMonths)
            ? durationMonths
            : null,
          discount_started_at: discountStartsAt,
          discount_ends_at: discountEndsAt,
          next_billing_at: nextBillingAt,
          post_discount_unit_amount_cents:
            PUBLIC_ACTIVE_PATIENT_PRICE.unitAmountCents,
          discount_status: status,
          last_discount_sync_at: now,
          updated_at: now,
        },
      ],
      { onConflict: "stripe_subscription_id" },
    );
    if (discountUpsertError) throw discountUpsertError;

    const { error: offerDiscountError } = await supabase
      .from("sales_offers")
      .update({
        stripe_subscription_id: subscription.id,
        stripe_discount_id: sanitizeString(discount?.id, 200) || null,
        stripe_coupon_id: sanitizeString(coupon?.id, 200) || null,
        stripe_promotion_code_id:
          sanitizeString(discount?.promotion_code, 200) || null,
        discount_percentage: percentage,
        updated_at: now,
      })
      .eq("id", offerId)
      .eq("lead_id", leadId);
    if (offerDiscountError) throw offerDiscountError;
  };

  const eventTypeSubscriptionIsActive = (status: string) =>
    ["active", "trialing", "past_due"].includes(
      String(status || "").toLowerCase(),
    );

  // ITEM09_SOURCE_END
  return { syncSalesSubscriptionDiscount, eventTypeSubscriptionIsActive };
};
