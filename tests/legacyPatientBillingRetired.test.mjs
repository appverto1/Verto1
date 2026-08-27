import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260827153000_platform_financial_ledger_and_subscription_state.sql', import.meta.url), 'utf8');

const patientProfileWindow = server.slice(server.indexOf("const upsertPatientProfile = async"), server.indexOf("const crossClinic", server.indexOf("const upsertPatientProfile = async")) > 0 ? server.indexOf("const crossClinic", server.indexOf("const upsertPatientProfile = async")) : server.indexOf("const upsertPatientProfile = async") + 5000);
assert.doesNotMatch(patientProfileWindow, /plan_price:\s*4\.90/, 'clinic-created patient profile must not get R$ 4,90 SaaS price');
assert.match(server, /LEGACY_PATIENT_BILLING_RETIRED/, 'patient checkout endpoint must fail closed');
assert.doesNotMatch(app, /Pagar Agora \(R\$ 4,90\)/, 'patient R$ 4,90 checkout CTA must be retired');
assert.match(app, /não possui assinatura individual/, 'patient UI must explain clinic-managed billing');
assert.match(migration, /where lower\(coalesce\(role::text, ''\)\) = 'patient'/i, 'migration must clean stored patient R$ 4,90 markers');

console.log('legacyPatientBillingRetired.test: PASS');
