import type {
  GeneratedOfficialTissDocument,
  OfficialTissCanonicalGuide,
  OfficialTissCanonicalPayload,
  OfficialTissDocumentInput,
  TissOfficialIssue,
  TissXmlGenerationStrategy
} from "../../types";
import {
  calculateTissEpilogueHash,
  canonicalJson,
  escapeXml,
  formatMoneyFromCents,
  monthKey,
  onlyDigits,
  sha256Hex,
  text
} from "../../security";
import {
  COMMUNICATION_040300_MANIFEST,
  COMMUNICATION_040300_MANIFEST_CHECKSUM
} from "./manifest";
import { validateOfficialTissXml040300 } from "./validator";
import {
  TISS_OFFICIAL_COMMUNICATION_VERSION,
  TISS_OFFICIAL_CONTENT_STRUCTURE_VERSION,
  TISS_OFFICIAL_TUSS_VERSION
} from "../../capabilities";
import {
  attendanceCharacters040300,
  attendanceRegimes040300,
  attendanceTypes040300
} from "./domains";
import { TISS_PROVIDER_CODE_MAX_LENGTH } from "../../../../utils/tissFieldValidation";

const ANS_NAMESPACE = "http://www.ans.gov.br/padroes/tiss/schemas";
const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
const DEFAULT_TISS_VERSION = TISS_OFFICIAL_COMMUNICATION_VERSION;
const DEFAULT_XML_PADRAO_VERSION = "4.03.00";
const DEFAULT_CONTENT_STRUCTURE_VERSION = TISS_OFFICIAL_CONTENT_STRUCTURE_VERSION;
const DEFAULT_TUSS_VERSION = TISS_OFFICIAL_TUSS_VERSION;
const MAX_GUIDES_PER_BATCH = 500;
const VALID_ATTENDANCE_TYPES = new Set(attendanceTypes040300.map((item) => item.code));
const VALID_ATTENDANCE_REGIMES = new Set(attendanceRegimes040300.map((item) => item.code));
const VALID_ATTENDANCE_CHARACTERS = new Set(attendanceCharacters040300.map((item) => item.code));
const VALID_CONSULTATION_TYPES = new Set(["1", "2", "3", "4"]);
const VALID_PARTICIPATION_DEGREES = new Set([
  "00", "01", "02", "03", "04", "05", "06",
  "07", "08", "09", "10", "11", "12", "13"
]);

const COUNCIL_CODES: Record<string, string> = {
  CRESS: "01",
  COREN: "02",
  CRF: "03",
  CRFA: "04",
  CRFa: "04",
  CREFONO: "04",
  CREFITO: "05",
  CRM: "06",
  CRN: "07",
  CRO: "08",
  CRP: "09",
  OUT: "10",
  OUTROS: "10",
  CRBIO: "11",
  CRBM: "12",
  CREF: "13",
  CRMV: "14",
  CRTR: "15"
};

const UF_CODES: Record<string, string> = {
  RO: "11",
  AC: "12",
  AM: "13",
  RR: "14",
  PA: "15",
  AP: "16",
  TO: "17",
  MA: "21",
  PI: "22",
  CE: "23",
  RN: "24",
  PB: "25",
  PE: "26",
  AL: "27",
  SE: "28",
  BA: "29",
  MG: "31",
  ES: "32",
  RJ: "33",
  SP: "35",
  PR: "41",
  SC: "42",
  RS: "43",
  MS: "50",
  MT: "51",
  GO: "52",
  DF: "53",
  EX: "98"
};

type RequiredIssueParams = {
  issues: TissOfficialIssue[];
  preGuideId?: string | null;
  entity: string;
  field: string;
  code: string;
  message: string;
};

type ProviderIdentifier = {
  tag: "codigoPrestadorNaOperadora" | "cpfContratado" | "cnpjContratado" | "CPF" | "CNPJ";
  value: string;
};

type NormalizedGuide = OfficialTissCanonicalGuide & {
  timeZone: string;
  payerAns: string;
  providerIdentifier: ProviderIdentifier;
  providerName: string;
  providerCnes: string;
  beneficiaryCard: string;
  beneficiaryName: string;
  requesterName: string;
  requesterCouncilCode: string;
  requesterCouncilNumber: string;
  requesterCouncilUf: string;
  requesterCboCode: string;
  professionalName: string;
  professionalIdentifier: ProviderIdentifier | null;
  professionalParticipationDegree?: string | null;
  councilCode: string;
  councilNumber: string;
  councilUf: string;
  cboCode: string;
  tussCode: string;
  tussDescription: string;
  quantity: number;
  unitAmountCents: number;
  authorizationCode?: string | null;
  authorizationDate?: string | null;
  authorizationValidFrom?: string | null;
  authorizationValidUntil?: string | null;
  requestDate?: string | null;
  attendanceType: string;
  attendanceRegime: string;
  attendanceCharacter: string;
  consultationType?: string | null;
  zeroAmountPolicyApplied: boolean;
  zeroAmountXmlReason?: string | null;
};

function addIssue(params: RequiredIssueParams) {
  params.issues.push({
    code: params.code,
    message: params.message,
    severity: "blocking",
    entity: params.entity,
    field: params.field,
    preGuideId: params.preGuideId || null
  });
}

function addWarning(params: RequiredIssueParams) {
  params.issues.push({
    code: params.code,
    message: params.message,
    severity: "warning",
    entity: params.entity,
    field: params.field,
    preGuideId: params.preGuideId || null
  });
}

const truthyValue = (value: unknown) => {
  if (value === true) return true;
  return ["1", "true", "yes", "sim"].includes(text(value, 20).toLowerCase());
};

function zeroAmountXmlPolicy(row: any) {
  const snapshot = row?.snapshot || row?.snapshot_data || {};
  const payer = snapshot.payer || {};
  const requirements = payer.requirements || snapshot.payerRequirements || snapshot.payer_requirements || {};
  const allowed = truthyValue(
    requirements.allowsZeroAmountXml ??
      requirements.allows_zero_amount_xml ??
      payer.allowsZeroAmountXml ??
      payer.allows_zero_amount_xml
  );
  const reason = text(
    requirements.zeroAmountXmlReason ??
      requirements.zero_amount_xml_reason ??
      payer.zeroAmountXmlReason ??
      payer.zero_amount_xml_reason,
    1200
  );
  return { allowed, reason };
}

function firstValue(...values: unknown[]) {
  for (const value of values) {
    const resolved = text(value, 500);
    if (resolved) return resolved;
  }
  return "";
}

