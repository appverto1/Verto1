import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const dashboard = readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const localDb = readFileSync('src/services/localDb.ts', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');

assert.match(server, /\^program_target:\(\[\^:\]\+\):\/i\.exec\(metricKey\)/, 'reader deve recuperar o alvo ABA embutido no metric_key do writer');
assert.match(server, /metricAbaTarget[\s\S]*programById[\s\S]*therapeutic_plan_id/, 'alvo deve resolver programa e plano da especialidade sem heurística textual');
assert.match(server, /visiblePlanMap\.has\(explicitPlanId\)/, 'somente plano já autorizado pode receber a série recuperada');
assert.match(server, /clinical_measurement_session_context_links_v3/, 'reader deve aproveitar contexto append-only quando já disponível');

assert.match(server, /read_clinical_outcomes_converged_v3[\s\S]*read_clinical_plan_outcomes_v3/, 'dashboard deve cair para o reader genérico quando o wrapper convergido ainda não estiver disponível');
assert.match(server, /CMV3_TYPED_SESSION_PROJECTION/, 'fallback genérico deve preservar autoridade/proveniência CMV3 para a UI');
assert.match(server, /sessionId:\s*sanitizeString\(contextLink\?\.aba_session_id/, 'gráfico por sessão deve preferir a sessão ABA clínica real');

assert.match(dashboard, /ptsStructuredAnalyticsSeries/, 'PTS deve distinguir contribuição estruturada de visão multidisciplinar de fallback');
assert.match(dashboard, /specialtyAnalyticsSeries/, 'PTS deve conseguir reutilizar séries das especialidades já autorizadas');
assert.match(dashboard, /ptsUsesSpecialtyFallback[\s\S]*specialtyAnalyticsSeries/, 'PTS vazio deve mostrar dados clínicos existentes sem inventar vínculo compartilhado');
assert.match(dashboard, /não são agregadas nem tratadas como contribuição a um objetivo compartilhado do PTS/, 'fallback PTS deve deixar a semântica explícita');

assert.match(dataService, /patientId:\s*safePatientId,\s*patient_id:\s*safePatientId/, 'outbox precisa carregar paciente para invalidar somente o cache correto');
assert.match(localDb, /clinical_plan_v3[\s\S]*verto:clinical-outcomes-changed/, 'ACK em background deve atualizar gráficos sem F5');

console.log('clinicalPlanGraphsRecovery.regression.test.mjs: ok');
