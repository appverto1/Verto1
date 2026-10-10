import fs from 'node:fs';
import assert from 'node:assert/strict';

const path = 'server.ts';
let source = fs.readFileSync(path, 'utf8');
function replaceOnce(previous, next) {
  assert.equal(source.split(previous).length - 1, 1, 'Expected one exact route anchor');
  source = source.replace(previous, next);
}
const post = "  app.post('/api/aba/patients/:patientId/therapeutic-plans', checkAuth, requireClinicCapability('treatment_plan.create'), checkPatientAccess, async (req: any, res) => {";
const patch = "  app.patch('/api/aba/patients/:patientId/therapeutic-plans/:planId', checkAuth, requireAnyClinicCapability('treatment_plan.edit', 'treatment_plan.create'), checkPatientAccess, async (req: any, res) => {";
const guard = `  // The case link, professional's membership specialty and write permission
  // remain the resource authority below; the capability is only the first gate.
  const requireScopedTherapeuticPlanCapability = (operation: 'create' | 'edit') =>
    async (req: any, res: any, next: any) => {
      try {
        const ctx = await resolveClinicCapabilityContext(req.session?.user);
        const hasCapability = operation === 'create'
          ? ctx?.capabilities.has('treatment_plan.create')
          : ctx?.capabilities.has('treatment_plan.edit') || ctx?.capabilities.has('treatment_plan.create');
        const denied = (key: string) =>
          (ctx?.overrides || []).some((o: any) =>
            String(o?.permission_key || o?.permissionKey || '').trim() === key &&
            String(o?.effect || '').toLowerCase() === 'deny');
        // Older case-professional profiles sometimes lack the role-default
        // create grant. A real, clinic-authenticated therapist with clinical
        // record+plan read permissions can continue only into the SAME
        // case-scoped, server-authorized plan handler (no arbitrary specialty).
        const scopedTherapistFallback = ctx?.role === 'therapist' &&
          ctx.capabilities.has('clinical.record.view') &&
          ctx.capabilities.has('treatment_plan.view') &&
          !denied('treatment_plan.create') &&
          (operation === 'create' || !denied('treatment_plan.edit'));
        if (!ctx || !(hasCapability || scopedTherapistFallback)) {
          return res.status(403).json({
            success: false, error: 'CLINIC_CAPABILITY_DENIED',
            capability: operation === 'create' ? 'treatment_plan.create' : 'treatment_plan.edit',
            message: 'Seu acesso atual nesta clínica não permite esta ação.'
          });
        }
        req.authorizationContext = ctx;
        req.effectiveClinicRole = ctx.role;
        return next();
      } catch (error) {
        return sendRouteDbError(res, 'therapeutic-plan-capability', error, {
          fallbackMessage: 'Não foi possível verificar a permissão do plano terapêutico.'
        });
      }
    };

`;
replaceOnce(post, guard + post.replace("requireClinicCapability('treatment_plan.create')", "requireScopedTherapeuticPlanCapability('create')"));
replaceOnce(patch, patch.replace("requireAnyClinicCapability('treatment_plan.edit', 'treatment_plan.create')", "requireScopedTherapeuticPlanCapability('edit')"));
assert.match(source, /participantProfessionalIds = Array\.from\(new Set\(\[responsibleProfessionalId,/);
assert.match(source, /membershipByProfessional\.get\(responsibleProfessionalId\)/);
assert.match(source, /THERAPEUTIC_PLAN_PROFESSIONAL_NOT_LINKED/);
assert.match(source, /filterTherapeuticPlanScopesForActor/);
fs.writeFileSync(path, source);
