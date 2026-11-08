// Pure, stable interpretation of the commercial post-payment response.
// No Stripe, database, cookies, browser state or network access.
export function resolveSalesPostPaymentState(data) {
  if (data?.state === 'review_required' || data?.reviewRequired === true) return 'review_required';
  if (data?.state === 'account_activated' || data?.sessionClaimed === true) return 'account_activated';
  if (data?.state === 'card_ready' || data?.cardActivationReady === true) return 'card_ready';
  if (data?.state === 'director_ready' || data?.directorSessionReady === true) return 'director_ready';
  if (data?.state === 'provisioning' || data?.accountProvisioned === true) return 'provisioning';
  if (data?.state === 'payment_confirmed' || data?.paymentConfirmed === true) return 'payment_confirmed';
  return 'payment_pending';
}

export function resolveSalesPostPaymentRetryDelayMs(retryAfterHeader, data, fallbackMs) {
  const headerSeconds = Number(retryAfterHeader || 0);
  const payloadMs = Number(data?.retryAfterMs || 0);
  const requestedMs = headerSeconds > 0
    ? headerSeconds * 1000
    : payloadMs > 0
      ? payloadMs
      : fallbackMs;
  return Math.max(1500, Math.min(30000, Math.round(requestedMs)));
}