function firstDigits(maxLength: number, ...values: unknown[]) {
  for (const value of values) {
    const resolved = onlyDigits(value, maxLength);
    if (resolved) return resolved;
  }
  return "";
}

function zonedDateTimeParts(value: unknown, timeZone: string) {
  const raw = text(value, 80);
  if (!/T/.test(raw) || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
    return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
  } catch {
    return null;
  }
}

function normalizeDate(value: unknown, timeZone = "America/Sao_Paulo") {
  const raw = text(value, 80);
  const zoned = zonedDateTimeParts(raw, timeZone);
  if (zoned) return `${zoned.year}-${zoned.month}-${zoned.day}`;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function normalizeTime(value: unknown, timeZone = "America/Sao_Paulo") {
  const raw = text(value, 80);
  const zoned = zonedDateTimeParts(raw, timeZone);
  if (zoned) return `${zoned.hour}:${zoned.minute}:${zoned.second}`;
  const direct = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (direct) return `${direct[1]}:${direct[2]}:${direct[3] || "00"}`;
  const iso = raw.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (iso) return `${iso[1]}:${iso[2]}:${iso[3] || "00"}`;
  return "";
}

function normalizeTissVersion(value: unknown) {
  const candidate = firstValue(value, DEFAULT_TISS_VERSION);
  return /^\d{1,2}\.\d{2}\.\d{2}$/.test(candidate) ? candidate : DEFAULT_TISS_VERSION;
}

function toSchemaPadraoVersion(value: unknown) {
  const version = normalizeTissVersion(value);
  const normalized = version.replace(/^0+(\d\.\d{2}\.\d{2})$/, "$1");
  return normalized || DEFAULT_XML_PADRAO_VERSION;
}

function normalizeCompetence(value: unknown) {
  const key = monthKey(value);
  return key ? `${key}-01` : "";
}

function normalizeLimitedText(value: unknown, maxLength: number) {
  return text(value, maxLength).replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeNumberText(value: unknown, maxLength: number) {
  return text(value, maxLength).replace(/[^A-Za-z0-9._/-]/g, "").slice(0, maxLength);
}

function normalizeCouncil(value: unknown) {
  const raw = text(value, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^\d{2}$/.test(raw)) return raw;
  return COUNCIL_CODES[raw] || "";
}

function normalizeUf(value: unknown) {
  const raw = text(value, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^\d{2}$/.test(raw)) return raw;
  return UF_CODES[raw] || "";
}

function normalizeCbo(value: unknown) {
  const code = onlyDigits(value, 6);
  return code.length === 6 ? code : "";
}

function isPlaceholder(value: unknown) {
  const normalized = text(value, 120)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return [
    "SEM-CNES",
    "SEM CNES",
    "NAO INFORMADO",
    "NÃO INFORMADO",
    "TESTE",
    "TESTE-ABA",
    "DEMO",
    "000000",
    "0000000",
    "00000000000",
    "00000000000000"
  ].includes(normalized);
}

function pickProviderIdentifier(snapshot: any, row: any): ProviderIdentifier | null {
  const payer = snapshot?.payer || {};
  const provider = snapshot?.provider || {};
  const contractedCode = normalizeNumberText(firstValue(
    payer.contractedProviderCode,
    payer.providerCode,
    payer.operatorProviderCode
  ), 200);
  if (contractedCode.length > 14) return null;
  if (contractedCode && !isPlaceholder(contractedCode)) {
    return { tag: "codigoPrestadorNaOperadora", value: contractedCode };
  }
  const documentType = text(provider.documentType || provider.document_type, 20).toUpperCase();
  const documentNumber = firstDigits(14, provider.documentNumber, provider.document_number, row?.provider_document_number);
  if (documentType === "CPF" && documentNumber.length === 11 && !isPlaceholder(documentNumber)) {
    return { tag: "cpfContratado", value: documentNumber };
  }
  if (documentNumber.length === 14 && !isPlaceholder(documentNumber)) {
    return { tag: "cnpjContratado", value: documentNumber };
  }
  if (documentNumber.length === 11 && !isPlaceholder(documentNumber)) {
    return { tag: "cpfContratado", value: documentNumber };
  }
  return null;
}

function pickProfessionalIdentifier(professional: any): ProviderIdentifier | null {
  const operatorCode = normalizeNumberText(firstValue(
    professional.operatorProviderCode,
    professional.operator_provider_code,
    professional.providerCode,
    professional.provider_code
  ), 14);
  if (operatorCode && !isPlaceholder(operatorCode)) {
    return { tag: "codigoPrestadorNaOperadora", value: operatorCode };
  }
  const documentType = text(professional.documentType || professional.document_type, 20).toUpperCase();
  const documentNumber = firstDigits(14, professional.documentNumber, professional.document_number);
  if (documentType === "CPF" && documentNumber.length === 11 && !isPlaceholder(documentNumber)) {
    return { tag: "cpfContratado", value: documentNumber };
  }
  return null;
}

function providerHeaderIdentifier(identifier: ProviderIdentifier): ProviderIdentifier {
  if (identifier.tag === "codigoPrestadorNaOperadora") {
    return { tag: "codigoPrestadorNaOperadora", value: identifier.value };
  }
  if (identifier.tag === "cpfContratado") {
    return { tag: "CPF", value: identifier.value };
  }
  if (identifier.tag === "cnpjContratado") {
    return { tag: "CNPJ", value: identifier.value };
  }
  return identifier;
}

function xmlElement(name: string, value: unknown, level = 0) {
  const indent = "  ".repeat(level);
  return `${indent}<ans:${name}>${escapeXml(value)}</ans:${name}>`;
}

function xmlProviderIdentifier(identifier: ProviderIdentifier, level: number) {
  return xmlElement(identifier.tag, identifier.value, level);
}

function xmlRequesterProfessional(guide: NormalizedGuide, level: number) {
  return [
    xmlElement("nomeProfissional", guide.requesterName, level),
    xmlElement("conselhoProfissional", guide.requesterCouncilCode, level),
    xmlElement("numeroConselhoProfissional", guide.requesterCouncilNumber, level),
    xmlElement("UF", guide.requesterCouncilUf, level),
    xmlElement("CBOS", guide.requesterCboCode, level)
  ].filter(Boolean).join("\n");
}

function xmlExecutantTeam(guide: NormalizedGuide, level: number) {
  if (!guide.professionalIdentifier) return "";
  return [
    `${"  ".repeat(level)}<ans:equipeSadt>`,
    guide.professionalParticipationDegree
      ? xmlElement("grauPart", guide.professionalParticipationDegree, level + 1)
      : "",
    `${"  ".repeat(level + 1)}<ans:codProfissional>`,
    xmlProviderIdentifier(guide.professionalIdentifier, level + 2),
    `${"  ".repeat(level + 1)}</ans:codProfissional>`,
    xmlElement("nomeProf", guide.professionalName, level + 1),
    xmlElement("conselho", guide.councilCode, level + 1),
    xmlElement("numeroConselhoProfissional", guide.councilNumber, level + 1),
    xmlElement("UF", guide.councilUf, level + 1),
    xmlElement("CBOS", guide.cboCode, level + 1),
    `${"  ".repeat(level)}</ans:equipeSadt>`
  ].filter(Boolean).join("\n");
}

function xmlProcedure(guide: NormalizedGuide, level: number) {
  return [
    xmlElement("codigoTabela", "22", level),
    xmlElement("codigoProcedimento", guide.tussCode, level),
    xmlElement("descricaoProcedimento", guide.tussDescription, level)
  ].join("\n");
}

function buildOfficialMessageXml(payload: OfficialTissCanonicalPayload, guides: NormalizedGuide[], epilogueHash: string) {
  const generatedDate = normalizeDate(payload.generatedAt, payload.timeZone);
  const generatedTime = normalizeTime(payload.generatedAt, payload.timeZone);
  const providerHeaderId = providerHeaderIdentifier(guides[0].providerIdentifier);
  const body = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    `<ans:mensagemTISS xmlns:ans="${ANS_NAMESPACE}" xmlns:ds="${XMLDSIG_NAMESPACE}">`,
    "  <ans:cabecalho>",
    "    <ans:identificacaoTransacao>",
    xmlElement("tipoTransacao", "ENVIO_LOTE_GUIAS", 3),
    xmlElement("sequencialTransacao", payload.batchNumber, 3),
    xmlElement("dataRegistroTransacao", generatedDate, 3),
    xmlElement("horaRegistroTransacao", generatedTime, 3),
    "    </ans:identificacaoTransacao>",
    "    <ans:origem>",
    "      <ans:identificacaoPrestador>",
    xmlProviderIdentifier(providerHeaderId, 4),
    "      </ans:identificacaoPrestador>",
    "    </ans:origem>",
    "    <ans:destino>",
    xmlElement("registroANS", guides[0].payerAns, 3),
    "    </ans:destino>",
    xmlElement("Padrao", toSchemaPadraoVersion(payload.communicationVersion), 2),
    "  </ans:cabecalho>",
    "  <ans:prestadorParaOperadora>",
    "    <ans:loteGuias>",
    xmlElement("numeroLote", payload.batchNumber, 3),
    "      <ans:guiasTISS>",
    ...guides.map((guide) => buildSpSadtGuideXml(guide, 1)),
    "      </ans:guiasTISS>",
    "    </ans:loteGuias>",
    "  </ans:prestadorParaOperadora>",
    "  <ans:epilogo>",
    xmlElement("hash", epilogueHash, 2),
    "  </ans:epilogo>",
    "</ans:mensagemTISS>"
  ].join("\n");
  return body;
}

function buildSpSadtGuideXml(guide: NormalizedGuide, sequence: number) {
  const date = normalizeDate(guide.scheduledStart, guide.timeZone);
  const startTime = normalizeTime(guide.scheduledStart, guide.timeZone);
  const endTime = normalizeTime(guide.scheduledEnd, guide.timeZone);
  const unitAmount = formatMoneyFromCents(guide.unitAmountCents);
  const totalAmount = formatMoneyFromCents(guide.totalAmountCents);
  const lines = [
    "        <ans:guiaSP-SADT>",
    "          <ans:cabecalhoGuia>",
    xmlElement("registroANS", guide.payerAns, 6),
    xmlElement("numeroGuiaPrestador", guide.providerGuideNumber, 6),
    "          </ans:cabecalhoGuia>"
  ];
  if (guide.operatorGuideNumber || guide.authorizationCode || guide.authorizationDate || guide.authorizationValidUntil) {
    lines.push(
      "          <ans:dadosAutorizacao>",
      guide.operatorGuideNumber ? xmlElement("numeroGuiaOperadora", guide.operatorGuideNumber, 6) : "",
      xmlElement("dataAutorizacao", guide.authorizationDate, 6),
      guide.authorizationCode ? xmlElement("senha", guide.authorizationCode, 6) : "",
      guide.authorizationValidUntil ? xmlElement("dataValidadeSenha", guide.authorizationValidUntil, 6) : "",
      "          </ans:dadosAutorizacao>"
    );
  }
  lines.push(
    "          <ans:dadosBeneficiario>",
    xmlElement("numeroCarteira", guide.beneficiaryCard, 6),
    xmlElement("atendimentoRN", "N", 6),
    "          </ans:dadosBeneficiario>",
    "          <ans:dadosSolicitante>",
    "            <ans:contratadoSolicitante>",
    xmlProviderIdentifier(guide.providerIdentifier, 7),
    "            </ans:contratadoSolicitante>",
    xmlElement("nomeContratadoSolicitante", guide.providerName, 6),
    "            <ans:profissionalSolicitante>",
    xmlRequesterProfessional(guide, 7),
    "            </ans:profissionalSolicitante>",
    "          </ans:dadosSolicitante>",
    "          <ans:dadosSolicitacao>",
    guide.requestDate ? xmlElement("dataSolicitacao", guide.requestDate, 6) : "",
    xmlElement("caraterAtendimento", guide.attendanceCharacter, 6),
    "          </ans:dadosSolicitacao>",
    "          <ans:dadosExecutante>",
    "            <ans:contratadoExecutante>",
    xmlProviderIdentifier(guide.providerIdentifier, 7),
    "            </ans:contratadoExecutante>",
    xmlElement("CNES", guide.providerCnes, 6),
    "          </ans:dadosExecutante>",
    "          <ans:dadosAtendimento>",
    xmlElement("tipoAtendimento", guide.attendanceType, 6),
    xmlElement("indicacaoAcidente", "9", 6),
    guide.consultationType ? xmlElement("tipoConsulta", guide.consultationType, 6) : "",
    xmlElement("regimeAtendimento", guide.attendanceRegime, 6),
    "          </ans:dadosAtendimento>",
    "          <ans:procedimentosExecutados>",
    "            <ans:procedimentoExecutado>",
    xmlElement("sequencialItem", sequence, 7),
    xmlElement("dataExecucao", date, 7),
    startTime ? xmlElement("horaInicial", startTime, 7) : "",
    endTime ? xmlElement("horaFinal", endTime, 7) : "",
    "              <ans:procedimento>",
    xmlProcedure(guide, 8),
    "              </ans:procedimento>",
    xmlElement("quantidadeExecutada", guide.quantity, 7),
    xmlElement("reducaoAcrescimo", "1.00", 7),
    xmlElement("valorUnitario", unitAmount, 7),
    xmlElement("valorTotal", totalAmount, 7),
    xmlExecutantTeam(guide, 7),
    "            </ans:procedimentoExecutado>",
    "          </ans:procedimentosExecutados>",
    "          <ans:valorTotal>",
    xmlElement("valorProcedimentos", totalAmount, 6),
    xmlElement("valorTotalGeral", totalAmount, 6),
    "          </ans:valorTotal>",
    "        </ans:guiaSP-SADT>"
  );
  return lines.filter(Boolean).join("\n");
}

function validatePreGuideBase(row: any, issues: TissOfficialIssue[]) {
  const id = firstValue(row?.id);
  const snapshot = row?.snapshot || row?.snapshot_data || {};
  if (row?.status !== "valid") {
    addIssue({
      issues,
      preGuideId: id,
      entity: "preGuide",
      field: "status",
      code: "TISS_OFFICIAL_PRE_GUIDE_NOT_VALID",
      message: "Somente Pré-guias válidas podem gerar XML TISS oficial."
    });
  }
  const blockingCodes = Array.isArray(row?.validationErrorCodes)
    ? row.validationErrorCodes
    : Array.isArray(row?.validation_error_codes)
      ? row.validation_error_codes
      : [];
  const blockingErrors = Array.isArray(row?.validationErrors)
    ? row.validationErrors
    : Array.isArray(row?.validation_errors)
      ? row.validation_errors
      : [];
  if (blockingCodes.length > 0 || blockingErrors.length > 0) {
    addIssue({
      issues,
      preGuideId: id,
      entity: "preGuide",
      field: "validation_errors",
      code: "TISS_OFFICIAL_PRE_GUIDE_HAS_BLOCKING_ISSUES",
      message: "Corrija as pendências bloqueantes da Pré-guia antes de gerar o XML oficial."
    });
  }
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length === 0) {
    addIssue({
      issues,
      preGuideId: id,
      entity: "preGuide",
      field: "snapshot_data",
      code: "TISS_OFFICIAL_PRE_GUIDE_SNAPSHOT_MISSING",
      message: "A Pré-guia precisa ter snapshot persistido para gerar XML oficial."
    });
  }
  return snapshot;
}

