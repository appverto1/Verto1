import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pendingSpecialistProgramActivations } from '../src/utils/specialistProgramActivation';

const actorId='11111111-1111-4111-8111-111111111111';
const patientId='22222222-2222-4222-8222-222222222222';
const scope={id:'scope-specialty',mode:'specialty',status:'active',responsible_professional_id:actorId,canEdit:true};
const pending={id:'program-legacy',status:'awaiting_approval',version:3,patient_id:patientId,therapeutic_plan_id:scope.id};
const input={programs:[pending],planScopes:[scope],actorId,actorRole:'therapist',patientId};
const eligible=pendingSpecialistProgramActivations(input);
assert.deepEqual(eligible,[{id:'program-legacy',version:3}]);
assert.deepEqual(pendingSpecialistProgramActivations({...input,actorRole:'director'}),[], 'director must not implicitly approve clinical programs');
assert.deepEqual(pendingSpecialistProgramActivations({...input,readOnlyHistory:true}),[], 'historical mode cannot mutate');
assert.deepEqual(pendingSpecialistProgramActivations({...input,actorId:'different-user'}),[], 'only plan specialist');
assert.deepEqual(pendingSpecialistProgramActivations({...input,planScopes:[{...scope,canEdit:false}]}),[], 'no write permission');
assert.deepEqual(pendingSpecialistProgramActivations({...input,planScopes:[{...scope,status:'draft'}]}),[], 'draft plan cannot activate');
assert.deepEqual(pendingSpecialistProgramActivations({...input,planScopes:[{...scope,status:'paused'}]}),[], 'paused plan cannot activate');
assert.deepEqual(pendingSpecialistProgramActivations({...input,planScopes:[{...scope,mode:'interdisciplinary'}]}),[], 'PTS requires its own review');
assert.deepEqual(pendingSpecialistProgramActivations({...input,programs:[{...pending,status:'draft'}]}),[], 'intentional draft not activated');
assert.deepEqual(pendingSpecialistProgramActivations({...input,programs:[{...pending,status:'paused'}]}),[], 'paused program preserved');
assert.deepEqual(pendingSpecialistProgramActivations({...input,programs:[{...pending,patient_id:'another-patient'}]}),[], 'patient scope enforced');
assert.deepEqual(pendingSpecialistProgramActivations({...input,programs:[{...pending,version:0}]}),[], 'no unsafe unversioned mutation');

const panel=fs.readFileSync('src/components/TherapeuticPlanPanel.tsx','utf8');
const programWriters=fs.readFileSync('services/therapeuticProgramWriteHandlers.ts','utf8');
const createPlanHandler=fs.readFileSync('services/therapeuticPlanCreateHandler.ts','utf8');
assert.match(panel,/pendingSpecialistProgramActivations\(/);
assert.match(panel,/updateTherapeuticProgramStatus\(patientId, next\.id, \{/);
assert.match(panel,/status: 'teaching',[\s\S]*?expectedVersion: next\.version/);
assert.match(panel,/idempotencyKey: `specialist-plan-activation:/);
assert.match(panel,/if \(result\?\.success === false\)[\s\S]*?setError\(/);
assert.match(panel,/await loadPlan\(true\)/);
assert.match(createPlanHandler,/status: mode === 'specialty' && role === 'therapist' && responsibleProfessionalId === actorId && !startAsDraft \? 'active' : 'draft'/,
  'new therapist-authored specialty scope is active unless deliberately prepared as draft');
assert.match(programWriters,/const specialistCanActivate = !canApprove && therapeuticPlanScope\?\.status === 'active'/);
assert.match(programWriters,/specialistCanActivate \? 'teaching' : 'draft'/);
assert.match(programWriters,/if \(!isTherapeuticPlanManager\(role\) && status === 'teaching'\)[\s\S]*?canActivateSpecialtyPlanForCase\(/,
  'server remains authoritative over transitions');
console.log('specialistProgramImmediateActivation.test.ts: PASS');
