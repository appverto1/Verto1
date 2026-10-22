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
  'draft plan occupies the canonical unique slot');
assert.equal(currentSpecialtyPlanScope([{...fono,status:'paused'}],'Fonoaudiologia')?.id, fono.id,
  'paused plan occupies the canonical unique slot');
assert.equal(currentSpecialtyPlanScope([{...fono,canEdit:false}],'Fonoaudiologia')?.canEdit, false,
  'a plan that is not editable must never be silently replaced');
assert.equal(currentSpecialtyPlanScope([{...fono,specialty:'ABA'}],'Fonoaudiologia'),null,
  'generic therapy labels must never grant clinical specialty authority');
assert.equal(currentSpecialtyPlanScope(null,'Fonoaudiologia'),null);

const panel=fs.readFileSync('src/components/TherapeuticPlanPanel.tsx','utf8');
const server=fs.readFileSync('server.ts','utf8');
assert.match(panel,/currentSpecialtyPlanScope\(specialtyScopes, derivedSpecialty\)/,
  'POST creation should check for a current same-specialty plan first');
assert.match(panel,/if \(existingScope\.canEdit !== true\)[\s\S]*?return;/,
  'no cross-professional plan takeover');
assert.match(panel,/setWorkspaceScopeId\(String\(existingScope\.id\)\);[\s\S]*?startEditingScope\(existingScope\)/,
  'own current plan opens versioned editor instead of duplicate POST');
assert.match(panel,/Nova versão/);
assert.match(panel,/Salvar nova versão/);
assert.match(server,/THERAPEUTIC_PLAN_SCOPE_EXISTS/,
  'server retains canonical uniqueness and rejects duplicate posts');
assert.match(server,/rpc\('update_patient_therapeutic_plan_v3'/,
  'versioned save persists through existing DB transaction');
assert.doesNotMatch(panel,/\.delete\(['"]patient_therapeutic_plans['"]\)/,
  'do not delete clinical plans to bypass a uniqueness constraint');
console.log('specialtyPlanRenewal: existing plan routes to safe versioned workflow PASS');