function normalizeGuide(row: any, issues: TissOfficialIssue[], timeZone: string): NormalizedGuide | null {
  const preGuideId = firstValue(row?.id);
  const snapshot = validatePreGuideBase(row, issues);
  const appointment = snapshot?.appointment || {};
  const beneficiary = snapshot?.beneficiary || {};
  const provider = snapshot?.provider || {};
  const payer = snapshot?.payer || {};
  const professional = snapshot?.professional || {};
  const requester = snapshot?.requester || snapshot?.requestingProfessional || {};
  const attendance = snapshot?.attendance || {};
  const procedure = snapshot?.procedure || {};
  const authorization = snapshot?.authorization || {};

  const payerAns = firstDigits(6, payer.ansRegistration, payer.ans_registration, payer.registrationAns, row?.payer_ans_registration);
  if (!/^\d{6}$/.test(payerAns) || isPlaceholder(payerAns)) {
    addIssue({ issues, preGuideId, entity: "payer", field: "ansRegistration", code: "TISS_OFFICIAL_PAYER_ANS_MISSING", message: "Registro ANS da operadora é obrigatório para XML TISS oficial." });
  }

  const providerCodeCandidate = normalizeNumberText(firstValue(
    payer.contractedProviderCode,
    payer.providerCode,
    payer.operatorProviderCode
  ), 200);
  if (providerCodeCandidate.length > TISS_PROVIDER_CODE_MAX_LENGTH) {
    addIssue({ issues, preGuideId, entity: "provider", field: "providerIdentifier", code: "TISS_OFFICIAL_PROVIDER_CODE_TOO_LONG", message: `Código do prestador deve ter no máximo ${TISS_PROVIDER_CODE_MAX_LENGTH} caracteres; o XML nunca trunca esse identificador.` });
  }
  const providerIdentifier = pickProviderIdentifier(snapshot, row);
  if (!providerIdentifier) {
    addIssue({ issues, preGuideId, entity: "provider", field: "providerIdentifier", code: "TISS_OFFICIAL_PROVIDER_IDENTIFIER_MISSING", message: "Informe código do prestador na operadora, CPF ou CNPJ do prestador." });
  }

  const contractedProviderName = firstValue(payer.contractedExecutant, payer.contracted_executant);
  const providerName = normalizeLimitedText(firstValue(
    providerIdentifier?.tag === "codigoPrestadorNaOperadora" ? contractedProviderName : "",
    provider.legalName,
    provider.legal_name,
    provider.tradeName,
    provider.trade_name,
    row?.clinicName,
    row?.clinic_name_snapshot
  ), 70);
  if (!providerName || isPlaceholder(providerName)) {
    addIssue({ issues, preGuideId, entity: "provider", field: "legalName", code: "TISS_OFFICIAL_PROVIDER_NAME_MISSING", message: "Razão social ou nome do prestador é obrigatório para XML TISS oficial." });
  }

  const providerCnes = firstDigits(7, provider.cnesCode, provider.cnes_code, row?.cnes_code);
  if (!/^\d{7}$/.test(providerCnes) || isPlaceholder(providerCnes)) {
    addIssue({ issues, preGuideId, entity: "provider", field: "cnesCode", code: "TISS_OFFICIAL_PROVIDER_CNES_MISSING", message: "CNES do prestador deve conter 7 dígitos para XML TISS oficial." });
  }

  const beneficiaryCard = normalizeNumberText(firstValue(beneficiary.cardNumber, beneficiary.beneficiaryCardNumber, beneficiary.card_number, row?.beneficiaryCardNumber, row?.beneficiary_card_number), 20);
  const beneficiaryName = normalizeLimitedText(firstValue(beneficiary.name, beneficiary.fullName, row?.patientName, row?.patient_name), 70);
  if (!beneficiaryCard || isPlaceholder(beneficiaryCard)) {
    addIssue({ issues, preGuideId, entity: "beneficiary", field: "cardNumber", code: "TISS_OFFICIAL_BENEFICIARY_CARD_MISSING", message: "Número da carteirinha do beneficiário é obrigatório para XML TISS oficial." });
  }

  const requesterName = normalizeLimitedText(firstValue(requester.name, requester.professionalName), 70);
  const requesterCouncilCode = normalizeCouncil(firstValue(requester.councilCode, requester.councilType, requester.council));
  const requesterCouncilNumber = normalizeNumberText(firstValue(requester.councilNumber, requester.registryNumber), 15);
  const requesterCouncilUf = normalizeUf(firstValue(requester.councilState, requester.councilUf));
  const requesterCboCode = normalizeCbo(firstValue(requester.cboCode, requester.cbo));
  if (!requesterName) {
    addIssue({ issues, preGuideId, entity: "requester", field: "name", code: "TISS_OFFICIAL_REQUESTER_NAME_MISSING", message: "Profissional solicitante real da guia é obrigatório para XML TISS oficial." });
  }
  if (!requesterCouncilCode) {
    addIssue({ issues, preGuideId, entity: "requester", field: "councilType", code: "TISS_OFFICIAL_REQUESTER_COUNCIL_MISSING", message: "Conselho do profissional solicitante deve estar mapeado para código TISS." });
  }
  if (!requesterCouncilNumber) {
    addIssue({ issues, preGuideId, entity: "requester", field: "councilNumber", code: "TISS_OFFICIAL_REQUESTER_REGISTRY_MISSING", message: "Número do conselho do profissional solicitante é obrigatório." });
  }
  if (!requesterCouncilUf) {
    addIssue({ issues, preGuideId, entity: "requester", field: "councilState", code: "TISS_OFFICIAL_REQUESTER_UF_MISSING", message: "UF do conselho do profissional solicitante é obrigatória." });
  }
  if (!requesterCboCode) {
    addIssue({ issues, preGuideId, entity: "requester", field: "cboCode", code: "TISS_OFFICIAL_REQUESTER_CBO_MISSING", message: "CBO do profissional solicitante é obrigatório." });
  }

  const professionalName = normalizeLimitedText(firstValue(professional.name, professional.displayName, row?.professionalName, row?.professional_name_snapshot), 70);
  const professionalIdentifier = pickProfessionalIdentifier(professional);
  const professionalParticipationDegreeRaw = normalizeNumberText(firstValue(
    professional.participationDegree,
    professional.participation_degree
  ), 2);
  const professionalParticipationDegree = professionalParticipationDegreeRaw
    ? professionalParticipationDegreeRaw.padStart(2, "0")
    : null;
  const councilCode = normalizeCouncil(firstValue(professional.councilCode, professional.councilType, professional.council, professional.registryCouncil));
  const councilNumber = normalizeNumberText(firstValue(professional.councilNumber, professional.registryNumber, professional.professionalRegistry), 15);
  const councilUf = normalizeUf(firstValue(professional.councilState, professional.councilUf, professional.registryState));
  const cboCode = normalizeCbo(firstValue(professional.cboCode, professional.cbo));
  if (!professionalName || ["Equipe", "Team"].includes(professionalName)) {
    addIssue({ issues, preGuideId, entity: "professional", field: "name", code: "TISS_OFFICIAL_PROFESSIONAL_NAME_MISSING", message: "Profissional executante real é obrigatório para XML TISS oficial." });
  }
  if (!councilCode) {
    addIssue({ issues, preGuideId, entity: "professional", field: "councilType", code: "TISS_OFFICIAL_PROFESSIONAL_COUNCIL_MISSING", message: "Conselho profissional deve estar mapeado para código TISS." });
  }
  if (!councilNumber || isPlaceholder(councilNumber)) {
    addIssue({ issues, preGuideId, entity: "professional", field: "councilNumber", code: "TISS_OFFICIAL_PROFESSIONAL_REGISTRY_MISSING", message: "Número do conselho profissional é obrigatório para XML TISS oficial." });
  }
  if (!councilUf) {
    addIssue({ issues, preGuideId, entity: "professional", field: "councilState", code: "TISS_OFFICIAL_PROFESSIONAL_UF_MISSING", message: "UF do conselho deve estar mapeada para código IBGE no XML TISS oficial." });
  }
  if (!cboCode || isPlaceholder(cboCode)) {
    addIssue({ issues, preGuideId, entity: "professional", field: "cboCode", code: "TISS_OFFICIAL_PROFESSIONAL_CBO_MISSING", message: "CBO do profissional é obrigatório para XML TISS oficial." });
  }

  if (payer?.requirements?.requiresExecutantRegistry && !professionalIdentifier) {
    addIssue({ issues, preGuideId, entity: "professional", field: "operatorProviderCode", code: "TISS_OFFICIAL_EXECUTANT_IDENTIFIER_MISSING", message: "Informe o código individual do executante na operadora ou o CPF no perfil faturável." });
  }
  if (professionalParticipationDegree && !VALID_PARTICIPATION_DEGREES.has(professionalParticipationDegree)) {
    addIssue({ issues, preGuideId, entity: "professional", field: "participationDegree", code: "TISS_OFFICIAL_PARTICIPATION_DEGREE_INVALID", message: "Grau de participação do executante não pertence ao domínio TISS." });
  }

  const providerGuideNumberRaw = firstValue(
    authorization.providerGuideNumber,
    authorization.provider_guide_number,
    row?.providerGuideNumber,
    row?.provider_guide_number
  );
  const providerGuideNumber = normalizeNumberText(providerGuideNumberRaw, 20);
  if (!providerGuideNumber || isPlaceholder(providerGuideNumber)) {
    addIssue({ issues, preGuideId, entity: "authorization", field: "providerGuideNumber", code: "TISS_OFFICIAL_PROVIDER_GUIDE_NUMBER_MISSING", message: "Número da guia no prestador é obrigatório e não pode ser inferido da guia da operadora." });
  } else if (providerGuideNumberRaw.length > 20) {
    addIssue({ issues, preGuideId, entity: "authorization", field: "providerGuideNumber", code: "TISS_OFFICIAL_PROVIDER_GUIDE_NUMBER_TOO_LONG", message: "Número da guia no prestador deve ter no máximo 20 caracteres; o XML nunca trunca esse número." });
  }
  const operatorGuideNumberRaw = firstValue(
    authorization.operatorGuideNumber,
    authorization.operator_guide_number,
    authorization.guideNumber,
    authorization.guide_number,
    row?.operatorGuideNumber,
    row?.operator_guide_number,
    row?.guideNumber,
    row?.guide_number
  );
  const operatorGuideNumber = normalizeNumberText(operatorGuideNumberRaw, 20) || null;
  if (operatorGuideNumberRaw.length > 20) {
    addIssue({ issues, preGuideId, entity: "authorization", field: "operatorGuideNumber", code: "TISS_OFFICIAL_OPERATOR_GUIDE_NUMBER_TOO_LONG", message: "Número da guia da operadora deve ter no máximo 20 caracteres; o XML nunca trunca esse número." });
  }

  const officialTussCode = normalizeNumberText(firstValue(row?.officialTussCode, row?.official_tuss_code, procedure.officialTussCode, procedure.official_tuss_code, row?.tussCode, row?.tuss_code, procedure.tussCode, procedure.tuss_code), 10);
  const billingTussCode = normalizeNumberText(firstValue(row?.billingCode, row?.billing_code, procedure.billingCode, procedure.billing_code), 10);
  const tussCode = billingTussCode || officialTussCode;
  const tussDescription = normalizeLimitedText(firstValue(row?.billingCodeDescription, row?.billing_code_description, procedure.billingCodeDescription, procedure.billing_code_description, row?.tussDescription, row?.tuss_description, procedure.tussDescription, procedure.tuss_description, procedure.name), 150);
  if (!/^\d{1,10}$/.test(tussCode) || isPlaceholder(tussCode)) {
    addIssue({ issues, preGuideId, entity: "procedure", field: "tussCode", code: "TISS_OFFICIAL_TUSS_CODE_MISSING", message: "Código TUSS é obrigatório para XML TISS oficial." });
  }
  if (!tussDescription || isPlaceholder(tussDescription)) {
    addIssue({ issues, preGuideId, entity: "procedure", field: "tussDescription", code: "TISS_OFFICIAL_TUSS_DESCRIPTION_MISSING", message: "Descrição TUSS é obrigatória para XML TISS oficial." });
  }

  const quantity = Math.max(1, Math.trunc(Number(row?.quantity || procedure.quantity || 1) || 1));
  if (quantity > 999) {
    addIssue({ issues, preGuideId, entity: "procedure", field: "quantity", code: "TISS_OFFICIAL_QUANTITY_INVALID", message: "Quantidade executada deve estar entre 1 e 999 para XML TISS oficial." });
  }
  const totalAmountCents = Math.trunc(Number(row?.totalAmountCents ?? row?.total_amount_cents ?? procedure.totalAmountCents ?? procedure.total_amount_cents ?? 0));
  const unitAmountCents = Math.trunc(Number(row?.unitAmountCents ?? row?.unit_amount_cents ?? procedure.unitAmountCents ?? procedure.unit_amount_cents ?? Math.trunc(totalAmountCents / quantity)));
  const zeroAmountPolicy = zeroAmountXmlPolicy(row);
  const invalidAmount = !Number.isFinite(totalAmountCents) || totalAmountCents < 0 || !Number.isFinite(unitAmountCents) || unitAmountCents < 0;
  if (invalidAmount || ((totalAmountCents === 0 || unitAmountCents === 0) && !zeroAmountPolicy.allowed)) {
    addIssue({ issues, preGuideId, entity: "procedure", field: "amount", code: "TISS_OFFICIAL_AMOUNT_MISSING", message: "Valor unitário e total são obrigatórios para XML TISS oficial, salvo política explícita da operadora." });
  } else if ((totalAmountCents === 0 || unitAmountCents === 0) && zeroAmountPolicy.allowed) {
    addWarning({
      issues,
      preGuideId,
      entity: "procedure",
      field: "amount",
      code: "TISS_OFFICIAL_ZERO_AMOUNT_OPERATOR_POLICY",
      message: zeroAmountPolicy.reason || "A operadora calcula o valor após a importação; o XML oficial será emitido com 0.00."
    });
  }

  const scheduledStart = firstValue(row?.scheduledStart, row?.scheduled_start, appointment.scheduledStart, appointment.scheduled_start);
  const scheduledDate = normalizeDate(scheduledStart, timeZone);
  if (!scheduledDate) {
    addIssue({ issues, preGuideId, entity: "appointment", field: "scheduledStart", code: "TISS_OFFICIAL_SCHEDULED_DATE_MISSING", message: "Data do atendimento é obrigatória para XML TISS oficial." });
  }

  const attendanceType = normalizeNumberText(firstValue(payer.defaultAttendanceType, payer.default_attendance_type, payer.defaultTipoAtendimento), 2).padStart(2, "0");
  const attendanceRegime = normalizeNumberText(firstValue(payer.defaultAttendanceRegime, payer.default_attendance_regime), 2).padStart(2, "0");
  const attendanceCharacter = normalizeNumberText(firstValue(payer.defaultAttendanceCharacter, payer.default_attendance_character), 1);
  const consultationType = normalizeNumberText(firstValue(
    attendance.consultationType,
    attendance.consultation_type
  ), 1) || null;
  if (!VALID_ATTENDANCE_TYPES.has(attendanceType)) {
    addIssue({ issues, preGuideId, entity: "payer", field: "defaultAttendanceType", code: "TISS_OFFICIAL_ATTENDANCE_TYPE_MISSING", message: "Tipo de atendimento TISS deve estar configurado no perfil do pagador." });
  }
  if (!VALID_ATTENDANCE_REGIMES.has(attendanceRegime)) {
    addIssue({ issues, preGuideId, entity: "payer", field: "defaultAttendanceRegime", code: "TISS_OFFICIAL_ATTENDANCE_REGIME_MISSING", message: "Regime de atendimento TISS deve estar configurado no perfil do pagador." });
  }
  if (!VALID_ATTENDANCE_CHARACTERS.has(attendanceCharacter)) {
    addIssue({ issues, preGuideId, entity: "payer", field: "defaultAttendanceCharacter", code: "TISS_OFFICIAL_ATTENDANCE_CHARACTER_MISSING", message: "Caráter de atendimento TISS deve estar configurado no perfil do pagador." });
  }
  if (attendanceType === "04" && !consultationType) {
    addIssue({ issues, preGuideId, entity: "attendance", field: "consultationType", code: "TISS_OFFICIAL_CONSULTATION_TYPE_MISSING", message: "Tipo de consulta é obrigatório quando o tipo de atendimento é 04 — Consulta." });
  }
  if (consultationType && !VALID_CONSULTATION_TYPES.has(consultationType)) {
    addIssue({ issues, preGuideId, entity: "attendance", field: "consultationType", code: "TISS_OFFICIAL_CONSULTATION_TYPE_INVALID", message: "Tipo de consulta não pertence ao domínio TISS." });
  }

  const authorizationCode = normalizeNumberText(firstValue(row?.authorizationCode, row?.authorization_code, authorization.authorizationCode, authorization.authorization_code), 20) || null;
  const authorizationDate = normalizeDate(firstValue(
    authorization.authorizationDate,
    authorization.authorization_date,
    authorization.issueDate,
    authorization.issue_date,
    authorization.authorizationValidFrom,
    authorization.validFrom,
    authorization.valid_from
  )) || null;
  const authorizationValidFrom = normalizeDate(firstValue(authorization.authorizationValidFrom, authorization.validFrom, authorization.valid_from)) || null;
  const authorizationValidUntil = normalizeDate(firstValue(row?.authorizationValidUntil, row?.authorization_valid_until, authorization.authorizationValidUntil, authorization.validUntil, authorization.valid_until)) || null;
  const requestDate = normalizeDate(firstValue(
    authorization.requestDate,
    authorization.request_date,
    attendance.requestDate,
    attendance.request_date
  )) || null;
  if ((operatorGuideNumber || authorizationCode || authorizationValidUntil) && !authorizationDate) {
    addIssue({ issues, preGuideId, entity: "authorization", field: "authorizationValidFrom", code: "TISS_OFFICIAL_AUTHORIZATION_DATE_MISSING", message: "Data da autorização deve ser informada quando houver senha ou validade de autorização." });
  }

  if (!providerIdentifier || issues.some((issue) => issue.preGuideId === preGuideId && issue.severity === "blocking")) return null;

  return {
    preGuideId,
    timeZone,
    appointmentId: firstValue(row?.appointmentId, row?.appointment_id, appointment.id),
    patientId: firstValue(row?.patientId, row?.patient_id, beneficiary.id),
    guideNumber: providerGuideNumber,
    providerGuideNumber,
    operatorGuideNumber,
    scheduledStart,
    scheduledEnd: firstValue(row?.scheduledEnd, row?.scheduled_end, appointment.scheduledEnd, appointment.scheduled_end),
    totalAmountCents,
    payerAns,
    providerIdentifier,
    providerName,
    providerCnes,
    beneficiaryCard,
    beneficiaryName,
    requesterName,
    requesterCouncilCode,
    requesterCouncilNumber,
    requesterCouncilUf,
    requesterCboCode,
    professionalName,
    professionalIdentifier,
    professionalParticipationDegree,
    councilCode,
    councilNumber,
    councilUf,
    cboCode,
    tussCode,
    tussDescription,
    quantity,
    unitAmountCents,
    authorizationCode,
    authorizationDate,
    authorizationValidFrom,
    authorizationValidUntil,
    requestDate,
    attendanceType,
    attendanceRegime,
    attendanceCharacter,
    consultationType,
    zeroAmountPolicyApplied: totalAmountCents === 0 && zeroAmountPolicy.allowed,
    zeroAmountXmlReason: totalAmountCents === 0 && zeroAmountPolicy.allowed ? zeroAmountPolicy.reason || null : null
  };
}

