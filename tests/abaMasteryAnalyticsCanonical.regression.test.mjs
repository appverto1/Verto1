import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const server = read('server.ts');
const chart = read('src/components/CumulativeGrowthChart.tsx');
const detail = read('src/components/PatientDetailView.tsx');
const dashboard = read('src/components/PatientDashboard.tsx');
const plan = read('src/components/TherapeuticPlanPanel.tsx');
const service = read('src/services/dataService.ts');

assert(server.includes("/api/portal/patients/:patientId/mastery-growth"), 'portal deve ter rota canônica de crescimento por maestria');
assert(server.includes("/api/aba/patients/:patientId/mastery-growth"), 'painel clínico deve usar a mesma fonte canônica de maestria');
assert(server.includes("status.eq.MASTERED_APPROVED"), 'crescimento canônico deve considerar somente maestria aprovada');
assert(server.includes(".eq('clinic_id', clinicId)"), 'leitura de maestria deve permanecer explicitamente limitada à clínica');
assert(server.includes("seenTargets.has(targetKey)"), 'mesma habilidade não pode incrementar o acumulado mais de uma vez');
assert(server.includes("Number.isNaN(evaluatedAtDate.getTime())"), 'timestamp inválido não pode virar um ponto artificial na data atual');

assert(service.includes('getPatientMasteryGrowth'), 'dataService deve centralizar a leitura do crescimento de maestria');
assert(chart.includes('useCanonicalMastery'), 'gráfico deve possuir modo canônico explícito');
assert(chart.includes('getPatientMasteryGrowth'), 'gráfico canônico deve ler eventos de maestria, não inferir score=max');
assert(chart.includes('Total acumulado até esta data'), 'tooltip deve distinguir total acumulado de aquisições do dia');
assert(chart.includes('novas habilidades nesta data') || chart.includes('nova{row.added'), 'tooltip deve informar quantas novas maestrias ocorreram na data');
assert(chart.includes('canonicalMasteryError'), 'erro da fonte canônica não deve ser apresentado como ausência clínica de dados');

const cumulativeCalls = [...detail.matchAll(/<CumulativeGrowthChart[\s\S]*?\/>/g)].map((match) => match[0]);
assert(cumulativeCalls.length >= 2, 'prontuário deve manter os gráficos cumulativos existentes');
assert(cumulativeCalls.every((call) => call.includes('useCanonicalMastery={useCanonicalMasteryGrowth}')), 'gráfico cumulativo clínico ABA/KIDS deve ativar a fonte canônica');
const portalShared = read('src/components/PortalSharedClinicalGraph.tsx');
assert(dashboard.includes('<PortalSharedClinicalGraph'), 'portal KIDS só deve exibir gráfico publicado');
assert(!dashboard.includes('<CumulativeGrowthChart'), 'crescimento cumulativo não pode voltar sem compartilhamento');
assert(portalShared.includes('useCanonicalMastery') && portalShared.includes('portalMode'), 'gráfico de maestria autorizado preserva fonte canônica');
assert(server.includes("error: 'GRAPH_NOT_SHARED'"), 'endpoint legado de maestria não pode ignorar autorização de publicação');

assert(dashboard.includes("subject === 'milestone_event' || text.startsWith('MILESTONE_EVENT|')"), 'payload técnico de milestone deve continuar disponível só para reconciliação interna');
assert(dashboard.includes('isSystemPortalMilestoneEvent(note)'), 'payload técnico de milestone não pode ser renderizado como anotação da família');
assert(detail.includes("subject === 'milestone_event' || rawText.startsWith('MILESTONE_EVENT|')"), 'prontuário não deve misturar evento técnico de milestone à timeline familiar');

assert(plan.includes('masteryEvaluations = []'), 'Plano deve aceitar avaliações de maestria já carregadas, sem nova consulta');
assert(plan.includes("status === 'MASTERED_APPROVED'"), 'Plano só deve converter avaliação aprovada em alvo dominado');
assert(plan.includes('criterionProgressPercent'), 'Plano deve refletir progresso parcial do critério sem chamar de domínio');
assert(detail.includes('masteryEvaluations={abaMasteryEvaluationsForPlan}'), 'Prontuário deve reaproveitar avaliações persistidas e o preview vivo da sessão no Plano');
assert(detail.includes('approvedMasteryTargetCount'), 'fallback de resumo não pode contar toda avaliação como alvo dominado');

console.log('abaMasteryAnalyticsCanonical.regression.test.mjs: ok');
