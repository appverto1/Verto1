import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/PatientEvolutionTimelinePanel.tsx', import.meta.url), 'utf8');
const external = fs.readFileSync(new URL('../src/components/ExternalEvolutionShare.tsx', import.meta.url), 'utf8');
const externalTimeline = fs.readFileSync(new URL('../src/components/ExternalPatientTimeline.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const data = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260828203000_patient_evolution_timeline_v2.sql', import.meta.url), 'utf8');

// Commercial entitlement remains unchanged.
assert.match(migration, /STANDARD includes one shareable item\/month; PLUS3 allows three items\/month/);
assert.match(migration, /unit_amount_cents integer not null default 200/);
assert.match(migration, /check \(unit_amount_cents = 200\)/);
assert.match(migration, /billing_status = 'ACTIVE'[\s\S]*monthly_limit = 3/);
assert.match(migration, /EVOLUTION_TIMELINE_STANDARD_MONTH_LIMIT/);
assert.match(migration, /EVOLUTION_TIMELINE_PLUS3_MONTH_LIMIT/);
assert.match(server, /EVOLUTION_TIMELINE_PLUS_UNIT_AMOUNT_CENTS = 200/);
assert.match(server, /STRIPE_EVOLUTION_TIMELINE_PLUS_PRICE_ID/);
assert.match(server, /amount !== EVOLUTION_TIMELINE_PLUS_UNIT_AMOUNT_CENTS/);
assert.match(panel, /1 registro por paciente\/mês incluído/);
assert.match(panel, /Até 3 registros por paciente\/mês/);
assert.match(panel, /R\$ 2,00 por paciente\/mês/);
assert.match(detail, /canManageBilling=\{hasCapability\('finance\.entries\.manage'\)\}/);
assert.match(data, /upgradePatientEvolutionTimelinePlus3/);

// External access is exact-item authorization; the Central aggregates authorized grants.
assert.match(server, /resolveExternalEvolutionAuthorizedShare/);
assert.match(server, /external_account_id/);
assert.match(server, /care_network_contact_id/);
assert.match(server, /itemId !== sanitizeString\(loaded\.item\?\.id, 120\)/);
assert.match(server, /\/api\/external\/evolution\/:publicId\/file\/:itemId/);
assert.match(server, /\/api\/external\/care-network\/shared/);
assert.match(server, /\.eq\('external_account_id', accountId\)/);
assert.match(server, /\.eq\('status', 'ACTIVE'\)/);
assert.match(external, /openAuthorizedTimeline/);
assert.match(externalTimeline, /timelineItemId/);
assert.match(externalTimeline, /item\.canComment/);
assert.doesNotMatch(externalTimeline, /R\$ 2/);
assert.doesNotMatch(externalTimeline, /monthlyLimit/);

console.log('patientEvolutionTimelineV2.regression: PASS');
