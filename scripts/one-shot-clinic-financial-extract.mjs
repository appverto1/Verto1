import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const expectedBlob='10a3505c621159e8b51242836a5d9a280fa54a95';
const baseCommit='8556cb75276323e5f316cab358714ceab64ead3b';
const manifestPath='docs/backend-modularization/20261012-clinic-financial-read-batch-manifest.json';
const docsPath='docs/backend-modularization/20261012-clinic-financial-read-batch.md';
const modulePath='services/clinicFinancialReadHandlers.ts';
const routeSpecs=[
['/api/private-pricing/catalog','createPrivatePricingCatalogReadHandler','sanitizeString currentClinicId isUuid supabase PRIVATE_PATIENT_AGREEMENT_SELECT PRIVATE_PRICE_RULE_SELECT TUSS_SERVICE_CATALOG_SELECT CLINIC_PAYER_SELECT privateSessionPricingErrorResponse'],
['/api/private-pricing/appointments/:appointmentId/snapshot','createPrivatePricingSnapshotReadHandler','sanitizeString currentClinicId isUuid supabase PRIVATE_FINANCIAL_SNAPSHOT_SELECT privateSessionPricingErrorResponse'],
['/api/patient-finance/ledger','createPatientFinanceLedgerReadHandler','sanitizeString currentClinicId isUuid supabase PATIENT_FINANCE_CHARGE_SELECT patientFinanceErrorResponse PATIENT_FINANCE_APPOINTMENT_SELECT PATIENT_FINANCE_POLICY_SELECT PRIVATE_FINANCIAL_SNAPSHOT_SELECT extractMissingColumnName PATIENT_FINANCE_APPOINTMENT_LEGACY_SELECT hasMissingFinancialSchema isMissingRelationError APPOINTMENT_BILLING_CONTEXT_SELECT'],
['/api/patient-finance/transactions/:transactionId/document','createPatientFinanceTransactionDocumentReadHandler','sanitizeString currentClinicId isUuid supabase sanitizeReceiptUrl patientFinanceErrorResponse'],
['/api/patient-finance/policy','createPatientFinancePolicyReadHandler','sanitizeString currentClinicId isUuid supabase PATIENT_FINANCE_POLICY_SELECT hasMissingFinancialSchema patientFinanceErrorResponse'],
['/api/payments','createPaymentsReadHandler','currentClinicId fetchPaymentsWithSchemaFallback hasGlobalClinicAccess parseBoundedListLimit sendRouteDbError requestIdForLogs supabase'],
['/api/financial/professional-payments','createProfessionalPaymentsReadHandler','currentClinicId fetchProfessionalPaymentsWithSchemaFallback hasGlobalClinicAccess parseBoundedListLimit hasMissingFinancialSchema sendRouteDbError requestIdForLogs supabase'],
['/api/financial/expenses','createFinancialExpensesReadHandler','clinicExpenseScope clinicExpenseMonthBounds supabase clinicExpenseSchemaMissing fetchFinancialEntriesWithSchemaFallback FINANCIAL_ENTRY_SELECT MAX_CLINIC_EXPENSE_ROWS CLINIC_EXPENSE_RULE_SELECT sanitizeString sendRouteDbError requestIdForLogs'],
['/api/financial/entries','createFinancialEntriesReadHandler','currentClinicId fetchFinancialEntriesWithSchemaFallback hasGlobalClinicAccess parseBoundedListLimit hasMissingFinancialSchema sendRouteDbError requestIdForLogs supabase'],
['/api/financial/feature-survey','createFinancialFeatureSurveyReadHandler','currentClinicId supabase FINANCIAL_FEEDBACK_SELECT']
];
const oldText=fs.readFileSync('server.ts','utf8');
const blob=execFileSync('git',['hash-object','server.ts'],{encoding:'utf8'}).trim();
assert.equal(blob,expectedBlob,'fail closed: staging server.ts changed');
const source=ts.createSourceFile('server.ts',oldText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const moduleParts=[],patches=[],routes=[];
function routeCalls(path) {
 const matches=[];
 const visit=(node)=>{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(source)==='app'
  &&node.expression.name.text==='get'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text===path)matches.push(node);
  ts.forEachChild(node,visit);
 };
 visit(source);return matches;
}
for(const [path,factory,words] of routeSpecs){
 const found=routeCalls(path);assert.equal(found.length,1,'exactly one original registration: '+path);
 const call=found[0],arrow=call.arguments.at(-1);
 assert.ok(ts.isArrowFunction(arrow)&&ts.isBlock(arrow.body),'inline original async GET: '+path);
 assert.ok(arrow.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword),'async GET: '+path);
 const originalArrow=oldText.slice(arrow.getStart(source),arrow.end);
 assert.ok(/^async \(req: any, res\) => \{$/.test(originalArrow.split('\n')[0]),'expected async signature: '+path);
 const inner=oldText.slice(arrow.body.getStart(source)+1,arrow.body.end-1);
 const deps=words.split(' ');
 const replacement=factory+'(() => ({ '+deps.join(', ')+' }))';
 patches.push({start:arrow.getStart(source),end:arrow.end,originalArrow,replacement,path});
 moduleParts.push('// GET '+path+'\nexport function '+factory+'(getDeps: () => any) {\n  return async (req: any, res: any) => {\n    const { '+deps.join(', ')+' } = getDeps();'+inner+'\n  };\n}\n');
 routes.push({method:'get',path,factory,dependencies:deps,originalHandlerStatements:arrow.body.statements.length,sourceLines:oldText.slice(call.getStart(source),call.end).split('\n').length});
}
patches.sort((a,b)=>b.start-a.start);
let updated=oldText;
for(const p of patches)updated=updated.slice(0,p.start)+p.replacement+updated.slice(p.end);
const importLine="import { "+routeSpecs.map(spec=>spec[1]).join(', ')+" } from './services/clinicFinancialReadHandlers';\n";
assert.ok(!oldText.includes('clinicFinancialReadHandlers'),'module not extracted yet');
updated=importLine+updated;
let reconstructed=updated.slice(importLine.length);
for(const p of patches) {
 assert.equal(reconstructed.split(p.replacement).length,2,'factory replacement unique');
 reconstructed=reconstructed.replace(p.replacement,p.originalArrow);
}
assert.equal(reconstructed,oldText,'byte-exact roundtrip for server.ts');
assert.equal(oldText.split('\n').length,100632,'exact source line baseline');
assert.equal(updated.split('\n').length,100113,'−519 physical lines');
const manifest={baseCommit,originalGitBlob:expectedBlob,originalLines:100632,expectedServerLines:100113,module:modulePath,routes};
fs.writeFileSync('server.ts',updated);
fs.writeFileSync(modulePath,moduleParts.join('\n').trimEnd()+'\n');
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const docs=[
'# Backend modularization: financial read batch (2026-10-12)',
'',
'- Base staging: '+baseCommit+'; original server.ts Git blob: '+expectedBlob+'.',
'- Ten GET handlers extracted, original app.get method, URL, middleware order and registration position preserved.',
'- Ten factories lazily obtain their original lexical dependencies per request; the original handler statements are copied without rewriting.',
'- server.ts: 100,632 → 100,113 lines (−519; 0.516% of the entrypoint).',
'- Exact reconstruction of original server.ts verified before changing files.',
'- AST parity test compares original route body statements, guards and middleware; targeted in-memory HTTP tests cover scoping and invalid identifiers.',
'- No migration, RLS, SQL rewrite, auth shortcut, Stripe, Resend, production deployment, new polling or write-handler changes.',
'- Existing GET /api/financial/expenses contains a pre-existing materialization RPC; this side effect is kept exactly as before.',
'- Target branch is staging. Live multi-tenant staging smoke and costs are not proven by mock testing.',
'',
'## Extracted routes',
...routes.map(r=>'- GET '+r.path+' ('+r.sourceLines+' original source lines)'),
'',
];
fs.writeFileSync(docsPath,docs.join('\n'));
const ciPath='.github/workflows/staging-ci.yml';
const ci=fs.readFileSync(ciPath,'utf8');
const anchor='      - name: Verto pre-main regression ratchet';
assert.equal(ci.split(anchor).length,2,'unique CI anchor');
fs.writeFileSync(ciPath,ci.replace(anchor,'      - name: Financial read handler extraction parity and tenant checks\n        run: |\n          node tests/clinicFinancialReadHandlersSourceParity.test.mjs\n          node --import tsx tests/clinicFinancialReadHandlers.test.ts\n\n'+anchor));
console.log('Extracted 10 exact GET handlers, source line delta −519, byte-reconstruction PASS.');
