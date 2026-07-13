import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const app = read('src/App.tsx');
const dashboard = read('src/components/PatientDashboard.tsx');
const detailView = read('src/components/PatientDetailView.tsx');
const historyCard = read('src/components/History.tsx');
const dataService = read('src/services/dataService.ts');
const server = read('server.ts');
const historyPhotoMigration = read('supabase/migrations/20260711123000_history_photo_storage_path.sql');

assert.match(dashboard, /FAMILY_DAILY_PHOTO_LIMIT = 5/);
assert.match(dashboard, /const saveResult = await onAddFamilyNote/);
assert.match(dashboard, /setShowFamilySuccess\(true\)/);
assert.match(dashboard, /setIsFamilySaving\(true\)/);
assert.match(dataService, /mimeType: 'image\/webp'/);
assert.match(dataService, /resolveIdempotentPatientPhotoPath/);
assert.match(app, /source:\s*isSimpleNote \? 'family_portal_note' : 'family_portal'/);
assert.match(app, /setHistory\(prev => prev\.filter/);
assert.match(server, /requireRoles\('coordinator', 'receptionist', 'therapist', 'admin', 'owner'\).*app\.patch\('\/api\/history|app\.patch\('\/api\/history[\s\S]*requireRoles\('coordinator', 'receptionist', 'therapist', 'admin', 'owner'\)/);
assert.doesNotMatch(server, /app\.patch\('\/api\/history\/:historyId'[\s\S]{0,200}requireRoles\([^)]*'patient'/);

assert.match(dashboard, /return `\$\{day\}\/\$\{month\}\/\$\{year\}`/);
assert.match(dashboard, /return raw\.replace\(\/-\/g, '\/'\)/);
assert.match(detailView, /formatPatientTimelineDateLabel/);
assert.match(detailView, /return `\$\{isoDate\[3\]\}\/\$\{isoDate\[2\]\}\/\$\{isoDate\[1\]\}`/);
assert.match(detailView, /formatPatientTimelineDateLabel\(dateKey\)/);

assert.match(dashboard, /const ownerPatientId = String\(portalPatientId \|\| user\?\.patientId \|\| user\?\.patient_id \|\| user\?\.id \|\| ''\)\.trim\(\)/);
assert.match(dashboard, /const fileName = `\$\{ownerPatientId\}\/family\/family-\$\{Date\.now\(\)\}\.\$\{extension\}`/);
assert.match(dashboard, /const fileName = `\$\{ownerPatientId\}\/family\/family-\$\{Date\.now\(\)\}-\$\{file\.name\}`/);
assert.doesNotMatch(dashboard, /const fileName = `\$\{user\.id\}\/family-/);
assert.doesNotMatch(dashboard, /const fileName = `\$\{user\.id\}\/\$\{Date\.now\(\)\}-/);

assert.match(dashboard, /metadata\?\.attachments/);
assert.match(dashboard, /entry\?\.storage_path/);
assert.match(dashboard, /item\?\.storage_path/);
assert.match(historyCard, /getFamilyHistoryImageSource/);
assert.match(historyCard, /metadata\?\.attachments/);
assert.match(historyCard, /patient-photos\/'\)/);
assert.match(detailView, /resolveFamilyMediaForTimeline/);
assert.match(detailView, /metadata\?\.attachments/);
assert.match(detailView, /patient_id:\s*n\?\.patient_id \?\? n\?\.patientId \?\? patient\?\.id/);
assert.match(detailView, /sourceRef:\s*current\?\.sourceRef \|\| entry\?\.sourceRef/);

assert.match(server, /function enrichPatientPhotoHistoryRow/);
assert.match(historyPhotoMigration, /add column if not exists image_path text/);
assert.match(historyPhotoMigration, /history_active_photo_image_path_idx/);
assert.match(server, /const enrichedHistory = consolidatedHistory\.map\(enrichPatientPhotoHistoryRow\)/);
assert.match(server, /const enriched = deduped\.map\(enrichPatientPhotoHistoryRow\)/);
assert.match(server, /const enriched = \(Array\.isArray\(data\) \? data : \[\]\)\.slice\(0, limit\)\.map\(enrichPatientPhotoHistoryRow\)/);
assert.match(server, /possibleReferences/);
assert.match(server, /\.in\('image_path', possibleReferences\)/);
assert.match(server, /\.in\('image', possibleReferences\)/);
assert.match(server, /linkedPatientIdSet\.has\(rowPatientId\)/);
assert.match(server, /canAccessPatientInCurrentClinic\(rowPatientId, req\.session\.user\)/);
assert.match(dashboard, /attachments: Array\.isArray\(note\?\.attachments\)/);
assert.match(dashboard, /note\?\.storage_path/);

console.log('family diary persistence checks passed');
