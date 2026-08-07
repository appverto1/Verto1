import assert from 'node:assert/strict';
import { validateTissPreGuide } from '../src/services/tissPreGuideEngine';
import { generateAndValidateOfficialTissDocument } from '../src/services/tissOfficial/officialTissDocumentService';
import { communication040300Strategy } from '../src/services/tissOfficial/versions/communication040300/generator';
import { calculateTissEpilogueHash } from '../src/services/tissOfficial/security';

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

const PROVIDER_GUIDE_NUMBER = '07878204072678502701';
const OPERATOR_GUIDE_NUMBER = '21348170';
const ZERO_REASON = 'A operadora calcula o valor contratado no portal depois da importação.';

const tissGuideMetadata = {
  schemaVersion: 1,
  providerGuideNumber: PROVIDER_GUIDE_NUMBER,
  operatorGuideNumber: OPERATOR_GUIDE_NUMBER,
  requestDate: '2026-07-04',
  consultationType: '1',
  executantParticipationDegree: '11',
  requester: {
    name: 'MEDICO NAO ENCONTRADO',
    councilType: 'CRM',
    councilNumber: '222222',
    councilState: 'SP',
    cboCode: '999999',
    source: 'manual_document',
  },
};

function buildVivestValidationInput() {
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
      name: 'PACIENTE TESTE VIVEST',
      insurance_card_number: '04010650000001',
      insurance_card_valid_until: '2107-05-01',
    },
    payer: { id: IDS.payer, name: 'Vivest', payer_type: 'INSURANCE' },
    billingContext: {
      payer_type: 'INSURANCE',
      payer_id: IDS.payer,
      insurance_card_number: '04010650000001',
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
    clinic: { id: IDS.clinic, name: 'CLINICA TESTE VIVEST LTDA' },
    clinicProfile: {
      id: IDS.clinicProfile,
      legal_name: 'CLINICA TESTE VIVEST LTDA',
      trade_name: 'CLINICA TESTE VIVEST LTDA',
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
      default_attendance_type: '04',
      default_attendance_regime: '01',
      default_attendance_character: '1',
      contracted_executant: 'CLINICA TESTE VIVEST LTDA',
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
      allows_zero_amount_xml: true,
      zero_amount_xml_reason: ZERO_REASON,
    },
    professionalProfile: {
      id: IDS.professionalProfile,
      professional_id: IDS.professional,
      display_name: 'PROFISSIONAL EXECUTANTE TESTE',
      document_type: 'CPF',
      document_number: '12345678901',
      council_type: 'CRP',
      council_number: '123009',
      council_state: 'SP',
      cbo_code: '251510',
      provider_code: '5872211',
    },
    professional: { id: IDS.professional, name: 'PROFISSIONAL EXECUTANTE TESTE' },
    authorization: {
      id: IDS.authorization,
      status: 'ACTIVE',
      authorization_number: '21348170119',
      authorization_code: '21348170119',
      guide_number: OPERATOR_GUIDE_NUMBER,
      issue_date: '2026-07-04',
      valid_from: '2026-07-04',
      valid_until: '2026-09-02',
      authorized_quantity: 1,
      used_quantity: 0,
      service_catalog_id: IDS.service,
      tuss_code_id: IDS.tuss,
      procedure_tuss_code: '50000470',
      sync_metadata: { tissGuide: tissGuideMetadata },
    },
    signature: {},
  };
}

function preGuideRow(snapshot: Record<string, any>) {
  return {
    id: IDS.preGuide,
    status: 'valid',
    organizationId: IDS.clinic,
    payerId: IDS.payer,
    appointmentId: IDS.appointment,
    guideNumber: OPERATOR_GUIDE_NUMBER,
    providerGuideNumber: snapshot.authorization?.providerGuideNumber,
    operatorGuideNumber: snapshot.authorization?.operatorGuideNumber,
    snapshot,
    validationErrorCodes: [],
    validationErrors: [],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function assertBlockingCode(result: ReturnType<typeof communication040300Strategy.generate>, code: string) {
  assert.equal(result.ok, false, `A geração deveria bloquear com ${code}.`);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.code === code), `Código ${code} não encontrado: ${result.issues.map((issue) => issue.code).join(', ')}`);
}

const validation = validateTissPreGuide(buildVivestValidationInput());
assert.equal(validation.status, 'valid');
assert.deepEqual(validation.errorCodes, []);
assert.ok(validation.warningCodes.includes('ZERO_AMOUNT_XML_OPERATOR_POLICY'));

const snapshot = validation.snapshot;
assert.equal(snapshot.authorization.providerGuideNumber, PROVIDER_GUIDE_NUMBER);
assert.equal(snapshot.authorization.operatorGuideNumber, OPERATOR_GUIDE_NUMBER);
assert.equal(snapshot.authorization.authorizationDate, '2026-07-04');
assert.equal(snapshot.authorization.requestDate, '2026-07-04');
assert.deepEqual(snapshot.requester, tissGuideMetadata.requester);
assert.equal(snapshot.attendance.consultationType, '1');
assert.equal(snapshot.professional.operatorProviderCode, '5872211');
assert.equal(snapshot.professional.documentType, 'CPF');
assert.equal(snapshot.professional.documentNumber, '12345678901');
assert.equal(snapshot.professional.participationDegree, '11');

