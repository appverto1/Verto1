import assert from 'node:assert/strict';
import fs from 'node:fs';

const sessionMode = fs.readFileSync(new URL('../src/components/SessionMode.tsx', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260818203000_aba_session_quick_collection_preferences_v1.sql', import.meta.url), 'utf8');

assert.doesNotMatch(sessionMode, /verto\.aba_dock_locations:/, 'custom ABA locations must not persist only in localStorage');
assert.match(sessionMode, /getAbaSessionQuickCollectionPreferences/);
assert.match(sessionMode, /createAbaSessionLocation/);
assert.match(sessionMode, /updateAbaSessionLocation/);
assert.match(sessionMode, /removeAbaSessionLocation/);
assert.match(sessionMode, /saveAbaQuickBehaviorShortcuts/);
assert.match(sessionMode, /crisisMode \? baselineQuickBehaviorShortcuts : quickBehaviorShortcuts/, 'personalized shortcuts must not hide the existing crisis shortcut set');
assert.match(sessionMode, /data-aba-personalized-quick-shortcuts/);
assert.match(sessionMode, /Adicionar local da sessão/);
assert.match(sessionMode, /Sondagens previstas para hoje/);
assert.match(sessionMode, /Elas não serão ativadas automaticamente/);
assert.match(sessionMode, /Agora não/);
assert.match(sessionMode, /Não cancela o planejamento clínico/);

assert.match(dataService, /getAbaSessionQuickCollectionPreferences/);
assert.match(dataService, /saveAbaQuickBehaviorShortcuts/);
assert.match(server, /\/api\/aba\/session-quick-collection\/preferences/);
assert.match(server, /\/api\/aba\/session-locations/);
assert.match(server, /requireClinicCapability\('aba\.behavior\.record'\)/);
assert.match(server, /save_aba_user_session_preferences_v1/);
assert.match(server, /const savedPreference = Array\.isArray\(data\) \? data\[0\] : data/, 'RPC response must tolerate object or row-array shapes');

assert.match(migration, /create table if not exists public\.aba_session_locations/);
assert.match(migration, /create table if not exists public\.aba_user_session_preferences/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on public\.aba_session_locations from anon, authenticated/);
assert.match(migration, /grant select, insert, update, delete on public\.aba_session_locations to service_role/);
assert.match(migration, /aba_session_locations_active_name_unique_v1/);
assert.match(migration, /pg_advisory_xact_lock/);

console.log('abaSessionQuickCollectionPersistence.regression.test.mjs: ok');
