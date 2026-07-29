import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isPatientVisibleInMainList,
  normalizePatientListResponse,
  normalizePatientStatus,
  patientMatchesProfessionalFilter,
  resolvePatientProfessionalIds,
} from '../src/utils/patientList';
import { dataService } from '../src/services/dataService';

const patients = [
  {
    id: 'active-lower',
    name: 'Gabriel',
    status: 'active',
    is_active: true,
    deleted_at: null,
    school: null,
    anamnesisData: null,
    professional_links: [
      { professional_id: 'coordinator-1', status: 'active' },
      { professional_id: 'therapist-1', status: 'active' },
    ],
  },
  {
    id: 'active-upper',
    name: 'Pedro Henrique',
    status: 'ACTIVE',
    is_active: true,
    deleted_at: null,
    professional_links: [{ professional_id: 'therapist-2', status: 'active' }],
  },
  {
    id: 'pending',
    name: 'Paciente em onboarding',
    status: 'PENDING_ANAMNESIS',
    is_active: true,
    deleted_at: null,
    school: null,
    anamnesisData: null,
    professional_links: [{ professional_id: 'coordinator-1', status: 'active' }],
  },
  {
    id: 'deleted-status',
    name: 'Removido por status',
    status: 'deleted',
    is_active: true,
    deleted_at: null,
  },
  {
    id: 'deleted-at',
    name: 'Removido por data',
    status: 'ACTIVE',
    is_active: true,
    deleted_at: '2026-07-29T10:00:00.000Z',
  },
  {
    id: 'inactive-flag',
    name: 'Removido por flag',
    status: 'ACTIVE',
    is_active: false,
    deleted_at: null,
  },
];

const apiResponse = normalizePatientListResponse({ success: true, data: patients });
assert.equal(apiResponse.success, true, '1. deve consumir { success: true, data }');
assert.deepEqual(apiResponse.success ? apiResponse.data : [], patients);

assert.equal(normalizePatientStatus(' active '), 'ACTIVE');
assert.equal(isPatientVisibleInMainList(patients[0]), true, '2. status active deve aparecer');
assert.equal(isPatientVisibleInMainList(patients[1]), true, '3. status ACTIVE deve aparecer');
assert.equal(isPatientVisibleInMainList(patients[2]), true, '4. PENDING_ANAMNESIS deve aparecer');
assert.equal(isPatientVisibleInMainList(patients[3]), false, '5. deleted deve ser ocultado');
assert.equal(isPatientVisibleInMainList(patients[4]), false, '6. deleted_at deve ser ocultado');
assert.equal(isPatientVisibleInMainList(patients[5]), false, '7. is_active false deve ser ocultado');
assert.equal(
  isPatientVisibleInMainList({ status: 'deleted', is_active: true, deleted_at: null }),
  false,
  '8. is_active true não pode reabilitar status deleted',
);

const neutralList = patients.filter(isPatientVisibleInMainList);
assert.equal(neutralList.length, 3, '9. Todos os pacientes deve aplicar somente remoção canônica');
assert.equal(
  neutralList.some((patient) => patient.id === 'active-lower' && patient.school == null),
  true,
  '10. paciente sem escola deve aparecer no filtro neutro',
);
assert.equal(
  neutralList.some((patient) => patient.id === 'pending' && patient.anamnesisData == null),
  true,
  '11. paciente sem anamnese deve aparecer',
);

assert.deepEqual(resolvePatientProfessionalIds(patients[0]), ['coordinator-1', 'therapist-1']);
assert.equal(
  neutralList.filter((patient) => patientMatchesProfessionalFilter(patient, 'coordinator-1')).length,
  2,
  '12. filtro por coordenador deve usar vínculos ativos',
);
assert.deepEqual(
  neutralList
    .filter((patient) => patientMatchesProfessionalFilter(patient, 'therapist-2'))
    .map((patient) => patient.id),
  ['active-upper'],
  '13. filtro por terapeuta deve usar vínculos ativos',
);
assert.deepEqual(
  neutralList.filter((patient) => patientMatchesProfessionalFilter(patient, 'all')),
  neutralList,
  '14. voltar para Todos os pacientes deve restaurar a lista',
);

for (const invalidPayload of [
  { success: true, data: null },
  { success: true },
  { data: {} },
  null,
]) {
  assert.equal(
    normalizePatientListResponse(invalidPayload).success,
    false,
    '15. resposta inválida não pode ser convertida silenciosamente em []',
  );
}

assert.deepEqual(
  normalizePatientListResponse([{ id: 'legacy-array' }]),
  { success: true, data: [{ id: 'legacy-array' }], source: 'array' },
  'contrato legado de array direto deve permanecer explícito',
);
assert.equal(
  normalizePatientListResponse({ patients: [{ id: 'legacy-patients' }] }).success,
  true,
);
assert.equal(
  normalizePatientListResponse({ items: [{ id: 'legacy-items' }] }).success,
  true,
);

const appSource = readFileSync('src/App.tsx', 'utf8');
const coordinatorSource = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const detailSource = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const dataServiceSource = readFileSync('src/services/dataService.ts', 'utf8');
const serverSource = readFileSync('server.ts', 'utf8');

assert.match(
  coordinatorSource,
  /patientListError[\s\S]*Não foi possível carregar os pacientes\./,
  '16. erro de API/contrato deve ter estado visual distinto da lista vazia',
);

