import assert from 'node:assert/strict';
import fs from 'node:fs';

const editor = fs.readFileSync(new URL('../src/components/PtsWorkspaceEditor.tsx', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/TherapeuticPlanPanel.tsx', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../src/utils/ptsClinicalWorkspace.ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260826190000_pts_draft_persistence_activation_v3.sql', import.meta.url), 'utf8');

assert.match(editor, /expectedDraftRevision: confirmedRevisionRef\.current/,
  'o editor envia a ultima revisao confirmada pelo Salvar, nao props obsoletas');
assert.match(editor, /persistInFlightRef\.current = true[\s\S]*finally \{[\s\S]*persistInFlightRef\.current = false/,
  'duplo clique em Salvar/Ativar nao pode criar requests concorrentes');
assert.doesNotMatch(editor, /activationValidation\.firstFieldId[\s\S]{0,500}return;[\s\S]{0,300}const normalized/);

for (const pattern of [
  /needs:[\s\S]*?\.filter\(\(item\) => item\.id\);/,
  /goals:[\s\S]*?\.filter\(\(item\) => item\.id\);/,
  /responsibilities:[\s\S]*?\.filter\(\(item\) => item\.id\);/,
  /network:[\s\S]*?\.filter\(\(item\) => item\.id\);/,
  /risks:[\s\S]*?\.filter\(\(item\) => item\.id\);/,
]) assert.match(workspace, pattern);

assert.match(server, /activate_patient_pts_draft_v3/);
assert.match(server, /validationFailed === true[\s\S]*draftPreserved: true[\s\S]*data: \(data as any\)\.version/);
assert.match(panel, /draftPreserved === true && response\?\.data\?\.id[\s\S]*setPtsDraftOverride/);

assert.match(migration, /create or replace function public\.patient_pts_snapshot_ready_for_activation_v3/);
assert.match(migration, /\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$/);
assert.match(migration, /from public\.save_patient_pts_draft_v2\([\s\S]*if not public\.patient_pts_snapshot_ready_for_activation_v3\(v_snapshot\) then[\s\S]*return jsonb_build_object\([\s\S]*'validationFailed', true[\s\S]*'draftPreserved', true/);
assert.doesNotMatch(migration, /raise exception 'PTS_DRAFT_VALIDATION_FAILED'/);
assert.match(migration, /create or replace function public\.activate_patient_pts_draft_v3/);

console.log('PASS pts draft persistence / activation regression');
