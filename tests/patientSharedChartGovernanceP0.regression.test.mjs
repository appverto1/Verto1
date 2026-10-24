import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const authority = read('supabase/migrations/20261023235600_patient_shared_chart_case_delegation_v2.sql');
const singleton = read('supabase/migrations/20261023235700_patient_shared_chart_global_singleton_bridge_v1.sql');
const bootstrap = read('supabase/migrations/20261023235530_patient_shared_graph_registry_bootstrap_v1.sql');
const routes = read('services/patientSharedChartRoutes.ts');
const panel = read('src/components/ProfessionalSharedChartControl.tsx');
const delegation = read('src/components/PatientSharedChartDelegationPanel.tsx');
const service = read('src/services/dataService.ts');

assert.match(authority, /patient_shared_chart_case_authority_v1/);
assert.match(authority, /m\.status='active'/);
assert.match(authority, /l\.status='active'/);
assert.match(authority, /g\.revoked_at is null/);
assert.match(authority, /l\.organization_id=p_clinic_id::text/);
assert.match(authority, /lower\(m\.role\)='supervisor'/);
assert.match(authority, /\('canPublish',v_leader or v_delegate/);
assert.match(authority, /SHARED_CHART_CASE_PUBLISH_DENIED/g);
assert.match(authority, /revoke execute on function public\.set_patient_shared_chart_case_delegation_v2[\s\S]*from public,anon,authenticated/);
assert.match(authority, /on conflict \(patient_id,clinic_id,professional_user_id\)/);
assert.match(authority, /patient_shared_chart_delegation_audit/);
assert.match(authority, /enable row level security/g);
assert.match(authority, /create or replace function public\.set_patient_shared_chart_selection_v2/);
assert.match(authority, /create or replace function public\.clear_patient_shared_chart_selection_v2/);
assert.doesNotMatch(authority, /delete from public\.patients|update public\.patients/, 'never change patient records for a chart grant');

assert.match(singleton, /v_global is null then[\s\S]*return new;/,
  'unverified patient identities must retain existing per-clinic behavior');
assert.match(singleton, /SHARED_CHART_GLOBAL_OWNER_CONFLICT/);
assert.match(singleton, /for update/);
assert.match(singleton, /on conflict\(global_patient_identity_id\) do nothing/);
assert.match(singleton, /trg_sync_canonical_shared_chart_v1/);
assert.match(singleton, /trg_invalidate_patient_shared_graph_on_unlink_v1/);
assert.match(singleton, /AUTO_DISABLE/);
assert.match(singleton, /after insert or update or delete on public\.patient_shared_chart_selections/);
assert.match(singleton, /if v_previous\.status='ACTIVE'[\s\S]*return new;/,
  're-saving the same chart must avoid duplicate audit/version');
assert.doesNotMatch(singleton, /update public\.patients|insert into public\.patients/,
  'never fabricate or assign global patient identity');
assert.match(bootstrap, /create table if not exists public\.patient_shared_graph_publications/);
assert.match(bootstrap, /enable row level security/g);
assert.match(bootstrap, /revoke all on public\.patient_shared_graph_publications from public,anon,authenticated/);

assert.match(routes, /globalPatientIdentityId: patient\.data\.global_patient_identity_id \|\| null/);
assert.match(routes, /item\.clinic_id !== clinicId/);
assert.match(routes, /item\.patient_id !== patientId/);
assert.match(routes, /item\.graph_type !== row\.chart_family/);
assert.match(routes, /item\.graph_key !== row\.chart_key/);
assert.match(routes, /if \(isUuid\(globalId\)\)/,
  'only verified global IDs add an additional registry read');
assert.match(routes, /shared-chart\/delegations/g);
assert.match(routes, /set_patient_shared_chart_case_delegation_v2/);
assert.match(routes, /patient_shared_chart_case_authority_v1/);
assert.match(routes, /requireAnyClinicCapability\('reports\.clinical\.indicators', 'aba\.analytics\.view'\)/);

assert.match(panel, /governance\.canPublish/);
assert.match(panel, /governance\.canDelegate/);
assert.match(panel, /PatientSharedChartDelegationPanel/);
assert.match(delegation, /Salvar/);
assert.match(delegation, /setDraft/);
assert.match(delegation, /result\?\.success === true/);
assert.match(service, /getPatientSharedChartDelegations/);
assert.match(service, /savePatientSharedChartDelegation/);
assert.doesNotMatch(delegation, /\.rpc\(/, 'browser must not call privileged RPC');
const server = read('server.ts');
const legacyStart = server.indexOf("app.get('/api/portal/patients/:patientId/mastery-growth'");
const legacyEnd = server.indexOf("app.get('/api/portal/context'", legacyStart);
assert.ok(legacyStart > 0 && legacyEnd > legacyStart, 'legacy patient portal route exists once');
const legacyPortalRoute = server.slice(legacyStart, legacyEnd);
assert.match(legacyPortalRoute, /GRAPH_NOT_SHARED/,'legacy endpoint cannot bypass canonical graph publication');
assert.doesNotMatch(legacyPortalRoute, /await readPatientMasteryGrowthEvents/,
  'portal may not read legacy mastery graph without publication');
const patient = read('src/components/PatientDashboard.tsx');
assert.match(patient, /<AdultWellbeingTrendChart/);
assert.match(patient, /<PortalSharedClinicalChart patientId=/);
assert.doesNotMatch(patient, /<EvolutionBarChart|<CumulativeGrowthChart/);
console.log('patientSharedChartGovernanceP0.regression.test.mjs: PASS');
