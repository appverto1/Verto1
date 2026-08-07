import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateTissPreGuide } from '../src/services/tissPreGuideEngine';
import { communication040300Strategy } from '../src/services/tissOfficial/versions/communication040300/generator';
import { generateTissXmlDraft } from '../src/services/tissXmlDraftGenerator';
import {
  getOfficialTissAmountBlockReason,
  isFrozenZeroAmountXmlAllowed,
} from '../src/utils/tissOfficialBatchEligibility';


const migration = fs.readFileSync('supabase/migrations/20260806183000_payer_tiss_zero_amount_xml_policy.sql', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const payerPanel = fs.readFileSync('src/components/PayerRequirementsPanel.tsx', 'utf8');

assert.match(migration, /^begin;/m);
assert.match(migration, /allows_zero_amount_xml boolean not null default false/);
assert.match(migration, /zero_amount_xml_reason text/);
assert.match(migration, /check \(total_amount_cents >= 0\)/);
assert.match(migration, /create trigger assert_tiss_official_zero_amount_policy/);
assert.match(migration, /TISS_ZERO_AMOUNT_XML_POLICY_REQUIRED/);
assert.match(migration, /commit;/);
assert.doesNotMatch(migration, /\btruncate\b/i);
assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
assert.doesNotMatch(migration, /\bdrop\s+table\b/i);
assert.match(server, /TISS_ZERO_AMOUNT_XML_REASON_REQUIRED/);
assert.match(server, /TISS_ZERO_AMOUNT_XML_POLICY_REQUIRED/);
assert.match(server, /amount\.value === 0 && !Boolean\(payerTissProfile\?\.allows_zero_amount_xml\)/);
assert.match(payerPanel, /A operadora calcula o valor após importar o XML/);
assert.match(payerPanel, /R\$ 0,00 exige a política explícita da operadora/);

const IDS = {
  appointment: '11111111-1111-4111-8111-111111111111',
  patient: '22222222-2222-4222-8222-222222222222',
  professional: '33333333-3333-4333-8333-333333333333',
  payer: '44444444-4444-4444-8444-444444444444',
  service: '55555555-5555-4555-8555-555555555555',
  tuss: '66666666-6666-4666-8666-666666666666',
  mapping: '77777777-7777-4777-8777-777777777777',
  price: '88888888-8888-4888-8888-888888888888',
  clinic: '99999999-9999-4999-8999-999999999999',
  clinicProfile: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  payerProfile: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  professionalProfile: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  authorization: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  preGuide: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};

const ZERO_REASON = 'Vivest calcula o valor contratado no portal após a importação';

function buildValidationInput(allowsZeroAmountXml: boolean) {
  return {
    appointment: {
      id: IDS.appointment,
      patient_id: IDS.patient,
      therapist_id: IDS.professional,
      scheduled_at: '2026-07-04T14:00:00-03:00',
      scheduled_start_at: '2026-07-04T14:00:00-03:00',
      scheduled_end_at: '2026-07-04T14:50:00-03:00',
      duration_minutes: 50,
      status: 'scheduled',
    },
    patient: {
      id: IDS.patient,
      name: 'THALITA EROULANA PHELLIPE',
      insurance_card_number: '04010650728000',
      insurance_card_valid_until: '2107-05-01',
    },
    payer: { id: IDS.payer, name: 'Vivest', payer_type: 'INSURANCE' },
    billingContext: {
      payer_type: 'INSURANCE',
      payer_id: IDS.payer,
      insurance_card_number: '04010650728000',
      insurance_card_valid_until: '2107-05-01',
    },
    billingItem: {
      appointment_id: IDS.appointment,
      patient_id: IDS.patient,
      professional_id: IDS.professional,
      service_catalog_id: IDS.service,
      quantity: 1,
      billing_unit: 'session',
    },
    service: {
      id: IDS.service,
      internal_code: 'PSICO',
      name: 'Sessão de psicoterapia individual por psicólogo',
      active: true,
      billing_unit: 'session',
      default_quantity: 1,
    },
    tussCode: {
      id: IDS.tuss,
      code: '50000470',
      description: 'SESSAO DE PSICOTERAPIA INDIVIDUAL POR PSICOLOGO',
      version: '202601',
      active: true,
    },
    mapping: {
      id: IDS.mapping,
      payer_id: IDS.payer,
      service_catalog_id: IDS.service,
      tuss_code_id: IDS.tuss,
      valid_from: '2026-01-01',
      valid_to: null,
      active: true,
    },
    price: {
      id: IDS.price,
      payer_id: IDS.payer,
      service_catalog_id: IDS.service,
      tuss_code_id: IDS.tuss,
      amount_cents: 0,
      valid_from: '2026-01-01',
      active: true,
      source: 'payer_contract',
    },
    clinic: { id: IDS.clinic, name: 'CLINICA CONSTRUINDO SABERES LTDA' },
    clinicProfile: {
      id: IDS.clinicProfile,
      legal_name: 'CLINICA CONSTRUINDO SABERES LTDA',
      trade_name: 'CLINICA CONSTRUINDO SABERES LTDA',
      document_type: 'CNPJ',
      document_number: '12345678000199',
      cnes_code: '4032046',
      provider_code: '413704',
    },
    payerProfile: {
      id: IDS.payerProfile,
      ans_registration: '315478',
      tiss_version: '4.03.00',
      default_guide_type: 'sp_sadt',
      default_attendance_type: '02',
      default_attendance_regime: '01',
      default_attendance_character: '1',
      contracted_executant: 'CLINICA CONSTRUINDO SABERES LTDA',
      contracted_provider_code: '413704',
      requires_provider_code: true,
      requires_cnes: true,
      requires_cbo: true,
      requires_executant_registry: true,
      requires_beneficiary_card: true,
      requires_beneficiary_card_validity: true,
      requires_authorization: true,
      requires_authorization_password: true,
      requires_guide_number: true,
      anti_glosa_reviewed: true,
      allows_zero_amount_xml: allowsZeroAmountXml,
      zero_amount_xml_reason: allowsZeroAmountXml ? ZERO_REASON : null,
    },
    professionalProfile: {
      id: IDS.professionalProfile,
      professional_id: IDS.professional,
      display_name: 'Luciano Pereira da Silva Santos',
      council_type: 'CRP',
      council_number: '123009',
      council_state: 'SP',
      cbo_code: '251510',
    },
    professional: { id: IDS.professional, name: 'Luciano Pereira da Silva Santos' },
    authorization: {
      id: IDS.authorization,
      status: 'ACTIVE',
      authorization_number: '21348170119',
      guide_number: '21348170',
      valid_from: '2026-07-04',
      valid_until: '2026-09-02',
      authorized_quantity: 1,
      used_quantity: 0,
      service_catalog_id: IDS.service,
      tuss_code_id: IDS.tuss,
      procedure_tuss_code: '50000470',
    },
    signature: {},
  };
}

const blockedPreGuide = validateTissPreGuide(buildValidationInput(false));
assert.equal(blockedPreGuide.status, 'pending_data');
assert.ok(blockedPreGuide.errorCodes.includes('AMOUNT_MISSING'));
assert.ok(!blockedPreGuide.warningCodes.includes('ZERO_AMOUNT_XML_OPERATOR_POLICY'));

const allowedPreGuide = validateTissPreGuide(buildValidationInput(true));
assert.equal(allowedPreGuide.status, 'valid');
assert.deepEqual(allowedPreGuide.errorCodes, []);
assert.ok(allowedPreGuide.warningCodes.includes('ZERO_AMOUNT_XML_OPERATOR_POLICY'));
assert.equal(allowedPreGuide.snapshot.procedure.unitAmountCents, 0);
assert.equal(allowedPreGuide.snapshot.procedure.totalAmountCents, 0);
assert.equal(allowedPreGuide.snapshot.procedure.zeroAmountXmlPolicyApplied, true);
assert.equal(allowedPreGuide.snapshot.payer.requirements.allowsZeroAmountXml, true);
assert.equal(allowedPreGuide.snapshot.payer.requirements.zeroAmountXmlReason, ZERO_REASON);

const preGuideRow = {
  id: IDS.preGuide,
  status: allowedPreGuide.status,
  organizationId: IDS.clinic,
  payerId: IDS.payer,
  appointmentId: IDS.appointment,
  snapshot: allowedPreGuide.snapshot,
  validationErrorCodes: allowedPreGuide.errorCodes,
  validationErrors: allowedPreGuide.errors,
};

assert.equal(isFrozenZeroAmountXmlAllowed(preGuideRow), true);
assert.equal(getOfficialTissAmountBlockReason(preGuideRow), null);
assert.equal(getOfficialTissAmountBlockReason({
  ...preGuideRow,
  snapshot: {
    ...allowedPreGuide.snapshot,
    procedure: {
      ...allowedPreGuide.snapshot.procedure,
      zeroAmountXmlPolicyApplied: false,
    },
  },
}), 'Sem valor');
assert.equal(getOfficialTissAmountBlockReason({
  ...preGuideRow,
  snapshot: {
    ...allowedPreGuide.snapshot,
    procedure: {
      ...allowedPreGuide.snapshot.procedure,
      zeroAmountXmlReason: '',
    },
    payer: {
      ...allowedPreGuide.snapshot.payer,
      requirements: {
        ...allowedPreGuide.snapshot.payer.requirements,
        zeroAmountXmlReason: '',
      },
    },
  },
}), 'Sem valor');

const draftResult = generateTissXmlDraft({
  preGuides: [preGuideRow],
  payerId: IDS.payer,
  competenceMonth: '2026-07',
  tissVersion: '4.03.00',
  generatedAt: '2026-08-06T20:00:00Z',
});
assert.equal(draftResult.ok, true);
if (!draftResult.ok) throw new Error('O rascunho deveria aceitar o valor zero autorizado.');
assert.equal(draftResult.totalAmountCents, 0);
assert.ok(draftResult.validationSummary.warnings.some((warning: any) => warning.code === 'ZERO_AMOUNT_XML_OPERATOR_POLICY'));
assert.match(draftResult.xml, /<totalAmount>0\.00<\/totalAmount>/);
assert.ok(draftResult.technicalValidation.warnings.some((warning: any) => warning.code === 'ZERO_AMOUNT_XML_OPERATOR_POLICY'));

const officialResult = communication040300Strategy.generate({
  preGuides: [preGuideRow],
  payerId: IDS.payer,
  competenceMonth: '2026-07',
  batchNumber: '1',
  generatedAt: '2026-08-06T20:00:00Z',
  timeZone: 'America/Sao_Paulo',
});

assert.equal(officialResult.ok, true);
if (!officialResult.ok) throw new Error('A geração oficial deveria aceitar o valor zero autorizado.');
assert.equal(officialResult.totalAmountCents, 0);
assert.equal(officialResult.validationSummary.zeroAmountPolicyGuideCount, 1);
assert.deepEqual(officialResult.validationSummary.zeroAmountPolicyReasons, [ZERO_REASON]);
assert.match(officialResult.xml, /<ans:valorUnitario>0\.00<\/ans:valorUnitario>/);
assert.match(officialResult.xml, /<ans:valorTotal>0\.00<\/ans:valorTotal>/);
assert.match(officialResult.xml, /<ans:valorTotalGeral>0\.00<\/ans:valorTotalGeral>/);

console.log('tissZeroAmountXmlPolicy: ok');
