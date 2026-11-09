import type { Express } from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

type GroupRateRouteDeps = {
  supabase: any;
  checkAuth: any;
  noStoreDynamicResponse: any;
  portalActionLimiter: any;
  requireClinicCapability: (capability: string) => any;
  requireClinicModule: (key: string) => any;
  currentClinicId: (user: any) => string | null;
  enforcePayloadLimit: (req: any,res: any,bytes: number,label?:string) => boolean;
};

/**
 * Dedicated price-only mutation; the canonical DB reconciler performs the
 * whole write under a patient lock and preserves snapshots/insurance history.
 * The frontend must use an explicit Save action and refresh the plan version.
 */
export function registerGroupSessionFinancialRateRoutes(app: Express,deps: GroupRateRouteDeps) {
  app.patch(
    '/api/patients/:patientId/financial-plans/:planId/group-rate',
    deps.portalActionLimiter,
    deps.noStoreDynamicResponse,
    deps.checkAuth,
    deps.requireClinicModule('appointments_communication'),
    deps.requireClinicCapability('patient.demographics.edit'),
    deps.requireClinicCapability('finance.entries.manage'),
    async (req:any,res:any) => {
      try {
        if (!deps.enforcePayloadLimit(req,res,4096,'Preço da sessão em grupo')) return;
        const clinicId=normalize(deps.currentClinicId(req.session?.user));
        const actorId=normalize(req.session?.user?.id);
        const patientId=normalize(req.params?.patientId);
        const planId=normalize(req.params?.planId);
        const rate=req.body?.groupAmountCents;
        if (![clinicId,actorId,patientId,planId].every(value=>UUID.test(value)))
          return res.status(400).json({success:false,code:'GROUP_RATE_IDENTIFIERS_INVALID'});
        if (typeof rate !== 'number' || !Number.isSafeInteger(rate) || rate < 0 || rate > 1000000000)
          return res.status(422).json({success:false,code:'GROUP_RATE_AMOUNT_INVALID'});
        const result=await deps.supabase.rpc('update_patient_specialty_group_rate_v1',{
          p_organization_id:clinicId,
          p_patient_id:patientId,
          p_plan_id:planId,
          p_actor_id:actorId,
          p_group_amount_cents:rate
        });
        if (result.error) throw result.error;
        const payload=result.data;
        if (payload?.success === true) return res.json(payload);
        const code=String(payload?.code||'GROUP_RATE_UPDATE_REJECTED');
        const status=code.includes('OUT_OF_SCOPE')||code.includes('NOT_FOUND')?404:
          code.includes('DENIED')?403:
          code.includes('STALE')?409:422;
        return res.status(status).json({success:false,code});
      } catch(error:any) {
        if (['42703','42P01','PGRST202','42883'].includes(String(error?.code||'')))
          return res.status(503).json({success:false,code:'GROUP_RATE_MIGRATION_REQUIRED'});
        return res.status(500).json({success:false,code:'GROUP_RATE_UPDATE_FAILED'});
      }
    }
  );
}
