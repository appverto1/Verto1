import { validateTissXmlDraft } from "./tissXmlDraftValidator";

type TissXmlDraftIssue = {
  code: string;
  message: string;
  severity?: "blocking" | "warning";
  path?: string;
  preGuideId?: string | null;
  appointmentId?: string | null;
  entity?: string;
};

type GenerateTissXmlDraftInput = {
  preGuides: any[];
  payerId: string;
  competenceMonth: string;
  guideType?: string | null;
  tissVersion?: string | null;
  generatedAt?: string;
};

export type TissSpSadtDraftPayload = {
  draftMode: true;
  draftFormat: "tiss_sp_sadt_draft";
  tissVersion: string;
  guideType: "sp_sadt" | string;
  competenceMonth: string;
  generatedAt: string;
  batch: {
    draftBatchId: string;
    guideCount: number;
    totalAmount: string;
    totalAmountCents: number;
    currency: "BRL";
  };
  provider: Record<string, any>;
  payer: Record<string, any>;
  guides: Array<Record<string, any>>;
  warnings: TissXmlDraftIssue[];
};

const text = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => Number(value || 0) || 0;
const onlyDigits = (value: unknown) => text(value).replace(/\D/g, "");
const TISS_VERSION_PATTERN = /^\d+\.\d{2}\.\d{2}$/;
const TEST_VERSION_PATTERN = /^(\d)\1{4,}$|^12345678$/;
const runtimeEnv = typeof globalThis !== "undefined" ? (globalThis as any)?.process?.env : {};
const DEFAULT_TISS_VERSION =
  text(runtimeEnv?.DEFAULT_TISS_VERSION) || "4.01.00";

export function escapeXml(value: unknown) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name: string, value: unknown, indent = 0) {
  const padding = " ".repeat(indent);
  return `${padding}<${name}>${escapeXml(value)}</${name}>`;
}

function open(name: string, indent = 0, attrs: Record<string, unknown> = {}) {
  const padding = " ".repeat(indent);
  const serializedAttrs = Object.entries(attrs)
    .filter(([, value]) => text(value))
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
  return `${padding}<${name}${serializedAttrs}>`;
}

function close(name: string, indent = 0) {
  return `${" ".repeat(indent)}</${name}>`;
}

function addIssue(issues: TissXmlDraftIssue[], preGuide: any, code: string, message: string, entity = "preGuide") {
  issues.push({
    code,
    message,
    severity: "blocking",
    entity,
    preGuideId: text(preGuide?.id) || null,
    appointmentId: text(preGuide?.appointmentId || preGuide?.appointment_id) || null,
  });
}

function addWarning(warnings: TissXmlDraftIssue[], code: string, message: string, entity = "draft", path?: string, preGuide?: any) {
  warnings.push({
    code,
    message,
    severity: "warning",
    entity,
    path,
    preGuideId: preGuide ? text(preGuide?.id) || null : null,
    appointmentId: preGuide ? text(preGuide?.appointmentId || preGuide?.appointment_id) || null : null,
  });
}

function hasAny(value: unknown) {
  return text(value).length > 0;
}

function normalizeTissVersion(value: unknown, warnings: TissXmlDraftIssue[]) {
  const version = text(value);
  if (TISS_VERSION_PATTERN.test(version) && !TEST_VERSION_PATTERN.test(version)) return version;
  addWarning(
    warnings,
    "TISS_VERSION_INVALID_FALLBACK_USED",
    "Versão TISS inválida ou não configurada; foi usado o fallback configurado.",
    "payer",
    "tissVersion"
  );
  return TISS_VERSION_PATTERN.test(DEFAULT_TISS_VERSION) ? DEFAULT_TISS_VERSION : "4.01.00";
}

function normalizeUnit(value: unknown) {
  const unit = text(value).toLowerCase();
  if (["session", "sessions", "sessao", "sessão", "sessoes", "sessões"].includes(unit)) {
    return { code: "sessoes", label: "sessões" };
  }
  return { code: unit || "unidade", label: unit || "unidade" };
}

function decimalAmount(cents: unknown) {
  return (amount(cents) / 100).toFixed(2);
}

function dateOnly(value: unknown) {
  const raw = text(value);
  return raw ? raw.slice(0, 10) : "";
}

