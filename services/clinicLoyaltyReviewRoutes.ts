// Staging-only terms review and consent, scoped to the authenticated clinic.
// Never mutates Stripe subscription, billing access, or clinical data.
type Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: any) => any;
  currentClinicId: (user: any) => string | null;
};
export function registerClinicLoyaltyReviewRoutes(app: any, deps: Deps) {
  const { supabase, noStoreDynamicResponse, checkAuth, requireClinicCapability, currentClinicId } = deps;
  const stagingOnly = (_req: any, res: any, next: any) => {
    if (process.env.VERTO_LOYALTY_STAGING_ENABLED !== 'true'
      || process.env.VERTO_DEPLOYMENT_ENV !== 'staging'
      || process.env.SUPABASE_EXPECTED_PROJECT_REF !== 'irspungjhapqdbgqroyc') {
      return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    }
    return next();
  };
  const guard = [
    noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.settings.edit'), stagingOnly,
  ];
  const directorContext = (req: any) => {
    const role = String(req.authorizationContext?.role || '').trim().toLowerCase();
    const clinicId = currentClinicId(req.session?.user);
    const userId = String(req.session?.user?.id || '').trim();
    const authorizedClinic = String(
      req.authorizationContext?.clinicId || req.authorizationContext?.clinic_id || '',
    ).trim();
    if (role !== 'director' || !clinicId || !userId
      || (authorizedClinic && authorizedClinic !== clinicId)) return null;
    return { clinicId, userId };
  };

  app.get('/api/clinic/loyalty/review', ...guard, async (req: any, res: any) => {
    const actor = directorContext(req);
    if (!actor) return res.status(403).json({success:false,error:'LOYALTY_DIRECTOR_REQUIRED'});
    try {
      const lookup = await supabase.from('organization_loyalty_drafts')
        .select('id,status,duration_months,legal_review_status,terms_version,terms_text,terms_sha256,effective_start_date,effective_end_date,accepted_at,accepted_by_name')
        .eq('organization_id', actor.clinicId).limit(1).maybeSingle();
      if (lookup.error) throw lookup.error;
      const d = lookup.data;
      if (!d || d.status === 'draft') {
        return res.json({ success:true, data:{ available:false, canAccept:false } });
      }
      const dateParts = new Intl.DateTimeFormat('en-US', {
        timeZone:'America/Sao_Paulo', year:'numeric',month:'2-digit',day:'2-digit',
      }).formatToParts(new Date());
      const part = (type: string) => dateParts.find((item) => item.type === type)?.value || '';
      const localToday = [part('year'),part('month'),part('day')].join('-');
      const inWindow = Boolean(d.effective_start_date && d.effective_start_date >= localToday);
      return res.json({ success:true, data:{
        available:true, status:d.status, durationMonths:d.duration_months,
        legalReviewStatus:d.legal_review_status,
        termsVersion:d.terms_version, termsText:d.terms_text,
        termsSha256:d.terms_sha256, effectiveStartDate:d.effective_start_date,
        effectiveEndDate:d.effective_end_date, acceptedAt:d.accepted_at,
        acceptedByName:d.accepted_by_name,
        canAccept:d.status === 'offered' && d.legal_review_status === 'owner_approved'
          && Boolean(inWindow),
      } });
    } catch {
      return res.status(503).json({ success:false,error:'LOYALTY_REVIEW_UNAVAILABLE' });
    }
  });

  app.post('/api/clinic/loyalty/accept', ...guard, async (req: any, res: any) => {
    const actor = directorContext(req);
    if (!actor) return res.status(403).json({success:false,error:'LOYALTY_DIRECTOR_REQUIRED'});
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 2
      || body.acceptTerms !== true || typeof body.termsSha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(body.termsSha256)) {
      return res.status(400).json({success:false,error:'LOYALTY_EXPLICIT_CONSENT_REQUIRED'});
    }
    try {
      const result = await supabase.rpc('accept_organization_loyalty_offer_v1', {
        p_organization_id: actor.clinicId,
        p_actor_user_id: actor.userId,
        p_terms_sha256: body.termsSha256,
        p_confirmed: true,
      });
      if (result.error) {
        const msg = String(result.error.message || '');
        if (/LOYALTY_DIRECTOR_REQUIRED/.test(msg))
          return res.status(403).json({success:false,error:'LOYALTY_DIRECTOR_REQUIRED'});
        if (/LOYALTY_OFFER_STALE_OR_NOT_APPROVED|LOYALTY_SUBSCRIPTION_INELIGIBLE|LOYALTY_OFFER_NOT_FOUND/.test(msg))
          return res.status(409).json({success:false,error:'LOYALTY_OFFER_STALE'});
        throw result.error;
      }
      return res.json({success:true,data:{
        status:result.data.status,acceptedAt:result.data.accepted_at,
        acceptedByName:result.data.accepted_by_name,termsSha256:result.data.terms_sha256,
        effectiveStartDate:result.data.effective_start_date,
        effectiveEndDate:result.data.effective_end_date,
      }});
    } catch {
      return res.status(503).json({success:false,error:'LOYALTY_ACCEPT_UNAVAILABLE'});
    }
  });
}
