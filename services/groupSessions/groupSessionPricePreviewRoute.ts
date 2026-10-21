import type { Express } from 'express';
import { previewGroupSessionRates } from './groupSessionPricePreview';

type GroupPreviewRouteDeps = {
  supabase: any;
  checkAuth: any;
  noStoreDynamicResponse: any;
  portalActionLimiter: any;
  requireClinicCapability: (capability: any) => any;
  requireClinicModule: (moduleKey: any) => any;
  currentClinicId: (user: any) => string | null;
  enforcePayloadLimit: (req: any, res: any, maxBytes: number, label?: string) => boolean;
};

/** Read-only group price preview; never reserves, invoices or modifies a plan. */
export function registerGroupSessionPricePreviewRoute(app: Express, deps: GroupPreviewRouteDeps) {
  app.post(
    '/api/appointments/groups/price-preview',
    deps.portalActionLimiter,
    deps.noStoreDynamicResponse,
    deps.checkAuth,
    deps.requireClinicModule('appointments_communication'),
    deps.requireClinicCapability('patient.demographics.edit'),
    deps.requireClinicCapability('finance.entries.view'),
    async (req: any, res: any) => {
      try {
        if (!deps.enforcePayloadLimit(req, res, 8 * 1024, 'Consulta de valores da sessão em grupo')) return;
        const clinicId = deps.currentClinicId(req.session?.user);
        const result = await previewGroupSessionRates({
          supabase: deps.supabase,
          authenticatedClinicId: String(clinicId || ''),
          specialty: req.body?.specialty,
          patientIds: req.body?.patientIds,
          scheduledStartAt: req.body?.scheduledStartAt,
          localDate: req.body?.date,
        });
        if (!result.ok) return res.status(
          result.code.endsWith('_OUT_OF_SCOPE') ? 404 : result.code.includes('INVALID') ? 400 : 409
        ).json({
          success: false, code: result.code,
          ...('patientId' in result && typeof result.patientId === 'string' &&
            Array.isArray(req.body?.patientIds) && req.body.patientIds.includes(result.patientId)
              ? { patientId: result.patientId } : {}),
        });
        return res.json({ success: true, mode: 'GROUP', rates: result.rates });
      } catch (error: any) {
        const code = String(error?.code || '');
        if (['42703', '42P01', 'PGRST204'].includes(code))
          return res.status(503).json({ success: false, code: 'GROUP_PRICING_MIGRATION_REQUIRED' });
        return res.status(500).json({ success: false, code: 'GROUP_PRICING_PREVIEW_FAILED' });
      }
    }
  );
}
