import assert from 'node:assert/strict';
import fs from 'node:fs';

const patient = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const pdf = fs.readFileSync('src/components/ProgressReportPDFLayout.tsx', 'utf8');

const selectorPos = patient.indexOf("Incluir Observações Clínicas");
const selectedPos = patient.indexOf("Observações Selecionadas para o Relatório");
assert.ok(selectorPos >= 0 && selectedPos > selectorPos, 'selecionadas devem preencher abaixo da lista de marcação');
assert.match(pdf, /page\.length >= 5/);
assert.match(pdf, /observationWeight/);
assert.match(pdf, /breakInside: 'avoid'/);
assert.match(pdf, /CompactPageHeader/);
assert.match(pdf, /clinic\.logoUrl/);
assert.match(pdf, /As observações são apresentadas nas páginas seguintes sem dividir um card entre páginas/);

console.log('clinicalReportSelectionPagination.regression.test.mjs: ok');
