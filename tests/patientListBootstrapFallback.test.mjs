import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');

assert.match(
  app,
  /const ensurePatientListLoaded = useCallback[\s\S]*?getPatients\(\{ workspaceId, forceRemote: true \}\)[\s\S]*?setAllPatients\(scopedPatients\)/,
  'App deve conseguir recuperar a lista canônica independentemente da hidratação global.',
);

assert.match(
  app,
  /patientListError=\{patientListError\}[\s\S]*?onEnsurePatientList=\{ensurePatientListLoaded\}/,
  'CoordinatorDashboard deve receber o fallback canônico da lista.',
);

assert.match(
  dashboard,
  /needsCanonicalPatientList = allPatients\.length === 0 \|\| Boolean\(patientListError\)[\s\S]*?onEnsurePatientList\(\)/,
  'Abrir Pacientes com lista vazia ou snapshot local não canônico deve recuperar a lista uma única vez por workspace.',
);

const moduleMap = dashboard.slice(
  dashboard.indexOf('const requiredModuleByTab'),
  dashboard.indexOf('const requiredModule = requiredModuleByTab'),
);
assert.doesNotMatch(
  moduleMap,
  /patients\s*:/,
  'Pacientes não pode depender de módulo comercial contratado.',
);

const getPatients = dataService.slice(
  dataService.indexOf('async getPatients'),
  dataService.indexOf('async savePatient'),
);
assert.match(
  getPatients,
  /forceRemote[\s\S]*?getNoStoreAuthHeaders\(false\)/,
  'Recuperação canônica deve usar a sessão HTTP já validada sem depender do bearer Supabase.',
);
assert.match(
  getPatients,
  /const patientsById = new Map[\s\S]*?record\?\.sync_status === 'synced'\) continue/,
  'Cache sincronizado não pode substituir a lista remota; somente pendência offline pode fazer overlay.',
);
assert.match(
  getPatients,
  /response\.status === 304[\s\S]*?snapshot_count[\s\S]*?cacheLooksComplete[\s\S]*?forceRemote: true/,
  '304 com cache local parcial deve refazer a leitura canônica em vez de esconder pacientes.',
);

console.log('patientListBootstrapFallback.test.mjs: OK');
