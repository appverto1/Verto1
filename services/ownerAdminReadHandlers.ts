import { applyOwnerDreCostsToOverview } from './ownerDreReadModel';
// GET /api/owner/stats
export function createOwnerStatsHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { loadOwnerSaasClients, buildOwnerFinancialOverviewFromLedger, sanitizeString } = getDeps();
    try {
      const clients = await loadOwnerSaasClients();
      const payingClients = clients.filter((row) => row.subscription_status === 'active' && Boolean(row.first_paid_at));
      const trialingClients = clients.filter((row) => row.subscription_status === 'trialing');
      const complimentaryClients = clients.filter((row) => row.subscription_status === 'complimentary');
      const ledger = await buildOwnerFinancialOverviewFromLedger();
      return res.json({
        success: true,
        stats: {
          totalUsers: clients.length,
          activeUsers: payingClients.length,
          payingClients: payingClients.length,
          trialingClients: trialingClients.length,
          complimentaryClients: complimentaryClients.length,
          mrr: Number(ledger?.summary?.revenueNet || 0),
        },
      });
    } catch (error: any) {
      console.error('[Owner Finance] stats failed', { message: sanitizeString(error?.message || String(error), 240) });
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }

  };
}

// GET /api/owner/clients
export function createOwnerClientsHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { loadOwnerSaasClients, sanitizeString } = getDeps();
    try {
      const clients = await loadOwnerSaasClients();
      return res.json({ success: true, data: clients });
    } catch (error: any) {
      console.error('[Owner Finance] clients failed', { message: sanitizeString(error?.message || String(error), 240) });
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }

  };
}

// GET /api/owner/financial-overview
export function createOwnerFinancialOverviewHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { buildOwnerFinancialOverviewFromLedger, sanitizeString } = getDeps();
    try {
      const overview = await buildOwnerFinancialOverviewFromLedger();
      if (!overview) {
        return res.json({
          success: true,
          data: {
            source: 'ledger_schema_pending',
            allocationMethod: 'contribution_share_pre_fixed',
            summary: {
              revenueGross: 0,
              deductions: 0,
              revenueNet: 0,
              variableCosts: 0,
              fixedCosts: 0,
              contributionMarginValue: 0,
              contributionMarginPct: 0,
              ebitda: 0,
              ebitdaPct: 0,
              delinquencyAmount: 0,
            },
            monthly: [],
            byPlan: [],
            topCustomers: [],
            delinquentCustomers: [],
            trialingCustomers: [],
          },
        });
      }
      const withOwnerCosts = await applyOwnerDreCostsToOverview(overview);
      return res.json({ success: true, data: withOwnerCosts });
    } catch (error: any) {
      console.error('[Owner Finance] overview failed', { message: sanitizeString(error?.message || String(error), 240) });
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }

  };
}

// GET /api/owner/financial-feature-surveys
export function createOwnerFinancialSurveysHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { supabase } = getDeps();
    try {
      const { data, error } = await supabase
        .from('financial_module_feedback')
        .select('clinic_id,user_id,user_email,selected_features,notes,created_at');

      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || String(error) });
    }

  };
}

// GET /api/admin/demo/sandboxes
export function createAdminDemoSandboxesHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { supabase, extractMissingColumnName, isMissingRelationError, sanitizeString, logRouteDbError } = getDeps();
    try {
      const result = await supabase
        .from('clinics')
        .select('id,name,is_demo,demo_status,demo_expires_at,demo_source,demo_owner_user_id,demo_kind,demo_key,demo_last_activity_at,demo_reset_at,billing_model,created_at,updated_at')
        .eq('is_demo', true)
        .order('created_at', { ascending: false })
        .limit(200);
      if (result.error) {
        if (extractMissingColumnName(result.error) || isMissingRelationError(result.error)) {
          return res.json({ success: true, data: [], warning: 'Schema demo ainda não aplicado.' });
        }
        throw result.error;
      }
      const kindPriority: Record<string, number> = { presentation: 0, playground: 1, prospect: 2 };
      const data = (result.data || []).map((row: any) => ({
        id: sanitizeString(row?.id, 120),
        name: sanitizeString(row?.name, 180),
        isDemo: row?.is_demo === true,
        demoStatus: sanitizeString(row?.demo_status, 40) || null,
        demoExpiresAt: sanitizeString(row?.demo_expires_at, 80) || null,
        demoSource: sanitizeString(row?.demo_source, 40) || null,
        demoKind: sanitizeString(row?.demo_kind, 40) || null,
        demoKey: sanitizeString(row?.demo_key, 80) || null,
        demoLastActivityAt: sanitizeString(row?.demo_last_activity_at, 80) || null,
        demoResetAt: sanitizeString(row?.demo_reset_at, 80) || null,
        demoOwnerUserId: sanitizeString(row?.demo_owner_user_id, 120) || null,
        billingModel: sanitizeString(row?.billing_model, 40) || null,
        createdAt: sanitizeString(row?.created_at, 80) || null,
        updatedAt: sanitizeString(row?.updated_at, 80) || null
      })).sort((a: any, b: any) => (
        (kindPriority[a.demoKind] ?? 9) - (kindPriority[b.demoKind] ?? 9) ||
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      ));
      return res.json({ success: true, data });
    } catch (error: any) {
      logRouteDbError('/api/admin/demo/sandboxes', error, {});
      return res.status(500).json({ success: false, error: 'Não foi possível listar sandboxes demo.' });
    }

  };
}

