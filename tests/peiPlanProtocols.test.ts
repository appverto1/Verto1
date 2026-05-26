import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const readSource = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');

test('aba Plano usa catalogo consolidado no seletor de protocolo do PEI', () => {
  const source = readSource('src/components/PatientDetailView.tsx');
  const peiBlock = source.match(/Adicionar Meta do Protocolo[\s\S]*?Nenhuma meta definida no PEI ainda/)?.[0] || '';

  assert.ok(peiBlock.includes('planProtocolCatalog.map'), 'dropdown do PEI deve usar catalogo consolidado');
  assert.ok(!peiBlock.includes('protocols.map((p: any)'), 'dropdown do PEI nao deve depender da lista crua');
  assert.ok(!/protocols\.find\([\s\S]{0,180}selectedPEIProtocolId/.test(peiBlock), 'dominios/metas nao devem buscar no protocols cru');
  assert.ok(peiBlock.includes('selectedPEIProtocol?.data || []'));
  assert.ok(peiBlock.includes('selectedPEIDomain?.skills || []'));
});

test('metas adicionadas pelo PEI preservam ids de protocolo e dominio', () => {
  const source = readSource('src/components/PatientDetailView.tsx');
  const peiGoalBlock = source.match(/const peiGoal = \{[\s\S]*?\};/)?.[0] || '';

  assert.ok(peiGoalBlock.includes('protocolId: selectedPEIProtocol?.id'));
  assert.ok(peiGoalBlock.includes('domainId: selectedPEIDomain?.id'));
  assert.ok(peiGoalBlock.includes('protocolTitle: selectedPEIProtocol?.title'));
  assert.ok(peiGoalBlock.includes('domainName: selectedPEIDomain?.name'));
});

test('dataService normaliza protocolos e metas PEI legadas antes de hidratar a tela', () => {
  const source = readSource('src/services/dataService.ts');

  assert.ok(source.includes('function normalizeProtocolList'));
  assert.ok(source.includes("['protocols', 'items', 'data', 'value']"));
  assert.ok(source.includes('function firstDefinedValue'));
  assert.ok(/function\s+normalizePeiGoals/.test(source));
  assert.ok(source.includes("const peiKeys = ['pei', 'peiGoals', 'pei_goals', 'goals', 'metas'];"));
  assert.ok(source.includes('const recordSource = firstDefinedValue(recordPayload, peiKeys);'));
  assert.ok(source.includes('const remoteProtocols = normalizeProtocolList(clinicData?.protocols);'));
  assert.ok(source.includes('const remoteProtocols = normalizeProtocolList(clinicStateData?.protocols);'));
  assert.ok(source.includes('const peiGoals = normalizePeiGoals(recordPayload, patient);'));
  assert.ok(source.includes('pei: peiGoals'));
});

test('rotas de protocolos retornam arrays normalizados em vez de vazio silencioso', () => {
  const source = readSource('server.ts');
  const clinicGetBlock = source.match(/app\.get\('\/api\/clinic\/state'[\s\S]*?app\.post\('\/api\/clinic\/state'/)?.[0] || '';
  const clinicPostBlock = source.match(/app\.post\('\/api\/clinic\/state'[\s\S]*?const handleVapidPublicKey/)?.[0] || '';
  const patientSelfBlock = source.match(/app\.get\('\/api\/patient\/self\/protocols'[\s\S]*?app\.post\('\/api\/history'/)?.[0] || '';

  assert.ok(source.includes('function normalizeProtocolArrayForRoute'));
  assert.ok(clinicGetBlock.includes('protocols: normalizeProtocolArrayForRoute(data?.protocols)'));
  assert.ok(clinicPostBlock.includes('protocols: normalizeProtocolArrayForRoute(data.protocols)'));
  assert.ok(patientSelfBlock.includes('normalizeProtocolArrayForRoute(s?.protocols).length > 0'));
  assert.ok(patientSelfBlock.includes('const protocols = normalizeProtocolArrayForRoute(selectedState?.protocols);'));
});

test('rota protocol-import-requests dinamica nao depende de cache/etag', () => {
  const source = readSource('server.ts');
  const routeBlock = source.match(/app\.get\('\/api\/protocol-import-requests'[\s\S]*?app\.delete\('\/api\/protocol-import-requests\/:requestId'/)?.[0] || '';

  assert.ok(source.includes("'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'"));
  assert.ok(source.includes("Pragma: 'no-cache'"));
  assert.ok(source.includes("Expires: '0'"));
  assert.ok(source.includes("'Surrogate-Control': 'no-store'"));
  assert.ok(source.includes("delete req.headers['if-none-match']"));
  assert.ok(source.includes("delete req.headers['if-modified-since']"));
  assert.ok(routeBlock.includes('noStoreDynamicResponse'));
  assert.ok(routeBlock.includes('sendNoStoreJson(res, { success: true, data: requests })'));
  assert.ok(!routeBlock.includes('res.json({ success: true, data: requests })'));
});

test('PEI e biblioteca buscam protocol-import-requests sem cache do navegador', () => {
  const patientSource = readSource('src/components/PatientDetailView.tsx');
  const protocolsSource = readSource('src/components/Protocols.tsx');
  const patientFetch = patientSource.match(/fetch\('\/api\/protocol-import-requests'[\s\S]*?\}\);/)?.[0] || '';
  const protocolsFetch = protocolsSource.match(/fetch\('\/api\/protocol-import-requests'[\s\S]*?\}\);/)?.[0] || '';

  assert.ok(patientFetch.includes("cache: 'no-store'"));
  assert.ok(patientFetch.includes("'Cache-Control': 'no-store'"));
  assert.ok(patientFetch.includes("Pragma: 'no-cache'"));
  assert.ok(protocolsFetch.includes("cache: 'no-store'"));
  assert.ok(protocolsFetch.includes("'Cache-Control': 'no-store'"));
  assert.ok(protocolsFetch.includes("Pragma: 'no-cache'"));
});

test('protocol-import-requests diagnostica filtros e considera escopos aprovados', () => {
  const source = readSource('server.ts');
  const routeBlock = source.match(/app\.get\('\/api\/protocol-import-requests'[\s\S]*?app\.delete\('\/api\/protocol-import-requests\/:requestId'/)?.[0] || '';

  assert.ok(source.includes('function buildProtocolAccessScopeKeys'));
  assert.ok(routeBlock.includes('table: \'protocol_import_requests\''));
  assert.ok(routeBlock.includes('totalProtocolImportRequests'));
  assert.ok(routeBlock.includes('filteredProtocolImportRequests'));
  assert.ok(routeBlock.includes('totalCanonicalProtocols'));
  assert.ok(routeBlock.includes('totalLegacyProtocolImportLogs'));
  assert.ok(routeBlock.includes('scopeKeys.flatMap'));
  assert.ok(routeBlock.includes('accessMap.get(scopeKey)'));
  assert.ok(routeBlock.includes('possiblyFilteredByScope'));
});

test('syncApprovedProtocolsToClinicState restaura apenas requests aprovados sem duplicar', () => {
  const source = readSource('server.ts');
  const script = readSource('scripts/restore-clinic-protocols-from-import-requests.ts');

  assert.ok(source.includes('const syncApprovedProtocolsToClinicState = async'));
  assert.ok(source.includes(".eq('status', 'approved')"));
  assert.ok(source.includes('mergeApprovedProtocolsIntoClinicState'));
  assert.ok(source.includes('LICENSED_VERTO_PROTOCOLS_BY_KEY'));
  assert.ok(source.includes('sourceRequestIds'));
  assert.ok(source.includes('restore_clinic_protocols_from_import_requests'));
  assert.ok(script.includes("String(row?.status || '').toLowerCase() !== 'approved'"));
  assert.ok(script.includes('pendingRequestIds'));
  assert.ok(script.includes('mergeProtocols(currentProtocols, approvedProtocols)'));
});

test('clinic_state protege protocols vazio quando existem requests aprovados', () => {
  const source = readSource('server.ts');
  const clinicPostBlock = source.match(/app\.post\('\/api\/clinic\/state'[\s\S]*?const handleVapidPublicKey/)?.[0] || '';
  const dataServiceSource = readSource('src/services/dataService.ts');

  assert.ok(source.includes('const getApprovedProtocolImportRequestCount = async'));
  assert.ok(clinicPostBlock.includes('nextProtocols.length === 0'));
  assert.ok(clinicPostBlock.includes('forceClearProtocols'));
  assert.ok(clinicPostBlock.includes('protocols_clear_blocked_with_approved_imports'));
  assert.ok(dataServiceSource.includes("Array.isArray(payload?.protocols) && payload.protocols.length > 0"));
});

test('clinic_state vazio e requests aprovados disparam sync para a aba Plano/PEI', () => {
  const source = readSource('server.ts');
  const clinicGetBlock = source.match(/app\.get\('\/api\/clinic\/state'[\s\S]*?app\.post\('\/api\/clinic\/state'/)?.[0] || '';
  const approveBlock = source.match(/app\.post\('\/api\/admin\/protocol-import-requests\/:requestId\/approve'[\s\S]*?app\.post\('\/api\/admin\/protocol-import-requests\/:requestId\/reject'/)?.[0] || '';

  assert.ok(clinicGetBlock.includes('normalizeProtocolArrayForRoute(data?.protocols).length === 0'));
  assert.ok(clinicGetBlock.includes('getApprovedProtocolImportRequestCount(clinicId)'));
  assert.ok(clinicGetBlock.includes('syncApprovedProtocolsToClinicState'));
  assert.ok(approveBlock.includes('syncApprovedProtocolsToClinicState'));
  assert.ok(approveBlock.includes('protocolSync'));
});

test('selects explicitos continuam apontando para tabelas que alimentam Plano/PEI', () => {
  const source = readSource('src/utils/routeSchemaFallbacks.ts');

  assert.ok(source.includes('export const CLINIC_STATE_SELECT_COLUMNS'));
  assert.ok(source.includes("'protocols'"));
  assert.ok(source.includes('export const PATIENT_RECORD_SELECT_COLUMNS'));
  assert.ok(source.includes("'payload_encrypted'"));
});

for (const { name, fn } of tests) {
  fn();
  console.log(`[ok] ${name}`);
}
