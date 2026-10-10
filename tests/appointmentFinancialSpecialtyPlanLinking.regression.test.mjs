import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const ledger = fs.readFileSync('src/components/PatientFinanceWorkspace.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261009211000_appointment_financial_specialty_plan_matching.sql', 'utf8');

// The appointment specialty remains clinic-scoped; the dropdown must not be
// locked to the previously selected professional.
assert.match(dashboard, /clinicSessionSpecialtyOptions\.map\(\(specialty\) =>/);
assert.match(dashboard, /appointmentProfessionalOptions\.filter\(\(member\) =>[\s\S]{0,180}clinicalSpecialtiesMatch\(member\.clinicSpecialty, specialty\)/);
assert.match(dashboard, /eligible\.length === 1 \? eligible\[0\] : null/);
assert.match(dashboard, /const selected = current \|\| responsible \|\| \(eligible\.length === 1/);
assert.match(dashboard, /if \(!isAddSessionModalOpen \|\| editingAppointmentId \|\| !sessionApproach\) return/);

// Canonical patient plan is matched by specialty, not a plan from another care line.
assert.match(dashboard, /const resolveSessionFinancialPlanForSpecialty =/);
assert.match(dashboard, /matching\.length === 1 \? matching\[0\] : null/);
assert.match(dashboard, /financialPlanMatchesAppointmentService\(plan, specialty\)/);
assert.match(dashboard, /if \(plan\?\.billingMode === "PRIVATE"\)/);
assert.match(dashboard, /setSessionFinancialContextType\("PRIVATE"\)/);
assert.match(dashboard, /selectedSessionMonthlyPlan\.amountCents/);
assert.match(dashboard, /cobrança é consolidada mensalmente após a conclusão/);
assert.match(dashboard, /sessionFinancialContextType !== "INSURANCE"\) return/);

// The ledger cannot misclassify a different specialty when only one monthly plan exists.
assert.match(ledger, /clinicalSpecialtiesMatch\(value, row\?\.serviceType\)/);
assert.match(ledger, /return matching\.length === 1 \? matching\[0\] : null/);
assert.doesNotMatch(ledger, /plans\.length === 1 \? plans\[0\] : null/);

// SQL authority: both the per-session pricing RPC and canonical monthly engine
// must match financial plan lines by the same immutable clinical alias key.
assert.match(migration, /create or replace function public\.appointment_financial_service_key_v1/);
assert.match(migration, /when v in \('fonoaudiologo','fonoaudiologa','fonoaudiologia','fono','speech_therapy'\)/);
assert.match(migration, /when v in \('terapeuta_ocupacional','terapia_ocupacional','occupational_therapy','to'\)/);
assert.match(migration, /create or replace function public\.resolve_private_session_price_v1/);
assert.match(migration, /create or replace function public\.resolve_appointment_financial_engine_v1/);
assert.match(migration, /create or replace function public\.sync_monthly_session_billing_for_appointment_v1/);
assert.ok((migration.match(/appointment_financial_service_key_v1\(plan\.service_type\)/g) || []).length >= 5);
assert.match(migration, /plan\.organization_id=p_organization_id/);
assert.match(migration, /plan\.patient_id=p_patient_id/);
assert.match(migration, /plan\.billing_mode=v_context_type/);
assert.match(migration, /if v_monthly_count>1 then return 'AMBIGUOUS'/);
assert.match(migration, /pg_advisory_xact_lock/);

console.log('appointmentFinancialSpecialtyPlanLinking.regression.test.mjs: ok');
