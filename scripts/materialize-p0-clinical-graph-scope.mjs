import fs from 'node:fs';

const path = 'server.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes("from './src/utils/clinicalGraphScope';")) {
  console.log('graph scope patch already materialized');
  process.exit(0);
}

const replaceOnce = (from, to, label) => {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`missing patch anchor: ${label}`);
  if (source.indexOf(from, index + from.length) >= 0) throw new Error(`ambiguous patch anchor: ${label}`);
  source = source.slice(0, index) + to + source.slice(index + from.length);
};

replaceOnce(
`import {
  normalizeClinicalSpecialty,
  readClinicalSpecialtyFromSource
} from './src/utils/clinicalSpecialties';`,
`import {
  normalizeClinicalSpecialty,
  readClinicalSpecialtyFromSource
} from './src/utils/clinicalSpecialties';
import {
  clinicalGraphLegacySnapshotVisibleToActor,
  filterClinicalGraphPlanScopesForActor
} from './src/utils/clinicalGraphScope';`,
  'graph scope import'
);

replaceOnce(
`          if (evidence.activeSupervisionLink) {
            req.patientSupervisionLink = evidence.activeSupervisionLink;
          }
          return next();`,
`          if (evidence.activeSupervisionLink) {
            req.patientSupervisionLink = evidence.activeSupervisionLink;
          }
          req.patientActorSpecialty =
            normalizeClinicalSpecialty(evidence.activeProfessionalProfile?.specialty) || null;
          return next();`,
  'patient actor specialty evidence'
);

replaceOnce(
`      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const accessContext = { actorId, actorRole, professionalLinks: linkResult.data || [], supervisionLinks: supervisionResult.data || [] };
      const allPlans = planResult.data || [];
      const visiblePlans = filterTherapeuticPlanScopesForActor(allPlans, accessContext).map((plan: any) => ({
        ...plan,
        canEdit: canEditTherapeuticPlanScope(plan, accessContext)
      }));
      const visiblePlanIds = new Set(visiblePlans.map((plan: any) => String(plan.id)));
      const visiblePrograms = filterTherapeuticPlanProgramsForActor(programResult.data || [], allPlans, accessContext);`,
`      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const actorSpecialty =
        normalizeClinicalSpecialty(
          req.patientActorSpecialty ||
          req.session.user?.activeAccessContext?.specialty
        ) || null;
      const hasGraphSupervisionAccess =
        actorRole === 'supervisor' || Boolean(req.patientSupervisionLink);
      const graphActorScope = {
        actorRole,
        actorSpecialty,
        hasSupervisionAccess: hasGraphSupervisionAccess
      };
      const accessContext = { actorId, actorRole, professionalLinks: linkResult.data || [], supervisionLinks: supervisionResult.data || [] };
      const allPlans = planResult.data || [];
      const rebacVisiblePlans = filterTherapeuticPlanScopesForActor(allPlans, accessContext);
      const graphVisiblePlanScopes = filterClinicalGraphPlanScopesForActor(rebacVisiblePlans, graphActorScope);
      const visiblePlans = graphVisiblePlanScopes.map((plan: any) => ({
        ...plan,
        canEdit: canEditTherapeuticPlanScope(plan, accessContext)
      }));
      const visiblePlanIds = new Set(visiblePlans.map((plan: any) => String(plan.id)));
      const visiblePrograms = filterTherapeuticPlanProgramsForActor(programResult.data || [], graphVisiblePlanScopes, accessContext);`,
  'clinical outcomes graph scope'
);

replaceOnce(
`        const planId = program?.therapeutic_plan_id ? String(program.therapeutic_plan_id) : null;
        if (planId && !visiblePlanIds.has(planId)) return null;
        return {`,
`        const planId = program?.therapeutic_plan_id ? String(program.therapeutic_plan_id) : null;
        if (planId && !visiblePlanIds.has(planId)) return null;
        if (
          !planId &&
          !clinicalGraphLegacySnapshotVisibleToActor(point.specialty, graphActorScope)
        ) return null;
        return {`,
  'legacy snapshot specialty guard'
);

fs.writeFileSync(path, source);
console.log('graph scope patch materialized');
