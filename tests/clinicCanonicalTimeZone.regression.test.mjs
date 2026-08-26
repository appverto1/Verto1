import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const coordinator = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/components/ClinicGlobalSettingsPanel.tsx', import.meta.url), 'utf8');
const ptsEditor = fs.readFileSync(new URL('../src/components/PtsWorkspaceEditor.tsx', import.meta.url), 'utf8');
const ptsEvent = fs.readFileSync(new URL('../src/components/PtsEventForm.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260826174500_clinic_canonical_timezone_v1.sql', import.meta.url), 'utf8');

assert.match(server, /clinicTimeZone:\s*context\.clinic\?\.timeZone/, 'session must expose authoritative clinic timezone');
assert.match(server, /clinicTimeZone:\s*resolveClinicTimeZone/, 'session payload must normalize clinic timezone');
assert.match(server, /timezone:\s*clinicTimeZone/, 'clinic settings save must persist canonical timezone');
assert.match(settings, /Fuso horário da clínica/, 'clinic settings must expose the canonical timezone');
assert.match(settings, /BRAZIL_CLINIC_TIME_ZONE_OPTIONS/, 'timezone selector must use curated IANA options');
assert.match(coordinator, /clinicTimeZone:\s*cleanClinicTimeZone/, 'coordinator save payload must include clinic timezone');
assert.match(ptsEditor, /toDateTimeLocalValue\(draft\.participationRecordedAt, clinicTimeZone\)/, 'PTS draft datetime must render in clinic timezone');
assert.match(ptsEvent, /fromDateTimeLocalValue\(occurredAt, clinicTimeZone\)/, 'PTS append-only events must persist using clinic timezone');
assert.match(migration, /when 'MS' then 'America\/Campo_Grande'/, 'Mato Grosso do Sul must backfill to Campo Grande timezone');
assert.match(migration, /pg_catalog\.pg_timezone_names/, 'database must validate timezone against IANA catalog');

console.log('clinicCanonicalTimeZone.regression.test.mjs: ok');