// GET /api/admin/stats
export function createAdminStatsHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { supabase } = getDeps();
    try {
      // Get total users
      const { count: totalUsers } = await supabase.from('users').select('id', { count: 'exact', head: true });

      // Get active subscriptions
      const { count: activeUsers } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('subscription_status', 'active');

      // Get delinquent users
      const { count: delinquentUsers } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('subscription_status', 'delinquent');

      // Calculate MRR (Monthly Recurring Revenue)
      const { data: activeProfiles } = await supabase
        .from('users')
        .select('plan_price')
        .eq('subscription_status', 'active');

      const mrr = activeProfiles?.reduce((sum, p) => sum + (p.plan_price || 0), 0) || 0;

      res.json({
        success: true,
        stats: {
          totalUsers,
          activeUsers,
          delinquentUsers,
          mrr
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }

  };
}

// GET /api/admin/clients
export function createAdminClientsHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { supabase, USER_PROFILE_SELECT, parseBoundedListLimit } = getDeps();
    try {
      const { data, error } = await supabase
        .from('users')
        .select(USER_PROFILE_SELECT)
        .order('created_at', { ascending: false })
        .limit(parseBoundedListLimit(req.query?.limit, 200, 500));

      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }

  };
}

// GET /api/admin/verto-protocols
export function createAdminVertoProtocolsHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { supabase, CANONICAL_PROTOCOL_SELECT, sanitizeString, sanitizeClinicalPayload } = getDeps();
    try {
      let protocols: any[] = [];
      try {
        const { data, error } = await supabase
          .from('verto_canonical_protocols')
          .select(CANONICAL_PROTOCOL_SELECT)
          .order('updated_at', { ascending: false })
          .limit(500);
        if (!error && Array.isArray(data)) {
          protocols = data.map((row: any) => ({
            id: sanitizeString(row.id, 120),
            canonicalKey: sanitizeString(row.canonical_key, 180),
            title: sanitizeString(row.title, 180),
            category: sanitizeString(row.category, 80) || 'evaluation',
            sourceLabel: sanitizeString(row.source_label, 180) || null,
            versionLabel: sanitizeString(row.version_label, 120) || null,
            status: sanitizeString(row.status, 40) || 'draft',
            protocol: sanitizeClinicalPayload(row.protocol_json),
            createdAt: sanitizeString(row.created_at, 80),
            updatedAt: sanitizeString(row.updated_at, 80)
          }));
        }
      } catch {
        protocols = [];
      }
      return res.json({ success: true, data: protocols });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel listar protocolos Verto.' });
    }

  };
}

// GET /api/owner/leads/recovery
export function createOwnerRecoveryLeadsHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { supabase, sanitizeString, sanitizeEmail } = getDeps();
    try {
      const pendingStatuses = ['pending', 'incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'checkout_abandoned'];
      const { data: candidates, error: usersError } = await supabase
        .from('users')
        .select('id, name, email, phone, plan_name, subscription_status, created_at, updated_at')
        .eq('role', 'coordinator')
        .in('subscription_status', pendingStatuses)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (usersError) throw usersError;

      const candidateIds = (candidates || []).map((user: any) => sanitizeString(user.id, 120)).filter(Boolean);
      let leadLogs: any[] = [];
      if (candidateIds.length > 0) {
        const { data: logsData, error: logsError } = await supabase
          .from('activity_logs')
          .select('id, user_id, title, content, action_type, payload_details, timestamp')
          .eq('type', 'lead_recovery')
          .in('user_id', candidateIds)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('timestamp', { ascending: false })
          .limit(5000);
        if (!logsError) {
          leadLogs = logsData || [];
        } else {
          const { data: fallbackLogs } = await supabase
            .from('activity_logs')
            .select('id, user_id, title, content, action_type, payload_details, timestamp')
            .in('user_id', candidateIds)
            .ilike('title', '%Checkout cancelado%')
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('timestamp', { ascending: false })
            .limit(5000);
          leadLogs = fallbackLogs || [];
        }
      }

      const grouped = new Map<string, { lastAt: string | null; cancelCount: number; source: string | null }>();
      for (const log of leadLogs) {
        const userId = sanitizeString(log?.user_id, 120);
        if (!userId) continue;
        const rawSource = (() => {
          try {
            const payload = JSON.parse(String(log?.payload_details || '{}'));
            return sanitizeString(payload?.source, 80);
          } catch {
            return null;
          }
        })();
        const existing = grouped.get(userId);
        const timestamp = sanitizeString(log?.timestamp, 80) || null;
        if (!existing) {
          grouped.set(userId, { lastAt: timestamp, cancelCount: 1, source: rawSource || null });
        } else {
          existing.cancelCount += 1;
          if (!existing.lastAt && timestamp) existing.lastAt = timestamp;
          if (!existing.source && rawSource) existing.source = rawSource;
          grouped.set(userId, existing);
        }
      }

      const data = (candidates || []).map((user: any) => {
        const leadMeta = grouped.get(sanitizeString(user.id, 120));
        return {
          userId: sanitizeString(user.id, 120),
          name: sanitizeString(user.name, 180) || 'Lead sem nome',
          email: sanitizeEmail(user.email),
          phone: sanitizeString(user.phone, 40) || null,
          planName: sanitizeString(user.plan_name, 80) || null,
          subscriptionStatus: sanitizeString(user.subscription_status, 40) || 'pending',
          createdAt: sanitizeString(user.created_at, 80) || null,
          lastUpdatedAt: sanitizeString(user.updated_at, 80) || null,
          lastCheckoutCancelAt: leadMeta?.lastAt || null,
          cancelCount: Number(leadMeta?.cancelCount || 0),
          lastCancelSource: leadMeta?.source || null
        };
      });

      return res.json({
        success: true,
        data
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }

  };
}