function buildPayload(input: OfficialTissDocumentInput, guides: NormalizedGuide[]): OfficialTissCanonicalPayload {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const totalAmountCents = guides.reduce((sum, guide) => sum + guide.totalAmountCents, 0);
  return {
    communicationVersion: normalizeTissVersion(input.communicationVersion || COMMUNICATION_040300_MANIFEST.communicationVersion),
    contentStructureVersion: text(input.contentStructureVersion || COMMUNICATION_040300_MANIFEST.contentStructureVersion, 20) || DEFAULT_CONTENT_STRUCTURE_VERSION,
    tussVersion: text(input.tussVersion || COMMUNICATION_040300_MANIFEST.tussVersion, 20) || DEFAULT_TUSS_VERSION,
    competenceMonth: normalizeCompetence(input.competenceMonth),
    generatedAt,
    timeZone: text(input.timeZone, 80) || "America/Sao_Paulo",
    batchNumber: normalizeNumberText(input.batchNumber, 12),
    payerId: text(input.payerId, 120),
    guideType: "sp_sadt",
    guideCount: guides.length,
    totalAmountCents,
    guides: guides.map((guide) => ({
      preGuideId: guide.preGuideId,
      appointmentId: guide.appointmentId,
      patientId: guide.patientId,
      guideNumber: guide.guideNumber,
      providerGuideNumber: guide.providerGuideNumber,
      operatorGuideNumber: guide.operatorGuideNumber,
      scheduledStart: guide.scheduledStart,
      scheduledEnd: guide.scheduledEnd,
      totalAmountCents: guide.totalAmountCents
    }))
  };
}