const input = {
  preGuides: [preGuideRow(snapshot)],
  payerId: IDS.payer,
  competenceMonth: '2026-07',
  batchNumber: '163713811638',
  generatedAt: '2026-08-07T15:20:24-03:00',
  timeZone: 'America/Sao_Paulo',
  communicationVersion: '04.03.00',
};

const built = await generateAndValidateOfficialTissDocument(input);
assert.equal(built.ok, true);
if (!built.ok) throw new Error(`Fixture Vivest não gerou XML oficial: ${built.issues.map((issue) => issue.code).join(', ')}`);
assert.equal(built.xsdValidation.status, 'valid');
assert.deepEqual(built.xsdValidation.errors, []);

const { xml, epilogueHash } = built.generated;
assert.match(xml, /<ans:numeroGuiaPrestador>07878204072678502701<\/ans:numeroGuiaPrestador>/);
assert.match(xml, /<ans:numeroGuiaOperadora>21348170<\/ans:numeroGuiaOperadora>/);
assert.doesNotMatch(xml, /<ans:numeroGuiaPrestador>21348170<\/ans:numeroGuiaPrestador>/);

const requesterXml = xml.match(/<ans:profissionalSolicitante>([\s\S]*?)<\/ans:profissionalSolicitante>/)?.[1] || '';
assert.match(requesterXml, /<ans:nomeProfissional>MEDICO NAO ENCONTRADO<\/ans:nomeProfissional>/);
assert.match(requesterXml, /<ans:conselhoProfissional>06<\/ans:conselhoProfissional>/);
assert.match(requesterXml, /<ans:numeroConselhoProfissional>222222<\/ans:numeroConselhoProfissional>/);
assert.match(requesterXml, /<ans:UF>35<\/ans:UF>/);
assert.match(requesterXml, /<ans:CBOS>999999<\/ans:CBOS>/);
assert.doesNotMatch(requesterXml, /PROFISSIONAL EXECUTANTE TESTE/);

assert.match(xml, /<ans:tipoConsulta>1<\/ans:tipoConsulta>/);
const executantXml = xml.match(/<ans:equipeSadt>([\s\S]*?)<\/ans:equipeSadt>/)?.[1] || '';
assert.match(executantXml, /<ans:grauPart>11<\/ans:grauPart>/);
assert.match(executantXml, /<ans:codigoPrestadorNaOperadora>5872211<\/ans:codigoPrestadorNaOperadora>/);
assert.match(executantXml, /<ans:nomeProf>PROFISSIONAL EXECUTANTE TESTE<\/ans:nomeProf>/);
assert.match(executantXml, /<ans:conselho>09<\/ans:conselho>/);
assert.match(executantXml, /<ans:numeroConselhoProfissional>123009<\/ans:numeroConselhoProfissional>/);
assert.match(executantXml, /<ans:UF>35<\/ans:UF>/);
assert.match(executantXml, /<ans:CBOS>251510<\/ans:CBOS>/);

assert.match(epilogueHash, /^[a-f0-9]{32}$/);
assert.equal(calculateTissEpilogueHash(xml), epilogueHash);
assert.match(xml, new RegExp(`<ans:hash>${epilogueHash}<\\/ans:hash>`));

const missingProviderGuide = clone(snapshot);
delete missingProviderGuide.authorization.providerGuideNumber;
assertBlockingCode(communication040300Strategy.generate({ ...input, preGuides: [preGuideRow(missingProviderGuide)] }), 'TISS_OFFICIAL_PROVIDER_GUIDE_NUMBER_MISSING');

const overlongProviderGuide = clone(snapshot);
overlongProviderGuide.authorization.providerGuideNumber = `${PROVIDER_GUIDE_NUMBER}9`;
assertBlockingCode(communication040300Strategy.generate({ ...input, preGuides: [preGuideRow(overlongProviderGuide)] }), 'TISS_OFFICIAL_PROVIDER_GUIDE_NUMBER_TOO_LONG');

const missingRequester = clone(snapshot);
delete missingRequester.requester;
assertBlockingCode(communication040300Strategy.generate({ ...input, preGuides: [preGuideRow(missingRequester)] }), 'TISS_OFFICIAL_REQUESTER_NAME_MISSING');

const missingExecutantIdentifier = clone(snapshot);
delete missingExecutantIdentifier.professional.operatorProviderCode;
delete missingExecutantIdentifier.professional.documentNumber;
assertBlockingCode(communication040300Strategy.generate({ ...input, preGuides: [preGuideRow(missingExecutantIdentifier)] }), 'TISS_OFFICIAL_EXECUTANT_IDENTIFIER_MISSING');

const withoutParticipationInput = buildVivestValidationInput();
delete withoutParticipationInput.authorization.sync_metadata.tissGuide.executantParticipationDegree;
const withoutParticipationValidation = validateTissPreGuide(withoutParticipationInput);
assert.equal(withoutParticipationValidation.snapshot.professional.participationDegree, null);
const withoutParticipationDocument = await generateAndValidateOfficialTissDocument({
  ...input,
  preGuides: [preGuideRow(withoutParticipationValidation.snapshot)],
});
assert.equal(withoutParticipationDocument.ok, true);
if (withoutParticipationDocument.ok) {
  assert.doesNotMatch(withoutParticipationDocument.generated.xml, /<ans:grauPart>/);
}

console.log('tissOfficialXml: ok');
