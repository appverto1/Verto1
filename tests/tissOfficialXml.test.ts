import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildOfficialTissIdempotencyKey,
  deriveOfficialTissBatchNumber,
  generateAndValidateOfficialTissDocument
} from "../src/services/tissOfficial/officialTissDocumentService";
import { getDefaultTissOfficialStrategyDescriptor } from "../src/services/tissOfficial/capabilities";
import { communication040300Strategy } from "../src/services/tissOfficial/versions/communication040300/generator";
import { validateOfficialTissXml040300 } from "../src/services/tissOfficial/versions/communication040300/validator";
import { calculateTissEpilogueHash, sha256Hex } from "../src/services/tissOfficial/security";
import { transitionTissRevenueCycleState } from "../src/services/tissRevenueCycleStateMachine";

const root = process.cwd();
const serverCode = readFileSync(join(root, "server.ts"), "utf8");
const dataServiceCode = readFileSync(join(root, "src/services/dataService.ts"), "utf8");
const uiCode = readFileSync(join(root, "src/components/TissPreGuideTab.tsx"), "utf8");
const migrationCode = readFileSync(join(root, "supabase/migrations/20260618120000_tiss_official_documents.sql"), "utf8");
const authorizationTussSyncMigrationCode = readFileSync(join(root, "supabase/migrations/20260618143000_authorization_tuss_mapping_sync.sql"), "utf8");
const persistenceHardeningMigrationCode = readFileSync(join(root, "supabase/migrations/20260626123000_tiss_official_persistence_hardening.sql"), "utf8");
const pgcryptoDigestHotfixMigrationCode = readFileSync(join(root, "supabase/migrations/20260628123000_tiss_official_pgcrypto_extensions_digest.sql"), "utf8");
const officialTrackingMigrationCode = readFileSync(join(root, "supabase/migrations/20260630120000_tiss_official_tracking.sql"), "utf8");
const draftGeneratorCode = readFileSync(join(root, "src/services/tissXmlDraftGenerator.ts"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PAYER_ID = "22222222-2222-4222-8222-222222222222";
const PRE_GUIDE_ID = "33333333-3333-4333-8333-333333333333";
const APPOINTMENT_ID = "44444444-4444-4444-8444-444444444444";
const PATIENT_ID = "55555555-5555-4555-8555-555555555555";
const GENERATED_AT = "2026-06-18T14:30:00.000Z";

function validPreGuide(overrides: Record<string, any> = {}) {
  const row = {
    id: PRE_GUIDE_ID,
    organization_id: ORGANIZATION_ID,
    clinic_id: ORGANIZATION_ID,
    payer_id: PAYER_ID,
    appointment_id: APPOINTMENT_ID,
    patient_id: PATIENT_ID,
    status: "valid",
    validation_error_codes: [],
    validation_errors: [],
    scheduled_start: "2026-06-10T13:00:00.000Z",
    scheduled_end: "2026-06-10T13:50:00.000Z",
    guide_number: "GUIA-2026-001",
    authorization_code: "AUT-123",
    authorization_valid_until: "2026-06-30",
    tuss_code: "50000000",
    tuss_description: "Sessão de psicoterapia individual",
    quantity: 1,
    unit_amount_cents: 19700,
    total_amount_cents: 19700,
    updated_at: "2026-06-18T13:00:00.000Z",
    snapshot_data: {
      appointment: {
        id: APPOINTMENT_ID,
        scheduledStart: "2026-06-10T13:00:00.000Z",
        scheduledEnd: "2026-06-10T13:50:00.000Z"
      },
      beneficiary: {
        id: PATIENT_ID,
        cardNumber: "AMIL123456789"
      },
      payer: {
        id: PAYER_ID,
        ansRegistration: "326305",
        contractedProviderCode: "PRESTADOR123",
        defaultAttendanceType: "03",
        defaultAttendanceRegime: "01",
        defaultAttendanceCharacter: "1"
      },
      provider: {
        legalName: "Clínica Verto & Saúde Ltda.",
        tradeName: "Verto Saúde",
        documentType: "CNPJ",
        documentNumber: "12345678000195",
        cnesCode: "1234567",
        providerCode: "PRESTADOR123"
      },
      professional: {
        name: "Ana Maria",
        council: "CRP",
        councilNumber: "12345",
        councilState: "SP",
        cboCode: "251510"
      },
      procedure: {
        tussCode: "50000000",
        tussDescription: "Sessão de psicoterapia individual",
        quantity: 1,
        unitAmountCents: 19700,
        totalAmountCents: 19700
      },
      authorization: {
        guideNumber: "GUIA-2026-001",
        authorizationCode: "AUT-123",
        authorizationValidFrom: "2026-06-01",
        authorizationValidUntil: "2026-06-30"
      }
    }
  };
  return {
    ...row,
    ...overrides,
    snapshot_data: overrides.snapshot_data
      ? { ...row.snapshot_data, ...overrides.snapshot_data }
      : row.snapshot_data
  };
}

function validInput(preGuides = [validPreGuide()]) {
  return {
    preGuides,
    payerId: PAYER_ID,
    competenceMonth: "2026-06",
    batchNumber: "000000123456",
    generatedAt: GENERATED_AT,
    communicationVersion: "04.03.00",
    contentStructureVersion: "202511",
    tussVersion: "202605"
  };
}

type Test = { name: string; fn: () => void | Promise<void> };
const tests: Test[] = [];
const test = (name: string, fn: Test["fn"]) => tests.push({ name, fn });

test("versao do XML oficial vem da estrategia 04.03.00, nao do cadastro editavel do pagador", () => {
  const descriptor = getDefaultTissOfficialStrategyDescriptor();
  assert.equal(descriptor.strategyKey, "communication040300");
  assert.equal(descriptor.communicationVersion, "04.03.00");
  assert.equal(descriptor.communicationVersion, communication040300Strategy.communicationVersion);

  assert.match(uiCode, /getDefaultTissOfficialStrategyDescriptor/);
  assert.match(uiCode, /OFFICIAL_TISS_XML_STRATEGY\.communicationVersion/);
  assert.match(uiCode, /Versão do XML TISS/);
  assert.doesNotMatch(uiCode, /selectedOfficialRows\[0\]\?\.snapshot\?\.payer\?\.tissVersion/);
  assert.doesNotMatch(uiCode, /selectedOfficialRows\[0\]\?\.tissVersion \|\| "04\.03\.00"/);

  assert.match(serverCode, /getDefaultTissOfficialStrategyDescriptor/);
  assert.match(serverCode, /communicationVersion:\s*officialTissStrategy\.communicationVersion/);
  assert.match(serverCode, /contentStructureVersion:\s*officialTissStrategy\.contentStructureVersion/);
  assert.match(serverCode, /tussVersion:\s*officialTissStrategy\.tussVersion/);
});

test("gera XML oficial SP/SADT 04.03.00 com raiz, namespace e sequência do XSD", async () => {
  const result = await generateAndValidateOfficialTissDocument(validInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const xml = result.generated.xml;
  assert.match(xml, /<ans:mensagemTISS xmlns:ans="http:\/\/www\.ans\.gov\.br\/padroes\/tiss\/schemas"/);
  assert.match(xml, /<ans:tipoTransacao>ENVIO_LOTE_GUIAS<\/ans:tipoTransacao>/);
  assert.match(xml, /<ans:Padrao>4\.03\.00<\/ans:Padrao>/);
  assert.match(xml, /<ans:loteGuias>[\s\S]*<ans:guiasTISS>[\s\S]*<ans:guiaSP-SADT>/);
  assert.ok(xml.indexOf("<ans:cabecalho>") < xml.indexOf("<ans:prestadorParaOperadora>"));
  assert.ok(xml.indexOf("<ans:prestadorParaOperadora>") < xml.indexOf("<ans:epilogo>"));
  assert.equal(result.xsdValidation.status, "valid");
});

test("serializa datas, horas, quantidades, valores e caracteres XML corretamente", () => {
  const result = communication040300Strategy.generate(validInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.xml, /<ans:dataExecucao>2026-06-10<\/ans:dataExecucao>/);
  assert.match(result.xml, /<ans:horaInicial>10:00:00<\/ans:horaInicial>/);
  assert.match(result.xml, /<ans:quantidadeExecutada>1<\/ans:quantidadeExecutada>/);
  assert.match(result.xml, /<ans:valorUnitario>197\.00<\/ans:valorUnitario>/);
  assert.match(result.xml, /<ans:valorTotalGeral>197\.00<\/ans:valorTotalGeral>/);
  assert.match(result.xml, /Clínica Verto &amp; Saúde Ltda\./);
  assert.equal(result.totalAmountCents, 19700);
});

test("converte UTC uma unica vez para o timezone da clinica e preserva horario local sem offset", () => {
  const utc = communication040300Strategy.generate({
    ...validInput(),
    timeZone: "America/Sao_Paulo",
  });
  assert.equal(utc.ok, true);
  if (utc.ok) {
    assert.match(utc.xml, /<ans:horaInicial>10:00:00<\/ans:horaInicial>/);
    assert.match(utc.xml, /<ans:horaFinal>10:50:00<\/ans:horaFinal>/);
    assert.match(utc.xml, /<ans:horaRegistroTransacao>11:30:00<\/ans:horaRegistroTransacao>/);
  }

  const local = validPreGuide({
    scheduled_start: "2026-06-10T09:00:00",
    scheduled_end: "2026-06-10T09:50:00",
    snapshot_data: {
      ...validPreGuide().snapshot_data,
      appointment: {
        id: APPOINTMENT_ID,
        scheduledStart: "2026-06-10T09:00:00",
        scheduledEnd: "2026-06-10T09:50:00",
      },
    },
  });
  const localResult = communication040300Strategy.generate({
    ...validInput([local]),
    timeZone: "America/Sao_Paulo",
  });
  assert.equal(localResult.ok, true);
  if (localResult.ok) assert.match(localResult.xml, /<ans:horaInicial>09:00:00<\/ans:horaInicial>/);
});

test("codigo de prestador acima do limite bloqueia sem truncar e nome vem da identidade contratual", () => {
  const invalidProviderCode = "TESTE-VERTO-001";
  const invalid = validPreGuide({
    snapshot_data: {
      ...validPreGuide().snapshot_data,
      payer: {
        ...validPreGuide().snapshot_data.payer,
        contractedProviderCode: invalidProviderCode,
        contractedExecutant: "Clinica Verto - Ambiente de Teste",
      },
    },
  });
  const invalidResult = communication040300Strategy.generate(validInput([invalid]));
  assert.equal(invalidResult.ok, false);
  if (!invalidResult.ok) {
    assert.ok(invalidResult.issues.some((issue) => issue.code === "TISS_OFFICIAL_PROVIDER_CODE_TOO_LONG"));
    assert.ok(!invalidResult.issues.some((issue) => issue.message.includes("TESTE-VERTO-00")));
  }

  const contracted = validPreGuide({
    snapshot_data: {
      ...validPreGuide().snapshot_data,
      payer: {
        ...validPreGuide().snapshot_data.payer,
        contractedExecutant: "Clinica Verto - Ambiente de Teste",
      },
      provider: {
        ...validPreGuide().snapshot_data.provider,
        legalName: "Neurolab",
      },
    },
  });
  const contractedResult = communication040300Strategy.generate(validInput([contracted]));
  assert.equal(contractedResult.ok, true);
  if (contractedResult.ok) {
    assert.match(contractedResult.xml, /<ans:nomeContratadoSolicitante>Clinica Verto - Ambiente de Teste<\/ans:nomeContratadoSolicitante>/);
    assert.doesNotMatch(contractedResult.xml, /<ans:nomeContratadoSolicitante>Neurolab<\/ans:nomeContratadoSolicitante>/);
  }
});

test("calcula hash TISS MD5 dos valores e SHA-256 determinístico do XML exato", () => {
  const first = communication040300Strategy.generate(validInput());
  const second = communication040300Strategy.generate(validInput());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.xml, second.xml);
  assert.equal(first.epilogueHash, calculateTissEpilogueHash(first.xml));
  assert.match(first.epilogueHash, /^[a-f0-9]{32}$/);
  assert.equal(first.xmlHash, sha256Hex(first.xml));
  assert.equal(first.xmlHash, second.xmlHash);
});

test("soma centavos inteiros sem cálculo financeiro em ponto flutuante", () => {
  const second = validPreGuide({
    id: "66666666-6666-4666-8666-666666666666",
    appointment_id: "77777777-7777-4777-8777-777777777777",
    guide_number: "GUIA-2026-002",
    unit_amount_cents: 101,
    total_amount_cents: 101,
    snapshot_data: {
      ...validPreGuide().snapshot_data,
      appointment: {
        id: "77777777-7777-4777-8777-777777777777",
        scheduledStart: "2026-06-11T13:00:00.000Z",
        scheduledEnd: "2026-06-11T13:50:00.000Z"
      },
      procedure: {
        ...validPreGuide().snapshot_data.procedure,
        unitAmountCents: 101,
        totalAmountCents: 101
      },
      authorization: {
        ...validPreGuide().snapshot_data.authorization,
        guideNumber: "GUIA-2026-002"
      }
    }
  });
  const result = communication040300Strategy.generate(validInput([validPreGuide(), second]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.totalAmountCents, 19801);
  assert.equal(result.payload.totalAmountCents, 19801);
  assert.match(result.xml, /<ans:valorTotalGeral>1\.01<\/ans:valorTotalGeral>/);
});

test("três Pré-guias geram um único lote com três guias SP/SADT sem consolidar sessões", () => {
  const first = validPreGuide({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    appointment_id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
    patient_id: "aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa",
    guide_number: "GUIA-2026-003",
    scheduled_start: "2026-06-12T15:00:00.000Z",
    scheduled_end: "2026-06-12T15:50:00.000Z",
    unit_amount_cents: 30000,
    total_amount_cents: 30000,
    snapshot_data: {
      ...validPreGuide().snapshot_data,
      appointment: {
        id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
        scheduledStart: "2026-06-12T15:00:00.000Z",
        scheduledEnd: "2026-06-12T15:50:00.000Z"
      },
      beneficiary: {
        ...validPreGuide().snapshot_data.beneficiary,
        id: "aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Carlos"
      },
      procedure: {
        ...validPreGuide().snapshot_data.procedure,
        unitAmountCents: 30000,
        totalAmountCents: 30000
      },
      authorization: {
        ...validPreGuide().snapshot_data.authorization,
        guideNumber: "GUIA-2026-003"
      }
    }
  });
  const second = validPreGuide({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    appointment_id: "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb",
    patient_id: "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb",
    guide_number: "GUIA-2026-001",
    scheduled_start: "2026-06-10T09:00:00.000Z",
    scheduled_end: "2026-06-10T09:50:00.000Z",
    unit_amount_cents: 19700,
    total_amount_cents: 19700,
    snapshot_data: {
      ...validPreGuide().snapshot_data,
      appointment: {
        id: "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb",
        scheduledStart: "2026-06-10T09:00:00.000Z",
        scheduledEnd: "2026-06-10T09:50:00.000Z"
      },
      beneficiary: {
        ...validPreGuide().snapshot_data.beneficiary,
        id: "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Ana"
      },
      authorization: {
        ...validPreGuide().snapshot_data.authorization,
        guideNumber: "GUIA-2026-001"
      }
    }
  });
  const third = validPreGuide({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    appointment_id: "cccccccc-1111-4ccc-8ccc-cccccccccccc",
    patient_id: "cccccccc-2222-4ccc-8ccc-cccccccccccc",
    guide_number: "GUIA-2026-002",
    scheduled_start: "2026-06-11T13:00:00.000Z",
    scheduled_end: "2026-06-11T13:50:00.000Z",
    unit_amount_cents: 101,
    total_amount_cents: 101,
    snapshot_data: {
      ...validPreGuide().snapshot_data,
      appointment: {
        id: "cccccccc-1111-4ccc-8ccc-cccccccccccc",
        scheduledStart: "2026-06-11T13:00:00.000Z",
        scheduledEnd: "2026-06-11T13:50:00.000Z"
      },
      beneficiary: {
        ...validPreGuide().snapshot_data.beneficiary,
        id: "cccccccc-2222-4ccc-8ccc-cccccccccccc",
        name: "Bruno"
      },
      procedure: {
        ...validPreGuide().snapshot_data.procedure,
        unitAmountCents: 101,
        totalAmountCents: 101
      },
      authorization: {
        ...validPreGuide().snapshot_data.authorization,
        guideNumber: "GUIA-2026-002"
      }
    }
  });

  const result = communication040300Strategy.generate(validInput([first, third, second]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.xml.match(/<ans:loteGuias>/g) || []).length, 1);
  assert.equal((result.xml.match(/<ans:guiaSP-SADT>/g) || []).length, 3);
  assert.equal(result.guideCount, 3);
  assert.equal(result.totalAmountCents, 49801);
  assert.match(result.xml, /<ans:valorTotalGeral>197\.00<\/ans:valorTotalGeral>/);
  assert.match(result.xml, /<ans:valorTotalGeral>1\.01<\/ans:valorTotalGeral>/);
  assert.match(result.xml, /<ans:valorTotalGeral>300\.00<\/ans:valorTotalGeral>/);
  assert.ok(result.xml.indexOf("GUIA-2026-001") < result.xml.indexOf("GUIA-2026-002"));
  assert.ok(result.xml.indexOf("GUIA-2026-002") < result.xml.indexOf("GUIA-2026-003"));
});

test("usa somente whitelist administrativa e não inclui prontuário, evolução ou ABA detalhada", () => {
  const row = validPreGuide({
    snapshot_data: {
      ...validPreGuide().snapshot_data,
      clinicalNotes: "CONTEUDO_CLINICO_PROIBIDO",
      evolution: "EVOLUCAO_SUBJETIVA_PROIBIDA",
      abaData: { prompt: "DADO_ABA_PROIBIDO" }
    }
  });
  const result = communication040300Strategy.generate(validInput([row]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.doesNotMatch(result.xml, /CONTEUDO_CLINICO_PROIBIDO|EVOLUCAO_SUBJETIVA_PROIBIDA|DADO_ABA_PROIBIDO/);
  assert.equal(result.validationSummary.clinicalDataExcluded, true);
});

test("bloqueia Pré-guia inválida, TUSS ausente, placeholder e campos obrigatórios ausentes", () => {
  for (const row of [
    validPreGuide({ status: "pending_data" }),
    validPreGuide({ tuss_code: "", snapshot_data: { ...validPreGuide().snapshot_data, procedure: { ...validPreGuide().snapshot_data.procedure, tussCode: "" } } }),
    validPreGuide({ tuss_code: "TESTE-ABA", snapshot_data: { ...validPreGuide().snapshot_data, procedure: { ...validPreGuide().snapshot_data.procedure, tussCode: "TESTE-ABA" } } }),
    validPreGuide({ snapshot_data: { ...validPreGuide().snapshot_data, payer: { ...validPreGuide().snapshot_data.payer, defaultAttendanceType: "" } } })
  ]) {
    const result = communication040300Strategy.generate(validInput([row]));
    assert.equal(result.ok, false);
  }
});

test("bloqueia múltiplos pagadores e competência divergente", () => {
  const otherPayer = validPreGuide({
    id: "88888888-8888-4888-8888-888888888888",
    payer_id: "99999999-9999-4999-8999-999999999999"
  });
  const payerResult = communication040300Strategy.generate(validInput([validPreGuide(), otherPayer]));
  assert.equal(payerResult.ok, false);
  if (!payerResult.ok) assert.ok(payerResult.issues.some((issue) => issue.code === "TISS_OFFICIAL_PAYER_MISMATCH"));

  const competenceResult = communication040300Strategy.generate(validInput([
    validPreGuide({ scheduled_start: "2026-07-01T13:00:00.000Z" })
  ]));
  assert.equal(competenceResult.ok, false);
  if (!competenceResult.ok) assert.ok(competenceResult.issues.some((issue) => issue.code === "TISS_OFFICIAL_COMPETENCE_MISMATCH"));
});

test("bloqueia Pré-guias de clínicas diferentes", () => {
  const otherClinic = validPreGuide({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    clinic_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  });
  const result = communication040300Strategy.generate(validInput([validPreGuide(), otherClinic]));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "TISS_OFFICIAL_MULTIPLE_CLINICS"));
});

test("XML gerado passa no XSD oficial e falhas estruturais são rejeitadas", async () => {
  const generated = communication040300Strategy.generate(validInput());
  assert.equal(generated.ok, true);
  if (!generated.ok) return;

  const valid = await validateOfficialTissXml040300(generated.xml);
  assert.equal(valid.status, "valid");

  const missingRequired = await validateOfficialTissXml040300(
    generated.xml.replace(/<ans:numeroCarteira>[\s\S]*?<\/ans:numeroCarteira>\n/, "")
  );
  assert.equal(missingRequired.status, "invalid");

  const wrongOrder = await validateOfficialTissXml040300(
    generated.xml.replace(
      /(\s*<ans:tipoAtendimento>03<\/ans:tipoAtendimento>\s*)(<ans:indicacaoAcidente>9<\/ans:indicacaoAcidente>)/,
      "$2$1"
    )
  );
  assert.equal(wrongOrder.status, "invalid");

  const wrongNamespace = await validateOfficialTissXml040300(
    generated.xml.replace("http://www.ans.gov.br/padroes/tiss/schemas", "https://example.invalid/tiss")
  );
  assert.equal(wrongNamespace.status, "invalid");
});

test("rejeita DTD, entidade externa e não realiza resolução de rede", async () => {
  const generated = communication040300Strategy.generate(validInput());
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const malicious = generated.xml.replace(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "https://example.invalid/secret">]>'
  );
  const result = await validateOfficialTissXml040300(malicious);
  assert.equal(result.status, "invalid");
  assert.ok(result.errors.some((issue) => issue.code === "XML_DTD_OR_ENTITY_BLOCKED"));
  assert.match(readFileSync(join(root, "src/services/tissOfficial/versions/communication040300/validator.ts"), "utf8"), /XML_PARSE_NONET/);
});

test("idempotency key e lote são determinísticos por snapshots e seleção ordenada", () => {
  const firstInput = validInput([validPreGuide()]);
  const secondInput = validInput([validPreGuide()]);
  const firstKey = buildOfficialTissIdempotencyKey(firstInput);
  const secondKey = buildOfficialTissIdempotencyKey(secondInput);
  assert.equal(firstKey, secondKey);
  assert.match(firstKey, /^[a-f0-9]{64}$/);
  assert.equal(deriveOfficialTissBatchNumber(firstKey), deriveOfficialTissBatchNumber(secondKey));
  assert.match(deriveOfficialTissBatchNumber(firstKey), /^\d{12}$/);
});

test("state machine permite apenas a transição pré-envio para XML oficial validado", () => {
  const allowed = transitionTissRevenueCycleState({
    previousState: "ready_for_billing",
    newState: "official_xml_validated",
    eventType: "TISS_OFFICIAL_XML_XSD_VALIDATED"
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.newState, "official_xml_validated");

  const future = transitionTissRevenueCycleState({
    previousState: "official_xml_validated",
    newState: "sent"
  });
  assert.equal(future.ok, false);
  assert.equal(future.errorCode, "TISS_REVENUE_STATE_RESERVED_FOR_FUTURE");
});

test("migration cria persistência imutável, RLS, índices e RPC transacional", () => {
  assert.match(migrationCode, /create table if not exists public\.tiss_official_documents/i);
  assert.match(migrationCode, /create schema if not exists extensions/i);
  assert.match(migrationCode, /create extension if not exists pgcrypto with schema extensions/i);
  assert.match(migrationCode, /enable row level security/i);
  assert.match(migrationCode, /for select to authenticated/i);
  assert.match(migrationCode, /revoke all on table public\.tiss_official_documents from anon/i);
  assert.match(migrationCode, /revoke insert, update, delete on table public\.tiss_official_documents from authenticated/i);
  assert.match(migrationCode, /create unique index if not exists idx_tiss_official_documents_idempotency/i);
  assert.match(migrationCode, /using gin \(generated_from_pre_guide_ids\)/i);
  assert.match(migrationCode, /for update/i);
  assert.match(migrationCode, /Validated TISS official documents are immutable/i);
  assert.match(migrationCode, /new\.xml_content is distinct from old\.xml_content/i);
  assert.match(migrationCode, /new\.total_amount_cents is distinct from old\.total_amount_cents/i);
  assert.match(migrationCode, /create or replace function public\.create_tiss_official_document/i);
  assert.match(migrationCode, /security definer[\s\S]*set search_path = public/i);
  assert.match(migrationCode, /encode\(extensions\.digest\(p_xml_content::text, 'sha256'::text\), 'hex'\)/);
  assert.match(migrationCode, /TISS_OFFICIAL_XML_GENERATED/);
  assert.match(migrationCode, /TISS_OFFICIAL_XML_XSD_VALIDATED/);
  assert.match(migrationCode, /tiss_revenue_cycle_events_type_check check \([\s\S]*?\)\s+not valid;/i);
  assert.match(migrationCode, /tiss_revenue_cycle_events_state_check check \([\s\S]*?\)\s+not valid;/i);
  assert.match(migrationCode, /p_pre_guide_versions \? selected\.id::text/);
  assert.match(migrationCode, /selected\.updated_at is distinct from \(p_pre_guide_versions ->> selected\.id::text\)::timestamptz/);
  assert.match(migrationCode, /select[\s\S]*d\.id,[\s\S]*idempotency_key = p_idempotency_key[\s\S]*for update[\s\S]*select[\s\S]*d\.id,[\s\S]*idempotency_key = p_idempotency_key/i);
  assert.doesNotMatch(migrationCode, /select\s+\*/i);
  assert.doesNotMatch(migrationCode, /(^|[^.\w])digest\s*\(/i);
  assert.match(persistenceHardeningMigrationCode, /create schema if not exists extensions/i);
  assert.match(persistenceHardeningMigrationCode, /create extension if not exists pgcrypto with schema extensions/i);
  assert.match(persistenceHardeningMigrationCode, /create or replace function public\.create_tiss_official_document/i);
  assert.match(persistenceHardeningMigrationCode, /drop function if exists public\.create_tiss_official_document/);
  assert.match(persistenceHardeningMigrationCode, /p_organization_id uuid/);
  assert.match(persistenceHardeningMigrationCode, /p_organization_id is null or p_organization_id <> v_clinic_id/);
  assert.match(persistenceHardeningMigrationCode, /TISS_OFFICIAL_PRE_GUIDE_LINK_SCHEMA_MISSING/);
  assert.match(persistenceHardeningMigrationCode, /TISS_OFFICIAL_AUDIT_SCHEMA_MISSING/);
  assert.match(persistenceHardeningMigrationCode, /TISS_OFFICIAL_IDEMPOTENCY_CONFLICT/);
  assert.match(persistenceHardeningMigrationCode, /v_existing\.generated_from_pre_guide_ids @> p_generated_from_pre_guide_ids/);
  assert.match(persistenceHardeningMigrationCode, /v_link_update_sql := 'update public\.appointment_tiss_pre_guides pg set official_document_id = \$1'/);
  assert.match(persistenceHardeningMigrationCode, /execute v_link_update_sql using v_document\.id, v_clinic_id, p_generated_from_pre_guide_ids/);
  assert.match(persistenceHardeningMigrationCode, /execute v_link_update_sql using v_existing\.id, v_clinic_id, p_generated_from_pre_guide_ids/);
  assert.match(persistenceHardeningMigrationCode, /official_document_id uuid references public\.tiss_official_documents\(id\) on delete set null/);
  assert.match(persistenceHardeningMigrationCode, /TISS_OFFICIAL_XML_GENERATED/);
  assert.match(persistenceHardeningMigrationCode, /TISS_OFFICIAL_XML_XSD_VALIDATED/);
  assert.match(persistenceHardeningMigrationCode, /tiss_revenue_cycle_events_type_check check \([\s\S]*?\)\s+not valid;/i);
  assert.match(persistenceHardeningMigrationCode, /tiss_revenue_cycle_events_state_check check \([\s\S]*?\)\s+not valid;/i);
  assert.match(persistenceHardeningMigrationCode, /encode\(extensions\.digest\(p_xml_content::text, 'sha256'::text\), 'hex'\)/);
  assert.match(persistenceHardeningMigrationCode, /grant execute on function public\.create_tiss_official_document\([\s\S]*?\) to authenticated;/);
  assert.match(persistenceHardeningMigrationCode, /grant execute on function public\.create_tiss_official_document\([\s\S]*?\) to service_role;/);
  assert.match(persistenceHardeningMigrationCode, /notify pgrst, 'reload schema';/);
  assert.doesNotMatch(persistenceHardeningMigrationCode, /select\s+\*/i);
  assert.doesNotMatch(persistenceHardeningMigrationCode, /(^|[^.\w])digest\s*\(/i);
  assert.match(pgcryptoDigestHotfixMigrationCode, /create schema if not exists extensions/i);
  assert.match(pgcryptoDigestHotfixMigrationCode, /create extension if not exists pgcrypto with schema extensions/i);
  assert.match(pgcryptoDigestHotfixMigrationCode, /perform encode\(extensions\.digest\('teste'::text, 'sha256'::text\), 'hex'\)/);
  assert.match(pgcryptoDigestHotfixMigrationCode, /create or replace function public\.create_tiss_official_document/i);
  assert.match(pgcryptoDigestHotfixMigrationCode, /p_organization_id uuid/);
  assert.match(pgcryptoDigestHotfixMigrationCode, /p_generated_by uuid default null/);
  assert.match(pgcryptoDigestHotfixMigrationCode, /encode\(extensions\.digest\(p_xml_content::text, 'sha256'::text\), 'hex'\)/);
  assert.match(pgcryptoDigestHotfixMigrationCode, /grant execute on function public\.create_tiss_official_document\([\s\S]*?\) to authenticated;/);
  assert.match(pgcryptoDigestHotfixMigrationCode, /grant execute on function public\.create_tiss_official_document\([\s\S]*?\) to service_role;/);
  assert.match(pgcryptoDigestHotfixMigrationCode, /notify pgrst, 'reload schema';/);
  assert.doesNotMatch(pgcryptoDigestHotfixMigrationCode, /tiss_revenue_cycle_events_type_check/i);
  assert.doesNotMatch(pgcryptoDigestHotfixMigrationCode, /alter table public\.tiss_revenue_cycle_events/i);
  assert.doesNotMatch(pgcryptoDigestHotfixMigrationCode, /(^|[^.\w])digest\s*\(/i);
  assert.doesNotMatch(pgcryptoDigestHotfixMigrationCode, /select\s+\*/i);
  assert.match(authorizationTussSyncMigrationCode, /tiss_revenue_cycle_events_type_check check \([\s\S]*?\)\s+not valid;/i);
});

test("migration de acompanhamento de lotes XML oficiais e aditiva, auditavel e multi-tenant", () => {
  assert.match(officialTrackingMigrationCode, /create table if not exists public\.tiss_official_document_tracking/i);
  assert.match(officialTrackingMigrationCode, /create table if not exists public\.tiss_official_guide_tracking/i);
  assert.match(officialTrackingMigrationCode, /create table if not exists public\.tiss_official_tracking_events/i);
  assert.match(officialTrackingMigrationCode, /official_document_id uuid not null references public\.tiss_official_documents\(id\)/i);
  assert.match(officialTrackingMigrationCode, /pre_guide_id uuid references public\.appointment_tiss_pre_guides\(id\)/i);
  assert.match(officialTrackingMigrationCode, /organization_id uuid not null references public\.clinics\(id\)/i);
  assert.match(officialTrackingMigrationCode, /constraint tiss_official_document_tracking_status_check check/i);
  for (const status of [
    "generated",
    "sent_to_operator",
    "protocol_registered",
    "under_review",
    "paid",
    "partially_paid",
    "denied_or_rejected",
    "glossed",
    "appeal_prepared",
    "appeal_sent",
    "appeal_accepted",
    "appeal_rejected"
  ]) {
    assert.match(officialTrackingMigrationCode, new RegExp(`'${status}'`));
  }
  for (const eventType of [
    "official_xml_tracking_created",
    "official_xml_marked_sent",
    "official_xml_protocol_registered",
    "official_xml_return_registered",
    "official_xml_guide_paid",
    "official_xml_guide_glossed",
    "official_xml_appeal_sent"
  ]) {
    assert.match(officialTrackingMigrationCode, new RegExp(`'${eventType}'`));
  }
  assert.match(officialTrackingMigrationCode, /alter table public\.tiss_official_document_tracking enable row level security/i);
  assert.match(officialTrackingMigrationCode, /alter table public\.tiss_official_guide_tracking enable row level security/i);
  assert.match(officialTrackingMigrationCode, /alter table public\.tiss_official_tracking_events enable row level security/i);
  assert.match(officialTrackingMigrationCode, /role in \('owner', 'admin', 'coordinator'\)/i);
  assert.match(officialTrackingMigrationCode, /grant select, insert, update on table public\.tiss_official_document_tracking to authenticated/i);
  assert.match(officialTrackingMigrationCode, /grant select, insert, update on table public\.tiss_official_guide_tracking to authenticated/i);
  assert.match(officialTrackingMigrationCode, /grant select, insert on table public\.tiss_official_tracking_events to authenticated/i);
  assert.match(officialTrackingMigrationCode, /notify pgrst, 'reload schema';/i);
  assert.doesNotMatch(officialTrackingMigrationCode, /alter table public\.tiss_official_documents/i);
  assert.doesNotMatch(officialTrackingMigrationCode, /update public\.tiss_official_documents/i);
  assert.doesNotMatch(officialTrackingMigrationCode, /delete from public\.tiss_official_documents/i);
});

test("rotas oficiais são paralelas, paginadas, sem XML na listagem e download confere hash", () => {
  assert.match(serverCode, /app\.get\('\/api\/tiss\/official-documents'/);
  assert.match(serverCode, /app\.post\('\/api\/tiss\/official-documents'/);
  assert.match(serverCode, /app\.get\('\/api\/tiss\/official-documents\/:documentId'/);
  assert.match(serverCode, /app\.get\('\/api\/tiss\/official-documents\/:documentId\/download'/);
  const officialCreateRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/tiss/official-documents'"),
    serverCode.indexOf("app.get('/api/tiss/official-documents/:documentId/download'")
  );
  const listSelect = serverCode.match(/const TISS_OFFICIAL_DOCUMENT_SELECT = \[([\s\S]*?)\]\.join/)?.[1] || "";
  assert.doesNotMatch(listSelect, /xml_content/);
  assert.match(serverCode, /crypto\.createHash\('sha256'\)\.update\(xmlContent, 'utf8'\)\.digest\('hex'\)/);
  assert.match(serverCode, /calculatedHash !== sanitizeString\(data\.xml_hash/);
  assert.match(serverCode, /'official_document_id'/);
  assert.match(serverCode, /const loadTissPreGuidesSchemaSafe = async/);
  assert.match(serverCode, /const classifyTissOfficialPersistenceFailure = \(error: any, rpcPayload\?: Record<string, any> \| null\)/);
  assert.match(serverCode, /stage: 'insert_official_document'/);
  assert.match(serverCode, /stage = 'update_pre_guides'/);
  assert.match(serverCode, /stage = 'audit_event'/);
  assert.match(serverCode, /stage = 'hash_calculation'/);
  assert.match(serverCode, /postgresCode === '42883'/);
  assert.match(serverCode, /: 'RPC_SIGNATURE_MISMATCH'/);
  assert.match(serverCode, /RPC_INTERNAL_SQL_FUNCTION_MISSING/);
  assert.match(serverCode, /RPC_TYPE_MISMATCH/);
  assert.match(serverCode, /RPC_ENV_OR_SCHEMA_CACHE_MISMATCH/);
  assert.match(serverCode, /RPC_PERSISTENCE_UNKNOWN_42883/);
  assert.match(serverCode, /const extractSupabasePostgresDiagnostics = \(error: any\) =>/);
  assert.match(serverCode, /postgresMessage: sanitizePostgresDiagnosticText\(error\?\.message/);
  assert.match(serverCode, /postgresDetails: sanitizePostgresDiagnosticText\(error\?\.details/);
  assert.match(serverCode, /postgresHint: sanitizePostgresDiagnosticText\(error\?\.hint/);
  assert.match(serverCode, /const classifyPostgres42883TissOfficialReason = /);
  assert.match(serverCode, /messageBundle\.includes\('create_tiss_official_document'\)/);
  assert.match(serverCode, /messageBundle\.includes\('could not find the function'\)/);
  assert.match(serverCode, /messageBundle\.includes\('explicit type casts'\)/);
  assert.match(serverCode, /hasPerfectRpcPayload \? 'RPC_ENV_OR_SCHEMA_CACHE_MISMATCH' : 'RPC_SIGNATURE_MISMATCH'/);
  assert.match(serverCode, /\[TISS Official Persistence\] RPC failed/);
  assert.match(serverCode, /reasonCode = 'SCHEMA_COLUMN_MISSING'/);
  assert.match(serverCode, /reasonCode = 'UNIQUE_CONSTRAINT'/);
  assert.match(serverCode, /reasonCode = 'FOREIGN_KEY_FAILED'/);
  assert.match(serverCode, /reasonCode = 'NOT_NULL_VIOLATION'/);
  assert.match(serverCode, /APPOINTMENT_TISS_PRE_GUIDE_BASE_SELECT/);
  assert.match(serverCode, /isOptionalTissPreGuideColumn\(missingOptionalColumn\)/);
  assert.match(serverCode, /TISS_OFFICIAL_PRE_GUIDE_BASE_SCHEMA_MISSING/);
  assert.match(officialCreateRoute, /loadTissPreGuidesSchemaSafe\(\{ organizationId, preGuideIds \}\)/);
  assert.match(officialCreateRoute, /TISS_OFFICIAL_PRE_GUIDE_PAYER_MISMATCH/);
  const rpcPayloadHelper = serverCode.slice(
    serverCode.indexOf("const CREATE_TISS_OFFICIAL_DOCUMENT_RPC_KEYS = ["),
    serverCode.indexOf("const classifyTissOfficialPersistenceFailure =")
  );
  const rpcPayloadReturn = rpcPayloadHelper.slice(
    rpcPayloadHelper.indexOf("): CreateTissOfficialDocumentRpcPayload => ({"),
    rpcPayloadHelper.indexOf("  });", rpcPayloadHelper.indexOf("): CreateTissOfficialDocumentRpcPayload => ({"))
  );
  assert.match(serverCode, /const buildCreateTissOfficialDocumentRpcPayload = \(/);
  assert.match(serverCode, /const describeCreateTissOfficialDocumentRpcPayloadKeys = /);
  assert.match(serverCode, /rpcPayloadKeys/);
  assert.match(serverCode, /missingRpcKeys/);
  assert.match(serverCode, /unexpectedRpcKeys/);
  assert.match(serverCode, /organizationIdPresent/);
  assert.match(serverCode, /payerIdPresent/);
  assert.match(serverCode, /preGuideCount/);
  assert.match(serverCode, /replace\(\/<\\\?xml\[\\s\\S\]\*\/gi, '\[xml_redacted\]'\)/);
  assert.match(serverCode, /replace\(\/<ans:\[\\s\\S\]\*\/gi, '\[xml_redacted\]'\)/);
  assert.match(serverCode, /replace\(\/\\bBearer\\s\+\[A-Za-z0-9\._~\+\/-\]\+=\*\/gi, 'Bearer \[redacted\]'\)/);
  assert.match(serverCode, /replace\(\/\\bAuthorization\\s\*\[:=\]\\s\*\[\^,\\s;\]\+\/gi, 'Authorization=\[redacted\]'\)/);
  assert.match(serverCode, /replace\(\/\\bcookie\\s\*\[:=\]\\s\*\[\^,\\s;\]\+\/gi, 'cookie=\[redacted\]'\)/);
  assert.match(serverCode, /replace\(\/\\bservice_role\\b\/gi, '\[redacted_role\]'\)/);
  assert.match(serverCode, /JSON\.stringify\(payload\)/);
  const expectedRpcParams = [
    "p_organization_id",
    "p_payer_id",
    "p_competence_month",
    "p_guide_type",
    "p_document_type",
    "p_communication_version",
    "p_content_structure_version",
    "p_tuss_version",
    "p_schema_root_file",
    "p_schema_manifest_checksum",
    "p_batch_number",
    "p_xml_content",
    "p_xml_hash",
    "p_generated_from_pre_guide_ids",
    "p_idempotency_key",
    "p_validation_summary",
    "p_metadata",
    "p_guide_count",
    "p_total_amount_cents",
    "p_pre_guide_versions",
    "p_generated_by"
  ];
  const expectedRpcParamsSorted = [...expectedRpcParams].sort();
  const declaredRpcParams = Array.from(
    rpcPayloadHelper.matchAll(/'([^']+)'/g),
    (match) => match[1]
  ).filter((key) => key.startsWith("p_"));
  assert.deepEqual([...declaredRpcParams].sort(), expectedRpcParamsSorted);
  for (const rpcParam of expectedRpcParams) {
    assert.match(rpcPayloadReturn, new RegExp(`${rpcParam}:`));
  }
  for (const legacyParam of [
    "organization_id:",
    "payer_id:",
    "competence_month:",
    "communicationVersion:",
    "contentStructureVersion:",
    "tussVersion:",
    "xmlContent:",
    "generatedBy:"
  ]) {
    assert.doesNotMatch(rpcPayloadReturn, new RegExp(`\\n\\s+${legacyParam}`));
  }
  assert.match(officialCreateRoute, /const rpcPayload = buildCreateTissOfficialDocumentRpcPayload\(/);
  assert.match(officialCreateRoute, /supabase\.rpc\('create_tiss_official_document', rpcPayload\)/);
  assert.match(officialCreateRoute, /classifyTissOfficialPersistenceFailure\(rpcResult\.error, rpcPayload\)/);
  assert.match(officialCreateRoute, /diagnostics: persistenceFailure\.diagnostics/);
  assert.match(officialCreateRoute, /officialDocumentId: serializedDocument\.id/);
  assert.match(officialCreateRoute, /revenueCycleState: 'official_xml_validated'/);
  assert.match(officialCreateRoute, /xsdValidation: built\.xsdValidation/);
  assert.doesNotMatch(officialCreateRoute, /\.eq\('payer_id', payerId\)[\s\S]*?\.in\('id', preGuideIds\)/);
  assert.match(serverCode, /generatedByName/);
  assert.match(serverCode, /Content-Type', 'application\/xml; charset=utf-8'/);
  assert.match(serverCode, /create_tiss_official_document/);
  assert.match(serverCode, /preGuideIds\.length > 500/);
  assert.match(serverCode, /\.limit\(500\)/);
  assert.match(serverCode, /requestedCommunicationVersion/);
  assert.match(serverCode, /TISS_OFFICIAL_VERSION_NOT_SUPPORTED/);
  assert.match(serverCode, /TISS_OFFICIAL_PRE_GUIDES_BLOCKED/);
  assert.match(serverCode, /issueSummary/);
  assert.match(uiCode, /TISS_OFFICIAL_PRE_GUIDE_BASE_SCHEMA_MISSING/);
  assert.match(uiCode, /N\\u00e3o foi poss\\u00edvel carregar a estrutura das Pr\\u00e9-guias/);
  assert.match(uiCode, /result\?\.diagnostics\?\.stage/);
  assert.match(uiCode, /result\?\.diagnostics\?\.safeMessage/);
  assert.match(uiCode, /OFFICIAL_BATCH_GUIDE_LIMIT = 500/);
  assert.match(readFileSync(join(root, "src/services/tissOfficial/versions/communication040300/generator.ts"), "utf8"), /MAX_GUIDES_PER_BATCH = 500/);
  assert.doesNotMatch(serverCode, /app\.(?:post|put|patch)\('\/api\/tiss\/official-documents\/:documentId'\s*,/);
});

test("endpoints de acompanhamento operam em camada separada sem mutar XML oficial", () => {
  for (const route of [
    "app.get('/api/tiss/official-documents/tracking'",
    "app.get('/api/tiss/official-documents/:documentId/tracking'",
    "app.post('/api/tiss/official-documents/:documentId/tracking/sent'",
    "app.post('/api/tiss/official-documents/:documentId/tracking/return'",
    "app.post('/api/tiss/official-documents/:documentId/guides/:guideId/tracking'",
    "app.post('/api/tiss/official-documents/:documentId/guides/:guideId/appeal'"
  ]) {
    assert.match(serverCode, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(serverCode, /const ensureTissOfficialDocumentTracking = async/);
  assert.match(serverCode, /\.from\('tiss_official_document_tracking'\)/);
  assert.match(serverCode, /\.from\('tiss_official_guide_tracking'\)/);
  assert.match(serverCode, /\.from\('tiss_official_tracking_events'\)/);
  assert.match(serverCode, /recordTissOfficialTrackingEvent/);
  assert.match(serverCode, /calculateTissOfficialTrackingTotals/);
  assert.match(serverCode, /serializeTissOfficialTrackingBundle/);
  assert.match(serverCode, /official_xml_protocol_registered/);
  assert.match(serverCode, /official_xml_return_registered/);
  assert.match(serverCode, /official_xml_guide_glossed/);
  assert.match(serverCode, /official_xml_appeal_sent/);
  const trackingRegion = serverCode.slice(
    serverCode.indexOf("const ensureTissOfficialDocumentTracking = async"),
    serverCode.indexOf("app.get('/api/tiss/official-documents/:documentId/download'")
  );
  assert.match(trackingRegion, /\.eq\('organization_id', organizationId\)/);
  assert.match(trackingRegion, /\.eq\('official_document_id', documentId\)/);
  assert.match(trackingRegion, /paidAmount \+ glossedAmount > totalSentAmount/);
  assert.match(trackingRegion, /paidAmount \+ glossedAmount > sentAmount/);
  assert.doesNotMatch(trackingRegion, /xml_content\s*:/);
  assert.doesNotMatch(trackingRegion, /\.update\([\s\S]*?xml_content/);
  assert.doesNotMatch(trackingRegion, /\.from\('tiss_official_documents'\)(?:[^\n]*\n){0,4}\s*\.update\(/);
});

test("lote ainda não enviado mantém lote e guias em estado preparado", () => {
  assert.match(serverCode, /trackingStatus === 'generated' \? \{ \.\.\.guide, status: 'generated' \} : guide/);
  assert.match(uiCode, /generated: \{ label: "Preparada"/);
  assert.match(uiCode, /tracking\.sentAt \? "Valor enviado" : "Valor preparado"/);
  assert.match(uiCode, />Valor do lote<\/th>/);
  assert.doesNotMatch(uiCode, /const normalized = String\(status \|\| "sent"\)/);
});

test("data service e UI expõem documento oficial sem remover o fluxo de rascunho", () => {
  for (const helper of [
    "listTissOfficialDocuments",
    "createTissOfficialDocument",
    "getTissOfficialDocument",
    "downloadTissOfficialDocument",
    "getTissOfficialDocumentTracking",
    "markTissOfficialDocumentSent",
    "registerTissOfficialDocumentReturn",
    "updateTissOfficialGuideTracking",
    "updateTissOfficialGuideAppeal"
  ]) {
    assert.match(dataServiceCode, new RegExp(`async ${helper}`));
  }
  assert.match(uiCode, /Gerar lote XML para operadora/);
  assert.match(uiCode, /Confirmar geração do lote XML/);
  assert.match(uiCode, /Histórico de lotes XML oficiais/);
  assert.match(uiCode, /Ferramentas avançadas/);
  assert.match(uiCode, /Acompanhamento do lote/);
  assert.match(uiCode, /Guias do lote/);
  assert.match(uiCode, /Histórico de acompanhamento/);
  assert.match(uiCode, /Registrar envio/);
  assert.match(uiCode, /Registrar retorno/);
  assert.match(uiCode, /Registrar glosa\/pagamento/);
  assert.match(uiCode, /Preparar recurso/);
  assert.match(uiCode, /Valor pago/);
  assert.match(uiCode, /Valor glosado/);
  assert.match(uiCode, /Pendente/);
  assert.match(uiCode, /Selecionar todas as válidas/);
  assert.match(uiCode, /Visualizar guias incluídas/);
  assert.match(uiCode, /Lote XML validado/);
  assert.match(uiCode, /Validado no XSD/);
  assert.match(uiCode, /não será enviado automaticamente à operadora/i);
  assert.match(uiCode, /Gerar XML TISS em rascunho/);
  assert.doesNotMatch(uiCode, /Gerar XML oficial validado/);
  assert.match(draftGeneratorCode, /generateTissXmlDraft/);
  assert.match(serverCode, /app\.post\('\/api\/tiss\/xml-drafts'/);
});

test("manifests e checksums oficiais são versionados e a dependência WASM está fixa", () => {
  const manifest = JSON.parse(readFileSync(
    join(root, "src/services/tissOfficial/versions/communication040300/schemaManifest.json"),
    "utf8"
  ));
  assert.equal(manifest.communicationVersion, "04.03.00");
  assert.equal(manifest.contentStructureVersion, "202511");
  assert.equal(manifest.tussVersion, "202605");
  for (const file of manifest.files) {
    const bytes = readFileSync(join(root, "src/services/tissOfficial/versions/communication040300/schemas", file.file));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase(), file.sha256);
  }
  assert.equal(packageJson.dependencies["libxml2-wasm"], "0.7.1");
  assert.equal(packageJson.scripts["test:tiss-official-xml"], "tsx tests/tissOfficialXml.test.ts");
});

let passed = 0;
for (const item of tests) {
  try {
    await item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} official TISS XML tests passed`);
