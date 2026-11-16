/**
 * Evidence for a single Supabase Auth session, never a clinic/role grant.
 *
 * `auth.getUser(accessToken)` MUST validate the exact token before any JWT payload
 * is examined. The source of truth for persona authorization remains the
 * active membership/patient binding/approved partner in the database.
 *
 * OAuth is a method CATEGORY, not proof of Google specifically: Supabase's
 * standard `amr` claim does not reliably identify the OAuth provider.
 * A separate trusted provider attestation is required for a Google-only
 * policy before multi-persona login can be enabled.
 */
export type VerifiedLoginCategory = 'password' | 'oauth';

export type VerifiedPortalAuthEvidence = Readonly<{
  authUserId: string;
  sessionId: string;
  category: VerifiedLoginCategory;
  authenticatedAt: number;
}>;

type AuthVerification = (
  accessToken: string,
) => Promise<{
  data?: { user?: { id?: string | null } | null } | null;
  error?: unknown;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PRIMARY_METHODS = new Set<VerifiedLoginCategory>(['password', 'oauth']);
const CLOCK_SKEW_SECONDS = 60;

const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

type AmrEntry = { method: VerifiedLoginCategory; timestamp: number };

/**
 * Fail closed on missing/ambiguous original authentication methods. A JWT
 * containing only "token_refresh" does not prove the method used to sign in.
 * This is also important when one identity has BOTH password and Google linked.
 */
function evidenceFromVerifiedClaims(
  claims: unknown,
  verifiedAuthUserId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedPortalAuthEvidence | null {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims) ||
      !UUID.test(verifiedAuthUserId) || !integer(nowSeconds)) return null;
  const c = claims as Record<string, unknown>;
  if (c.sub !== verifiedAuthUserId || !UUID.test(String(c.session_id || '')) ||
      c.is_anonymous === true || !integer(c.iat) || !integer(c.exp) ||
      c.iat > nowSeconds + CLOCK_SKEW_SECONDS || c.exp <= nowSeconds ||
      c.exp <= c.iat || !Array.isArray(c.amr)) return null;

  const primary: AmrEntry[] = [];
  for (const event of c.amr) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
    const entry = event as Record<string, unknown>;
    if (entry.method === 'token_refresh') continue; // Never sufficient by itself
    if (PRIMARY_METHODS.has(entry.method as VerifiedLoginCategory)) {
      if (!integer(entry.timestamp) || entry.timestamp < 1 ||
          entry.timestamp > c.iat + CLOCK_SKEW_SECONDS) return null;
      primary.push({ method: entry.method as VerifiedLoginCategory, timestamp: entry.timestamp });
    }
  }
  if (primary.length === 0) return null;
  primary.sort((a, b) => b.timestamp - a.timestamp);
  // Multiple different methods with the same timestamp have no safe precedence.
  if (primary.some(e => e.timestamp === primary[0].timestamp && e.method !== primary[0].method)) return null;
  return {
    authUserId: verifiedAuthUserId,
    sessionId: c.session_id as string,
    category: primary[0].method,
    authenticatedAt: primary[0].timestamp,
  };
}

/**
 * Supabase Auth verifies the exact access token first. Parsing the payload
 * below does NOT replace that verification. Never call evidenceFromVerifiedClaims
 * on an unverified token to authorize API or RLS access.
 */
export async function verifyPortalAuthEvidence(
  accessToken: unknown,
  verifyWithSupabaseAuth: AuthVerification,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedPortalAuthEvidence | null> {
  if (typeof accessToken !== 'string' || accessToken.length < 80 ||
      accessToken.length > 8192 || !JWT.test(accessToken)) return null;
  try {
    const verified = await verifyWithSupabaseAuth(accessToken);
    const verifiedId = verified?.data?.user?.id;
    if (verified.error || typeof verifiedId !== 'string' || !UUID.test(verifiedId)) return null;
    const payload = accessToken.split('.')[1];
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    if (json.length > 16384) return null;
    return evidenceFromVerifiedClaims(JSON.parse(json), verifiedId, nowSeconds);
  } catch {
    return null;
  }
}

/**
 * This deliberately does NOT turn the oauth category into "google".
 * Verifying a specific provider requires separately attested identity of that
 * login event, not app_metadata.provider (which can be an older linked provider).
 */
export function matchesRequiredMethod(
  evidence: VerifiedPortalAuthEvidence | null,
  configuredMethod: 'password' | 'google',
): boolean {
  if (!evidence) return false;
  if (configuredMethod === 'password') return evidence.category === 'password';
  // Standard Supabase AMR reports generic OAuth, not the specific provider.
  // Until a separately verified Google-only claim exists, fail closed.
  return false;
}
