import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const baseCommit='5c871886748de10185567193d3391b827c77b908';
const expectedBlob='ec019c5b9a6e88bc5ae9fb10081442ed88a17e4d';
const expectedOriginalLines=100113;
const expectedNewLines=99382;
const modulePath='services/tissPayerReadHandlers.ts';
const manifestPath='docs/backend-modularization/20261012-tiss-payer-read-batch-manifest.json';
const docsPath='docs/backend-modularization/20261012-tiss-payer-read-batch.md';

const specs=[
['/api/admin/tiss/provider-profile','createTissProviderProfileReadHandler'],
['/api/admin/tiss/payer-profiles/:payerId','createTissPayerProfileReadHandler'],
['/api/patients/tiss-authorizations','createPatientTissAuthorizationsReadHandler'],
['/api/patients/:patientId/tiss-authorizations','createPatientTissAuthorizationReadHandler'],
['/api/tiss/professional-profile/me','createTissOwnProfessionalProfileReadHandler'],
['/api/admin/tiss/professional-profiles','createTissProfessionalProfilesReadHandler'],
['/api/admin/tiss/professional-profiles/:professionalId','createTissProfessionalProfileReadHandler'],
['/api/tiss/pre-guides','createTissPreGuidesReadHandler'],
['/api/tiss/official-documents','createTissOfficialDocumentsReadHandler'],
['/api/tiss/official-documents/tracking','createTissDocumentTrackingListReadHandler'],
['/api/tiss/xml-drafts','createTissXmlDraftsReadHandler'],
['/api/tiss/xml-drafts/:draftId','createTissXmlDraftReadHandler'],
['/api/tiss/revenue-cycle/events','createTissRevenueEventsReadHandler'],
['/api/tiss/billing-batch-drafts','createTissBillingBatchDraftsReadHandler'],
['/api/tiss/billing-batch-drafts/:batchId','createTissBillingBatchDraftReadHandler'],
['/api/tiss/pre-guides/coverage','createTissPreGuidesCoverageReadHandler'],
['/api/tiss/pre-guides/:appointmentId','createTissPreGuideReadHandler'],
['/api/payer-options','createPayerOptionsReadHandler'],
['/api/admin/payers','createAdminPayersReadHandler'],
['/api/admin/payers/:payerId/requirements','createAdminPayerRequirementsReadHandler'],
];

const possibleDeps=[
'currentClinicId','sanitizeString','sanitizeTextField','isUuid','supabase','payerSafeError',
'fetchTissPreGuideProfile','CLINIC_TISS_PROFILE_SELECT','PAYER_TISS_PROFILE_SELECT',
'PATIENT_PAYER_AUTHORIZATION_SELECT','canAccessPatientBillingInCurrentClinic','fetchPayerForAdmin',
'hasMissingFinancialSchema','isMissingRelationError','sendNoStoreJson','hydratePatientPayerAuthorizations',
'PROFESSIONAL_BILLING_PROFILE_SELECT','assertProfessionalBillingProfileScope','parseBoundedListLimit',
'tissPreGuideQuickFilterCodes','APPOINTMENT_TISS_PRE_GUIDE_LIST_SELECT',
'APPOINTMENT_TISS_PRE_GUIDE_LIST_BASE_SELECT','APPOINTMENT_TISS_PRE_GUIDE_SELECT',
'APPOINTMENT_TISS_PRE_GUIDE_BASE_SELECT','extractMissingColumnName','isOptionalTissPreGuideColumn',
'TISS_OFFICIAL_DOCUMENT_SELECT','TISS_OFFICIAL_DOCUMENT_TRACKING_SELECT','TISS_XML_DRAFT_SELECT',
'TISS_XML_DRAFT_DETAIL_SELECT','TISS_REVENUE_CYCLE_EVENT_SELECT','TISS_BILLING_BATCH_DRAFT_SELECT',
'OFFICIAL_XML_TRACKING_STATUSES','serializeTissOfficialDocument','serializeTissOfficialTracking',
'normalizeNonNegativeCents','normalizeTissXmlCompetenceMonth','serializeTissXmlDraft',
'serializeTissRevenueCycleEvent','serializeTissBillingBatchDraft',
'parseClosureDateRange','fetchClosurePeriodAppointmentRows','loadOrganizationRowsByAppointmentIds',
'APPOINTMENT_BILLING_CONTEXT_SELECT','mergeBillingContextMetadata',
'resolveTissPreGuideEligibilityContextsInBatch','evaluateTissPreGuideEligibility','normalizePayerType',
'CLINIC_PAYER_SELECT','serializePayer','CLINIC_PAYER_REQUIREMENT_SELECT','serializePayerRequirement',
'serializeTissPreGuide'
];
const oldText=fs.readFileSync('server.ts','utf8');
const oldGitBlob=execFileSync('git',['hash-object','server.ts'],{encoding:'utf8'}).trim();
assert.equal(oldGitBlob,expectedBlob,'fail closed: source staging changed');
assert.equal(oldText.split('\n').length,expectedOriginalLines,'original lines changed');
assert.ok(!oldText.includes('tissPayerReadHandlers'),'batch already extracted');
const source=ts.createSourceFile('server.ts',oldText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);

