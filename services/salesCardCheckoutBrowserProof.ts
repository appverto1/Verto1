import crypto from 'node:crypto';
import type { Response } from 'express';

// Browser-only Checkout handoff. No client field grants a Director/clinic role.
// For an existing checkout, the original browser keeps its existing cookie;
// another visitor cannot obtain a second first-access proof from the same link.
export const SALES_CARD_PROOF_COOKIE = '__Host-verto_card_checkout';
export const SALES_CARD_PROOF_TTL_MS = 24 * 60 * 60 * 1000;

const hashProof = (proof: string) =>
  crypto.createHash('sha256').update(proof).digest('hex');

export async function issueSalesCardCheckoutBrowserProof(
  supabase: any, res: Response, offerId: string, checkoutSessionId: string,
): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/i.test(offerId) ||
      !/^cs_(test|live)_[A-Za-z0-9]+$/.test(checkoutSessionId)) return false;

  const secret = crypto.randomBytes(32).toString('base64url');
  const { data, error } = await supabase
    .from('sales_card_checkout_handoffs')
    .insert({
      checkout_session_id: checkoutSessionId,
      offer_id: offerId,
      proof_hash: hashProof(secret),
      expires_at: new Date(Date.now() + SALES_CARD_PROOF_TTL_MS).toISOString(),
    })
    .select('checkout_session_id')
    .maybeSingle();

  // The first handoff alone holds the proof. Duplicate attempts do not
  // mint another credential, even if the public checkout URL is shared.
  if (error) {
    if (String(error.code) === '23505') return false;
    throw error;
  }
  if (!data?.checkout_session_id) return false;

  res.cookie(SALES_CARD_PROOF_COOKIE, `${checkoutSessionId}.${secret}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SALES_CARD_PROOF_TTL_MS,
  });
  res.setHeader('Cache-Control', 'no-store');
  return true;
}

export async function verifySalesCardCheckoutBrowserProof(
  supabase: any, cookieHeader: unknown, offerId: string, checkoutSessionId: string,
): Promise<boolean> {
  const cookies = String(cookieHeader || '').split(';').map((item) => item.trim());
  const raw = cookies.find((item) => item.startsWith(`${SALES_CARD_PROOF_COOKIE}=`));
  if (!raw) return false;

  let value = '';
  try { value = decodeURIComponent(raw.slice(SALES_CARD_PROOF_COOKIE.length + 1)); }
  catch { return false; }
  const separator = value.indexOf('.');
  if (separator < 1 || value.slice(0, separator) !== checkoutSessionId) return false;
  const proof = value.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) return false;

  const { data, error } = await supabase
    .from('sales_card_checkout_handoffs')
    .select('proof_hash')
    .eq('checkout_session_id', checkoutSessionId)
    .eq('offer_id', offerId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  const expected = String(data?.proof_hash || '');
  const received = hashProof(proof);
  return /^[0-9a-f]{64}$/.test(expected) &&
    crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}