const workspaceHydrationSource = dataServiceSource.slice(
  dataServiceSource.indexOf('async hydrateWorkspaceState'),
  dataServiceSource.indexOf('async getSchools'),
);
assert.match(
  appSource,
  /dataService\.hydrateWorkspaceState\(workspaceId\)/,
  '17. a listagem deve hidratar o workspace sem IDs de prontuário',
);
assert.doesNotMatch(
  workspaceHydrationSource,
  /\/api\/patient-records\/|getPatientRecord\(/,
  '17. a hidratação da listagem não pode abrir prontuários',
);
assert.doesNotMatch(
  coordinatorSource,
  /getPatientRecord\(|\/api\/patient-records\//,
  '17. o componente da listagem não pode abrir prontuários por paciente',
);

const detailSnapshotSource = dataServiceSource.slice(
  dataServiceSource.indexOf('async getPatientDetailSnapshot'),
  dataServiceSource.indexOf('async getPatientFinancialPlans'),
);
assert.equal(
  (detailSnapshotSource.match(/getPatientRecord\(/g) || []).length,
  1,
  '18. abrir o detalhe deve solicitar um prontuário para o paciente selecionado',
);
assert.match(appSource, /onOpenPatientDetails=\{loadPatientDetailsOnOpen\}/);
assert.doesNotMatch(
  detailSource.slice(
    detailSource.indexOf('const loadPersistedFiles'),
    detailSource.indexOf('const [patientFiles'),
  ),
  /getPatientRecord\(/,
  'o carregamento de arquivos não pode duplicar a leitura do prontuário na abertura',
);

assert.doesNotMatch(
  workspaceHydrationSource,
  /for\s*\(\s*const patient of patients/,
  '19. a quantidade de requests da listagem não pode crescer com o número de pacientes',
);
assert.equal(
  (serverSource.slice(
    serverSource.indexOf("app.get('/api/patients'"),
    serverSource.indexOf("app.post('/api/patients'"),
  ).match(/\.from\('patient_professional_links'\)/g) || []).length,
  1,
  'vínculos profissionais devem ser carregados em uma única consulta em lote',
);

assert.match(coordinatorSource, /const visiblePatients = useMemo/);
assert.doesNotMatch(
  coordinatorSource.slice(
    coordinatorSource.indexOf('const visiblePatients = useMemo'),
    coordinatorSource.indexOf('const visiblePatientsWithoutQuickFilter'),
  ),
  /getPatients\(|\/api\/patients/,
  '20. filtros locais não devem refazer a consulta principal',
);

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
console.warn = (...args: any[]) => {
  if (!String(args[0] || '').includes('[auth-headers]')) originalWarn(...args);
};
const initialRequestUrls: string[] = [];
const runtimePatients = Array.from({ length: 48 }, (_, index) => ({
  id: `runtime-${index + 1}`,
  name: `Paciente ${index + 1}`,
  status: index === 0 ? 'PENDING_ANAMNESIS' : 'active',
  is_active: true,
  deleted_at: null,
}));
globalThis.fetch = (async (input: any) => {
  const url = String(input);
  initialRequestUrls.push(url);
  if (url.includes('/api/clinic/state')) {
    return new Response(JSON.stringify({ success: true, data: { rooms: [], appointments: [], protocols: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes('/api/clinic/anamnesis-template')) {
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes('/api/patients')) {
    return new Response(JSON.stringify({ success: true, data: runtimePatients }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error(`Request inesperada na listagem: ${url}`);
}) as typeof fetch;

const runtimeHydration = await dataService.hydrateWorkspaceState('clinic-test');
assert.equal(runtimeHydration?.success, true);
assert.equal(runtimeHydration?.data?.patients?.length, 48);
assert.equal(
  initialRequestUrls.filter((url) => url.includes('/api/patients')).length,
  1,
  'a lista deve fazer uma única chamada paginada de pacientes',
);
assert.equal(
  initialRequestUrls.filter((url) => url.includes('/api/patient-records/')).length,
  0,
  '17/19. 48 pacientes não podem gerar chamadas de prontuário na listagem',
);
const patientListApplicationRequests = initialRequestUrls.filter(
  (url) =>
    url.includes('/api/clinic/state') ||
    url.includes('/api/clinic/anamnesis-template') ||
    url.includes('/api/patients'),
);
assert.equal(
  patientListApplicationRequests.length,
  3,
  'o plano inicial de requests da listagem deve ser constante',
);

const detailRequestUrls: string[] = [];
globalThis.fetch = (async (input: any) => {
  const url = String(input);
  detailRequestUrls.push(url);
  if (url.includes('/api/patient-records/runtime-1')) {
    return new Response(
      JSON.stringify({ success: true, data: { payload: { anamnese: { status: 'draft' } } } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  throw new Error(`Request inesperada no detalhe: ${url}`);
}) as typeof fetch;
const runtimeDetail = await dataService.getPatientDetailSnapshot(runtimePatients[0]);
assert.equal(runtimeDetail?.success, true);
assert.deepEqual(
  detailRequestUrls.filter((url) => url.includes('/api/patient-records/')),
  ['/api/patient-records/runtime-1'],
);
globalThis.fetch = originalFetch;
console.warn = originalWarn;

console.log('patientListVisibility.test.ts: OK');