function looksLikeTestTussCode(value: unknown) {
  const normalized = text(value).toUpperCase();
  return normalized.includes("TESTE") || normalized.includes("CONFIGURADO-PELA-CLINICA");
}

function looksInvalidCbo(value: unknown) {
  const digits = onlyDigits(value);
  return Boolean(text(value)) && digits.length !== 6;
}

function validatePreGuideForXml(preGuide: any): TissXmlDraftIssue[] {
  const issues: TissXmlDraftIssue[] = [];
  const snapshot = preGuide?.snapshot || preGuide?.snapshot_data || {};
  const payer = snapshot.payer || {};
  const provider = snapshot.provider || {};
  const beneficiary = snapshot.beneficiary || {};
  const professional = snapshot.professional || {};
  const procedure = snapshot.procedure || {};
  const authorization = snapshot.authorization || {};
  const requirements = payer.requirements || {};

  if (preGuide?.status !== "valid") {
    addIssue(issues, preGuide, "TISS_XML_DRAFT_PRE_GUIDE_NOT_READY", "A Pré-guia precisa estar válida para gerar XML em rascunho.");
  }
  if (Array.isArray(preGuide?.validationErrorCodes) && preGuide.validationErrorCodes.length > 0) {
    addIssue(issues, preGuide, "TISS_XML_DRAFT_PRE_GUIDE_HAS_ERRORS", "A Pré-guia ainda possui pendências bloqueantes.");
  }
  if (!hasAny(preGuide?.payerId || preGuide?.payer_id || payer.id)) addIssue(issues, preGuide, "PAYER_MISSING", "Pagador não informado.", "payer");
  if (!hasAny(payer.ansRegistration)) addIssue(issues, preGuide, "PAYER_ANS_MISSING", "Registro ANS da operadora não informado.", "payer");
  if (!hasAny(provider.legalName || provider.tradeName)) addIssue(issues, preGuide, "PROVIDER_NAME_MISSING", "Dados do prestador não informados.", "provider");
  if (!hasAny(provider.documentNumber)) addIssue(issues, preGuide, "PROVIDER_DOCUMENT_MISSING", "CPF/CNPJ do prestador não informado.", "provider");
  if (requirements.requiresCnes && !hasAny(provider.cnesCode)) addIssue(issues, preGuide, "PROVIDER_CNES_MISSING", "CNES do prestador não informado.", "provider");
  if (requirements.requiresProviderCode && !hasAny(provider.providerCode)) addIssue(issues, preGuide, "PROVIDER_CODE_MISSING", "Código do prestador na operadora não informado.", "provider");
  if (!hasAny(beneficiary.name || preGuide?.patientName)) addIssue(issues, preGuide, "BENEFICIARY_NAME_MISSING", "Nome do beneficiário não informado.", "beneficiary");
  if (requirements.requiresBeneficiaryCard && !hasAny(beneficiary.cardNumber || preGuide?.beneficiaryCardNumber)) addIssue(issues, preGuide, "BENEFICIARY_CARD_MISSING", "Carteirinha do beneficiário não informada.", "beneficiary");
  if (!hasAny(procedure.billingCode || procedure.billing_code || procedure.tussCode || preGuide?.billingCode || preGuide?.billing_code || preGuide?.tussCode)) addIssue(issues, preGuide, "TUSS_CODE_MISSING", "Código TUSS não informado.", "procedure");
  if (!hasAny(procedure.name || preGuide?.internalProcedureName)) addIssue(issues, preGuide, "PROCEDURE_NAME_MISSING", "Procedimento não informado.", "procedure");
  if (amount(procedure.quantity || preGuide?.quantity) <= 0) addIssue(issues, preGuide, "QUANTITY_MISSING", "Quantidade do procedimento não informada.", "procedure");
  if (amount(procedure.totalAmountCents || preGuide?.totalAmountCents) <= 0) addIssue(issues, preGuide, "AMOUNT_MISSING", "Valor previsto não informado.", "procedure");
  if (requirements.requiresExecutantRegistry && (!hasAny(professional.councilType) || !hasAny(professional.councilNumber))) {
    addIssue(issues, preGuide, "PROFESSIONAL_REGISTRY_MISSING", "Registro profissional não informado.", "professional");
  }
  if (requirements.requiresCbo && !hasAny(professional.cboCode)) addIssue(issues, preGuide, "CBO_MISSING", "CBO não informado.", "professional");
  if ((requirements.requiresAuthorization || requirements.requiresAuthorizationPassword) && !hasAny(authorization.authorizationCode || preGuide?.authorizationCode)) {
    addIssue(issues, preGuide, "AUTHORIZATION_REQUIRED", "Autorização não informada.", "authorization");
  }
  if (requirements.requiresGuideNumber && !hasAny(authorization.guideNumber || preGuide?.guideNumber)) {
    addIssue(issues, preGuide, "GUIDE_MISSING", "Número da guia não informado.", "authorization");
  }

  return issues;
}

