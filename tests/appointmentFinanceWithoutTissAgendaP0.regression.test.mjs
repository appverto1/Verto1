import assert from 'node:assert/strict';
import fs from 'node:fs';

const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

// Finance-only insurance appointments must stay available without opening any TISS-only surface.
assert.match(
  coordinator,
  /const sessionUsesTissOperationalFields\s*=\s*sessionFinancialContextType === ["']INSURANCE["']\s*&&\s*hasInsuranceTissModule/,
  'Agenda must derive one explicit TISS operational gate from INSURANCE + insurance_tiss entitlement',
);

assert.match(
  coordinator,
  /!sessionUsesTissOperationalFields[\s\S]{0,900}setSessionBillingSuggestionState\(\{ loading: false, error: ["']["'], suggestion: null \}\)/,
  'billing suggestion/TUSS loading must short-circuit when TISS is not entitled',
);

assert.match(
  coordinator,
  /appointment\.id\s*&&\s*!isTherapist\s*&&\s*hasInsuranceTissModule[\s\S]{0,500}getAppointmentBillingContext/,
  'editing an appointment must not read the TISS billing-context endpoint without insurance_tiss',
);

assert.match(
  coordinator,
  /if \(hasInsuranceTissModule\) \{[\s\S]{0,1200}updateAppointmentBillingContext/,
  'editing a finance-only insurance appointment must not PATCH the TISS billing-context endpoint',
);

assert.match(
  coordinator,
  /sessionUsesTissOperationalFields\s*&&\s*\([\s\S]{0,500}Procedimento faturável do convênio/,
  'TUSS/De-Para procedure UI must be hidden without TISS',
);
assert.match(
  coordinator,
  /sessionUsesTissOperationalFields\s*&&\s*\([\s\S]{0,700}Dados do plano/,
  'TISS plan/card UI must be hidden without TISS',
);
assert.match(
  coordinator,
  /sessionUsesTissOperationalFields\s*\?\s*\([\s\S]{0,500}Guia/,
  'guide/authorization fields must be hidden without TISS',
);

assert.match(
  coordinator,
  /insuranceTissEnabled:\s*hasInsuranceTissModule/,
  'Agenda persistence must carry the already-hydrated module decision to App without a second entitlement lookup',
);

assert.match(
  app,
  /const usesTissOperationalFields\s*=\s*usesInsuranceContext\s*&&\s*sess\.insuranceTissEnabled !== false/,
  'App must distinguish generic INSURANCE financial context from optional TISS operational fields',
);
assert.match(
  app,
  /const insuranceServiceCatalogId = usesTissOperationalFields/,
  'App must not derive TUSS service catalog data for finance-only insurance appointments',
);
assert.match(
  app,
  /const effectiveInsurancePlanName = usesTissOperationalFields/,
  'App must not hydrate TISS plan data for finance-only insurance appointments',
);
assert.match(
  app,
  /guideNumber: usesTissOperationalFields \? occurrenceBillingFields\.guideNumber : ['"]["']/,
  'App must not persist guide data when insurance_tiss is absent',
);
assert.match(
  app,
  /authorizationCode: usesTissOperationalFields \? occurrenceBillingFields\.authorizationCode : ['"]["']/,
  'App must not persist authorization data when insurance_tiss is absent',
);

// The generic payer identity remains part of INSURANCE even when TISS is disabled.
assert.match(app, /payerId: usesInsuranceContext \? effectivePayerId \|\| null : null/);
assert.match(app, /payerName: usesInsuranceContext \? effectivePayerName \|\| ['"]["'] : ['"]["']/);

console.log('appointmentFinanceWithoutTissAgendaP0 regression: ok');
