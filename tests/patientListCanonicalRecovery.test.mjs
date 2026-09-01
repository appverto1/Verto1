import assert from 'node:assert/strict';
import fs from 'node:fs';

const localDb = fs.readFileSync('src/services/localDb.ts', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

assert.match(
  localDb,
  /snapshot_count\?: number \| null/,
  'metadado do cache deve registrar a cardinalidade do snapshot remoto de pacientes',
);

assert.match(
  dataService,
  /response\.status === 304[\s\S]*?snapshot_count[\s\S]*?cacheLooksComplete[\s\S]*?forceRemote: true/,
  '304 não pode transformar IndexedDB parcial em lista canônica; deve refazer uma leitura sem cache quando incompleto',
);

assert.match(
  dataService,
  /cacheResponseMetadata\(endpoint, response, latest \|\| null, normalizedPatients\.length\)/,
  'snapshot remoto válido deve persistir a cardinalidade usada para validar futuros 304',
);

assert.match(
  dataService,
  /offline: true,[\s\S]{0,120}patientListCanonical: false/,
  'fallback local de hidratação deve ser marcado explicitamente como não canônico',
);

assert.match(
  dataService,
  /patientListCanonical: true,[\s\S]{0,180}clinicState: clinicStateWithProtocolFallback/,
  'hidratação remota confirmada deve marcar a lista de pacientes como canônica',
);

assert.match(
  app,
  /result\?\.patientListCanonical === false \|\| result\?\.offline === true[\s\S]*?getPatients\(\{ workspaceId, forceRemote: true \}\)[\s\S]*?setAllPatients\(canonicalScopedPatients\)/,
  'App deve reconciliar em background uma lista local parcial sem apagar o snapshot visível durante a tentativa',
);

assert.match(
  coordinator,
  /patientListSurfaceVisible = activeTab === "patients" \|\| activeTab === "notices" \|\| activeTab === "agenda"[\s\S]*?patientListEnsureAttemptedWorkspaceRef\.current === workspaceScopeKey/,
  'tela de pacientes deve garantir uma única reconciliação canônica por workspace mesmo quando o cache parcial não está vazio',
);

console.log('patientListCanonicalRecovery.test.mjs: ok');
