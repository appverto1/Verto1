import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aggregateAbaPointsBySpecialty, filterAbaPointsByHistoricalScope } from '../src/utils/abaSpecialtyAnalytics';
import { sanitizeTherapeuticTemplateContent } from '../src/utils/therapeuticTemplatePrivacy';

const sanitized = sanitizeTherapeuticTemplateContent({
  title: 'Plano de Maria Silva',
  patientName: 'Maria Silva',
  cpf: '123.456.789-00',
  dateOfBirth: '2018-01-01',
  guardian: { name: 'Responsável privado' },
  objectives: ['Maria Silva deverá solicitar ajuda', 'Objetivo funcional sem identificação'],
  attachmentUrl: 'https://private.example/file.pdf'
}, 'Maria Silva');
assert.equal(sanitized.redacted, true);
assert.equal('cpf' in sanitized.sanitized, false);
assert.equal('patientName' in sanitized.sanitized, false);
assert.equal('guardian' in sanitized.sanitized, false);
assert.equal('attachmentUrl' in sanitized.sanitized, false);
assert.equal(JSON.stringify(sanitized.sanitized).includes('Maria Silva'), false);
assert.equal(JSON.stringify(sanitized.sanitized).includes('123.456.789-00'), false);
const identifiers = sanitizeTherapeuticTemplateContent({
  email: 'responsavel@exemplo.com',
  phone: '(11) 99999-9999',
  individualNotes: 'nota que não deve ser reutilizada',
  sections: [{ title: 'Estrutura reutilizável' }]
});
assert.equal(identifiers.redacted, true);
assert.equal(JSON.stringify(identifiers.sanitized).includes('responsavel@exemplo.com'), false);
assert.equal(JSON.stringify(identifiers.sanitized).includes('99999-9999'), false);

const points = [
  { specialty: 'Psicologia', professionalId: 'p1', metricType: 'BEHAVIOR_FREQUENCY', value: 2, changedAt: '2026-07-01' },
  { specialty: 'Psicologia', professionalId: 'p1', metricType: 'BEHAVIOR_FREQUENCY', value: 3, changedAt: '2026-07-02' },
  { specialty: 'Fonoaudiologia', professionalId: 'p2', metricType: 'BEHAVIOR_FREQUENCY', value: 4, changedAt: '2026-07-02' },
  { specialty: 'Psicologia', professionalId: 'p1', metricType: 'TARGET_ACCURACY', value: 50, attemptsCount: 10, changedAt: '2026-07-01' },
  { specialty: 'Psicologia', professionalId: 'p1', metricType: 'TARGET_ACCURACY', value: 100, attemptsCount: 30, changedAt: '2026-07-02' },
  { specialty: null, professionalId: null, metricType: 'MASTERY_STATUS', value: 1, changedAt: '2026-07-01' },
  { specialty: null, professionalId: null, metricType: 'MASTERY_STATUS', value: 3, changedAt: '2026-07-02' }
];
const metrics = aggregateAbaPointsBySpecialty(points);
assert.equal(metrics.find((row) => row.specialty === 'Psicologia' && row.metricType === 'BEHAVIOR_FREQUENCY')?.value, 5);
assert.equal(metrics.find((row) => row.specialty === 'Psicologia' && row.metricType === 'TARGET_ACCURACY')?.value, 87.5);
assert.equal(metrics.find((row) => row.specialty === 'Especialidade não informada' && row.metricType === 'MASTERY_STATUS')?.value, 3);
assert.equal(filterAbaPointsByHistoricalScope(points, { specialty: 'Fonoaudiologia' }).length, 1);
assert.equal(filterAbaPointsByHistoricalScope(points, { professionalId: 'p1' }).length, 4);

const durationAndIntervals = aggregateAbaPointsBySpecialty([
  { specialty: 'Psicologia', metricType: 'BEHAVIOR_DURATION_TOTAL', value: 30 },
  { specialty: 'Psicologia', metricType: 'BEHAVIOR_DURATION_TOTAL', value: 45 },
  { specialty: 'Psicologia', metricType: 'BEHAVIOR_INTERVAL_OCCURRENCE', value: 50, attemptsCount: 10 },
  { specialty: 'Psicologia', metricType: 'BEHAVIOR_INTERVAL_OCCURRENCE', value: 100, attemptsCount: 30 },
  { specialty: 'Fonoaudiologia', metricType: 'LATENCY', value: 4 },
  { specialty: 'Fonoaudiologia', metricType: 'LATENCY', value: 8 }
]);
assert.equal(durationAndIntervals.find((row) => row.metricType === 'BEHAVIOR_DURATION_TOTAL')?.value, 75);
assert.equal(durationAndIntervals.find((row) => row.metricType === 'BEHAVIOR_INTERVAL_OCCURRENCE')?.value, 87.5);
assert.equal(durationAndIntervals.find((row) => row.metricType === 'LATENCY')?.value, 6);

