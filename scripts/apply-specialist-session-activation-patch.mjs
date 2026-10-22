import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'server.ts';
let source = fs.readFileSync(path, 'utf8');
const edits = [
  [
    "import { groupCalendarMetadata,",
    "import { canActivateSpecialtyPlanForCase } from './services/therapeuticSpecialistActivation';\nimport { groupCalendarMetadata,"
  ],
  [
    "        request_hash: requestHash,\n        status: 'draft',\n        edit_version: 1,",
    "        request_hash: requestHash,\n        // Self-authored specialty plans are eligible for immediate clinical use.\n        // Membership, case link and specialty were verified above. PTS remains draft.\n        status: mode === 'specialty' && role === 'therapist' && responsibleProfessionalId === actorId ? 'active' : 'draft',\n        edit_version: 1,"
  ],
  [
    "      const hasSpecialtyObjectivesUpdate =\n",
    "      if (!canManageAny && nextStatus === 'active' && currentStatus !== 'active') {\n        const canActivate = await canActivateSpecialtyPlanForCase({\n          supabase, clinicId, organizationId, patientId, actorId, actorRole: role, plan: existing\n        });\n        if (!canActivate) return res.status(403).json({\n          success: false, error: 'THERAPEUTIC_SPECIALIST_ACTIVATION_DENIED',\n          message: 'A ativação exige que você seja o especialista responsável, com vínculo clínico ativo nesta especialidade.'\n        });\n      }\n\n      const hasSpecialtyObjectivesUpdate =\n"
  ],
  [
    "      const canApprove = isTherapeuticPlanManager(role);\n      const requestedStatus = sanitizeString(req.body?.status, 40).toLowerCase();\n      const status = canApprove\n        ? (['draft', 'teaching', 'maintenance'].includes(requestedStatus) ? requestedStatus : 'teaching')\n        : (requestedStatus === 'draft' ? 'draft' : 'awaiting_approval');",
    "      const canApprove = isTherapeuticPlanManager(role);\n      const requestedStatus = sanitizeString(req.body?.status, 40).toLowerCase();\n      const specialistCanActivate = !canApprove && therapeuticPlanScope?.status === 'active'\n        && await canActivateSpecialtyPlanForCase({ supabase, clinicId, patientId,\n          actorId, actorRole: role, organizationId, plan: therapeuticPlanScope });\n      const status = canApprove\n        ? (['draft', 'teaching', 'maintenance'].includes(requestedStatus) ? requestedStatus : 'teaching')\n        : (requestedStatus === 'draft' ? 'draft' : specialistCanActivate ? 'teaching' : 'draft');"
  ],
  [
    "      if (!isTherapeuticPlanManager(role) && status !== 'awaiting_approval') {\n        return res.status(403).json({ success: false, error: 'Somente supervisão ou coordenação pode alterar a fase oficial do programa.' });\n      }",
    "      if (!isTherapeuticPlanManager(role) && !['awaiting_approval', 'teaching'].includes(status)) {\n        return res.status(403).json({ success: false, error: 'Esta fase requer gestão clínica.' });\n      }"
  ],
  [
    "      const therapeuticPlanId = sanitizeString(currentProgram.therapeutic_plan_id, 120);\n      if (therapeuticPlanId && ['teaching', 'maintenance'].includes(status)) {",
    "      const therapeuticPlanId = sanitizeString(currentProgram.therapeutic_plan_id, 120);\n      if (!isTherapeuticPlanManager(role) && status === 'teaching' && !therapeuticPlanId) {\n        return res.status(403).json({ success: false, error: 'THERAPEUTIC_SPECIALIST_ACTIVATION_DENIED' });\n      }\n      if (therapeuticPlanId && ['teaching', 'maintenance'].includes(status)) {"
  ],
  [
    "          .from('patient_therapeutic_plans')\n          .select('id,status')\n          .eq('id', therapeuticPlanId)",
    "          .from('patient_therapeutic_plans')\n          .select('id,status,mode,specialty,clinic_id,organization_id,patient_id,responsible_professional_id')\n          .eq('id', therapeuticPlanId)"
  ],
  [
    "        if (!parentPlan?.id) return res.status(409).json({ success: false, error: 'THERAPEUTIC_PLAN_NOT_FOUND' });\n        const parentPlanStatus",
    "        if (!parentPlan?.id) return res.status(409).json({ success: false, error: 'THERAPEUTIC_PLAN_NOT_FOUND' });\n        if (!isTherapeuticPlanManager(role) && status === 'teaching') {\n          const mayActivate = await canActivateSpecialtyPlanForCase({\n            supabase, clinicId, organizationId, patientId, actorId, actorRole: role, plan: parentPlan\n          });\n          if (!mayActivate) return res.status(403).json({\n            success: false, error: 'THERAPEUTIC_SPECIALIST_ACTIVATION_DENIED',\n            message: 'Apenas o especialista responsável por este plano ativo pode ativar o programa para as sessões.'\n          });\n        }\n        const parentPlanStatus"
  ]
];
for (const [from,to] of edits) {
  assert.equal(source.split(from).length,2,`Expected one exact server anchor: ${from.slice(0,68)}`);
  source = source.replace(from,to);
}
assert.match(source,/canActivateSpecialtyPlanForCase/);
assert.match(source,/THERAPEUTIC_SPECIALIST_ACTIVATION_DENIED/);
fs.writeFileSync(path,source);
console.log('Specialist-owned therapeutic plan and program lifecycle patch applied');
