import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20261008103000_patient_wellbeing_production_reconciliation.sql', 'utf8');
const previous = fs.readFileSync('supabase/migrations/20260829114500_smoke_corrections_block6_followup.sql', 'utf8');

assert.match(sql, /create table if not exists public\.patient_wellbeing_checkins/);
assert.match(sql, /organization_id uuid not null references public\.clinics/);
assert.match(sql, /clinic_id uuid not null references public\.clinics/);
assert.match(sql, /patient_id uuid not null references public\.patients/);
assert.match(sql, /metric_kind in \('mood', 'energy'\)/);
assert.match(sql, /metric_value between 0 and 100/);
assert.doesNotMatch(sql, /unique\s*\(clinic_id,\s*patient_id,\s*metric_kind,\s*local_date\)/i);
assert.match(sql, /enable row level security/);
assert.match(sql, /revoke all on table public\.patient_wellbeing_checkins from public, anon, authenticated/);
assert.match(sql, /revoke update, delete on table public\.patient_wellbeing_checkins from service_role/);
assert.match(sql, /grant select, insert on table public\.patient_wellbeing_checkins to service_role/);
assert.match(sql, /create index if not exists idx_patient_wellbeing_checkins_patient_created/);
assert.match(previous, /with legacy_wellbeing as/);
assert.doesNotMatch(sql, /(?:drop\s+table|truncate\s|delete\s+from|update\s+public\.history)/i);
console.log('p0WellbeingProductionReconciliation.regression.test.mjs: ok');