function compareGuidesForOfficialBatch(a: NormalizedGuide, b: NormalizedGuide) {
  const byDate = a.scheduledStart.localeCompare(b.scheduledStart);
  if (byDate !== 0) return byDate;
  const byPatient = (a.beneficiaryName || a.patientId).localeCompare(b.beneficiaryName || b.patientId);
  if (byPatient !== 0) return byPatient;
  return a.preGuideId.localeCompare(b.preGuideId);
}

function validateBatchInput(input: OfficialTissDocumentInput, guides: NormalizedGuide[], issues: TissOfficialIssue[]) {
  if (guides.length === 0) {
    issues.push({ code: "TISS_OFFICIAL_EMPTY_SELECTION", message: "Selecione ao menos uma Pré-guia válida para gerar XML TISS oficial.", severity: "blocking", entity: "preGuide" });
  }
  if (guides.length > MAX_GUIDES_PER_BATCH) {
    issues.push({ code: "TISS_OFFICIAL_BATCH_TOO_LARGE", message: "O lote SP/SADT oficial suporta no máximo 500 guias nesta versão.", severity: "blocking", entity: "preGuide" });
  }
  if (!normalizeCompetence(input.competenceMonth)) {
    issues.push({ code: "TISS_OFFICIAL_COMPETENCE_INVALID", message: "Competência inválida para XML TISS oficial.", severity: "blocking", entity: "competence", field: "competenceMonth" });
  }
  if (!normalizeNumberText(input.batchNumber, 12)) {
    issues.push({ code: "TISS_OFFICIAL_BATCH_NUMBER_MISSING", message: "Número do lote é obrigatório para XML TISS oficial.", severity: "blocking", entity: "batch", field: "batchNumber" });
  }
  const payerAnsSet = new Set(guides.map((guide) => guide.payerAns));
  if (payerAnsSet.size > 1) {
    issues.push({ code: "TISS_OFFICIAL_MULTIPLE_PAYERS", message: "Gere um XML TISS oficial por operadora/pagador.", severity: "blocking", entity: "payer" });
  }
  const payerIdSet = new Set((input.preGuides || []).map((row: any) => text(row?.payerId || row?.payer_id, 120)).filter(Boolean));
  if (payerIdSet.size > 1 || (input.payerId && payerIdSet.size === 1 && !payerIdSet.has(input.payerId))) {
    issues.push({ code: "TISS_OFFICIAL_PAYER_MISMATCH", message: "As Pré-guias selecionadas precisam pertencer ao mesmo pagador solicitado.", severity: "blocking", entity: "payer" });
  }
  const organizationIdSet = new Set(
    (input.preGuides || [])
      .map((row: any) => text(row?.organizationId || row?.organization_id || row?.clinicId || row?.clinic_id, 120))
      .filter(Boolean)
  );
  if (organizationIdSet.size > 1) {
    issues.push({ code: "TISS_OFFICIAL_MULTIPLE_CLINICS", message: "As Pré-guias selecionadas precisam pertencer à mesma clínica.", severity: "blocking", entity: "clinic" });
  }
  const competence = monthKey(input.competenceMonth);
  const divergentGuide = guides.find((guide) => monthKey(normalizeDate(guide.scheduledStart, guide.timeZone)) !== competence);
  if (divergentGuide) {
    issues.push({
      code: "TISS_OFFICIAL_COMPETENCE_MISMATCH",
      message: "Todas as Pré-guias precisam pertencer à competência selecionada.",
      severity: "blocking",
      entity: "preGuide",
      preGuideId: divergentGuide.preGuideId
    });
  }
}

