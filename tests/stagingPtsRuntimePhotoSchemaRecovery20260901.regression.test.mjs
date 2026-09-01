import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const panel = read('src/components/TherapeuticPlanPanel.tsx');
const dashboard = read('src/components/PtsTherapeuticDashboard.tsx');
const historyFallback = read('src/utils/routeSchemaFallbacks.ts');
const photoMigration = read('supabase/migrations/20260901163000_patient_photo_schema_contract_repair.sql');

// Runtime PTS contract: preserve live case-team context and safe arrays.
assert.match(panel, /caseTeamLinks = \[\]/);
assert.match(panel, /clinicTimeZone/);
assert.match(panel, /const professionalLinks = useMemo/);
assert.match(panel, /Array\.isArray\(caseTeamLinks\)/);
assert.match(panel, /sharedEvidence=\{ptsSharedEvidence\}/);
assert.match(panel, /legacyEvidence=\{ptsLegacyEvidence\}/);
assert.match(dashboard, /availableScopes = \[\]/);
assert.match(dashboard, /professionals = \[\]/);
assert.match(dashboard, /sharedEvidence = \[\]/);
assert.match(dashboard, /legacyEvidence = \[\]/);

// Draft persistence: incomplete activation must never discard an already saved draft.
assert.match(panel, /PTS_DRAFT_VALIDATION_FAILED[\s\S]*?draftPreserved === true[\s\S]*?setPtsDraftOverride/);
assert.match(panel, /setActivationWarning/);
assert.match(panel, /Rascunho salvo\. Nenhuma informação preenchida foi descartada\./);

// Explicit sharing remains opt-in and survives edit/reload.
assert.match(panel, /shareWithPts: false/);
assert.match(panel, /Compartilhar resumo com o PTS/);
assert.match(panel, /shareWithPts: Boolean\(normalizedForm\.shareWithPts\)/);
assert.match(panel, /program\?\.advanced_settings\?\.shareWithPts === true/);

// Avoid the known guaranteed 42703 first query on canonical history schema.
const historyColumns = historyFallback.match(/export const HISTORY_SELECT_COLUMNS = \[[\s\S]*?\n\];/)?.[0] || '';
assert.ok(historyColumns.length > 0, 'HISTORY_SELECT_COLUMNS not found');
assert.doesNotMatch(historyColumns, /'updated_at'/);
assert.match(historyColumns, /'created_at'/);

// Existing patient-photo contract must be present even on a drifted environment.
assert.match(photoMigration, /add column if not exists patient_photo_policy text/);
assert.match(photoMigration, /add column if not exists portal_profile_picture text/);
assert.match(photoMigration, /portal_profile_picture_path text/);
assert.match(photoMigration, /set patient_photo_policy = 'PORTAL'[\s\S]*where patient_photo_policy is null/);
assert.match(photoMigration, /check \(patient_photo_policy in \('PORTAL', 'CLINIC'\)\) not valid/);
assert.doesNotMatch(photoMigration, /update public\.patients/);

console.log('stagingPtsRuntimePhotoSchemaRecovery20260901.regression.test.mjs: OK');
