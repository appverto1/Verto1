import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createAbaChartReadHandlers } from '../services/abaChartReadHandlers';
const baseline = "52e2686c21d284ee0e948f9827b4719032a328e6";
const original = execFileSync('git', ['show', baseline + ':server.ts'], { encoding: 'utf8', maxBuffer: 12000000 });
const current = readFileSync('server.ts','utf8');
const service = readFileSync('services/abaChartReadHandlers.ts','utf8');
const routes = ["targets","behaviors","mastery","maintenance","session-changes","overview"];
const deps = ["supabase","resolveAbaChartPatientScope","isUuid","parseAbaChartParams","fetchAbaSnapshotRows","fetchAbaGraphAnnotations","normalizeAbaSnapshotPoint","applyAbaChartTenantScope","hasMissingFinancialSchema","analyzeBehaviorContextPatterns","enrichMaintenanceRowsWithTargetDisplay","isAbaSignificantChange","buildAbaChartInsight","ABA_BEHAVIOR_DAILY_CHART_SELECT","ABA_MASTERY_LIST_SELECT","ABA_MAINTENANCE_SCHEDULE_SELECT","ABA_MAINTENANCE_PROBE_RESULT_SELECT","ABA_REGRESSION_ALERT_SELECT","ABA_PATIENT_SUMMARY_SELECT"];
const factory = '  const abaChartReadHandlers = createAbaChartReadHandlers(() => ({ ' + deps.join(', ') + ' }));\n';
const imp = "import { createAbaChartReadHandlers } from './services/abaChartReadHandlers';\n";
assert.ok(current.startsWith(imp));
assert.ok(!current.includes('abaChartReadHandlers.session-changes'), 'route names with hyphens must use bracket access');
// Compare the historical ABA extraction against its merge commit; subsequent
// independent server.ts extractions must not invalidate this source fixture.
const abaExtractionMerge = 'b8928ebe3ee93a2ed5557307b4459d2fc6479e37';
const historicalExtracted = execFileSync('git', ['show', abaExtractionMerge + ':server.ts'], { encoding: 'utf8', maxBuffer: 12000000 });
assert.ok(historicalExtracted.startsWith(imp), 'ABA extraction import at historical merge');
let recovered = historicalExtracted.replace('abaChartReadHandlers.session-changes', "abaChartReadHandlers['session-changes']").replace(imp,'').replace(factory,'');
for (const route of [...routes].reverse()) {
  const pattern = new RegExp("^  app\\.get\\('/api/aba/patients/:patientId/charts/" + route + "'[^\\n]*?async \\(req: any, res\\) => \\{\\n([\\s\\S]*?)^  \\}\\);", 'gm');
  const matches = [...original.matchAll(pattern)];
  assert.equal(matches.length,1,route + ' baseline route count');
  const raw = matches[0][0], body = matches[0][1];
  const header = raw.slice(0,raw.indexOf('\n'));
  const accessor = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(route) ? '.' + route : "['" + route + "']";
  const replacement = header.replace(/async \(req: any, res\) => \{$/, 'abaChartReadHandlers' + accessor + ');');
  assert.equal(current.split(replacement).length-1,1,route + ' original middleware and registration');
  const extracted = new RegExp('^    // ORIGINAL_BEGIN ' + route + '\\n([\\s\\S]*?)^    // ORIGINAL_END ' + route,'m').exec(service);
  assert.ok(extracted,route);
  assert.equal(extracted![1],body,route + ' byte-for-byte handler body parity');
  recovered = recovered.replace(replacement,raw);
}
assert.equal(recovered,original,'exact historical ABA full-source roundtrip');
const resp=()=>({code:200,payload:null as any,status(code:number){this.code=code;return this;},json(payload:any){this.payload=payload;return this;}});
let dbCalls=0;
const invalid=createAbaChartReadHandlers(()=>({resolveAbaChartPatientScope:()=>({patientId:'invalid'}),isUuid:()=>false,supabase:{from:()=>{dbCalls++;throw Error('not allowed');}}}));
for (const route of routes) { const r=resp(); await (invalid as any)[route]({session:{user:{id:'user'}},query:{}},r); assert.equal(r.code,200);assert.equal(r.payload.success,true);assert.deepEqual(r.payload.data.points,[]); }
assert.equal(dbCalls,0,'invalid patient cannot trigger query');
let tenantCalls=0;
const handlers=createAbaChartReadHandlers(()=>({
resolveAbaChartPatientScope:()=>({patientId:'00000000-0000-4000-8000-000000000001',clinicId:'clinic-a',organizationId:'org-a'}),
isUuid:()=>true,parseAbaChartParams:()=>({dateFromIso:'2026-10-01',dateToIso:'2026-10-13',limit:10}),
fetchAbaSnapshotRows:async(q:any)=>{tenantCalls++;assert.equal(q.clinicId,'clinic-a');assert.equal(q.organizationId,'org-a');return [{id:'point'}];},
fetchAbaGraphAnnotations:async(q:any)=>{tenantCalls++;assert.equal(q.clinicId,'clinic-a');return [{id:'annotation'}];},
normalizeAbaSnapshotPoint:(row:any)=>({...row,normalized:true})
}));
const success=resp();await handlers.targets({session:{user:{id:'user'}},query:{}},success);
assert.equal(success.code,200);assert.equal(tenantCalls,2);assert.equal(success.payload.data.points[0].normalized,true);assert.equal(success.payload.data.annotations[0].id,'annotation');
console.log('abaChartReadHandlers.test.ts: PASS');
