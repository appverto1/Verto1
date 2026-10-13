import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import ts from 'typescript';

const expectedBranch = 'refs/heads/refactor/backend-portal-appointments-read-batch-20261013';
assert.equal(process.env.GITHUB_REF, expectedBranch, 'refuse writes outside isolated feature branch');
const serverPath = 'server.ts';
const source = fs.readFileSync(serverPath, 'utf8');
const originalBlob = crypto.createHash('sha1').update(Buffer.concat([
  Buffer.from('blob ' + Buffer.byteLength(source) + '\0'), Buffer.from(source)
])).digest('hex');
assert.equal(originalBlob, '36af849f70c27af3bb1a47d8130e5266d60ea9be', 'staging baseline changed: refuse unsafe rewrite');

const routes = [
  {
    "path": "/api/portal/appointments",
    "name": "createPortalAppointmentsListHandler",
    "deps": [
      "sanitizeString",
      "getPortalPatientIdsForUser",
      "isUuid",
      "isResponsiblePortalRole",
      "sanitizeEmail",
      "currentClinicId",
      "readPortalPatientContexts",
      "extractMissingColumnName",
      "sanitizeIsoDateTime",
      "parseBoundedListLimit",
      "queryPortalAppointmentsWithSchemaFallback",
      "supabase",
      "hasMissingFinancialSchema",
      "deploymentEnv",
      "buildCalendarAppointmentStart",
      "isMissingRelationError",
      "canPortalUserAccessPatient",
      "readClinicBrandingForFamilyView",
      "readClinicPatientReschedulePolicies",
      "parseAppointmentSourcePayloadForFamilyView",
      "serializePortalAppointmentForFamilyView",
      "portalSafeError"
    ]
  },
  {
    "path": "/api/portal/appointments/:appointmentId",
    "name": "createPortalAppointmentDetailHandler",
    "deps": [
      "fetchPortalAppointmentForUser",
      "portalSafeError",
      "sanitizeString",
      "supabase",
      "APPOINTMENT_ACTION_REQUEST_SELECT",
      "SESSION_SIGNATURE_SELECT",
      "APPOINTMENT_STATUS_AUDIT_SELECT",
      "APPOINTMENT_CLOSURE_CHECK_SELECT",
      "CLOSURE_ABA_SESSION_SELECT",
      "hasMissingFinancialSchema",
      "serializePortalAppointmentForFamilyView",
      "buildPortalAppointmentHistory",
      "PORTAL_SESSION_CONSENT_TEXT",
      "PORTAL_SESSION_CONSENT_TEXT_VERSION"
    ]
  },
  {
    "path": "/api/portal/appointments/:appointmentId/reschedule-slots",
    "name": "createPortalRescheduleSlotsHandler",
    "deps": [
      "fetchPortalAppointmentForUser",
      "portalSafeError",
      "readClinicPatientReschedulePolicy",
      "patientRescheduleDisabledResponse",
      "normalizeOperationalAppointmentStatus",
      "isAppointmentTerminalForPortalAction",
      "buildPortalRescheduleAvailabilityForAppointment"
    ]
  }
];
const unique = new Set(routes.map(x => x.path));
assert.equal(unique.size, 3);
let updated = source;
let moduleText = '// Extracted verbatim from server.ts; route middleware stays in the entrypoint.\n\n';
const manifest = [];
for (const route of routes) {
  const anchor = "  app.get('" + route.path + "',";
  const a = source.indexOf(anchor);
  assert.ok(a >= 0 && source.indexOf(anchor, a + 1) === -1, 'route missing or duplicated: ' + route.path);
  const endToken = '\n  });';
  const end = source.indexOf(endToken, a);
  assert.ok(end > a, 'route terminator missing');
  const original = source.slice(a, end + endToken.length);
  const firstLine = original.split('\n')[0];
  const handlerToken = ', async (req: any, res) => {';
  assert.ok(firstLine.endsWith(handlerToken), 'unexpected middleware/handler signature: ' + route.path);
  const expectedLines = route.name === 'createPortalAppointmentsListHandler' ? 234 :
    route.name === 'createPortalAppointmentDetailHandler' ? 97 : 16;
  assert.equal(original.split('\n').length, expectedLines, 'unexpected route body length: ' + route.path);
  const deps = route.deps;
  assert.equal(deps.length, new Set(deps).size);
  for (const dep of deps) assert.match(original, new RegExp('\\b' + dep + '\\b'), 'missing declared dep ' + dep);
  const payload = original.slice(firstLine.length, -endToken.length);
  const dependencyList = deps.map(n => '    ' + n + ',').join('\n');
  const preservedMiddleware = firstLine.slice(0, -handlerToken.length);
  const registration = preservedMiddleware + ', ' + route.name + '(() => ({\n' + dependencyList + '\n  })));';
  assert.ok(!source.includes(route.name), 'already extracted ' + route.name);
  assert.ok(updated.includes(original), 'route overlapped previous extraction');
  updated = updated.replace(original, registration);
  const factory = 'export function ' + route.name + '(getDeps: () => any) {\n'
    + '  return async (req: any, res: any) => {\n'
    + '    const { ' + deps.join(', ') + ' } = getDeps() as { sanitizeString: (value: any, max?: number) => string } & Record<string, any>;'
    + payload + '\n  };\n}\n\n';
  moduleText += factory.replace(/^[ \t]+$/gm, '');
  manifest.push({
    method:'get', path:route.path, factory:route.name,
    originalHeader:firstLine, originalLines:original.split('\n').length,
    sha256:crypto.createHash('sha256').update(original).digest('hex'), dependencies:deps
  });
}
const importLine = "import { " + routes.map(r=>r.name).join(', ') + " } from './services/portalAppointmentReadHandlers';\n";
assert.ok(source.includes("import express from 'express';\n"));
updated = updated.replace("import express from 'express';\n", "import express from 'express';\n" + importLine);
let reverse = updated.replace(importLine, '');
for (const entry of manifest) {
  const route = routes.find(x => x.path === entry.path);
  const anchor = "  app.get('" + route.path + "',";
  const originalA = source.indexOf(anchor), originalB = source.indexOf('\n  });', originalA);
  const original = source.slice(originalA, originalB + '\n  });'.length);
  const signature = entry.originalHeader.slice(0, -', async (req: any, res) => {'.length);
  const register = signature + ', ' + route.name + '(() => ({\n'
    + entry.dependencies.map(x=>'    ' + x + ',').join('\n') + '\n  })));';
  assert.ok(reverse.includes(register));
  reverse = reverse.replace(register, original);
}
assert.equal(reverse, source, 'exact reversible transformation failed');
assert.ok(updated.split('\n').length < source.split('\n').length-250, 'insufficient meaningful reduction');
const parsed=ts.createSourceFile('portalAppointmentReadHandlers.ts',moduleText,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
assert.equal(parsed.parseDiagnostics.length,0, 'generated module must parse');
assert.ok(!fs.existsSync('services/portalAppointmentReadHandlers.ts'), 'module already exists');

fs.writeFileSync('services/portalAppointmentReadHandlers.ts',moduleText);
fs.writeFileSync(serverPath,updated);
fs.mkdirSync('docs/backend-modularization',{recursive:true});
const report={date:'2026-10-13',base:'52e2686c21d284ee0e948f9827b4719032a328e6',originalBlob:'36af849f70c27af3bb1a47d8130e5266d60ea9be',resultBlob:null,originalServerLines:source.split('\n').length,newServerLines:updated.split('\n').length,removedLines:source.split('\n').length-updated.split('\n').length,service:'services/portalAppointmentReadHandlers.ts',routes:manifest,ci:'pending',pr:'pending',merge:'pending',deploy:'pending'};
fs.writeFileSync('docs/backend-modularization/20261013-portal-appointment-read-manifest.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync('docs/backend-modularization/20261013-portal-appointment-read.md',[
'# Portal family appointment read-only modularization — 2026-10-13',
'',
'- Original staging commit: `52e2686c21d284ee0e948f9827b4719032a328e6`.',
'- Exact original `server.ts` Git blob: `36af849f70c27af3bb1a47d8130e5266d60ea9be`.',
'- Cohesive single slice: three GET routes (family appointment list, appointment detail, rescheduling slots), all handlers copied unchanged to `services/portalAppointmentReadHandlers.ts`.',
'- Middleware registration remains at the same original place and in the same original order in `server.ts`.',
'- All dependencies are explicit lazy closure captures; same Supabase queries, tenant checks, role-scoping, HTTP payloads, logs and failure handling.',
'- No writes, migrations, Stripe, Resend or database changes; write endpoints for confirmation and rescheduling untouched.',
'- Exact source round-trip and original blob SHA guard checked before editing. AST parse check. Per-route historical SHA256 and middleware headers recorded in sibling JSON manifest.',
'- Before: '+source.split('\n').length+' lines; after: '+updated.split('\n').length+' lines; reduction: '+report.removedLines+' lines. Not a measure of architecture completion.',
'- Node20 HTTP auth and negative-path regressions, typecheck and build required before PR; standard staging CI required before merge.',
'- Disposable branch-only workflow/script must be removed from final proposed diff.',
'- PR/merge/deploy status at extraction commit: not yet confirmed. Do not duplicate this slice.',
''
].join('\n'));
console.log('PORTAL_APPOINTMENTS_READ_BATCH_EXTRACTED',JSON.stringify({before:report.originalServerLines,after:report.newServerLines,removed:report.removedLines,routes:manifest.map(x=>x.path)}));