const migration = fs.readFileSync(
  'supabase/migrations/20260728010000_sales_multidisciplinary_commercial_evolution.sql',
  'utf8'
);
const server = fs.readFileSync('server.ts', 'utf8');
const planPanel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const linksPanel = fs.readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const library = fs.readFileSync('src/components/TherapeuticProgramLibrary.tsx', 'utf8');
const abaCharts = fs.readFileSync('src/components/AbaClinicalChartsPanel.tsx', 'utf8');
assert.match(migration, /create table if not exists public\.patient_professional_links/);
assert.match(migration, /if active_count >= 5 then raise exception 'PATIENT_PROFESSIONAL_LINK_LIMIT_REACHED'/);
assert.match(migration, /idx_patient_professional_links_active_unique/);
assert.match(migration, /idx_patient_professional_links_one_primary/);
assert.match(migration, /historicalRead/);
assert.match(migration, /historicalAccessEndedAt/);
assert.match(migration, /authorized_reader_ids/);
assert.match(migration, /perform public\.end_patient_professional_link_v1/, 'substituir o principal deve preservar o mesmo encerramento histórico');
assert.match(migration, /status = 'ended'/, 'vínculos anteriores devem ser encerrados, não apagados');
assert.match(migration, /insert into public\.patient_professional_links[\s\S]*from public\.patients p/, 'vínculo legado deve ser migrado');
assert.match(migration, /patient_professional_links_tenant_select/);
assert.match(migration, /patient_therapeutic_plans_tenant_select/);
assert.match(migration, /patient_therapeutic_plan_versions/);
assert.match(migration, /mode in \('specialty','interdisciplinary'\)/);
assert.match(migration, /idx_therapeutic_plan_active_specialty/);
assert.match(migration, /source_template_version/);
assert.match(migration, /snapshot_aba_program_template_version_v1/);
assert.match(migration, /snapshot_aba_specialty_v1/);
assert.match(migration, /aggregation_weight_snapshot/);
assert.match(migration, /having count\(distinct link\.specialty\) = 1/);
assert.match(migration, /Especialidade não informada/);
assert.doesNotMatch(migration, /delete from public\.patient_professional_links|delete from public\.patient_therapeutic_plans/i);

assert.match(server, /THERAPEUTIC_PLAN_VERSION_CONFLICT/);
assert.match(server, /\.eq\('edit_version', expectedVersion\)/);
assert.match(server, /THERAPEUTIC_PLAN_PROFESSIONAL_NOT_LINKED/);
assert.match(server, /meta: \{ queryCount: 7, batched: true/);
assert.match(server, /\.in\('professional_id', professionalIds\)/, 'profissionais devem ser carregados em lote');
assert.match(server, /TEMPLATE_PRIVACY_REVIEW_REQUIRED/);
assert.match(server, /visibility === 'private'/);
assert.match(server, /source_template_version/);
assert.match(server, /patientProfessionalHistoricalReadOnly/);
assert.match(server, /historicalSnapshotOnly: true/);
assert.match(server, /\.contains\('authorized_reader_ids', \[actorId\]\)/);
assert.match(server, /\.lte\('created_at', accessEndedAt\)/);
assert.match(planPanel, /therapeutic-plan-history-read-only/);
assert.match(planPanel, /somente as versões congeladas/);
assert.match(linksPanel, /active\.length >= 5/);
assert.match(linksPanel, /Encerrar vínculo/);
assert.match(library, /Salvar nova versão/);
assert.match(library, /Arquivar modelo/);
assert.match(library, /Duplicar/);
assert.match(abaCharts, /Comparação por especialidade/);
assert.match(abaCharts, /data-aba-specialty-filters/);
assert.match(abaCharts, /value=\{professionalId\}/);
assert.match(abaCharts, /value=\{specialty\}/);
assert.match(migration, /aba_program_templates_read[\s\S]*?owner_user_id = actor\.id::text/);
assert.match(migration, /patient_therapeutic_plans_tenant_select[\s\S]*?actor\.clinic_id::text = patient_therapeutic_plans\.organization_id/);

console.log('clinicalMultidisciplinaryEvolution.test.ts: ok');
