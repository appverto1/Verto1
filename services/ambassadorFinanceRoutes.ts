// Super Admin-only ambassador finance endpoints. This module has no public
// routes, patient/clinic session privileges, payouts or Stripe mutations.
type Deps = {
  supabase: any;
  checkAuth: any;
  checkPlatformAdmin: any;
  isUuid: (value: string) => boolean;
};

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const page = (query: any) => {
  const limit = Number(query?.limit ?? 30);
  const offset = Number(query?.offset ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return null;
  return { limit, offset };
};

const invalid = (res: any) =>
  res.status(400).json({ success: false, error: 'Dados inválidos para o programa de embaixadores.' });

export function registerAmbassadorFinanceRoutes(app: any, deps: Deps) {
  const { supabase, checkAuth, checkPlatformAdmin, isUuid } = deps;
  const guard = [checkAuth, checkPlatformAdmin];
  const actor = (req: any) => asString(req.session?.user?.id);

  app.get('/api/owner/ambassadors', ...guard, async (req: any, res: any) => {
    const paging = page(req.query);
    if (!paging) return invalid(res);
    try {
      const result = await supabase.from('ambassador_partners')
        .select('id,display_name,contact_email,kind,code,linked_clinic_id,status,created_at')
        .order('created_at', { ascending: false })
        .range(paging.offset, paging.offset + paging.limit - 1);
      if (result.error) throw result.error;
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json({ success: true, partners: result.data || [] });
    } catch {
      return res.status(503).json({ success: false, error: 'Cadastro de embaixadores indisponível.' });
    }
  });

  app.post('/api/owner/ambassadors', ...guard, async (req: any, res: any) => {
    const input = req.body;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['name','email','kind','code','linkedClinicId'].includes(key))) {
      return invalid(res);
    }
    const name = asString(input.name);
    const email = asString(input.email).toLowerCase();
    const kind = asString(input.kind);
    const code = asString(input.code).toUpperCase();
    const linkedClinicId = input.linkedClinicId == null ? null : asString(input.linkedClinicId);
    if (!isUuid(actor(req)) || name.length < 2 || name.length > 180 ||
        email.length < 3 || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
        !['person','company'].includes(kind) || !/^[A-Z0-9_-]{3,32}$/.test(code) ||
        (linkedClinicId !== null && !isUuid(linkedClinicId))) return invalid(res);
    try {
      const result = await supabase.rpc('ambassador_create_partner_v1', {
        p_actor: actor(req), p_name: name, p_email: email,
        p_kind: kind, p_code: code, p_linked_clinic_id: linkedClinicId,
      });
      if (result.error) {
        if (result.error.code === '23505') {
          return res.status(409).json({ success: false, error: 'Código ou e-mail já cadastrado.' });
        }
        if (/AMBASSADOR_(ADMIN_REQUIRED|CLINIC_NOT_FOUND|INVALID_PARTNER)/.test(String(result.error.message))) {
          return res.status(409).json({ success: false, error: 'Cadastro não autorizado ou dados não elegíveis.' });
        }
        throw result.error;
      }
      return res.status(201).json({ success: true, partner: result.data });
    } catch {
      return res.status(503).json({ success: false, error: 'Não foi possível cadastrar o embaixador.' });
    }
  });

  app.post('/api/owner/ambassadors/referrals', ...guard, async (req: any, res: any) => {
    const input = req.body;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['leadId','code'].includes(key))) return invalid(res);
    const leadId = asString(input.leadId);
    const code = asString(input.code).toUpperCase();
    if (!isUuid(actor(req)) || !isUuid(leadId) || !/^[A-Z0-9_-]{3,32}$/.test(code)) return invalid(res);
    try {
      const result = await supabase.rpc('ambassador_assign_lead_v1', {
        p_actor: actor(req), p_lead_id: leadId, p_code: code,
      });
      if (result.error) {
        if (/AMBASSADOR_(ADMIN_REQUIRED|CODE_UNAVAILABLE|LEAD_NOT_FOUND|REFERRAL_INELIGIBLE|REFERRAL_ALREADY_ATTRIBUTED)/.test(String(result.error.message))) {
          return res.status(409).json({ success: false, error: 'Indicação indisponível, já atribuída ou não elegível.' });
        }
        throw result.error;
      }
      return res.json({ success: true, referral: result.data });
    } catch {
      return res.status(503).json({ success: false, error: 'Não foi possível registrar a indicação.' });
    }
  });

  app.get('/api/owner/ambassadors/commissions', ...guard, async (req: any, res: any) => {
    const partnerId = asString(req.query?.partnerId);
    const paging = page(req.query);
    if (!paging || !isUuid(partnerId)) return invalid(res);
    try {
      const result = await supabase.from('ambassador_commission_entries')
        .select('id,referral_id,source_amount_cents,commission_cents,status,paid_invoice_at,available_after,ambassador_referrals!inner(partner_id,sales_lead_id)')
        .eq('ambassador_referrals.partner_id', partnerId)
        .order('paid_invoice_at', { ascending: false })
        .range(paging.offset, paging.offset + paging.limit - 1);
      if (result.error) throw result.error;
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json({ success: true, entries: result.data || [] });
    } catch {
      return res.status(503).json({ success: false, error: 'Comissões indisponíveis.' });
    }
  });
}
