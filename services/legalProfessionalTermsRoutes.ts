import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const PROFESSIONAL_TERMS_VERSION = 'v1.1' as const;
export const PROFESSIONAL_TERMS_KEY = 'professional_terms' as const;
const professionalTermsHtml = readFileSync(
  path.resolve(process.cwd(), 'services/legal/professional-terms-v1.1.html'),
  'utf8',
);
export const PROFESSIONAL_TERMS_SHA256 = createHash('sha256')
  .update(professionalTermsHtml, 'utf8')
  .digest('hex');

const PROFESSIONAL_PORTAL_ROLES = new Set([
  'owner', 'admin', 'director', 'coordinator', 'supervisor', 'therapist', 'receptionist', 'biller',
]);

export const isProfessionalLegalSession = (user: any) =>
  Boolean(user?.id) && PROFESSIONAL_PORTAL_ROLES.has(String(user?.role || '').trim().toLowerCase());

export function registerProfessionalTermsRoutes(
  app: any,
  deps: { checkAuth: any; supabase: any },
) {
  const authorize = (req: any, res: any, next: any) => {
    if (!isProfessionalLegalSession(req.session?.user)) {
      return res.status(403).json({ success: false, error: 'PROFESSIONAL_PORTAL_REQUIRED' });
    }
    return next();
  };

  app.get('/api/legal/professional-terms', deps.checkAuth, authorize, (_req: any, res: any) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    return res.status(200).type('html').send(professionalTermsHtml);
  });

  app.get('/api/legal/professional-terms/status', deps.checkAuth, authorize, async (req: any, res: any) => {
    const userId = String(req.session.user.id);
    const result = await deps.supabase
      .from('user_legal_acceptances')
      .select('user_id')
      .eq('user_id', userId)
      .eq('document_key', PROFESSIONAL_TERMS_KEY)
      .eq('document_sha256', PROFESSIONAL_TERMS_SHA256)
      .limit(1)
      .maybeSingle();
    if (result.error) {
      return res.status(503).json({ success: false, error: 'LEGAL_ACCEPTANCE_STATE_UNAVAILABLE' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ success: true, accepted: Boolean(result.data) });
  });
}

export async function ensureProfessionalTermsAccepted(params: {
  supabase: any;
  userId: string;
  explicitlyAccepted: boolean;
  contextKey: string;
}) {
  if (params.explicitlyAccepted) {
    const result = await params.supabase
      .from('user_legal_acceptances')
      .upsert({
        user_id: params.userId,
        document_key: PROFESSIONAL_TERMS_KEY,
        document_version: PROFESSIONAL_TERMS_VERSION,
        document_sha256: PROFESSIONAL_TERMS_SHA256,
        context_key: params.contextKey,
      }, { onConflict: 'user_id,document_key,document_sha256,context_key', ignoreDuplicates: true });
    if (result.error) throw result.error;
    return true;
  }
  const result = await params.supabase
    .from('user_legal_acceptances')
    .select('user_id')
    .eq('user_id', params.userId)
    .eq('document_key', PROFESSIONAL_TERMS_KEY)
    .eq('document_sha256', PROFESSIONAL_TERMS_SHA256)
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data);
}
