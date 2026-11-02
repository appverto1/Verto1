import { renderLoyaltyTermsV1 } from '../src/constants/loyaltyTermsDraft';
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
      || process.env.VERTO_DEPLOYMENT_ENV !== 'staging'
      || process.env.SUPABASE_EXPECTED_PROJECT_REF !== 'irspungjhapqdbgqroyc') {
      return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    }
    return next();
  };
  const guard = [checkAuth, checkPlatformAdmin, stagingOnly];

  app.get('/api/owner/loyalty/drafts', ...guard, async (_req: any, res: any) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      // One bounded view of active subscriptions; never list patients or invoices.
      const [subscriptions,drafts] = await Promise.all([
        supabase.from('platform_subscription_financial_state')
          .select('organization_id,first_paid_at,last_paid_at,clinics!platform_subscription_financial_state_organization_id_fkey(name)')
          .eq('stripe_status','active').not('organization_id','is',null)
          .order('updated_at',{ascending:false}).limit(100),
        supabase.from('organization_loyalty_drafts')
          .select('id,organization_id,duration_months,legal_review_status,status,terms_version,created_at,effective_start_date,effective_end_date,accepted_at,clinics!organization_loyalty_drafts_organization_id_fkey(name)')
          .order('created_at',{ascending:false}).limit(100),
      ]);
      if (subscriptions.error || drafts.error) throw subscriptions.error || drafts.error;
      const eligible = (subscriptions.data || []).filter((row: any) =>
        row.organization_id && (row.first_paid_at || row.last_paid_at));
      const draftRows: any[] = drafts.data || [];
      const draftByOrg = new Map(draftRows.map((draft: any) =>
        [String(draft.organization_id), draft]));
      const data = eligible.map((row: any) => ({
        organizationId: row.organization_id,
        clinicName: (Array.isArray(row.clinics) ? row.clinics[0]?.name : row.clinics?.name) || 'Clínica',
        draft: draftByOrg.get(String(row.organization_id)) || null,
      }));
      const known = new Set(data.map((row: any) => String(row.organizationId)));
      for (const draft of draftRows) {
        if (known.has(String(draft.organization_id))) continue;
        data.push({
          organizationId: draft.organization_id,
          clinicName: (Array.isArray(draft.clinics) ? draft.clinics[0]?.name : draft.clinics?.name) || 'Clínica',
          draft,
        });
      }
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
  // Only the owner explicitly publishing an offer can create a binding invitation.
  // The commercial fields are mandatory and the canonical contract text comes
  // from the server-owned, versioned template, never from the browser.
  app.post('/api/owner/loyalty/drafts/:organizationId/publish', ...guard, async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const orgId = String(req.params?.organizationId || '');
    const actorId = String(req.session?.user?.id || '');
    const body = req.body;
    const fields = [
      'vertoLegalName', 'vertoCnpj', 'vertoAddress',
      'clinicLegalName', 'clinicCnpj', 'clinicAddress',
      'benefitDescription', 'benefitConditions',
      'benefitValueCents', 'monthlyReferenceCents', 'startDate',
    ];
    if (!isUuid(orgId) || !isUuid(actorId) || !body || typeof body !== 'object'
      || Array.isArray(body) || Object.keys(body).length !== fields.length
      || Object.keys(body).some((key) => !fields.includes(key))) {
      return res.status(400).json({ success: false, error: 'LOYALTY_OFFER_INVALID' });
    }
    const stringFields = fields.filter((name) => !['benefitValueCents','monthlyReferenceCents'].includes(name));
    if (stringFields.some((name) => typeof body[name] !== 'string')
      || !Number.isSafeInteger(body.benefitValueCents) || body.benefitValueCents < 1
      || !Number.isSafeInteger(body.monthlyReferenceCents) || body.monthlyReferenceCents < 1
      || body.benefitValueCents > 100000000 || body.monthlyReferenceCents > 100000000
      || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)
      || !Number.isFinite(Date.parse(body.startDate + 'T12:00:00Z'))
      || stringFields.some((name) => body[name].length > 1000)
      || !validCnpj(body.vertoCnpj) || !validCnpj(body.clinicCnpj)) {
      return res.status(400).json({ success: false, error: 'LOYALTY_OFFER_FIELDS_INVALID' });
    }
    try {
      const subscription = await supabase.from('platform_subscription_financial_state')
        .select('stripe_subscription_id,first_paid_at,last_paid_at')
        .eq('organization_id', orgId).eq('stripe_status', 'active')
        .limit(1).maybeSingle();
      if (subscription.error) throw subscription.error;
      if (!subscription.data?.stripe_subscription_id
        || (!subscription.data.first_paid_at && !subscription.data.last_paid_at)) {
        return res.status(409).json({ success: false, error: 'LOYALTY_SUBSCRIPTION_INELIGIBLE' });
      }
      const start = new Date(body.startDate + 'T12:00:00Z');
      if (start.toISOString().slice(0,10) !== body.startDate) {
        return res.status(400).json({ success: false, error: 'LOYALTY_DATE_INVALID' });
      }
      const y = start.getUTCFullYear() + 1;
      const m = start.getUTCMonth();
      const d = start.getUTCDate();
      const maxDay = new Date(Date.UTC(y, m+1, 0)).getUTCDate();
      const end = new Date(Date.UTC(y, m, Math.min(d,maxDay)));
      end.setUTCDate(end.getUTCDate()-1);
      const endDate = end.toISOString().slice(0,10);
      const brl = (cents: number) => new Intl.NumberFormat('pt-BR',{
        style: 'currency',currency:'BRL'
      }).format(cents/100);
      const terms = renderLoyaltyTermsV1({
        vertoLegalName: body.vertoLegalName,
        vertoCnpj: body.vertoCnpj,
        vertoAddress: body.vertoAddress,
        clinicLegalName: body.clinicLegalName,
        clinicCnpj: body.clinicCnpj,
        clinicAddress: body.clinicAddress,
        representativeLabel: 'Diretor autenticado identificado no comprovante do aceite',
        subscriptionId: subscription.data.stripe_subscription_id,
        referenceMonthlyAmount: brl(body.monthlyReferenceCents),
        benefitDescription: body.benefitDescription,
        benefitValue: brl(body.benefitValueCents),
        benefitConditions: body.benefitConditions,
        startDate: body.startDate,
        endDate,
      });
      const result = await supabase.rpc('publish_organization_loyalty_offer_v1', {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_verto_legal_name: body.vertoLegalName,
        p_verto_cnpj: body.vertoCnpj,
        p_verto_address: body.vertoAddress,
        p_clinic_legal_name: body.clinicLegalName,
        p_clinic_cnpj: body.clinicCnpj,
        p_clinic_address: body.clinicAddress,
        p_benefit_description: body.benefitDescription,
        p_benefit_value_cents: body.benefitValueCents,
        p_benefit_conditions: body.benefitConditions,
        p_monthly_reference_cents: body.monthlyReferenceCents,
        p_effective_start_date: body.startDate,
        p_terms_text: terms,
      });
      if (result.error) {
        const message = String(result.error.message || '');
        if (message.includes('LOYALTY_OFFER_INCOMPLETE')) return res.status(400).json({success:false,error:'LOYALTY_OFFER_INCOMPLETE'});
        if (/LOYALTY_SUBSCRIPTION_INELIGIBLE|LOYALTY_OFFER_ALREADY_FINALIZED/.test(message))
          return res.status(409).json({success:false,error:message.includes('FINALIZED')?'LOYALTY_OFFER_FINALIZED':'LOYALTY_SUBSCRIPTION_INELIGIBLE'});
        throw result.error;
      }
      return res.json({success:true,data:{
        id: result.data.id, organizationId: result.data.organization_id,
        status: result.data.status, legalReviewStatus: result.data.legal_review_status,
        effectiveStartDate: result.data.effective_start_date,
        effectiveEndDate: result.data.effective_end_date,
      }});
    } catch {
      return res.status(503).json({success:false,error:'LOYALTY_OFFER_PUBLISH_UNAVAILABLE'});
    }
  });

}

function validCnpj(value: string): boolean {
  const digits = String(value).replace(/\D/g,'');
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const check = (length: number) => {
    let weight = length - 7;
    let total = 0;
    for(let i=0;i<length;i++) {
      total += Number(digits[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const mod = total % 11;
    return (mod < 2 ? 0 : 11 - mod) === Number(digits[length]);
  };
  return check(12) && check(13);
}
