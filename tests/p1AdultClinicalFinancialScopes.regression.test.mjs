import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const agenda = readFileSync('src/components/Calendar.tsx', 'utf8');
const portal = readFileSync('src/utils/patientPortalKind.ts', 'utf8');

// P1-18: both adult models use an existing per-protocol clinical assessment,
// not synthetic ABA skill counts. The comparison is bounded to chosen protocol
// and application dates and never requires a new request from the graphs tab.
assert.match(detail, /data-testid="adult-protocol-evaluation-charts"/);
assert.match(detail, /<ComparisonBarChart data=\{adultDomainComparisonData\}/);
assert.match(detail, /planProtocolCatalog\.map\(\(protocol: any\) => <option/);
assert.match(detail, /adultProtocolSnapshotDates\.map\(\(date: any\) => <option/);
assert.match(detail, /const canViewAdultEvaluationCharts = !isKidsProfile/);
assert.match(detail, /tab === 'aba-charts'\) return hasAbaSessionSurface \|\| canViewAdultEvaluationCharts/);
assert.match(detail, /\['receptionist', 'reception'\]/);

// P1-19: summary uses real completed session records; unknown professional,
// duration or evolution are not guessed; evidence remains linkable.
assert.match(detail, /data-testid="adult-completed-session-timeline-row"/);
assert.match(detail, /completedSessionReports\.map\(\(session: any\) =>/);
assert.match(detail, /professional_name \|\| session\?\.professionalName/);
assert.match(detail, /Duração não informada/);
assert.match(detail, /evolutionText && <p/);
assert.match(detail, /openCompletedSessionReport\(session\.id\)/);
assert.match(detail, /conventionalSessionEvolutions\.map/);
assert.match(detail, /evolution\.appointmentId/);

// P1-20: conventional adult shares assessment and history, but ABA-specific
// flows are still gated by explicit clinical profile.
assert.match(detail, /const hasAbaClinicalProfile = isKidsProfile \|\| isAdultAbaProfile/);
assert.match(detail, /const hasConventionalSessionSurface = !hasAbaClinicalProfile/);
assert.match(detail, /!isKidsProfile && \(\s*<section data-testid="adult-protocol-evaluation-charts"/);

// P1-21/22: clinic module entitlement must be present in server-filtered
// capability set; payer data alone never opts a clinic into TISS.
assert.match(agenda, /const canUseTissBilling = hasAgendaCapability\('patient\.insurance\.view'\)/);
assert.match(agenda, /const canEditBillingContext = canUseTissBilling/);
assert.match(agenda, /const patientFinancialPlans = normalizePatientFinancialPlans/);
assert.match(agenda, /const simplePatientFinancialPlans = patientFinancialPlans\.filter/);
assert.match(agenda, /simplePatientFinancialPlans\.length === 1 \? simplePatientFinancialPlans\[0\] : null/);
assert.match(agenda, /Plano Financeiro do paciente/);
assert.match(agenda, /!canUseTissBilling && simplePatientFinancialPlan/);
assert.match(agenda, /!canUseTissBilling && !simplePatientFinancialPlan/);
assert.match(agenda, /APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS\.filter\(\(option\) => canUseTissBilling \|\| option\.value !== 'INSURANCE'\)/);
assert.match(agenda, /\{canUseTissBilling && billingEditorOpen && \(/);
assert.match(agenda, /\{canUseTissBilling && billingFormUsesInsurance && billingSuggestedTissAuthorization && \(/);
assert.match(agenda, /\{canUseTissBilling && !detailCancellationState\.isCancelled/);
assert.match(agenda, /billingDetailIsNonInsuranceContext && sectionKey === 'tissBilling'/);

console.log('p1AdultClinicalFinancialScopes.regression.test.mjs: ok');
