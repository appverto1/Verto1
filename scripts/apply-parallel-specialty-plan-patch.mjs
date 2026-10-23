import assert from 'node:assert/strict';
import fs from 'node:fs';

// One-shot patch for a large server.ts, checked against exact expected anchors.
// It MUST never silently replace a differing backend version.
const edits = [
  [
    "      const mode = sanitizeString(req.body?.mode, 40).toLowerCase();\n      const idempotencyKey = sanitizeString(",
    "      const mode = sanitizeString(req.body?.mode, 40).toLowerCase();\n      const startAsDraft = mode === 'specialty' && req.body?.startAsDraft === true;\n      const planLabel = mode === 'specialty' ? sanitizeString(req.body?.planLabel, 120) : '';\n      const idempotencyKey = sanitizeString("
  ],
  [
    "            mode,\n            specialty,\n            responsibleProfessionalId,\n            participantProfessionalIds: [...participantProfessionalIds].sort(),",
    "            mode,\n            specialty,\n            startAsDraft,\n            planLabel,\n            responsibleProfessionalId,\n            participantProfessionalIds: [...participantProfessionalIds].sort(),"
  ],
  [
    "          mode,\n          specialty,\n          responsibleProfessionalId,\n          participantProfessionalIds,\n          participantSpecialties,\n          capturedAt: now",
    "          mode,\n          specialty,\n          planLabel,\n          responsibleProfessionalId,\n          participantProfessionalIds,\n          participantSpecialties,\n          capturedAt: now"
  ],
  [
    "        status: mode === 'specialty' && role === 'therapist' && responsibleProfessionalId === actorId ? 'active' : 'draft',",
    "        status: mode === 'specialty' && role === 'therapist' && responsibleProfessionalId === actorId && !startAsDraft ? 'active' : 'draft',"
  ],
  [
    "                : 'Já existe um plano ativo para esta especialidade.'",
    "                : 'Já existe um plano ativo desta especialidade. Crie o novo plano como rascunho para prepará-lo sem alterar as sessões atuais.'"
  ],
  [
    "      const { data, error } = await supabase.rpc('update_patient_therapeutic_plan_v3', {\n        p_plan_id: planId,\n        p_organization_id: organizationId,\n        p_patient_id: patientId,\n        p_expected_version: expectedVersion,\n        p_common_objectives: commonObjectives,\n        p_specialty_objectives: specialtyObjectives,\n        p_pts_payload: sanitizeClinicalPayload(ptsPayload),\n        p_review_due_date: reviewDueDate,\n        p_last_reviewed_at: lastReviewedAt,\n        p_status: nextStatus,\n        p_actor_id: actorId,\n        p_now: now,\n      });",
    "      // Activating a prepared specialty cycle must complete the previous active\n      // cycle and activate the new one atomically in the database.\n      const switchingSpecialtyCycle =\n        String(existing.mode || '').toLowerCase() === 'specialty' &&\n        nextStatus === 'active' && currentStatus !== 'active';\n      const rpcName = switchingSpecialtyCycle\n        ? 'activate_patient_specialty_plan_v1'\n        : 'update_patient_therapeutic_plan_v3';\n      const { data, error } = await supabase.rpc(rpcName, {\n        p_plan_id: planId,\n        p_organization_id: organizationId,\n        p_patient_id: patientId,\n        p_expected_version: expectedVersion,\n        p_common_objectives: commonObjectives,\n        p_specialty_objectives: specialtyObjectives,\n        p_pts_payload: sanitizeClinicalPayload(ptsPayload),\n        p_review_due_date: reviewDueDate,\n        p_last_reviewed_at: lastReviewedAt,\n        ...(switchingSpecialtyCycle\n          ? { p_actor_can_manage_all: canManageAny }\n          : { p_status: nextStatus }),\n        p_actor_id: actorId,\n        p_now: now,\n      });"
  ],
  [
    "        if (code.includes('PGRST202') || code.includes('update_patient_therapeutic_plan_v3')) {\n          return res.status(503).json({ success: false, error: 'PTS_SCHEMA_MIGRATION_REQUIRED', message: 'A atualização estrutural do PTS ainda não foi aplicada no banco.' });\n        }",
    "        if (code.includes('SPECIALTY_PLAN_SCOPE_DENIED')) {\n          return res.status(403).json({ success: false, error: 'SPECIALTY_PLAN_SCOPE_DENIED',\n            message: 'A ativação exige autorização sobre o plano vigente e o futuro, ou permissão da gestão clínica.' });\n        }\n        if (code.includes('SPECIALTY_PLAN_NOT_ACTIVATABLE') || code.includes('SPECIALTY_PLAN_TRANSITION_FAILED')) {\n          return res.status(409).json({ success: false, error: 'SPECIALTY_PLAN_ACTIVATION_CONFLICT',\n            message: 'O plano não pode ser ativado neste estado. Atualize e confirme qual plano está vigente.' });\n        }\n        if (code.includes('PGRST202') || code.includes(rpcName)) {\n          return res.status(503).json({ success: false, error: 'THERAPEUTIC_PLAN_SCHEMA_MIGRATION_REQUIRED',\n            message: 'A migração de planos terapêuticos ainda não foi aplicada no Staging.' });\n        }"
  ],
  [
    "      const status = canApprove\n        ? (['draft', 'teaching', 'maintenance'].includes(requestedStatus) ? requestedStatus : 'teaching')\n        : (requestedStatus === 'draft' ? 'draft' : specialistCanActivate ? 'teaching' : 'draft');",
    "      const status = therapeuticPlanScope?.status !== 'active'\n        ? 'draft' // Future plans are editable, but cannot collect clinical data.\n        : canApprove\n          ? (['draft', 'teaching', 'maintenance'].includes(requestedStatus) ? requestedStatus : 'teaching')\n          : (requestedStatus === 'draft' ? 'draft' : specialistCanActivate ? 'teaching' : 'draft');"
  ]
];
const file='server.ts';
let content=fs.readFileSync(file,'utf8');
for(let i=0;i<edits.length;i++){
 const [before,after]=edits[i];
 assert.equal(content.split(before).length-1,1,'server.ts anchor '+i+' changed: aborting');
 content=content.replace(before,after);
}
assert.match(content,/switchingSpecialtyCycle/);
assert.match(content,/startAsDraft/);
assert.match(content,/specialistCanActivate/);
fs.writeFileSync(file,content);
console.log('Applied '+edits.length+' exact backend edits for independent specialty cycles');