function findRoute(path) {
 const matches=[];
 function walk(n) {
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)
    &&n.expression.expression.getText(source)==='app'&&n.expression.name.text==='get'
    &&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text===path)matches.push(n);
  ts.forEachChild(n,walk);
 }
 walk(source);
 assert.equal(matches.length,1,'unique original GET '+path);
 return matches[0];
}
const patches=[],moduleParts=[],routes=[];
for(const [path,factory] of specs) {
 const call=findRoute(path);
 const arrow=call.arguments.at(-1);
 assert.ok(ts.isArrowFunction(arrow)&&ts.isBlock(arrow.body),'expected original inline arrow '+path);
 assert.ok(arrow.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword),'expected async GET '+path);
 const rawArrow=oldText.slice(arrow.getStart(source),arrow.end);
 assert.ok(rawArrow.startsWith('async (req: any, res) => {'),'unexpected handler signature: '+path);
 const inner=oldText.slice(arrow.body.getStart(source)+1,arrow.body.end-1);
 const deps=possibleDeps.filter(x=>new RegExp('\\b'+x+'\\b').test(inner));
 const handler=factory+'(() => ({ '+deps.join(', ')+' }))';
 const oldLines=oldText.slice(call.getStart(source),call.end).split('\n').length;
 patches.push({start:arrow.getStart(source),end:arrow.end,rawArrow,handler});
 moduleParts.push('// GET '+path+'\nexport function '+factory+'(getDeps: () => any) {\n  return async (req: any, res: any) => {\n    const { '+deps.join(', ')+' } = getDeps();'+inner+'\n  };\n}\n');
 routes.push({method:'get',path,factory,dependencies:deps,sourceLines:oldLines});
}
let updated=oldText;
for(const p of [...patches].sort((a,b)=>b.start-a.start))updated=updated.slice(0,p.start)+p.handler+updated.slice(p.end);
const importText="import { "+specs.map(x=>x[1]).join(', ')+" } from './services/tissPayerReadHandlers';\n";
updated=importText+updated;
let reconstructed=updated.slice(importText.length);
for(const p of patches){
 assert.equal(reconstructed.split(p.handler).length,2,'factory unique '+p.handler);
 reconstructed=reconstructed.replace(p.handler,p.rawArrow);
}
assert.equal(reconstructed,oldText,'byte exact roundtrip restoration');
const actualNewLines=updated.split('\n').length;
assert.equal(actualNewLines,expectedNewLines,'physical source reduction mismatch');
const manifest={baseCommit,originalGitBlob:expectedBlob,originalLines:expectedOriginalLines,expectedServerLines:expectedNewLines,module:modulePath,routes};
fs.writeFileSync('server.ts',updated);
fs.writeFileSync(modulePath,moduleParts.join('\n').trimEnd().replace(/[ \t]+$/gm,'')+'\n');
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(docsPath,[
 '# Backend: TISS and payer financial GET extraction — October 12, 2026',
 '',
 '- Source staging HEAD: '+baseCommit+'; server.ts Git blob '+expectedBlob+'.',
 '- Tenants and authenticated clinic scoping: unchanged original expressions. Middleware, method, route path and registration order stay in server.ts.',
 '- 20 independent original GET callbacks extracted exactly to '+modulePath+'.',
 '- server.ts: '+expectedOriginalLines+' → '+expectedNewLines+' lines (−731 lines).',
 '- Safety: unique original AST route signatures, lazy getter dependencies and byte-exact server.ts roundtrip before writes.',
 '- Tests: 20 original AST handler statement/middleware/dependency checks and mocked HTTP tenant-scope scenarios; required through existing batch01 regression runner.',
 '- No migration, SQL/RLS rewrite, request-count change, additional polling, Stripe/webhook change or modifications to any POST/PATCH/PUT/DELETE route.',
 '- Existing HTTP GET handlers that can call materialization or tracking-write helpers were excluded from this slice.',
 '- CI tests do not replace live authenticated tenant smoke tests. Production/main remain out of scope.',
 '',
 '## Original endpoints',
 ...routes.map(r=>'- GET '+r.path+' — '+r.sourceLines+' original lines'),
 ''
].join('\n'));
const runnerPath='scripts/backend-modularization-batch01-regressions.mjs';
const runner=fs.readFileSync(runnerPath,'utf8');
const runnerAnchor="  'tests/clinicFinancialReadHandlers.test.ts',";
assert.equal(runner.split(runnerAnchor).length,2,'deterministic CI runner anchor changed');
fs.writeFileSync(runnerPath,runner.replace(runnerAnchor,runnerAnchor+"\n  'tests/tissPayerReadHandlersSourceParity.test.mjs',\n  'tests/tissPayerReadHandlers.test.ts',"));
console.log('PASS: 20 GET callbacks, 731 server lines removed, byte-exact restoration and source anchors.');