export function validateTissXmlDraftInput(input: GenerateTissXmlDraftInput) {
  const preGuides = Array.isArray(input.preGuides) ? input.preGuides : [];
  const issues = preGuides.flatMap(validatePreGuideForXml);
  const payerIds = new Set(preGuides.map((row) => text(row?.payerId || row?.payer_id || row?.snapshot?.payer?.id)).filter(Boolean));
  if (preGuides.length === 0) {
    issues.push({ code: "TISS_XML_DRAFT_EMPTY", message: "Nenhuma Pré-guia válida encontrada para gerar XML em rascunho.", entity: "preGuide", severity: "blocking" });
  }
  if (payerIds.size > 1) {
    issues.push({ code: "TISS_XML_DRAFT_MULTIPLE_PAYERS", message: "Gere um rascunho XML por pagador.", entity: "payer", severity: "blocking" });
  }
  if (input.payerId && payerIds.size === 1 && !payerIds.has(input.payerId)) {
    issues.push({ code: "TISS_XML_DRAFT_PAYER_MISMATCH", message: "As Pré-guias selecionadas não pertencem ao pagador informado.", entity: "payer", severity: "blocking" });
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function buildTissSpSadtDraftPayload(input: GenerateTissXmlDraftInput): TissSpSadtDraftPayload {
  const preGuides = Array.isArray(input.preGuides) ? input.preGuides : [];
  const first = preGuides[0] || {};
  const snapshot = first.snapshot || {};
  const provider = snapshot.provider || {};
  const payer = snapshot.payer || {};
  const warnings: TissXmlDraftIssue[] = [];
  const tissVersion = normalizeTissVersion(input.tissVersion || payer.tissVersion || first.tissVersion, warnings);
  const guideType = text(input.guideType || first.guideType || payer.guideType) || "sp_sadt";
  const generatedAt = input.generatedAt || new Date().toISOString();
  const guides = preGuides.map((row, index) => {
    const rowSnapshot = row.snapshot || {};
    const beneficiary = rowSnapshot.beneficiary || {};
    const professional = rowSnapshot.professional || {};
    const procedure = rowSnapshot.procedure || {};
    const authorization = rowSnapshot.authorization || {};
    const quantity = amount(procedure.quantity || row.quantity || 1);
    const totalAmountCents = amount(procedure.totalAmountCents || row.totalAmountCents);
    const unit = normalizeUnit(procedure.unit || row.unit);
    const officialTussCode = text(procedure.officialTussCode || procedure.official_tuss_code || row.officialTussCode || row.official_tuss_code || procedure.tussCode || row.tussCode);
    const tussCode = text(procedure.billingCode || procedure.billing_code || row.billingCode || row.billing_code || officialTussCode);
    const cboCode = text(professional.cboCode);
    if (looksLikeTestTussCode(tussCode)) {
      addWarning(warnings, "TUSS_CODE_LOOKS_LIKE_TEST_DATA", "Código TUSS parece ser dado de teste.", "procedure", `guides.${index}.procedure.tussCode`, row);
    }
    if (looksInvalidCbo(cboCode)) {
      addWarning(warnings, "CBO_CODE_LOOKS_INVALID", "CBO informado não parece seguir formato esperado.", "professional", `guides.${index}.professional.cboCode`, row);
    }
    return {
      preGuideId: text(row.id),
      appointmentId: text(row.appointmentId || row.appointment_id),
      scheduledStart: text(row.scheduledStart || row.scheduled_start || rowSnapshot.appointment?.scheduledStart),
      guideNumber: text(authorization.guideNumber || row.guideNumber),
      authorizationCode: text(authorization.authorizationCode || row.authorizationCode),
      authorizationValidFrom: dateOnly(authorization.authorizationValidFrom),
      authorizationValidUntil: dateOnly(authorization.authorizationValidUntil || row.authorizationValidUntil),
      beneficiary: {
        name: text(beneficiary.name || row.patientName),
        cardNumber: onlyDigits(beneficiary.cardNumber || row.beneficiaryCardNumber),
        cardValidUntil: dateOnly(beneficiary.cardValidUntil),
        documentNumber: onlyDigits(beneficiary.documentNumber),
        planCategory: text(beneficiary.planCategory),
      },
      professional: {
        name: text(professional.name || row.professionalName),
        councilType: text(professional.councilType),
        councilNumber: text(professional.councilNumber),
        councilState: text(professional.councilState),
        cboCode,
      },
      procedure: {
        internalCode: text(procedure.internalCode || row.internalProcedureCode),
        name: text(procedure.name || row.internalProcedureName),
        tussCode,
        officialTussCode,
        authorizedCode: text(procedure.authorizedCode || procedure.authorized_code || row.authorizedCode || row.authorized_code),
        billingCode: tussCode,
        operatorPackageCode: text(procedure.operatorPackageCode || procedure.operator_package_code || row.operatorPackageCode || row.operator_package_code),
        tussDescription: text(procedure.billingCodeDescription || procedure.billing_code_description || row.billingCodeDescription || row.billing_code_description || procedure.tussDescription || row.tussDescription),
        quantity,
        unit,
      },
      values: {
        totalAmount: decimalAmount(totalAmountCents),
        totalAmountCents,
        currency: "BRL",
      },
      validationMetadata: {
        preGuideStatus: text(row.status),
        lastValidatedAt: text(row.lastValidatedAt || row.last_validated_at),
      },
    };
  });
  const totalAmountCents = guides.reduce((sum, guide) => sum + amount(guide.values.totalAmountCents), 0);
  return {
    draftMode: true,
    draftFormat: "tiss_sp_sadt_draft",
    tissVersion,
    guideType,
    competenceMonth: text(input.competenceMonth),
    generatedAt,
    batch: {
      draftBatchId: `draft-${text(input.payerId).slice(0, 8) || "payer"}-${text(input.competenceMonth).slice(0, 7) || "period"}`,
      guideCount: guides.length,
      totalAmount: decimalAmount(totalAmountCents),
      totalAmountCents,
      currency: "BRL",
    },
    provider: {
      legalName: text(provider.legalName || provider.tradeName),
      tradeName: text(provider.tradeName),
      documentNumber: onlyDigits(provider.documentNumber),
      cnesCode: onlyDigits(provider.cnesCode),
      providerCode: text(provider.providerCode),
    },
    payer: {
      name: text(payer.name || first.payerName),
      ansRegistration: onlyDigits(payer.ansRegistration),
      operatorCode: text(payer.operatorCode),
    },
    guides,
    warnings,
  };
}

function writeObject(lines: string[], name: string, value: any, indent: number) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    lines.push(open(name, indent));
    for (const [key, nested] of Object.entries(value)) {
      writeObject(lines, key, nested, indent + 2);
    }
    lines.push(close(name, indent));
    return;
  }
  lines.push(tag(name, value, indent));
}

