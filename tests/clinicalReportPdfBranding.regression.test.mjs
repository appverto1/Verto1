import assert from 'node:assert/strict';
import fs from 'node:fs';

const patient = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const capture = fs.readFileSync('src/utils/pdfCapture.ts', 'utf8');
const pdf = fs.readFileSync('src/components/ProgressReportPDFLayout.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

assert.match(patient, /buildProgressReportPdfDocument/, 'adulto e infantil devem compartilhar o mesmo pipeline visual de PDF');
assert.doesNotMatch(patient, /plainTextLines/, 'relatório adulto não pode voltar ao PDF de texto puro');
assert.match(patient, /clinicLogoUrl:/, 'refresh de mídia deve manter a chave canônica do logo da clínica');
assert.match(capture, /new URL\(normalized, window\.location\.href\)/, 'URL relativa autenticada deve ser resolvida para captura');
assert.match(capture, /credentials: sameOrigin \? "include" : "omit"/, 'logo privado same-origin deve carregar com sessão autenticada');
assert.match(capture, /contentType\.startsWith\("image\/"\)/, 'recurso de logo deve validar MIME antes de entrar no PDF');
assert.match(pdf, /clinicalSections/, 'PDF deve receber a hierarquia clínica canônica');
assert.match(pdf, /Plano:<\/strong>/, 'observações enriquecidas devem poder exibir o plano');
assert.match(pdf, /Domínio:<\/strong>/, 'PDF deve exibir domínio');
assert.match(pdf, /Programa:<\/strong>/, 'PDF deve exibir programa');
assert.match(server, /domain_id,domain_name,name,status/, 'read model deve trazer domínio do programa sem query adicional');

console.log('clinicalReportPdfBranding.regression.test.mjs: ok');
