import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createPatientFinancialPlan,
  findUniqueActiveFinancialPlanForService,
  isMonthlySessionBillingPlan,
} from '../src/utils/patientFinancialPlan';

const speech = createPatientFinancialPlan({
  id: 'speech-plan',
  serviceType: 'SPEECH_THERAPY',
  billingMode: 'PRIVATE',
  billingFrequency: 'MONTHLY',
  pricingUnit: 'SESSION',
  aggregationMethod: 'ELIGIBLE_COMPLETED_SESSIONS',
  amountCents: 18000,
  dueDay: 5,
  status: 'ACTIVE',
});
const psychology = createPatientFinancialPlan({
  id: 'psych-plan',
  serviceType: 'PSYCHOLOGY',
  billingMode: 'PRIVATE',
  billingFrequency: 'MONTHLY',
  pricingUnit: 'SESSION',
  aggregationMethod: 'ELIGIBLE_COMPLETED_SESSIONS',
  amountCents: 19000,
  dueDay: 10,
  status: 'ACTIVE',
});
const plans = [speech, psychology];

// Reproduction: the persisted service name differs from the billing catalog code.
assert.equal(findUniqueActiveFinancialPlanForService(plans, 'Fonoaudiólogo')?.id, 'speech-plan');
assert.equal(findUniqueActiveFinancialPlanForService(plans, 'Fonoaudiologia')?.amountCents, 18000);
assert.equal(findUniqueActiveFinancialPlanForService(plans, 'SPEECH_THERAPY')?.amountCents, 18000);
assert.equal(findUniqueActiveFinancialPlanForService(plans.filter(isMonthlySessionBillingPlan), 'Fonoaudiólogo')?.dueDay, '5');
assert.equal(findUniqueActiveFinancialPlanForService(plans, 'Psicoterapeuta')?.id, 'psych-plan');

// Do not silently use the only available plan for a different profession.
assert.equal(findUniqueActiveFinancialPlanForService([speech], 'Terapeuta Ocupacional'), null);
assert.equal(findUniqueActiveFinancialPlanForService([speech], 'ABA'), null);
assert.equal(findUniqueActiveFinancialPlanForService(plans, ''), null);
assert.equal(findUniqueActiveFinancialPlanForService([], 'Fonoaudiólogo'), null);
assert.equal(findUniqueActiveFinancialPlanForService([
  speech, { ...speech, id: 'duplicate' },
], 'Fonoaudiólogo'), null);
assert.equal(findUniqueActiveFinancialPlanForService([
  { ...speech, status: 'INACTIVE' }, psychology,
], 'Fonoaudiólogo'), null);
assert.equal(findUniqueActiveFinancialPlanForService([
  createPatientFinancialPlan({ serviceType: 'OCCUPATIONAL_THERAPY', amountCents: 10000 }),
], 'Terapeuta Ocupacional')?.serviceType, 'OCCUPATIONAL_THERAPY');

const calendar = fs.readFileSync('src/components/Calendar.tsx', 'utf8');
const detail = calendar.slice(calendar.indexOf('const billingContext = detail.billingContext'), calendar.indexOf('const billingAuthorizationId'));
assert.match(detail, /savedAppointmentFinancialContext/);
assert.match(detail, /findUniqueActiveFinancialPlanForService/);
assert.match(detail, /eventSourceFinancial\.financialContextType/);
assert.match(detail, /patientFinance\?\.payment_id[\s\S]*patientFinance\.unit_amount[\s\S]*monthlySessionPlan/);
assert.doesNotMatch(detail, /simplePatientFinancialPlans\.length === 1/);
assert.doesNotMatch(detail, /monthlySessionPlans\.length === 1/);
assert.match(calendar, /monthlySessionUnitAmount === null \? 'Valor não disponível/);

console.log('appointmentCalendarFinancialPlanRead.regression.test.ts: ok');
