// Staging-only, non-binding 12-month loyalty drafts for existing paid clinics.
// Intentionally does not call Stripe, touch clinical data, or change billing/access.
// The customer-facing acceptance + legally approved penalty must be separate gates.
type Dependencies = {
  supabase: any;
  checkAuth: any;
  checkPlatformAdmin: any;
  isUuid: (value: string) => boolean;
};

export function registerOwnerLoyaltyDraftRoutes(app: any, deps: Dependencies) {
  const { supabase, checkAuth, checkPlatformAdmin, isUuid } = deps;

  const stagingOnly = (_req: any, res: any, next: any) => {
    // Both flags are server-side. Never enable this preview in production.
    if (process.env.VERTO_LOYALTY_STAGING_ENABLED !== 'true'
      || !/staging/i.test(String(process.env.RAILWAY_ENVIRONMENT_NAME || ''))) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    }
    return next();
  };
  const guard = [checkAuth, checkPlatformAdmin, stagingOnly];

  app.get('/api/owner/loyalty/drafts', ...guard, async (_req: any, res: any) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      // One bounded view of active subscriptions; never list patients or invoices.
      const subscriptions = await supabase
        .from('platform_subscription_financial_state')
        .select('organization_id,first_paid_at,last_paid_at,clinics!platform_subscription_financial_state_organization_id_fkey(name)')
        .eq('stripe_status', 'active')
        .not('organization_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(100);
      if (subscriptions.error) throw subscriptions.error;

      const eligible = (subscriptions.data || []).filter((row: any) =>
        row.organization_id && (row.first_paid_at || row.last_paid_at));
      if (!eligible.length) return res.json({ success: true, data: [] });

      const ids = [...new Set(eligible.map((row: any) => String(row.organization_id)))];
      const drafts = await supabase.from('organization_loyalty_drafts')
        .select('id,organization_id,duration_months,penalty_policy,legal_review_status,status,terms_version,created_at')
        .in('organization_id', ids).limit(100);
      if (drafts.error) throw drafts.error;
      const draftByOrg = new Map((drafts.data || []).map((draft: any) => [String(draft.organization_id), draft]));
      const data = eligible.map((row: any) => ({
        organizationId: row.organization_id,
        clinicName: (Array.isArray(row.clinics) ? row.clinics[0]?.name : row.clinics?.name) || 'Clínica',
        draft: draftByOrg.get(String(row.organization_id)) || null,
      }));
      return res.json({ success: true, data });
    } catch {
      return res.status(503).json({ success: false, error: 'LOYALTY_DRAFTS_UNAVAILABLE' });
    }
  });

  app.post('/api/owner/loyalty/drafts', ...guard, async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const body = req.body;
    const organizationId = body?.organizationId;
    const actorId = req.session?.user?.id;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1
      || typeof organizationId !== 'string' || !isUuid(organizationId)
      || typeof actorId !== 'string' || !isUuid(actorId)) {
      return res.status(400).json({ success: false, error: 'LOYALTY_INVALID_REQUEST' });
    }
    try {
      const created = await supabase.rpc('create_organization_loyalty_draft_v1', {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
      });
      if (created.error) {
        const message = String(created.error.message || '');
        if (/LOYALTY_ACTIVE_PAID_SUBSCRIPTION_REQUIRED|LOYALTY_SUBSCRIPTION_CHANGED/.test(message)) {
          return res.status(409).json({ success: false, error: 'LOYALTY_SUBSCRIPTION_INELIGIBLE' });
        }
        if (message.includes('LOYALTY_OWNER_REQUIRED')) {
          return res.status(403).json({ success: false, error: 'LOYALTY_OWNER_REQUIRED' });
        }
        throw created.error;
      }
      const draft = created.data;
      return res.json({
        success: true,
        data: {
          id: draft.id,
          organizationId: draft.organization_id,
          durationMonths: draft.duration_months,
          legalReviewStatus: draft.legal_review_status,
          status: draft.status,
          createdAt: draft.created_at,
        },
      });
    } catch {
      return res.status(503).json({ success: false, error: 'LOYALTY_DRAFT_CREATE_UNAVAILABLE' });
    }
  });
}
