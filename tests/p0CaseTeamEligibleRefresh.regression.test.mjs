import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const gate = readFileSync('scripts/pre-main-gate.mjs', 'utf8');

// Regression: moving a receptionist into a clinical membership makes them eligible
// without refreshing the browser. The newly opened manager must read current
// tenant-scoped membership data rather than a stale preloaded parent prop.
assert.match(panel, /import \{ getSupabase \} from '\.\.\/lib\/supabase'/);
assert.match(panel, /const refreshAvailableProfessionals = async \(\) =>/);
assert.match(panel, /await api\('\/api\/clinic\/members', \{ cache: 'no-store' \}\)/);
assert.match(panel, /if \(!result\?\.success \|\| !Array\.isArray\(result\?\.data\)\)/);
assert.match(panel, /isPatientCaseTeamMembershipRole\(member\?\.role\)/);
assert.match(panel, /String\(member\?\.status \|\| ''\)\.toLowerCase\(\) === 'active'/);
assert.match(panel, /resolveProfessionalProfileSpecialty\(member\)\.length >= 2/);
assert.match(panel, /const requestSeq = \+\+candidatesRequestSeqRef\.current/);
assert.match(panel, /if \(candidatesRequestSeqRef\.current !== requestSeq\) return/);
assert.match(panel, /candidatesRequestSeqRef\.current \+= 1/);
assert.match(panel, /if \(effectiveCanManage\) void refreshAvailableProfessionals\(\)/);
assert.match(panel, /\(verifiedProfessionals \|\| \[\]\)\.filter/);
assert.doesNotMatch(panel, /\(\) => professionals\.filter\(\(professional\)/);
assert.match(panel, /refreshingCandidates \|\| verifiedProfessionals === null \|\| candidateLoadError/);
assert.match(panel, /disabled=\{refreshingCandidates \|\| verifiedProfessionals === null \|\| Boolean\(candidateLoadError\)\}/);
assert.match(panel, /'Atualizando profissionais…'/);
assert.match(panel, /Tentar novamente/);
assert.match(panel, /await api\(`\/api\/patients\/\$\{encodeURIComponent\(patientId\)\}\/professional-links`/);
assert.match(gate, /tests\/p0CaseTeamEligibleRefresh\.regression\.test\.mjs/);
console.log('p0CaseTeamEligibleRefresh.regression.test.mjs: PASS (fresh authoritative candidates, tenant-scoped retry, no F5)');
