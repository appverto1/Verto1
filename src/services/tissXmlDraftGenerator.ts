type TissXmlDraftIssue = {
  code: string;
  message: string;
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

const text = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => Number(value || 0) || 0;

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
    entity,
    preGuideId: text(preGuide?.id) || null,
    appointmentId: text(preGuide?.appointmentId || preGuide?.appointment_id) || null,
  });
}

function hasAny(value: unknown) {
  return text(value).length > 0;
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
  if (!hasAny(procedure.tussCode || preGuide?.tussCode)) addIssue(issues, preGuide, "TUSS_CODE_MISSING", "Código TUSS não informado.", "procedure");
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
    issues.push({ code: "TISS_XML_DRAFT_EMPTY", message: "Nenhuma Pré-guia válida encontrada para gerar XML em rascunho.", entity: "preGuide" });
  }
  if (payerIds.size > 1) {
    issues.push({ code: "TISS_XML_DRAFT_MULTIPLE_PAYERS", message: "Gere um rascunho XML por pagador.", entity: "payer" });
  }
  if (input.payerId && payerIds.size === 1 && !payerIds.has(input.payerId)) {
    issues.push({ code: "TISS_XML_DRAFT_PAYER_MISMATCH", message: "As Pré-guias selecionadas não pertencem ao pagador informado.", entity: "payer" });
  }
  return {
    ok: issues.length === 0,
    issues,
  };
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

  const preGuides = input.preGuides;
  const first = preGuides[0] || {};
  const snapshot = first.snapshot || {};
  const provider = snapshot.provider || {};
  const payer = snapshot.payer || {};
  const tissVersion = text(input.tissVersion || payer.tissVersion || first.tissVersion) || "draft";
  const guideType = text(input.guideType || first.guideType || payer.guideType) || "sp_sadt";
  const generatedAt = input.generatedAt || new Date().toISOString();
  const totalAmountCents = preGuides.reduce((sum, row) => sum + amount(row?.totalAmountCents || row?.snapshot?.procedure?.totalAmountCents), 0);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    open("vertoTissXmlDraft", 0, { version: tissVersion, guideType }),
    tag("draftMode", "true", 2),
    tag("warning", "Rascunho interno para conferência. Não enviado à operadora.", 2),
    tag("competenceMonth", input.competenceMonth, 2),
    tag("generatedAt", generatedAt, 2),
    open("provider", 2),
    tag("legalName", provider.legalName || provider.tradeName, 4),
    tag("tradeName", provider.tradeName, 4),
    tag("documentNumber", provider.documentNumber, 4),
    tag("cnesCode", provider.cnesCode, 4),
    tag("providerCode", provider.providerCode, 4),
    close("provider", 2),
    open("payer", 2),
    tag("name", payer.name || first.payerName, 4),
    tag("ansRegistration", payer.ansRegistration, 4),
    tag("operatorCode", payer.operatorCode, 4),
    close("payer", 2),
    open("guides", 2),
  ];

  for (const row of preGuides) {
    const rowSnapshot = row.snapshot || {};
    const beneficiary = rowSnapshot.beneficiary || {};
    const professional = rowSnapshot.professional || {};
    const procedure = rowSnapshot.procedure || {};
    const authorization = rowSnapshot.authorization || {};
    lines.push(open("guide", 4, { preGuideId: row.id, appointmentId: row.appointmentId || row.appointment_id }));
    lines.push(tag("scheduledStart", row.scheduledStart || row.scheduled_start || rowSnapshot.appointment?.scheduledStart, 6));
    lines.push(open("beneficiary", 6));
    lines.push(tag("name", beneficiary.name || row.patientName, 8));
    lines.push(tag("cardNumber", beneficiary.cardNumber || row.beneficiaryCardNumber, 8));
    lines.push(tag("cardValidUntil", beneficiary.cardValidUntil, 8));
    lines.push(close("beneficiary", 6));
    lines.push(open("professional", 6));
    lines.push(tag("name", professional.name || row.professionalName, 8));
    lines.push(tag("councilType", professional.councilType, 8));
    lines.push(tag("councilNumber", professional.councilNumber, 8));
    lines.push(tag("councilState", professional.councilState, 8));
    lines.push(tag("cboCode", professional.cboCode, 8));
    lines.push(close("professional", 6));
    lines.push(open("authorization", 6));
    lines.push(tag("guideNumber", authorization.guideNumber || row.guideNumber, 8));
    lines.push(tag("authorizationCode", authorization.authorizationCode || row.authorizationCode, 8));
    lines.push(tag("validFrom", authorization.authorizationValidFrom, 8));
    lines.push(tag("validUntil", authorization.authorizationValidUntil || row.authorizationValidUntil, 8));
    lines.push(close("authorization", 6));
    lines.push(open("procedure", 6));
    lines.push(tag("internalCode", procedure.internalCode || row.internalProcedureCode, 8));
    lines.push(tag("name", procedure.name || row.internalProcedureName, 8));
    lines.push(tag("tussCode", procedure.tussCode || row.tussCode, 8));
    lines.push(tag("tussDescription", procedure.tussDescription || row.tussDescription, 8));
    lines.push(tag("quantity", procedure.quantity || row.quantity, 8));
    lines.push(tag("unit", procedure.unit || row.unit, 8));
    lines.push(tag("totalAmountCents", procedure.totalAmountCents || row.totalAmountCents, 8));
    lines.push(close("procedure", 6));
    lines.push(close("guide", 4));
  }

  lines.push(close("guides", 2));
  lines.push(open("summary", 2));
  lines.push(tag("guideCount", preGuides.length, 4));
  lines.push(tag("totalAmountCents", totalAmountCents, 4));
  lines.push(close("summary", 2));
  lines.push(close("vertoTissXmlDraft"));

  return {
    ok: true as const,
    xml: lines.join("\n"),
    validationSummary: {
      status: "draft",
      guideCount: preGuides.length,
      totalAmountCents,
      tissVersion,
      guideType,
      issues: [],
      warning: "Rascunho interno para conferência. Não enviado à operadora.",
    },
    preGuideIds: preGuides.map((row) => text(row.id)).filter(Boolean),
    totalAmountCents,
    guideCount: preGuides.length,
    tissVersion,
    guideType,
  };
}
