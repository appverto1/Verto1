import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const read = (file) => fs.readFileSync(file, 'utf8');
const source = read('src/utils/ptsClinicalWorkspace.ts');
const editor = read('src/components/PtsWorkspaceEditor.tsx');
const panel = read('src/components/TherapeuticPlanPanel.tsx');
const migration = read('supabase/migrations/20261009160000_pts_activation_optional_content_v4.sql');
const baseMigration = read('supabase/migrations/20260826190000_pts_draft_persistence_activation_v3.sql');
const server = read('server.ts');

const context = { exports: {}, Date, Set, Map, Object, Array, String, Number, RegExp };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { emptyPtsClinicalPayload, validatePtsDraftForActivation } = context.exports;
assert.equal(validatePtsDraftForActivation(emptyPtsClinicalPayload()).valid, true, 'empty PTS is activatable');
assert.equal(validatePtsDraftForActivation({
  ...emptyPtsClinicalPayload(),
  caseManagerId: '', startedAt: '', goals: [], needs: [],
}).valid, true, 'all optional clinical fields may be blank');
assert.equal(validatePtsDraftForActivation({
  ...emptyPtsClinicalPayload(), goals: [{ title: '', target: '', responsibleProfessionalIds: [] }],
}).valid, true, 'incomplete drafts may be activated without synthetic fields');

assert.match(migration, /create or replace function public\.patient_pts_snapshot_ready_for_activation_v3/);
assert.match(migration, /jsonb_typeof\(p_snapshot->'pts_payload'\) = 'object'/);
assert.doesNotMatch(migration, /caseManagerId|startedAt|jsonb_array_length|responsibleProfessionalIds/,
  'clinical field completion cannot be required to activate');
assert.match(migration, /revoke all on function public\.patient_pts_snapshot_ready_for_activation_v3\(jsonb\)[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.patient_pts_snapshot_ready_for_activation_v3\(jsonb\)[\s\S]*to service_role/);
assert.match(baseMigration, /from public\.save_patient_pts_draft_v2\([\s\S]*p_expected_draft_revision/);
assert.match(server, /requireClinicCapability\('treatment_plan\.edit'\), checkPatientAccess/);
assert.match(server, /PTS_DRAFT_VERSION_CONFLICT/);

assert.match(editor, /expectedDraftRevision: confirmedRevisionRef\.current/);
assert.match(editor, /persistInFlightRef\.current = true[\s\S]*persistInFlightRef\.current = false/);
assert.match(editor, /outcome\?\.success \|\| outcome\?\.draftPreserved/);
assert.match(editor, /approvedConflictRevision > confirmedRevisionRef\.current/);
assert.match(panel, /ptsDraftWriteInFlightRef\.current = true/);
assert.match(panel, /const fresh = await dataService\.getPatientTherapeuticPlan\(patientId, \{ force: true \}\)/);
assert.match(panel, /sameContent\) \{[\s\S]*response = await send\(\{ \.\.\.requestPayload, expectedDraftRevision: freshRevision \}\)/);
assert.match(panel, /window\.confirm\('Aplicar seu preenchimento atual sobre a revisão mais recente/);
assert.match(panel, /setApprovedPtsRebaseRevision\(ptsDraftConflict\.revision\)/);
assert.match(panel, /setPtsEditorReloadKey\(\(value\) => value \+ 1\)/);
assert.match(panel, /draftRevision: acknowledgedRevision/);
assert.match(panel, /setScopeSaving\(false\)/);
console.log('p000PtsActivationOptionalAndCas.regression.test.mjs: ok');
