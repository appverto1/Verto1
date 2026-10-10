import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  appointmentCardPaymentMethodLabel,
  appointmentCardPriceSourceLabel,
  appointmentCardPrivatePolicyLabel,
  appointmentCardServiceLabel,
} from '../src/utils/appointmentCardDisplayLabels';

// Patient plan codes remain unchanged; only the appointment detail presents PT-BR labels.
assert.equal(appointmentCardServiceLabel('SPEECH_THERAPY'), 'Fonoaudiologia');
assert.equal(appointmentCardServiceLabel('PSYCHOLOGY'), 'Psicologia');
assert.equal(appointmentCardServiceLabel('OCCUPATIONAL_THERAPY'), 'Terapia ocupacional');
assert.equal(appointmentCardServiceLabel('NUTRITION'), 'Nutrição');
assert.equal(appointmentCardServiceLabel('MUSIC_THERAPY'), 'Musicoterapia');
assert.equal(appointmentCardServiceLabel('CUSTOM'), 'Outro serviço');
assert.equal(appointmentCardServiceLabel('Fonoaudiólogo'), 'Fonoaudiólogo');
assert.equal(appointmentCardServiceLabel(''), 'Não informado');

assert.equal(appointmentCardPaymentMethodLabel('card'), 'Cartão');
assert.equal(appointmentCardPaymentMethodLabel('CARD'), 'Cartão');
assert.equal(appointmentCardPaymentMethodLabel('pix'), 'PIX');
assert.equal(appointmentCardPaymentMethodLabel('cash'), 'Dinheiro');
assert.equal(appointmentCardPaymentMethodLabel('transfer'), 'Transferência');
assert.equal(appointmentCardPaymentMethodLabel('CREDIT_CARD'), 'Cartão de crédito');
assert.equal(appointmentCardPaymentMethodLabel('BANK_TRANSFER'), 'Transferência bancária');
assert.equal(appointmentCardPaymentMethodLabel(''), 'Não informada');

assert.equal(appointmentCardPriceSourceLabel(null, 'LEGACY_PATIENT_PLAN'), 'Plano particular vigente do paciente');
assert.equal(appointmentCardPriceSourceLabel(null, 'MANUAL_OVERRIDE'), 'Valor manual autorizado');
assert.equal(appointmentCardPriceSourceLabel('Regra vigente da clínica', 'SERVICE_RULE'), 'Regra vigente da clínica');
assert.equal(appointmentCardPriceSourceLabel(null, null), 'Histórico anterior');

const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
assert.match(calendar, /appointmentCardServiceLabel\(detailEvent\.type\)/);
assert.match(calendar, /Serviço:<\/span> \{appointmentCardServiceLabel\(/);
assert.match(calendar, /appointmentCardPaymentMethodLabel\(simplePatientFinancialPlan\.paymentMethod\)/);
assert.match(calendar, /appointmentCardPaymentMethodLabel\(patientFinance\?\.method\)/);
assert.match(calendar, /appointmentCardPriceSourceLabel\(patientFinance\?\.private_price_source_label, patientFinance\?\.private_price_source\)/);
assert.doesNotMatch(calendar, /String\(simplePatientFinancialPlan\.paymentMethod\)\.toUpperCase\(\)/);
assert.match(calendar, /Ver lista de verificação/);
assert.match(calendar, /Validação financeira da sessão/);

// Scheduling's private price quote must show PT-BR policy labels, never
// backend rule codes. A missing rule is the contractual no-charge default.
assert.equal(appointmentCardPrivatePolicyLabel({ type: 'NO_CHARGE', value: 0 }), 'Sem cobrança');
assert.equal(appointmentCardPrivatePolicyLabel({ type: 'no_charge', value: 0 }), 'Sem cobrança');
assert.equal(appointmentCardPrivatePolicyLabel(null), 'Sem cobrança');
assert.equal(appointmentCardPrivatePolicyLabel({ type: 'FULL', value: 0 }), '100% do valor da sessão');
assert.equal(appointmentCardPrivatePolicyLabel({ type: 'PERCENTAGE', value: 25 }), '25% do valor da sessão');
assert.equal(appointmentCardPrivatePolicyLabel({ type: 'FIXED', value: 37.5 }), 'R$ 37,50');
assert.equal(appointmentCardPrivatePolicyLabel({ type: 'MANUAL' }), 'Decisão manual');
assert.equal(appointmentCardPrivatePolicyLabel({ type: 'UNKNOWN' }), 'Regra não informada');

const coordinator = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
assert.match(coordinator, /Cancelamento tardio:<\/span> \{appointmentCardPrivatePolicyLabel\(sessionPrivatePricingState\.quote\.late_cancellation_rule\)\}/);
assert.match(coordinator, /Falta:<\/span> \{appointmentCardPrivatePolicyLabel\(sessionPrivatePricingState\.quote\.no_show_rule\)\}/);
assert.doesNotMatch(coordinator, /\.late_cancellation_rule\?\.type \|\| "NO_CHARGE"/);
assert.doesNotMatch(coordinator, /\.no_show_rule\?\.type \|\| "NO_CHARGE"/);

console.log('appointmentCardPortugueseLabels.regression.test.ts: ok');
