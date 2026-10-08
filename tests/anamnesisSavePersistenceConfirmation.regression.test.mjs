import assert from 'node:assert/strict';
import fs from 'node:fs';

const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const start = patientDetail.indexOf('const handleUpdateAnamnesis = async');
const end = patientDetail.indexOf('const handleUnlinkPatient', start);

assert.ok(start >= 0 && end > start, 'o salvamento da anamnese deve ser assíncrono e identificável');
const saveFlow = patientDetail.slice(start, end);

assert.match(
  saveFlow,
  /const patientUpdateResult = await onUpdatePatient\(/,
  'o cadastro\/prontuário deve confirmar persistência antes de avançar',
);
assert.match(
  saveFlow,
  /if \(!patientUpdateResult\?\.success\)[\s\S]*?return;/,
  'falha da persistência do paciente deve interromper o fluxo',
);
assert.match(
  saveFlow,
  /const submissionResult = await dataService\.submitPatientAnamnesis\(/,
  'a submissão da anamnese deve ser aguardada',
);
assert.match(
  saveFlow,
  /if \(!submissionResult\?\.success\)[\s\S]*?return;/,
  'falha da submissão deve manter a ficha no fluxo de edição',
);
assert.doesNotMatch(
  saveFlow,
  /void dataService\.submitPatientAnamnesis/,
  'a anamnese não pode disparar persistência em background e declarar sucesso antes da resposta',
);
assert.doesNotMatch(
  saveFlow,
  /onAddActivityLog/,
  'o primeiro passo não deve registrar log dizendo que o arquivo foi anexado antes do salvamento real em Arquivos',
);

const updateIndex = saveFlow.indexOf('await onUpdatePatient(');
const submissionIndex = saveFlow.indexOf('await dataService.submitPatientAnamnesis(');
const closeIndex = saveFlow.indexOf('setShowAnamnesis(false)');
const fileModalIndex = saveFlow.indexOf('setShowAnamnesisFileModal(true)');
assert.ok(updateIndex >= 0 && submissionIndex > updateIndex, 'ordem deve confirmar paciente antes da submissão');
assert.ok(closeIndex > submissionIndex, 'a ficha só pode fechar depois da confirmação da submissão');
assert.ok(fileModalIndex > submissionIndex, 'o fluxo de PDF só pode abrir depois da confirmação da submissão');

assert.match(saveFlow, /if \(!onUpdatePatient\)[\s\S]*?return;/,
  'ausência de writer de paciente não pode produzir falso sucesso');
assert.match(saveFlow, /patientUpdateResult\?\.pending === true[\s\S]*?patientUpdateResult\?\.offline === true[\s\S]*?patientUpdateResult\?\.queued === true/,
  'a ficha só pode encerrar após ACK de paciente, não fila offline');
assert.match(saveFlow, /submissionResult\?\.pending === true[\s\S]*?submissionResult\?\.offline === true[\s\S]*?submissionResult\?\.queued === true/,
  'a submissão deve receber ACK definitivo antes de fechar');

console.log('anamnesisSavePersistenceConfirmation.regression.test.mjs: ok');
