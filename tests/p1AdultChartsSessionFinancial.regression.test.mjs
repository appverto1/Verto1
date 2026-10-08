import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const coordinator = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

// Both adult portal types prioritize evaluation by protocol.
assert.match(detail, /!isKidsProfile && \(\s*<section data-testid="adult-protocol-evaluation-charts"/);
assert.match(detail, /<ComparisonBarChart data=\{adultDomainComparisonData\}/);
assert.match(detail, /\{isKidsProfile \? \(\s*<ClinicalChartsWorkspace/);
assert.match(detail, /hasAbaClinicalProfile \? \(\s*<details[^>]+data-testid="adult-aba-intervention-charts-optional"/);
assert.match(detail, /Gráficos de intervenção ABA \(complementares à avaliação\)/);

// Adult conventional keeps the session history and no ABA intervention surface.
assert.match(detail, /data-testid="adult-completed-session-timeline-row"/);
for (const property of ['duration_minutes', 'professional_name', 'evolution_note']) {
  assert.ok(detail.includes(property), 'adult timeline must preserve ' + property);
}
assert.match(detail, /activeTab === 'session' && hasConventionalSessionSurface/);
assert.match(detail, /Evolução da sessão/);

// TISS financial fields are only sent/read for entitled clinics; simple financial
// plan remains independent of insurance module.
assert.match(coordinator, /const hasInsuranceTissModule = authorizationHydrated && hasModule\("insurance_tiss"\)/);
assert.match(coordinator, /sessionFinancialContextType === "INSURANCE" && hasInsuranceTissModule/);
assert.match(coordinator, /\.\.\.\(hasInsuranceTissModule\s*\? \{/);
assert.match(coordinator, /const canManagePatientFinancialPlan = hasCapability\("patient\.demographics\.edit"\)/);

console.log('p1AdultChartsSessionFinancial.regression.test.mjs: ok');
