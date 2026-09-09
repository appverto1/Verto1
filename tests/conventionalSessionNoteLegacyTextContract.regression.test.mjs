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
const migration = fs.readFileSync('supabase/migrations/20260907193000_conventional_session_note_legacy_text_contract_fix.sql', 'utf8');
const previousAttributionMigration = fs.readFileSync('supabase/migrations/20260907180000_conventional_session_note_therapist_attribution_fix.sql', 'utf8');

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
assert.ok(noteRouteCallback, 'conventional note PUT route must exist');

const objectMap = (obj) => Object.fromEntries(
  obj.properties.flatMap((p) => {
    if (ts.isPropertyAssignment(p)) return [[p.name.getText(sourceFile).replace(/["']/g, ''), p.initializer.getText(sourceFile)]];
    if (ts.isShorthandPropertyAssignment(p)) {
      const name = p.name.getText(sourceFile);
      return [[name, name]];
    }
    return [];
  })
);

let insertObject = null;
const updateObjects = [];
const visitRoute = (node) => {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    if (method === 'insert' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) insertObject = node.arguments[0];
    if (method === 'update' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) updateObjects.push(node.arguments[0]);
  }
  ts.forEachChild(node, visitRoute);
};
visitRoute(noteRouteCallback);
assert.ok(insertObject, 'route must insert the conventional note when missing');
const routeInsert = objectMap(insertObject);

// Required legacy/canonical dual-write plus professional attribution.
assert.equal(routeInsert.text, 'content');
assert.equal(routeInsert.content, 'content');
assert.equal(routeInsert.therapist_id, 'appointmentTherapistId');
assert.equal(routeInsert.created_by, 'actorId');
assert.equal(routeInsert.original_author_id, 'actorId');

// Every content mutation in the PUT route must keep legacy text + canonical content synchronized.
assert.ok(updateObjects.length >= 2, 'route should cover existing-note update and 23505 retry update');
for (const updateObject of updateObjects) {
  const map = objectMap(updateObject);
  if ('content' in map) {
    assert.equal(map.text, 'content', 'every conventional note content update must also write text');
    assert.equal(map.content, 'content');
  }
  assert.ok(!('therapist_id' in map), 'content update must not change therapist attribution');
  assert.ok(!('created_by' in map), 'content update must not change creator');
  assert.ok(!('original_author_id' in map), 'content update must not change original author');
}

const routeText = noteRouteCallback.getText(sourceFile);
assert.match(routeText, /\.slice\(0,\s*12001\)/, '12k content limit must stay enforced');
assert.match(routeText, /content\.length\s*>\s*12000/);

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

// Preflight must verify the explicitly discovered mandatory legacy columns and also enumerate
// every NOT NULL/no-default column in the real staging schema before replacing the RPC.
assert.match(migration, /table_name = 'notes' AND column_name = 'text'[\s\S]*udt_name = 'text' AND is_nullable = 'NO'/i);
assert.match(migration, /table_name = 'notes' AND column_name = 'content'[\s\S]*udt_name = 'text'/i);
assert.match(migration, /table_name = 'notes' AND column_name = 'therapist_id'[\s\S]*udt_name = 'uuid' AND is_nullable = 'NO'/i);
assert.match(migration, /table_name = 'appointments' AND column_name = 'therapist_id'[\s\S]*udt_name = 'uuid'/i);
assert.match(migration, /is_nullable = 'NO'[\s\S]*column_default IS NULL[\s\S]*is_identity[\s\S]*is_generated/i);
assert.match(migration, /CONVENTIONAL_SESSION_NOTE_TEXT_PREFLIGHT_UNSUPPORTED_REQUIRED_COLUMNS/);
assert.match(migration, /CONVENTIONAL_SESSION_NOTE_REQUIRED_NO_DEFAULT_COLUMNS/);

const expectedColumnsMatch = migration.match(/v_conventional_insert_columns constant text\[\] := ARRAY\[([\s\S]*?)\];/i);
assert.ok(expectedColumnsMatch, 'migration must declare the shared writer insert contract');
const supportedRequired = new Set([...expectedColumnsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
for (const required of ['id','patient_id','appointment_id','therapist_id','text','content','visibility','type','subject','source','portability_scope','is_portable','shared_with_patient','shared_with_professionals','original_author_id','created_by','is_active']) {
  assert.ok(supportedRequired.has(required), `shared writer contract must include ${required}`);
}

const functionAt = migration.indexOf('CREATE OR REPLACE FUNCTION public.complete_conventional_appointment_session_v1');
assert.ok(functionAt >= 0, 'corrective migration must replace the installed completion RPC');
const functionBlock = migration.slice(functionAt);

const insertMatch = functionBlock.match(/INSERT INTO public\.notes\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*;/i);
assert.ok(insertMatch, 'completion RPC must contain conventional note insert');
const columns = splitSqlList(insertMatch[1]);
const values = splitSqlList(insertMatch[2]);
assert.equal(columns.length, values.length, 'SQL INSERT column/value arity must match');
const sqlMap = Object.fromEntries(columns.map((column, index) => [column.trim(), values[index].trim()]));
const expectedNoteExpr = "left(coalesce(p_session_note, ''), 12000)";
assert.equal(sqlMap.text, expectedNoteExpr);
assert.equal(sqlMap.content, expectedNoteExpr);
assert.equal(sqlMap.therapist_id, 'v_therapist_id');
assert.equal(sqlMap.created_by, 'p_actor_id');
assert.equal(sqlMap.original_author_id, 'p_actor_id');

const sqlUpdateMatch = functionBlock.match(/UPDATE public\.notes\s+SET([\s\S]*?)WHERE id = v_note_id;/i);
assert.ok(sqlUpdateMatch, 'completion RPC must update the existing canonical note');
assert.match(sqlUpdateMatch[1], /text\s*=\s*left\(coalesce\(p_session_note, ''\), 12000\)/i);
assert.match(sqlUpdateMatch[1], /content\s*=\s*left\(coalesce\(p_session_note, ''\), 12000\)/i);
assert.doesNotMatch(sqlUpdateMatch[1], /therapist_id\s*=/i);
assert.doesNotMatch(sqlUpdateMatch[1], /created_by\s*=/i);
assert.doesNotMatch(sqlUpdateMatch[1], /original_author_id\s*=/i);

// Semantic scenario: appointment professional differs from coordinator actor.
const PROFESSIONAL_A = '11111111-1111-4111-8111-111111111111';
const COORDINATOR_B = '22222222-2222-4222-8222-222222222222';
const SESSION_NOTE = 'evolução';
const routeEnv = { content: SESSION_NOTE, appointmentTherapistId: PROFESSIONAL_A, actorId: COORDINATOR_B };
assert.equal(routeEnv[routeInsert.text], SESSION_NOTE);
assert.equal(routeEnv[routeInsert.content], SESSION_NOTE);
assert.equal(routeEnv[routeInsert.therapist_id], PROFESSIONAL_A);
assert.equal(routeEnv[routeInsert.created_by], COORDINATOR_B);
assert.equal(routeEnv[routeInsert.original_author_id], COORDINATOR_B);

// Previous professional attribution hotfix remains installed conceptually; only content contract changes.
assert.match(previousAttributionMigration, /v_therapist_id := v_appointment\.therapist_id;/);
assert.match(functionBlock, /v_therapist_id := v_appointment\.therapist_id;/);
assert.match(functionBlock, /UPDATE public\.appointments[\s\S]*status = 'completed'/);
assert.doesNotMatch(functionBlock, /INSERT INTO public\.payments|create_patient_financial_charge|sync_private_appointment_finance/i);

console.log('conventionalSessionNoteLegacyTextContract.regression.test.mjs: ok');
