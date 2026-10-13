import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const original = readFileSync('server.ts', 'utf8');
const baselineSha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
const expectedBase = '52e2686c21d284ee0e948f9827b4719032a328e6';
assert.equal(baselineSha, expectedBase, 'exact approved staging baseline required');
const routes = ['targets','behaviors','mastery','maintenance','session-changes','overview'];
const deps = ['supabase','resolveAbaChartPatientScope','isUuid','parseAbaChartParams','fetchAbaSnapshotRows','fetchAbaGraphAnnotations','normalizeAbaSnapshotPoint','applyAbaChartTenantScope','hasMissingFinancialSchema','analyzeBehaviorContextPatterns','enrichMaintenanceRowsWithTargetDisplay','isAbaSignificantChange','buildAbaChartInsight','ABA_BEHAVIOR_DAILY_CHART_SELECT','ABA_MASTERY_LIST_SELECT','ABA_MAINTENANCE_SCHEDULE_SELECT','ABA_MAINTENANCE_PROBE_RESULT_SELECT','ABA_REGRESSION_ALERT_SELECT','ABA_PATIENT_SUMMARY_SELECT'];
const blocks = {};
let changed = original;
for (const route of routes) {
  const pattern = new RegExp("^  app\\.get\\('/api/aba/patients/:patientId/charts/" + route + "'[^\\n]*?async \\(req: any, res\\) => \\{\\n([\\s\\S]*?)^  \\}\\);", 'gm');
  const matches = [...original.matchAll(pattern)];
  assert.equal(matches.length, 1, route + ' route handler is unique');
  const raw = matches[0][0];
  const header = raw.slice(0, raw.indexOf('\n'));
  const replacement = header.replace(/async \(req: any, res\) => \{$/, 'abaChartReadHandlers.' + route + ');');
  assert.ok(replacement.endsWith('abaChartReadHandlers.' + route + ');'));
  assert.equal(changed.split(raw).length, 2, route + ' source occurs exactly once');
  blocks[route] = {raw, body:matches[0][1], replacement};
  changed = changed.replace(raw, replacement);
}
const factory = '  const abaChartReadHandlers = createAbaChartReadHandlers(() => ({ ' + deps.join(', ') + ' }));\n';
const imp = "import { createAbaChartReadHandlers } from './services/abaChartReadHandlers';\n";
assert.equal(changed.split(blocks.targets.replacement).length, 2);
changed = imp + changed.replace(blocks.targets.replacement, factory + blocks.targets.replacement);
const service = '// ABA chart GET handlers; auth, order and route registration remain in server.ts.\n'
  + '// Existing dependencies are captured lazily when an authorized request reaches a handler.\n'
  + 'export const createAbaChartReadHandlers = (getDeps: () => any) => ({\n'
  + routes.map(route => "  '" + route + "': async (req: any, res: any) => {\n"
    + '    const { ' + deps.join(', ') + ' } = getDeps();\n'
    + '    // ORIGINAL_BEGIN ' + route + '\n'
    + blocks[route].body
    + '    // ORIGINAL_END ' + route + '\n'
    + '  }').join(',\n')
  + '\n});\n';
let reconstructed = changed.replace(imp, '').replace(factory, '');
for (const route of [...routes].reverse()) {
  reconstructed = reconstructed.replace(blocks[route].replacement, blocks[route].raw);
  const body = new RegExp('^    // ORIGINAL_BEGIN ' + route + '\\n([\\s\\S]*?)^    // ORIGINAL_END ' + route, 'm').exec(service);
  assert.ok(body);
  assert.equal(body[1], blocks[route].body, route + ' original body unchanged');
}
assert.equal(reconstructed, original, 'full server.ts must reconstruct byte for byte');
const anchor = "  'tests/moduleUpgradeV5S1Http.test.ts',";
const runner = readFileSync('scripts/pre-main-gate.mjs', 'utf8');
assert.equal(runner.split(anchor).length, 2);
const updatedRunner = runner.replace(anchor, anchor + "\n  'tests/abaChartReadHandlers.test.ts',");
const test = [
 "import assert from 'node:assert/strict';",
 "import { readFileSync } from 'node:fs';",
 "import { execFileSync } from 'node:child_process';",
 "import { createAbaChartReadHandlers } from '../services/abaChartReadHandlers';",
 "const baseline = " + JSON.stringify(expectedBase) + ";",
 "const original = execFileSync('git', ['show', baseline + ':server.ts'], { encoding: 'utf8', maxBuffer: 12000000 });",
 "const current = readFileSync('server.ts','utf8');",
 "const service = readFileSync('services/abaChartReadHandlers.ts','utf8');",
 "const routes = " + JSON.stringify(routes) + ";",
 "const deps = " + JSON.stringify(deps) + ";",
 "const factory = '  const abaChartReadHandlers = createAbaChartReadHandlers(() => ({ ' + deps.join(', ') + ' }));\\n';",
 "const imp = \"import { createAbaChartReadHandlers } from './services/abaChartReadHandlers';\\n\";",
 "assert.ok(current.startsWith(imp));",
 "let recovered = current.replace(imp,'').replace(factory,'');",
 "for (const route of [...routes].reverse()) {",
 "  const pattern = new RegExp(\"^  app\\\\.get\\\\('/api/aba/patients/:patientId/charts/\" + route + \"'[^\\\\n]*?async \\\\(req: any, res\\\\) => \\\\{\\\\n([\\\\s\\\\S]*?)^  \\\\}\\\\);\", 'gm');",
 "  const matches = [...original.matchAll(pattern)];",
 "  assert.equal(matches.length,1,route + ' baseline route count');",
 "  const raw = matches[0][0], body = matches[0][1];",
 "  const header = raw.slice(0,raw.indexOf('\\n'));",
 "  const replacement = header.replace(/async \\(req: any, res\\) => \\{$/, 'abaChartReadHandlers.' + route + ');');",
 "  assert.equal(current.split(replacement).length-1,1,route + ' original middleware and registration');",
 "  const extracted = new RegExp('^    // ORIGINAL_BEGIN ' + route + '\\\\n([\\\\s\\\\S]*?)^    // ORIGINAL_END ' + route,'m').exec(service);",
 "  assert.ok(extracted,route);",
 "  assert.equal(extracted![1],body,route + ' byte-for-byte handler body parity');",
 "  recovered = recovered.replace(replacement,raw);",
 "}",
 "assert.equal(recovered,original,'exact full-source roundtrip');",
 "const resp=()=>({code:200,payload:null as any,status(code:number){this.code=code;return this;},json(payload:any){this.payload=payload;return this;}});",
 "let dbCalls=0;",
 "const invalid=createAbaChartReadHandlers(()=>({resolveAbaChartPatientScope:()=>({patientId:'invalid'}),isUuid:()=>false,supabase:{from:()=>{dbCalls++;throw Error('not allowed');}}}));",
 "for (const route of routes) { const r=resp(); await (invalid as any)[route]({session:{user:{id:'user'}},query:{}},r); assert.equal(r.code,200);assert.equal(r.payload.success,true);assert.deepEqual(r.payload.data.points,[]); }",
 "assert.equal(dbCalls,0,'invalid patient cannot trigger query');",
 "let tenantCalls=0;",
 "const handlers=createAbaChartReadHandlers(()=>({",
 "resolveAbaChartPatientScope:()=>({patientId:'00000000-0000-4000-8000-000000000001',clinicId:'clinic-a',organizationId:'org-a'}),",
 "isUuid:()=>true,parseAbaChartParams:()=>({dateFromIso:'2026-10-01',dateToIso:'2026-10-13',limit:10}),",
 "fetchAbaSnapshotRows:async(q:any)=>{tenantCalls++;assert.equal(q.clinicId,'clinic-a');assert.equal(q.organizationId,'org-a');return [{id:'point'}];},",
 "fetchAbaGraphAnnotations:async(q:any)=>{tenantCalls++;assert.equal(q.clinicId,'clinic-a');return [{id:'annotation'}];},",
 "normalizeAbaSnapshotPoint:(row:any)=>({...row,normalized:true})",
 "}));",
 "const success=resp();await handlers.targets({session:{user:{id:'user'}},query:{}},success);",
 "assert.equal(success.code,200);assert.equal(tenantCalls,2);assert.equal(success.payload.data.points[0].normalized,true);assert.equal(success.payload.data.annotations[0].id,'annotation');",
 "console.log('abaChartReadHandlers.test.ts: PASS');",
].join('\n') + '\n';
const doc = '# ABA chart GET batch extraction — 2026-10-13\n\n'
 + '- Base staging: '+expectedBase+'. Six GET routes: charts/{'+routes.join(', ')+'}.\n'
 + '- Original middleware chains, registration locations, patient/clinic scope checks, callbacks and response logic preserved. The callback bodies in the new module match the original byte for byte; the original server.ts is exactly reconstructable from the output.\n'
 + '- Lazy dependency injection only (no new requests, DB/RLS/role changes, persistence changes, Stripe changes, or background jobs).\n'
 + '- Regression: original middleware statements, full server.ts byte-for-byte roundtrip, 6 invalid-patient checks and targets-success tenant scoping mock.\n'
 + '- server.ts: '+original.split('\n').length+' → '+changed.split('\n').length+' lines (−'+(original.split('\n').length-changed.split('\n').length)+').\n'
 + '- Real CI status, deploy status and live authenticated staging smoke require independent verification.\n';
mkdirSync('services',{recursive:true});
mkdirSync('docs/backend-modularization',{recursive:true});
writeFileSync('server.ts',changed);
writeFileSync('services/abaChartReadHandlers.ts',service);
writeFileSync('tests/abaChartReadHandlers.test.ts',test);
writeFileSync('scripts/pre-main-gate.mjs',updatedRunner);
writeFileSync('docs/backend-modularization/20261013-aba-chart-read-batch.md',doc);
console.log('Extraction complete: '+routes.length+' GET handlers; server lines '+original.split('\n').length+' => '+changed.split('\n').length);
