// Read-only customer review of a non-binding draft. No acceptance/Stripe writes.
type Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: any) => any;
  currentClinicId: (user: any) => string | null;
};
export function registerClinicLoyaltyReviewRoutes(app: any, deps: Deps) {
  const { supabase, noStoreDynamicResponse, checkAuth, requireClinicCapability, currentClinicId } = deps;
  app.get(
    '/api/clinic/loyalty/review',
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability('clinic.settings.edit'),
    async (req: any, res: any) => {
      if (process.env.VERTO_LOYALTY_STAGING_ENABLED !== 'true'
        || process.env.VERTO_DEPLOYMENT_ENV !== 'staging'
        || process.env.SUPABASE_EXPECTED_PROJECT_REF !== 'irspungjhapqdbgqroyc') {
        return res.status(404).json({ success: false, error: 'NOT_FOUND' });
      }
      // Consent authority cannot come from client-side role, clinic IDs or checkboxes.
      const context = req.authorizationContext;
      const role = String(context?.role || '').trim().toLowerCase();
      const clinicId = currentClinicId(req.session?.user);
      const authorizedClinic = String(context?.clinicId || context?.clinic_id || '').trim();
      if (role !== 'director' || !clinicId || (authorizedClinic && authorizedClinic !== clinicId)) {
        return res.status(403).json({ success: false, error: 'LOYALTY_DIRECTOR_REQUIRED' });
      }
      try {
        const lookup = await supabase.from('organization_loyalty_drafts')
          .select('id,status,duration_months,legal_review_status,terms_version')
          .eq('organization_id', clinicId).limit(1).maybeSingle();
        if (lookup.error) throw lookup.error;
        return res.json({
          success: true,
          data: lookup.data ? {
            available: true,
            durationMonths: lookup.data.duration_months,
            legalReviewStatus: lookup.data.legal_review_status,
            status: lookup.data.status,
            termsVersion: lookup.data.terms_version,
            canAccept: false,
          } : { available: false, canAccept: false },
        });
      } catch {
        return res.status(503).json({ success: false, error: 'LOYALTY_REVIEW_UNAVAILABLE' });
      }
    },
  );
}
