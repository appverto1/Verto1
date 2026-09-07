import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const loadTypeScript = () => {
  try { return require('typescript'); } catch {}
  const tsc = fs.realpathSync(execFileSync('which', ['tsc'], { encoding: 'utf8' }).trim());
  const packageRoot = path.dirname(path.dirname(tsc));
  return require(path.join(packageRoot, 'lib', 'typescript.js'));
};
const ts = loadTypeScript();

const server = fs.readFileSync('server.ts', 'utf8');
const correctiveMigration = fs.readFileSync('supabase/migrations/20260907180000_conventional_session_note_therapist_attribution_fix.sql', 'utf8');
const originalMigration = fs.readFileSync('supabase/migrations/20260905163000_conventional_session_lifecycle.sql', 'utf8');
const privacyMigration = fs.readFileSync('supabase/migrations/20260817103000_patient_note_visibility_privacy_v1.sql', 'utf8');
const appointmentsMigration = fs.readFileSync('supabase/migrations/20260514120000_appointments_push_notifications.sql', 'utf8');

// Canonical semantics: appointment therapist is the responsible professional; note authorship follows the actor.
assert.match(appointmentsMigration, /therapist_id uuid not null references public\.users\(id\)/i);
assert.match(privacyMigration, /set original_author_id = created_by::text::uuid/i);

const sourceFile = ts.createSourceFile('server.ts', server, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let noteRouteCallback = null;
const visit = (node) => {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'put') {
    const firstArg = node.arguments[0];
    if (firstArg && ts.isStringLiteral(firstArg) && firstArg.text === '/api/patients/:patientId/appointments/:appointmentId/conventional-session/note') {
      noteRouteCallback = node.arguments[node.arguments.length - 1];
    }
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
assert.ok(noteRouteCallback, 'conventional session note route must exist');

const routeText = noteRouteCallback.getText(sourceFile);
assert.match(routeText, /appointmentTherapistId\s*=\s*sanitizeString\(appointment\.therapist_id/);
assert.match(routeText, /!isUuid\(appointmentTherapistId\)/);
assert.match(routeText, /CONVENTIONAL_SESSION_THERAPIST_REQUIRED/);

let insertObject = null;
let updateObjects = [];
const visitRoute = (node) => {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    if (method === 'insert' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) insertObject = node.arguments[0];
    if (method === 'update' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) updateObjects.push(node.arguments[0]);
  }
  ts.forEachChild(node, visitRoute);
};
visitRoute(noteRouteCallback);
assert.ok(insertObject, 'route must insert canonical note when absent');
const objectMap = (obj) => Object.fromEntries(obj.properties.filter(ts.isPropertyAssignment).map((p) => [p.name.getText(sourceFile).replace(/["']/g, ''), p.initializer.getText(sourceFile)]));
const routeInsert = objectMap(insertObject);
assert.equal(routeInsert.therapist_id, 'appointmentTherapistId');
assert.equal(routeInsert.created_by, 'actorId');
assert.equal(routeInsert.original_author_id, 'actorId');
for (const updateObject of updateObjects) {
  assert.ok(!('therapist_id' in objectMap(updateObject)), 'existing conventional note update must not silently replace therapist_id');
}

const splitSqlList = (input) => {
  const parts = [];
  let depth = 0;
  let current = '';
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      current += ch;
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; }
    else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

assert.match(correctiveMigration, /notes[^\n]*therapist_id[\s\S]*udt_name = 'uuid'[\s\S]*is_nullable = 'NO'/i);
assert.match(correctiveMigration, /appointments[^\n]*therapist_id[\s\S]*udt_name = 'uuid'/i);
assert.match(correctiveMigration, /to_regprocedure\('public\.complete_conventional_appointment_session_v1\(uuid,uuid,uuid,uuid,timestamptz,text,text,text\)'\)/i);

const functionAt = correctiveMigration.indexOf('CREATE OR REPLACE FUNCTION public.complete_conventional_appointment_session_v1');
assert.ok(functionAt >= 0);
const functionBlock = correctiveMigration.slice(functionAt);
const assignmentAt = functionBlock.indexOf('v_therapist_id := v_appointment.therapist_id;');
const insertAt = functionBlock.indexOf('INSERT INTO public.notes');
assert.ok(assignmentAt >= 0 && assignmentAt < insertAt, 'appointment professional must be resolved before note insert');
assert.match(functionBlock.slice(assignmentAt, insertAt), /IF v_therapist_id IS NULL THEN[\s\S]*CONVENTIONAL_SESSION_THERAPIST_REQUIRED/);

const insertMatch = functionBlock.match(/INSERT INTO public\.notes\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*;/i);
assert.ok(insertMatch, 'corrective RPC must contain note insert');
const columns = splitSqlList(insertMatch[1]);
const values = splitSqlList(insertMatch[2]);
assert.equal(columns.length, values.length, 'INSERT column/value arity must match');
const sqlMap = Object.fromEntries(columns.map((column, index) => [column.trim(), values[index].trim()]));
assert.equal(sqlMap.therapist_id, 'v_therapist_id');
assert.equal(sqlMap.created_by, 'p_actor_id');
assert.equal(sqlMap.original_author_id, 'p_actor_id');

const PROFESSIONAL_A = '11111111-1111-4111-8111-111111111111';
const COORDINATOR_B = '22222222-2222-4222-8222-222222222222';
const resolveIdentifier = (identifier, env) => env[identifier];
assert.equal(resolveIdentifier(routeInsert.therapist_id, { appointmentTherapistId: PROFESSIONAL_A, actorId: COORDINATOR_B }), PROFESSIONAL_A);
assert.equal(resolveIdentifier(routeInsert.created_by, { appointmentTherapistId: PROFESSIONAL_A, actorId: COORDINATOR_B }), COORDINATOR_B);
assert.equal(resolveIdentifier(routeInsert.original_author_id, { appointmentTherapistId: PROFESSIONAL_A, actorId: COORDINATOR_B }), COORDINATOR_B);
assert.equal(resolveIdentifier(sqlMap.therapist_id, { v_therapist_id: PROFESSIONAL_A, p_actor_id: COORDINATOR_B }), PROFESSIONAL_A);
assert.equal(resolveIdentifier(sqlMap.created_by, { v_therapist_id: PROFESSIONAL_A, p_actor_id: COORDINATOR_B }), COORDINATOR_B);

// Normal therapist-operated case remains valid too.
assert.equal(resolveIdentifier(routeInsert.therapist_id, { appointmentTherapistId: PROFESSIONAL_A, actorId: PROFESSIONAL_A }), PROFESSIONAL_A);
assert.equal(resolveIdentifier(routeInsert.created_by, { appointmentTherapistId: PROFESSIONAL_A, actorId: PROFESSIONAL_A }), PROFESSIONAL_A);

// Existing note update/retry keeps attribution; completion lifecycle/finance contract stays unchanged.
const sqlUpdateMatch = functionBlock.match(/UPDATE public\.notes\s+SET([\s\S]*?)WHERE id = v_note_id;/i);
assert.ok(sqlUpdateMatch);
assert.doesNotMatch(sqlUpdateMatch[1], /therapist_id\s*=/i);
assert.match(functionBlock, /UPDATE public\.appointments[\s\S]*status = 'completed'/);
assert.doesNotMatch(functionBlock, /INSERT INTO public\.payments|create_patient_financial_charge|sync_private_appointment_finance/i);
assert.match(originalMigration, /CREATE OR REPLACE FUNCTION public\.complete_conventional_appointment_session_v1/);

console.log('conventionalSessionProfessionalAttribution.regression.test.mjs: ok');
