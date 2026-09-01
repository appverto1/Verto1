import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/PatientEvolutionTimelinePanel.tsx', import.meta.url), 'utf8');
const external = fs.readFileSync(new URL('../src/components/ExternalEvolutionShare.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const data = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260828203000_patient_evolution_timeline_v2.sql', import.meta.url), 'utf8');

// Commercial entitlement: one item included, three only after active paid entitlement.
assert.match(migration, /STANDARD includes one shareable item\/month; PLUS3 allows three items\/month/);
assert.match(migration, /unit_amount_cents integer not null default 200/);
assert.match(migration, /check \(unit_amount_cents = 200\)/);
assert.match(migration, /billing_status = 'ACTIVE'[\s\S]*monthly_limit = 3/);
assert.match(migration, /generate_series\(1, v_limit\)/);
assert.match(migration, /EVOLUTION_TIMELINE_STANDARD_MONTH_LIMIT/);
assert.match(migration, /EVOLUTION_TIMELINE_PLUS3_MONTH_LIMIT/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /reserve_patient_evolution_timeline_plus_v1/);
assert.match(migration, /finalize_patient_evolution_timeline_plus_v1/);
assert.match(migration, /revoke all on table public\.patient_evolution_timeline_entitlements from public, anon, authenticated/);
assert.doesNotMatch(migration, /drop table/i);
assert.doesNotMatch(migration, /truncate/i);

// Runtime enforces the entitlement and Stripe price, not just the UI.
assert.match(server, /create_patient_evolution_timeline_item_v2/);
assert.match(server, /EVOLUTION_TIMELINE_PLUS_UNIT_AMOUNT_CENTS = 200/);
assert.match(server, /STRIPE_EVOLUTION_TIMELINE_PLUS_PRICE_ID/);
assert.match(server, /amount !== EVOLUTION_TIMELINE_PLUS_UNIT_AMOUNT_CENTS/);
assert.match(server, /currency !== 'brl'/);
assert.match(server, /interval !== 'month'/);
assert.match(server, /'\/api\/patients\/:patientId\/evolution-timeline\/upgrade-plus3'/);
const upgradeStart = server.indexOf("'/api/patients/:patientId/evolution-timeline/upgrade-plus3'");
const upgradeEnd = server.indexOf("app.delete(\n    '/api/patients/:patientId/evolution-timeline/:itemId'", upgradeStart);
const upgradeRoute = server.slice(upgradeStart, upgradeEnd);
assert.match(upgradeRoute, /requireClinicCapability\('reports\.generate'\)/);
assert.match(upgradeRoute, /requireClinicCapability\('finance\.entries\.manage'\)/);
assert.match(upgradeRoute, /reserve_patient_evolution_timeline_plus_v1/);
assert.match(upgradeRoute, /finalize_patient_evolution_timeline_plus_v1/);
assert.match(upgradeRoute, /post-activation quantity reconciliation warning/);

// Internal responsible UI: month is in the circle and capacity is represented by dots.
assert.match(panel, /compactMonthLabel\(month\)\.split\(' '\)\[0\]/);
assert.match(panel, /compactMonthLabel\(month\)\.split\(' '\)\[1\]/);
assert.match(panel, /Array\.from\(\{ length: entitlement\.monthlyLimit \}\)/);
assert.match(panel, /1 registro por paciente\/mês incluído/);
assert.match(panel, /Até 3 registros por paciente\/mês/);
assert.match(panel, /R\$ 2,00 por paciente\/mês/);
assert.match(panel, /Ativar até 3 · \+R\$ 2\/mês/);
assert.match(panel, /canManageBilling/);
assert.match(detail, /canManageBilling=\{hasCapability\('finance\.entries\.manage'\)\}/);
assert.match(data, /upgradePatientEvolutionTimelinePlus3/);

// External access is a recipient-filtered read-only timeline, not a single item.
assert.match(server, /loadExternalEvolutionTimelineForRecipient/);
assert.match(server, /\.eq\('recipient_email', email\)/);
assert.doesNotMatch(server.slice(server.indexOf('const loadExternalEvolutionTimelineForRecipient'), server.indexOf("app.get('/api/external/evolution/:publicId/content")), /\.ilike\('recipient_email'/);
assert.match(server, /visibleMonthCount: timeline\.length/);
assert.match(server, /timeline,[\s\S]*readOnly: true/);
assert.match(server, /\/api\/external\/evolution\/:publicId\/file\/:itemId/);
assert.match(server, /eq\('timeline_item_id', itemId\)[\s\S]*eq\('status', 'ACTIVE'\)[\s\S]*eq\('recipient_email', email\)/);

assert.match(external, /external-evolution-readonly-timeline/);
assert.match(external, /Timeline de evolução/);
assert.match(external, /monthCircleParts\(month\.monthKey\)/);
assert.match(external, /Somente os registros compartilhados com/);
assert.match(external, /Meses sem conteúdo compartilhado com este e-mail não são exibidos/i);
assert.match(external, /\/file\/\$\{encodeURIComponent\(itemId\)\}/);
assert.doesNotMatch(external, /R\$ 2/);
assert.doesNotMatch(external, /monthlyLimit/);
assert.doesNotMatch(external, /0\/3|1\/3|2\/3|3\/3/);

console.log('patientEvolutionTimelineV2.regression: PASS');