export const communication040300Strategy: TissXmlGenerationStrategy = {
  communicationVersion: DEFAULT_TISS_VERSION,
  contentStructureVersion: DEFAULT_CONTENT_STRUCTURE_VERSION,

  generate(input: OfficialTissDocumentInput): GeneratedOfficialTissDocument {
    const issues: TissOfficialIssue[] = [];
    const timeZone = text(input.timeZone, 80) || "America/Sao_Paulo";
    const guides = (Array.isArray(input.preGuides) ? input.preGuides : [])
      .map((row) => normalizeGuide(row, issues, timeZone))
      .filter((row): row is NormalizedGuide => Boolean(row))
      .sort(compareGuidesForOfficialBatch);
    validateBatchInput(input, guides, issues);
    if (issues.some((issue) => issue.severity === "blocking")) {
      return {
        ok: false,
        code: "TISS_OFFICIAL_GENERATION_BLOCKED",
        message: "Não foi possível gerar o XML TISS oficial porque há dados obrigatórios ausentes ou inconsistentes.",
        issues
      };
    }
    const payload = buildPayload(input, guides);
    const xmlWithoutHash = buildOfficialMessageXml(payload, guides, "");
    let epilogueHash = "";
    try {
      epilogueHash = calculateTissEpilogueHash(xmlWithoutHash);
    } catch (error: any) {
      return {
        ok: false,
        code: text(error?.message, 120) || "TISS_OFFICIAL_EPILOGUE_HASH_FAILED",
        message: "Não foi possível calcular o hash TISS porque há texto incompatível com a codificação definida pelo padrão.",
        issues: [{
          code: text(error?.message, 120) || "TISS_OFFICIAL_EPILOGUE_HASH_FAILED",
          message: "Revise caracteres especiais nos dados administrativos antes de gerar o XML oficial.",
          severity: "blocking",
          entity: "document"
        }]
      };
    }
    const xml = buildOfficialMessageXml(payload, guides, epilogueHash);
    const recalculatedEpilogueHash = calculateTissEpilogueHash(xml);
    if (recalculatedEpilogueHash !== epilogueHash) {
      return {
        ok: false,
        code: "TISS_OFFICIAL_EPILOGUE_HASH_MISMATCH",
        message: "O XML TISS não passou na verificação interna do hash do epílogo.",
        issues: [{
          code: "TISS_OFFICIAL_EPILOGUE_HASH_MISMATCH",
          message: "O hash do epílogo divergiu após a serialização final do XML.",
          severity: "blocking",
          entity: "document"
        }]
      };
    }
    const xmlHash = sha256Hex(Buffer.from(xml, "latin1"));
    return {
      ok: true,
      xml,
      xmlHash,
      epilogueHash,
      payload,
      preGuideIds: guides.map((guide) => guide.preGuideId),
      guideCount: guides.length,
      totalAmountCents: payload.totalAmountCents,
      batchNumber: payload.batchNumber,
      communicationVersion: payload.communicationVersion,
      contentStructureVersion: payload.contentStructureVersion,
      tussVersion: payload.tussVersion,
      schemaRootFile: COMMUNICATION_040300_MANIFEST.schemaRootFile,
      schemaManifestChecksum: COMMUNICATION_040300_MANIFEST_CHECKSUM,
      validationSummary: {
        format: "official_tiss_sp_sadt_xml",
        messageOperation: COMMUNICATION_040300_MANIFEST.messageOperation,
        guideCount: payload.guideCount,
        totalAmountCents: payload.totalAmountCents,
        zeroAmountPolicyGuideCount: guides.filter((guide) => guide.zeroAmountPolicyApplied).length,
        zeroAmountPolicyReasons: Array.from(new Set(guides.map((guide) => guide.zeroAmountXmlReason).filter(Boolean))),
        epilogueHash,
        epilogueHashAlgorithm: "MD5 dos valores da transação em ordem, sem tags, codificados em ISO-8859-1",
        xmlHash,
        notSentToPayer: true,
        clinicalDataExcluded: true,
        whitelist: [
          "provider",
          "payer",
          "beneficiary",
          "professional",
          "procedure",
          "authorization",
          "appointment_date",
          "values"
        ]
      }
    };
  },

  validate(xml: string) {
    return validateOfficialTissXml040300(xml);
  }
};
