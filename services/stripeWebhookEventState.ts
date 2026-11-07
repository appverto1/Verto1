import type Stripe from 'stripe';
import crypto from 'crypto';
// Item 09: Stripe eventState; original audited statements retained unchanged.
export const createStripeWebhookEventState = (deps: Record<string, any>) => {
  const { sanitizeString, supabase } = deps;
  // ITEM09_SOURCE_BEGIN
async function reserveStripeWebhookEvent(event: Stripe.Event): Promise<boolean> {
  const eventId = sanitizeString(event?.id, 200);
  const eventType = sanitizeString(event?.type, 120);
  if (!eventId || !eventType) {
    throw new Error('STRIPE_WEBHOOK_EVENT_ID_INVALID');
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('stripe_webhook_events')
    .insert([{
      id: eventId,
      event_type: eventType,
      status: 'processing',
      metadata: {},
      processed_at: now,
      updated_at: now,
      attempt_count: 1
    }]);
  if (!error) return true;

  const code = sanitizeString((error as any)?.code, 20);
  const message = sanitizeString((error as any)?.message || '', 300).toLowerCase();
  if (code !== '23505' && !message.includes('duplicate')) {
    throw error;
  }

  const { data: existing, error: existingError } = await supabase
    .from('stripe_webhook_events')
    .select('id,status,processed_at,attempt_count')
    .eq('id', eventId)
    .maybeSingle();
  if (existingError || !existing) {
    throw existingError || new Error('STRIPE_WEBHOOK_RESERVATION_NOT_FOUND');
  }
  if (sanitizeString(existing.status, 40) === 'processed') return false;

  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const canRetry =
    sanitizeString(existing.status, 40) === 'failed' ||
    (sanitizeString(existing.status, 40) === 'processing' &&
      sanitizeString(existing.processed_at, 80) < staleBefore);
  if (!canRetry) return false;

  let retryQuery = supabase
    .from('stripe_webhook_events')
    .update({
      status: 'processing',
      processed_at: now,
      updated_at: now,
      last_error_code: null,
      attempt_count: Math.max(1, Number(existing.attempt_count || 1)) + 1
    })
    .eq('id', eventId)
    .eq('status', sanitizeString(existing.status, 40));
  if (sanitizeString(existing.status, 40) === 'processing') {
    retryQuery = retryQuery.lt('processed_at', staleBefore);
  }
  const { data: retried, error: retryError } = await retryQuery.select('id');
  if (retryError) throw retryError;
  return Array.isArray(retried) && retried.length === 1;
}

async function markStripeWebhookEventStatus(
  event: Stripe.Event,
  status: 'processed' | 'failed',
  errorCode?: string | null
): Promise<void> {
  const eventId = sanitizeString(event?.id, 200);
  if (!eventId) return;
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('stripe_webhook_events')
      .update({
        status,
        processed_at: now,
        updated_at: now,
        last_error_code: status === 'failed' ? sanitizeString(errorCode, 120) || 'PROCESSING_FAILED' : null
      })
      .eq('id', eventId);
    if (error) throw error;
  } catch (statusError: any) {
    console.error('[Stripe Webhook] Falha ao persistir status do evento.', {
      eventType: sanitizeString(event?.type, 120),
      message: sanitizeString(statusError?.message || String(statusError), 200)
    });
  }
}
  // ITEM09_SOURCE_END
  return { reserveStripeWebhookEvent, markStripeWebhookEventStatus };
};
