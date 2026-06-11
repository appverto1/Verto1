import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const app = read('src/App.tsx');
const dashboard = read('src/components/PatientDashboard.tsx');
const dataService = read('src/services/dataService.ts');
const server = read('server.ts');

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

console.log('family diary persistence checks passed');
