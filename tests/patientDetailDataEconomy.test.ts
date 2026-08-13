import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/PatientDetailView.tsx', 'utf8');

const between = (start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `trecho inicial ausente: ${start}`);
  assert.notEqual(endIndex, -1, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const filesLoad = between(
  "const shouldLoadFiles = activeTab === 'files' || Boolean(previewFile);",
  'const [showAnamnesisFileModal',
);
assert.match(filesLoad, /if \(!patientId \|\| !shouldLoadFiles\) return;/);
assert.match(filesLoad, /patientFilesLoadedForRef\.current === patientId/);
assert.match(filesLoad, /patientFilesRequestInFlightRef\.current === patientId/);
assert.match(filesLoad, /if \(loaded\) patientFilesLoadedForRef\.current = patientId/,
  'falha transitoria nao pode envenenar o cache como lista carregada');
assert.match(source, /patientFilesLoadError/);
assert.match(source, /setPatientFilesReloadKey\(\(value\) => value \+ 1\)/,
  'o estado de erro precisa oferecer retry explicito sem refetch automatico');
assert.equal(
  (source.match(/dataService\.getPatientFiles\(/g) || []).length,
  1,
  'o prontuario deve ter um unico ponto de leitura lazy de arquivos',
);
const fileNormalization = between('const normalizeFileRecord', 'const createObjectUrlFromDataUrl');
assert.doesNotMatch(
  fileNormalization,
  /createObjectUrlFromDataUrl/,
  'a listagem nao deve materializar Blob de todos os PDFs antes do preview',
);
assert.match(source, /onClick=\{\(\) => openPatientFilePreview\(file\)\}/);

const assignedTasksLoad = between(
  'if (!patientId || patientAgeYears === null || patientAgeYears <= 12) {',
  'const resolveProtocolAgeRange',
);
assert.match(assignedTasksLoad, /assignedTasksLoadedForRef\.current === patientId/);
assert.match(assignedTasksLoad, /assignedTasksRequestRef\.current\?\.patientId !== patientId/);
assert.match(assignedTasksLoad, /result\?\.success && Array\.isArray\(result\?\.data\)[\s\S]*assignedTasksLoadedForRef\.current = patientId/);
assert.match(assignedTasksLoad, /\}, \[assignedTasksReloadKey, patient\?\.id, patientAgeYears\]\);/);
assert.doesNotMatch(
  assignedTasksLoad,
  /\[patient\?\.id, patientAgeYears, activeTab\]/,
  'trocar de aba nao pode consultar novamente as tarefas do paciente',
);
assert.match(source, /setAssignedTasksReloadKey\(\(value\) => value \+ 1\)/);

const abaLoad = between(
  'const requestKey = `${patientId}:${abaRecordsRefreshKey}`;',
  'if (typeof window === \'undefined\')',
);
assert.match(abaLoad, /if \(activeTab !== 'plan'\) return;/);
assert.match(abaLoad, /abaRecordsLoadedKeyRef\.current === requestKey/);
assert.match(abaLoad, /abaRecordsFailedKeyRef\.current === requestKey/,
  'falha ABA deve aguardar retry explicito, sem refetch ao alternar abas');
assert.match(abaLoad, /abaRecordsRequestRef\.current\?\.key === requestKey/);
assert.match(abaLoad, /payload\?\.success === false \|\| !Array\.isArray\(payload\?\.data\)/,
  'resposta de erro resolvida nao pode ser tratada como lista vazia valida');
assert.match(abaLoad, /const hasCanonicalPage = Number\.isFinite\(Number\(payload\?\.page\)\)/,
  'vazio remoto deve ser confirmado pelo contrato paginado');
assert.match(abaLoad, /const confirmed = hasCanonicalPage \|\| data\.length > 0/,
  'registros offline validos devem ser preservados sem congelar fallback vazio');
assert.match(abaLoad, /if \(allAbaSourcesConfirmed\)[\s\S]*abaRecordsLoadedKeyRef\.current = requestKey/,
  'somente a leitura integral confirmada pode preencher o cache ABA');
for (const method of [
  'getPatientAbaSummary',
  'getAbaSessions',
  'getAbaTrials',
  'getAbaBehaviorEvents',
  'getAbaMasteryEvaluations',
  'getAbaMaintenanceOverview',
]) {
  assert.match(abaLoad, new RegExp(`dataService\\.${method}\\(`));
}
assert.match(source, /<ClinicalChartsWorkspace patientId=/);
assert.match(source, /role="alert"[\s\S]*Tentar novamente/,
  'erro ABA precisa permanecer visivel e oferecer retry controlado');
assert.match(source, /activeTab !== 'history'[\s\S]*requestPatientHistoryPage/);
assert.match(source, /abaV2Enabled && isSessionModeOpen[\s\S]*<SessionMode/);

assert.equal(
  (source.match(/dataService\.getAbaLinkableTargetsForMaintenance\(/g) || []).length,
  1,
  'o painel e o efeito de manutencao devem compartilhar uma unica leitura deduplicada',
);
assert.match(
  source,
  /peiMaintenanceLinkableTargetsRequestRef\.current\?\.patientId === requestPatientId[\s\S]*return peiMaintenanceLinkableTargetsRequestRef\.current\.promise/,
);
assert.match(
  source,
  /peiMaintenanceLinkableTargetsRequestRef\.current\?\.promise !== promise/,
  'uma resposta antiga nao pode sobrescrever a recarga forcada mais recente',
);
assert.match(
  source,
  /dataService\.getAbaMaintenancePanel[\s\S]*loadPeiMaintenanceLinkableTargets\(requestPatientId,/,
);
assert.match(
  source,
  /refreshPeiMaintenancePanel\(\{ refreshLinkableTargets: true \}\)/,
  'mutacoes de manutencao devem invalidar apenas o cache dependente',
);
assert.match(
  source,
  /const successful = result\?\.success !== false && Array\.isArray\(result\?\.data\)[\s\S]*loadedFor: successful \? requestPatientId/,
  'falha de targets de manutencao nao pode ser congelada como vazio carregado',
);

console.log('patient detail data economy tests passed');