export function renderTissSpSadtDraftXml(payload: TissSpSadtDraftPayload) {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    open("tissSpSadtDraft", 0, {
      draftFormat: payload.draftFormat,
      version: payload.tissVersion,
      guideType: payload.guideType,
    }),
    tag("draftMode", "true", 2),
    tag("warning", "Rascunho interno para conferência. Não enviado à operadora.", 2),
    tag("competenceMonth", payload.competenceMonth, 2),
    tag("generatedAt", payload.generatedAt, 2),
    open("batch", 2),
    tag("draftBatchId", payload.batch.draftBatchId, 4),
    tag("guideCount", payload.batch.guideCount, 4),
    tag("totalAmount", payload.batch.totalAmount, 4),
    tag("totalAmountCents", payload.batch.totalAmountCents, 4),
    tag("currency", payload.batch.currency, 4),
    close("batch", 2),
    open("provider", 2),
    tag("legalName", payload.provider.legalName, 4),
    tag("tradeName", payload.provider.tradeName, 4),
    tag("documentNumber", payload.provider.documentNumber, 4),
    tag("cnesCode", payload.provider.cnesCode, 4),
    tag("providerCode", payload.provider.providerCode, 4),
    close("provider", 2),
    open("payer", 2),
    tag("name", payload.payer.name, 4),
    tag("ansRegistration", payload.payer.ansRegistration, 4),
    tag("operatorCode", payload.payer.operatorCode, 4),
    close("payer", 2),
    open("spSadtGuides", 2),
  ];

  for (const guide of payload.guides) {
    lines.push(open("spSadtGuide", 4, { preGuideId: guide.preGuideId, appointmentId: guide.appointmentId }));
    lines.push(tag("scheduledStart", guide.scheduledStart, 6));
    lines.push(open("authorization", 6));
    lines.push(tag("guideNumber", guide.guideNumber, 8));
    lines.push(tag("authorizationCode", guide.authorizationCode, 8));
    lines.push(tag("validFrom", guide.authorizationValidFrom, 8));
    lines.push(tag("validUntil", guide.authorizationValidUntil, 8));
    lines.push(close("authorization", 6));
    writeObject(lines, "beneficiary", guide.beneficiary, 6);
    writeObject(lines, "professional", guide.professional, 6);
    lines.push(open("procedure", 6));
    lines.push(tag("internalCode", guide.procedure.internalCode, 8));
    lines.push(tag("name", guide.procedure.name, 8));
    lines.push(tag("tussCode", guide.procedure.tussCode, 8));
    lines.push(tag("tussDescription", guide.procedure.tussDescription, 8));
    lines.push(tag("quantity", guide.procedure.quantity, 8));
    lines.push(open("unit", 8));
    lines.push(tag("code", guide.procedure.unit.code, 10));
    lines.push(tag("label", guide.procedure.unit.label, 10));
    lines.push(close("unit", 8));
    lines.push(close("procedure", 6));
    writeObject(lines, "values", guide.values, 6);
    writeObject(lines, "validationMetadata", guide.validationMetadata, 6);
    lines.push(close("spSadtGuide", 4));
  }

  lines.push(close("spSadtGuides", 2));
  if (payload.warnings.length > 0) {
    lines.push(open("technicalWarnings", 2));
    for (const warning of payload.warnings) {
      lines.push(open("warning", 4, { code: warning.code, entity: warning.entity, path: warning.path }));
      lines.push(tag("message", warning.message, 6));
      lines.push(close("warning", 4));
    }
    lines.push(close("technicalWarnings", 2));
  }
  lines.push(close("tissSpSadtDraft"));
  return lines.join("\n");
}

