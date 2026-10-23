import assert from 'node:assert/strict';
import fs from 'node:fs';
import { currentSpecialtyPlanScope } from '../src/utils/specialtyPlanRenewal';

const fono = {id:'plan-fono',mode:'specialty',status:'active',specialty:'Fonoaudiólogo',canEdit:true};
const to = {id:'plan-to',mode:'specialty',status:'active',specialty:'Terapeuta Ocupacional',canEdit:true};
const pts = {id:'plan-pts',mode:'interdisciplinary',status:'active',specialty:'Fonoaudiólogo',canEdit:true};
assert.equal(currentSpecialtyPlanScope([fono,to,pts],'Fonoaudiologia')?.id, fono.id,
  'alias values from clinical membership and previous plan must resolve to same specialty');
assert.equal(currentSpecialtyPlanScope([fono,to,pts],'Speech therapy')?.id, fono.id);
assert.equal(currentSpecialtyPlanScope([fono,to,pts],'Psicoterapia'),null,
  'another specialty cannot block creation of a new specialty scope');
assert.equal(currentSpecialtyPlanScope([pts],'Fonoaudiólogo'),null, 'PTS cannot block independent specialty plan');
assert.equal(currentSpecialtyPlanScope([{...fono,status:'completed'}],'Fonoaudiólogo'),null,
  'completed specialty plan is historical, not an active conflict');
assert.equal(currentSpecialtyPlanScope([{...fono,status:'archived'}],'Fonoaudiólogo'),null,
  'archived specialty plan is historical');
assert.equal(currentSpecialtyPlanScope([{...fono,status:'draft'}],'Fonoaudiologia')?.id, fono.id,
  'draft plans must be discoverable for edit or planning, but must not block creating another');
assert.equal(currentSpecialtyPlanScope([{...fono,status:'paused'}],'Fonoaudiologia')?.id, fono.id,
  'paused plan remains visible but does not block an independent draft');
assert.equal(currentSpecialtyPlanScope([{...fono,canEdit:false}],'Fonoaudiologia')?.canEdit, false,
  'a plan that is not editable must never be silently replaced');
assert.equal(currentSpecialtyPlanScope([{...fono,specialty:'ABA'}],'Fonoaudiologia'),null,
  'generic therapy labels must never grant clinical specialty authority');
assert.equal(currentSpecialtyPlanScope(null,'Fonoaudiologia'),null);

const panel=fs.readFileSync('src/components/TherapeuticPlanPanel.tsx','utf8');
const server=fs.readFileSync('server.ts','utf8');
assert.match(panel,/const startAsDraft = scopeDraft\.mode === 'specialty'/,
  'new independent plan may be prepared while the old active cycle continues');
assert.match(panel,/planLabel: newScopeName\.trim\(\)/,
  'named plan cycles are independent and traceable');
assert.match(panel,/Criar novo plano/);
assert.match(panel,/Nova versão/);
assert.match(panel,/Salvar nova versão/);
assert.match(panel,/startEditingScope\(response\.data\)/,
  'creating a new plan opens its own editor, not the preceding plan');
assert.doesNotMatch(panel,/setWorkspaceScopeId\(String\(existingScope\.id\)\)/,
  'new plan must not silently convert into an edit of the old plan');
assert.match(server,/startAsDraft = mode === 'specialty' && req\.body\?\.startAsDraft === true/);
assert.match(server,/activate_patient_specialty_plan_v1/,
  'plan activation must select the transactionally safe DB RPC');
assert.match(server,/therapeuticPlanScope\?\.status !== 'active'/,
  'no teaching status in a future draft plan');
assert.match(server,/THERAPEUTIC_PLAN_SCOPE_EXISTS/,
  'simultaneous active cycles remain blocked server-side');
assert.doesNotMatch(panel,/\.delete\(['"]patient_therapeutic_plans['"]\)/,
  'never delete clinical records to bypass specialty uniqueness');
console.log('specialtyPlanRenewal: independent future plans and versioned edits PASS');
