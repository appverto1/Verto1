import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(new URL('../src/components/TherapeuticPlanPanel.tsx', import.meta.url), 'utf8');
const server = readModularServerSource();

assert.match(panel, /const changePlanScopeStatus = async \(scope: any, nextStatus: 'active' \| 'paused'\)/);
assert.match(panel, /updatePatientTherapeuticPlanScope\(patientId, scopeId, \{/);
assert.match(panel, /expectedVersion: Number\(scope\?\.edit_version \|\| 1\)/);
assert.match(panel, /status: nextStatus/);
assert.match(panel, /Publicar e ativar/);
assert.match(panel, /Retomar plano/);
assert.match(panel, /Pausar plano/);
assert.match(panel, /scopeIsDraft && canEditThisScope/);
assert.match(panel, /scopeIsPaused && canEditThisScope/);
assert.match(panel, /scopeStatus === 'active' && canEditThisScope/);

assert.match(server, /draft: \['draft', 'active', 'archived'\]/);
assert.match(server, /active: \['active', 'paused', 'completed', 'archived'\]/);
assert.match(server, /paused: \['paused', 'active', 'completed', 'archived'\]/);
assert.match(server, /THERAPEUTIC_PLAN_STATUS_TRANSITION_INVALID/);

console.log('Block 6 Test 7 plan activation regression: PASS');