export function generateTissXmlDraft(input: GenerateTissXmlDraftInput) {
  const validation = validateTissXmlDraftInput(input);
  if (!validation.ok) {
    const hasNotReadyPreGuide = validation.issues.some((issue) =>
      ["TISS_XML_DRAFT_PRE_GUIDE_NOT_READY", "TISS_XML_DRAFT_PRE_GUIDE_HAS_ERRORS"].includes(issue.code)
    );
    return {
      ok: false as const,
      code: hasNotReadyPreGuide ? "TISS_XML_DRAFT_PRE_GUIDE_NOT_READY" : "TISS_XML_DRAFT_VALIDATION_FAILED",
      message: hasNotReadyPreGuide
        ? "Corrija as pendências da pré-guia antes de gerar o XML em rascunho."
        : "Não foi possível gerar o XML em rascunho porque existem dados obrigatórios ausentes.",
      issues: validation.issues,
    };
  }

  const payload = buildTissSpSadtDraftPayload(input);
  const xml = renderTissSpSadtDraftXml(payload);
  const technicalValidation = validateTissXmlDraft(xml);

  return {
    ok: true as const,
    xml,
    payload,
    validationSummary: {
      status: "draft",
      draftFormat: payload.draftFormat,
      guideCount: payload.batch.guideCount,
      totalAmountCents: payload.batch.totalAmountCents,
      totalAmount: payload.batch.totalAmount,
      currency: payload.batch.currency,
      tissVersion: payload.tissVersion,
      guideType: payload.guideType,
      issues: [],
      warnings: payload.warnings,
      technicalValidation,
      warning: "Rascunho interno para conferência. Não enviado à operadora.",
    },
    preGuideIds: payload.guides.map((guide) => text(guide.preGuideId)).filter(Boolean),
    totalAmountCents: payload.batch.totalAmountCents,
    guideCount: payload.batch.guideCount,
    tissVersion: payload.tissVersion,
    guideType: payload.guideType,
    draftFormat: payload.draftFormat,
    technicalValidation,
  };
}
