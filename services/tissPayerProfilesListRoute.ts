import type { Express } from 'express';

type TissPayerProfilesListRouteDeps = {
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicModule: any;
  requireClinicCapability: any;
  sanitizeString: any;
  currentClinicId: any;
  isUuid: any;
  payerSafeError: any;
  supabase: any;
  PAYER_TISS_PROFILE_SELECT: any;
  PAYER_TISS_PROFILE_OPTIONAL_REVIEW_COLUMNS: any;
  extractMissingColumnName: any;
  PAYER_TISS_PROFILE_BASE_SELECT: any;
  hasMissingFinancialSchema: any;
  isMissingRelationError: any;
  sendNoStoreJson: any;
};

// Original route/middleware chain, registered at the same entrypoint position.
export function registerTissPayerProfilesListRoute(app: Express, deps: TissPayerProfilesListRouteDeps) {
  const { noStoreDynamicResponse, checkAuth, requireClinicModule, requireClinicCapability, sanitizeString, currentClinicId, isUuid, payerSafeError, supabase, PAYER_TISS_PROFILE_SELECT, PAYER_TISS_PROFILE_OPTIONAL_REVIEW_COLUMNS, extractMissingColumnName, PAYER_TISS_PROFILE_BASE_SELECT, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson } = deps;
  app.get('/api/admin/tiss/payer-profiles', noStoreDynamicResponse, checkAuth, requireClinicModule('insurance_tiss'), requireClinicCapability('billing.mapping.manage'), async (req: any, res) => {
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const { data, error } = await supabase
        .from('payer_tiss_profiles')
        .select(PAYER_TISS_PROFILE_SELECT)
        .eq('organization_id', organizationId)
        .eq('active', true)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) {
        if (PAYER_TISS_PROFILE_OPTIONAL_REVIEW_COLUMNS.includes(String(extractMissingColumnName(error) || ''))) {
          const fallback = await supabase
            .from('payer_tiss_profiles')
            .select(PAYER_TISS_PROFILE_BASE_SELECT)
            .eq('organization_id', organizationId)
            .eq('active', true)
            .order('updated_at', { ascending: false })
            .limit(500);
          if (!fallback.error) {
            return sendNoStoreJson(res, { success: true, data: Array.isArray(fallback.data) ? fallback.data : [] });
          }
          if (hasMissingFinancialSchema(fallback.error) || isMissingRelationError(fallback.error)) {
            return sendNoStoreJson(res, { success: true, data: [] });
          }
          throw fallback.error;
        }
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return sendNoStoreJson(res, { success: true, data: [] });
        }
        throw error;
      }
      return sendNoStoreJson(res, { success: true, data: Array.isArray(data) ? data : [] });
    } catch (error: any) {
      console.warn('[TissPreGuide] payer profiles list failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }
  });}
