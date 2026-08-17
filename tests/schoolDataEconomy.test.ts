import assert from 'node:assert/strict';
import fs from 'node:fs';

const routes = fs.readFileSync('services/schoolManagementRoutes.ts', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const enrollmentDialog = fs.readFileSync('src/components/SchoolEnrollmentDialog.tsx', 'utf8');
const schoolsManagement = fs.readFileSync('src/components/SchoolsManagement.tsx', 'utf8');
const schoolMeetingWorkspace = fs.readFileSync('src/components/SchoolMeetingWorkspace.tsx', 'utf8');
const coordinatorDashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const schemaFallbacks = fs.readFileSync('src/utils/routeSchemaFallbacks.ts', 'utf8');

const routeStart = routes.indexOf("app.get('/api/schools/:schoolId/enrollment-options'");
const routeEnd = routes.indexOf("app.post('/api/schools'", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'endpoint enxuto de opções do vínculo deve existir');
const enrollmentOptionsRoute = routes.slice(routeStart, routeEnd);

assert.match(enrollmentOptionsRoute, /requireClinicCapability\('school\.view'\)/);
assert.match(enrollmentOptionsRoute, /ensureSchoolVisible\(scope, schoolId\)/);
assert.match(enrollmentOptionsRoute, /select\('id,school_id,name,is_active,archived_at'\)/);
assert.match(enrollmentOptionsRoute, /select\('id,school_id,school_unit_id,name,role,is_primary,is_active,archived_at'\)/);
assert.doesNotMatch(enrollmentOptionsRoute, /select\('\*'\)/);
assert.doesNotMatch(enrollmentOptionsRoute, /patient_school_enrollments|school_meetings|school_document_links|school_audit_events/);

assert.match(dataService, /getSchoolEnrollmentOptions\(schoolId: string, options: \{ signal\?: AbortSignal \} = \{\}\)/);
assert.match(dataService, /getSchoolAutocomplete\(search = '', page = 1, pageSize = 20, options: \{ signal\?: AbortSignal \} = \{\}\)/);
assert.match(dataService, /\/enrollment-options/);
assert.match(enrollmentDialog, /dataService\.getSchoolEnrollmentOptions/);
assert.doesNotMatch(enrollmentDialog, /dataService\.getSchoolDetail/);
assert.match(enrollmentDialog, /hasEnrollmentOptions/);
assert.match(enrollmentDialog, /new AbortController\(\)/);

assert.match(schoolsManagement, /debouncedSearch/);
assert.match(schoolsManagement, /window\.setTimeout\([\s\S]*?, 300\)/);
assert.match(schoolsManagement, /dataService\.getSchools\([\s\S]*?\{ signal \}\)/);
assert.match(schoolsManagement, /controller\.abort\(\)/);
assert.match(schoolsManagement, /debouncedPatientFilter/);
assert.match(schoolsManagement, /searchSchoolPatients\([\s\S]*?\{ signal \}\)/,
  'filtros escolares locais precisam cancelar consultas obsoletas');
assert.match(schoolsManagement, /detailSectionRequestsRef\.current\.get\(key\) === request/,
  'o finally de um detalhe antigo nao pode remover o request atual');
assert.match(schoolsManagement, /getSchoolDetail\(school\.id, \{ section: 'summary' \}\)/,
  'abrir uma escola deve carregar apenas o resumo necessário');
assert.match(schoolsManagement, /loadSchoolDetailSection\(activeDetailTab\)/,
  'reuniões, documentos e histórico devem ser lazy por aba');
assert.match(schoolsManagement, /loadedDetailSectionsRef/,
  'cada seção carregada deve ser reutilizada enquanto a escola permanecer aberta');
assert.match(dataService, /getSchoolDetail\(schoolId: string, options: \{ section\?: 'summary' \| 'audit'; signal\?: AbortSignal \} = \{\}\)/);

const schoolDetailStart = routes.indexOf("app.get('/api/schools/:schoolId',");
const schoolDetailEnd = routes.indexOf("app.get('/api/schools/:schoolId/units'", schoolDetailStart);
const schoolDetailRoute = routes.slice(schoolDetailStart, schoolDetailEnd);
assert.match(schoolDetailRoute, /section === 'summary'/);
assert.match(schoolDetailRoute, /section === 'audit'/);
assert.match(schoolDetailRoute, /SCHOOL_AUDIT_SUMMARY_COLUMNS/,
  'histórico escolar não deve transportar snapshots JSON que a tela não renderiza');
assert.doesNotMatch(schoolDetailRoute, /\.select\('\*'\)/,
  'detalhe escolar não deve usar projeção irrestrita');

const patientSchoolOptionsEffectStart = coordinatorDashboard.indexOf('patientSchoolOptionsLoadedForRef.current === workspaceId');
assert.ok(patientSchoolOptionsEffectStart >= 0, 'opcoes escolares devem ser carregadas uma vez por workspace');
const patientSchoolOptionsEffect = coordinatorDashboard.slice(
  coordinatorDashboard.lastIndexOf('useEffect(() => {', patientSchoolOptionsEffectStart),
  coordinatorDashboard.indexOf('useEffect(() => {', patientSchoolOptionsEffectStart + 1),
);
assert.match(patientSchoolOptionsEffect, /if \(activeTab !== "patients"\) return;/,
  'a lista escolar nao deve ser carregada em abas que nao exibem o filtro');
assert.match(patientSchoolOptionsEffect, /if \(!authorizationHydrated\) return;/,
  'o filtro escolar nao deve consultar APIs opcionais antes da autorizacao canonica hidratar');
assert.match(patientSchoolOptionsEffect, /if \(!canUseSchoolPatientFilters\) \{[\s\S]*?setPatientSchoolOptions\(\[\]\);[\s\S]*?setPatientSchoolOptionsLoadError\(""\);[\s\S]*?return;/,
  'clinicas sem modulo escolar/capability nao devem consultar nem manter estado escolar residual');
assert.match(coordinatorDashboard, /const canUseSchoolPatientFilters =[\s\S]*?authorizationHydrated && hasModule\("school_management"\) && hasCapability\("school\.view"\);/,
  'filtros escolares do paciente devem exigir entitlement do modulo e capability efetiva');
assert.match(coordinatorDashboard, /\{canUseSchoolPatientFilters && \([\s\S]*?patientSchoolOptionsLoadError[\s\S]*?>Escola<[\s\S]*?>Autorização<[\s\S]*?\)\}/,
  'UI escolar deve desaparecer por completo quando o modulo nao foi contratado');
assert.match(patientSchoolOptionsEffect, /setPatientSchoolOptions\(\[\]\);[\s\S]*?setPatientSchoolOptionsWorkspaceId\(""\);/,
  'trocar de workspace ou invalidar o cache deve remover imediatamente opções antigas');
assert.match(patientSchoolOptionsEffect, /getSchoolAutocomplete\("", 1, 100, \{ signal: controller\.signal \}\)/,
  'o filtro deve usar o endpoint enxuto, sem carregar reuniões, matrículas e contatos da listagem completa');
assert.doesNotMatch(patientSchoolOptionsEffect, /getSchools\(/,
  'o filtro de pacientes não deve consultar a listagem escolar pesada');
assert.match(patientSchoolOptionsEffect, /setPatientSchoolOptionsLoadError\("Não foi possível carregar as escolas\. Tente novamente\."\)/,
  'falha de rede precisa ser visível e não pode ser cacheada como vazio');
assert.match(coordinatorDashboard, /patientSchoolOptionsWorkspaceId !== workspaceId/,
  'filtro antigo não pode consultar uma escola de outro workspace enquanto o novo cache carrega');
assert.match(coordinatorDashboard, /patientSchoolOptionsWorkspaceId === String\(user\?\.activeWorkspaceId \|\| user\?\.clinicId \|\| ""\)\.trim\(\)[\s\S]*?\? patientSchoolOptions[\s\S]*?: \[\]/,
  'opções de outro workspace não podem aparecer nem durante o frame anterior ao efeito de limpeza');
assert.match(coordinatorDashboard, /addEventListener\("verto:school-options-changed"/,
  'o cache escolar deve ser invalidado apenas por mutacao do dominio');
assert.match(schoolsManagement, /notifySchoolOptionsChanged\(\)/,
  'criar, editar ou arquivar escola deve invalidar as opcoes reutilizadas');
assert.equal((coordinatorDashboard.match(/loadClinicAnamnesisTemplate\(\);/g) || []).length, 2,
  'a ficha deve ser lida no mount e ao abrir o editor, sem refetch ao trocar para configuracoes');
assert.doesNotMatch(coordinatorDashboard, /activeTab === "settings" \|\| isAnamnesisTemplateModalOpen/);
assert.match(coordinatorDashboard, /therapistMembersWorkspaceRef\.current = workspaceId[\s\S]*setTherapistMembersById\(\{\}\)/,
  'trocar workspace precisa remover imediatamente identidades profissionais do tenant anterior');
assert.match(coordinatorDashboard, /therapistMembersRequestSeqRef\.current !== requestSeq[\s\S]*therapistMembersWorkspaceRef\.current !== workspaceId/,
  'resposta atrasada de membros nao pode contaminar o workspace atual');
assert.match(coordinatorDashboard, /patientSchoolOptionsRequestSeqRef\.current !== requestSeq/,
  'uma resposta escolar anterior do mesmo workspace nao pode limpar o request mais recente');
assert.match(coordinatorDashboard, /key=\{`schools:\$\{workspaceScopeKey\}`\}[\s\S]*?workspaceScopeKey=\{workspaceScopeKey\}/,
  'a gestao escolar precisa ser remontada ao trocar de clinica');

assert.match(dataService, /accessPatientFile\(patientId: string, fileId: string, action: 'view' \| 'download'\)/,
  'vinculos documentais precisam acessar somente o arquivo apontado');
assert.match(schoolsManagement, /dataService\.accessPatientFile\(/);
assert.doesNotMatch(schoolsManagement, /dataService\.getPatientFiles\(/,
  'abrir um documento escolar nao pode transferir todos os arquivos do paciente');
assert.match(schoolMeetingWorkspace, /dataService\.accessPatientFile\(/);
assert.doesNotMatch(schoolMeetingWorkspace, /dataService\.getPatientFiles\(/);
assert.match(schemaFallbacks, /fileId\?: string \| null[\s\S]*if \(fileId\) query = query\.eq\('id', fileId\)/,
  'a consulta canonica deve filtrar o arquivo no banco');
const patientFilesRoute = server.slice(
  server.indexOf("app.get('/api/patient-files/:patientId'"),
  server.indexOf("app.post('/api/patient-files/:patientId'"),
);
assert.match(patientFilesRoute, /if \(requestedFileId && withUrls\.length > 0\)[\s\S]*return res\.json/,
  'arquivo canonico encontrado nao deve descriptografar o payload legado');

console.log('schoolDataEconomy.test.ts: OK');
