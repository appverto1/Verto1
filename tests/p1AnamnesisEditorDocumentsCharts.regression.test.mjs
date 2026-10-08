import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(path, 'utf8');
const editor = source('src/components/Anamnesis.tsx');
const detail = source('src/components/PatientDetailView.tsx');
const chart = source('src/components/ClinicalPlanAnalyticsShell.tsx');

// P1 8: o gestor de templates não é um prontuário/paciente.
assert.match(editor, /const isTemplateManager = initialData\?\.manageTemplate === true/);
assert.match(editor, /const nextView: ModalView = isTemplateManager \|\|/);
assert.match(editor, /const handleSubmitForm = \(\) => \{[\s\S]{0,180}if \(isTemplateManager\) return;/);
assert.match(editor, /canEditTemplate && !isTemplateManager/);
assert.match(editor, /isTemplateManager && !canEditTemplate/);
assert.match(editor, /O preenchimento acontece exclusivamente no prontuário de um paciente/);

// P1 10: auditoria de campos já presentes no PDF, sem nova rota ou download.
assert.match(detail, /const freshClinicContext = await refreshClinicDocumentMedia\(\)/);
assert.match(detail, /generatePdfBlobFromAnamnesisHtml\(documentHtml\)/);
for (const field of ['clinicName', 'clinicCnpj', 'clinicAddress', 'clinicLogoUrl', 'professionalName', 'professionalCrp', 'signatureUrl']) {
  assert.match(detail, new RegExp('const ' + field + ' ='), 'PDF da anamnese deve ter ' + field);
}
assert.match(detail, /escapeHtml\(clinicName\)/);
assert.match(detail, /escapeHtml\(professionalName\)/);
assert.match(detail, /escapeHtml\(clinicLogoUrl\)/);

// P1 12: o mecanismo de barras por domínio já existe, mas uso por TODAS
// as especialidades exige smoke com fontes reais (não provar apenas por grep).
for (const label of ['Habilidades', 'Comportamentos interferentes', 'Maestria', 'Manutenção', 'Regressão/alertas']) {
  assert.ok(chart.includes(label), 'domínio clínico ausente: ' + label);
}
assert.match(chart, /stackId="domains"/);

console.log('P1 audit: editor de modelos isolado; campos atuais do PDF e barras gerais presentes; smoke autenticado ainda obrigatório.');
