import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const localDb = readFileSync('src/services/localDb.ts', 'utf8');
const persistenceMigration = readFileSync('supabase/migrations/20260815143000_aba_measurement_v3_persistence_sync.sql', 'utf8');
const summaryMigration = readFileSync('supabase/migrations/20260815153000_aba_measurement_v3_server_summaries.sql', 'utf8');
const probeMigration = readFileSync('supabase/migrations/20260815173000_aba_measurement_v3_probes_session_fsm.sql', 'utf8');

// V3 correction/delete is append-only and server-authoritative. The browser never
// directly UPDATEs/DELETEs the immutable V3 envelope or submits canonical steps.
const revisionRouteStart = server.indexOf("'/api/aba/v3/trial-revisions'");
const revisionRouteEnd = server.indexOf("'/api/aba/v3/patients/:patientId/behavior-catalog'", revisionRouteStart);
assert.ok(revisionRouteStart >= 0 && revisionRouteEnd > revisionRouteStart, 'V3 revision route must exist');
const revisionRoute = server.slice(revisionRouteStart, revisionRouteEnd);
assert.match(revisionRoute, /requireAbaV3CollectionFeature,[\s\S]*?checkAuth,[\s\S]*?requireClinicCapability\('aba\.trial\.record'\),[\s\S]*?checkPatientAccess/);
assert.match(revisionRoute, /enforcePayloadLimit\(req, res, 48 \* 1024, 'Revisão de tentativa ABA V3'\)/);
assert.match(revisionRoute, /\.from\('aba_trials_v3'\)[\s\S]*?\.eq\('organization_id', organizationId\)[\s\S]*?\.eq\('patient_id', patientId\)/);
assert.match(revisionRoute, /assertAbaSessionCanAcceptClinicalWrite\(sessionId, organizationId, req\.session\.user, \{ allowCompletedComplement: true \}\)/);
assert.match(revisionRoute, /supabase\.rpc\('record_aba_trial_revision_v3'/);
assert.match(revisionRoute, /supabase\.rpc\('record_aba_trial_correction_v3'/);
assert.match(revisionRoute, /buildAbaV3TrialSteps\(actionKey, promptKey \|\| null\)/);
assert.match(revisionRoute, /\.select\('id,key,name,category,intrusiveness_order,active,show_in_session'\)/);
assert.doesNotMatch(revisionRoute, /req\.body\?\.steps|req\.body\.steps/);
assert.doesNotMatch(revisionRoute, /independence_score|response_score/);
assert.doesNotMatch(revisionRoute, /\.from\('aba_trials_v3'\)[\s\S]{0,600}?\.delete\(/);
assert.doesNotMatch(revisionRoute, /\.from\('aba_trials_v3'\)[\s\S]{0,600}?\.update\(/);

// Existing DB contracts already provide the atomic primitives, so this fix needs
// no destructive migration and remains compatible with data already in production.
assert.match(persistenceMigration, /create or replace function public\.record_aba_trial_revision_v3\(/i);
assert.match(persistenceMigration, /event_type in \('VOID', 'CORRECT', 'SUPERSEDE', 'RESTORE', 'ANNOTATE'\)/i);
assert.match(summaryMigration, /create or replace function public\.record_aba_trial_correction_v3\(/i);
assert.match(summaryMigration, /record_aba_trials_bulk_v3[\s\S]*?record_aba_trial_revision_v3/i);
assert.match(probeMigration, /reconcile_aba_maintenance_probe_after_revision_v3/i);
assert.match(probeMigration, /STALE_REVIEW_REQUIRED/i);

// Offline-first revision persists one client revision key and failed rejected
// trials can be explicitly discarded without touching synced clinical cache rows.
assert.match(dataService, /async saveAbaV3TrialRevision/);
assert.match(dataService, /saveOfflineFirst\([\s\S]*?'aba_v3',[\s\S]*?'\/api\/aba\/v3\/trial-revisions',[\s\S]*?'POST'/);
assert.match(dataService, /async discardAbaV3FailedTrial/);
assert.match(localDb, /discardFailedOfflineEntityMutations/);
assert.match(localDb, /row\.sync_status === 'failed' \|\| row\.sync_status === 'conflict'/);
assert.doesNotMatch(localDb.slice(localDb.indexOf('discardFailedOfflineEntityMutations'), localDb.indexOf('getRecordsByType')), /cache_records\.delete/);

// Rejected local attempts are actionable rather than permanently trapping the
// session. They still block closure until the clinician retries or explicitly
// discards the non-persisted local error, preventing silent data loss.
assert.match(sessionMode, /const retryFailedV3Trial = async/);
assert.match(sessionMode, /const discardFailedV3Trial = async/);
assert.match(sessionMode, /v3_failed_trials_require_resolution/);
assert.match(sessionMode, /Tente novamente ou descarte o erro local antes de encerrar/);
assert.match(sessionMode, /Tentar novamente/);
assert.match(sessionMode, /Descartar erro/);
assert.match(sessionMode, /Descartar esta tentativa que NÃO foi gravada no servidor/);
assert.match(sessionMode, /measurementModelVersion === 'V3'/);
assert.match(sessionMode, /score: null,[\s\S]*?abaV3ActionDisplayLabel\(v3ActionKey\)/);
assert.match(sessionMode, /record\.kind === 'trial' && record\.measurementModelVersion === 'V3' && record\.syncStatus === 'error'/);

// Synced V3 history exposes user-friendly Edit/Delete actions, but each action is
// translated into an audited V3 revision. Direct legacy edit remains blocked.
assert.match(sessionMode, /openV3Revision\(record, 'CORRECT'\)/);
assert.match(sessionMode, /openV3Revision\(record, 'VOID'\)/);
assert.match(sessionMode, /data-aba-v3-revision-modal/);
assert.match(sessionMode, /A Verto não altera a tentativa original/);
assert.match(sessionMode, /O evento original não será destruído/);
assert.match(sessionMode, /dataService\.saveAbaV3TrialRevision/);
assert.match(sessionMode, /if \(original\?\.measurementModelVersion === 'V3'\)[\s\S]*?A edição direta foi bloqueada/);

// Authorized complements remain possible after closure. ABC continues on its
// existing Legacy pilot boundary but is explicitly marked as a clinical complement.
assert.match(sessionMode, /\+ Adicionar ABC/);
assert.match(sessionMode, /if \(!sessionCompleted && !ensureSessionCanRecord\(\)\) return/);
assert.match(sessionMode, /clinical_complement: sessionCompleted \|\| undefined/);
assert.match(sessionMode, /authorizedComplement: sessionCompleted \|\| undefined/);
assert.match(server, /\/api\/aba\/abc-events[\s\S]*?allowCompletedComplement: isAuthorizedComplement/);

console.log('ABA V3 session history recovery/revision contracts: OK');
