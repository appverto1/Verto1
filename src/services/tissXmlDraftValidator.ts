export type TissXmlDraftValidationSeverity = "blocking" | "warning";

export type TissXmlDraftValidationIssue = {
  code: string;
  message: string;
  severity: TissXmlDraftValidationSeverity;
  path?: string;
  preGuideId?: string | null;
  entity?: string;
};

export type TissXmlDraftValidationResult = {
  status: "valid" | "invalid" | "warning";
  validatedAt: string;
  errors: TissXmlDraftValidationIssue[];
  warnings: TissXmlDraftValidationIssue[];
  xsdValidation: {
    status: "not_configured" | "valid" | "invalid";
    message: string;
  };
};

const TISS_VERSION_PATTERN = /^\d+\.\d{2}\.\d{2}$/;
const TEST_VERSION_PATTERN = /^(\d)\1{4,}$|^12345678$/;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function issue(
  code: string,
  message: string,
  severity: TissXmlDraftValidationSeverity,
  path?: string,
  entity?: string,
  preGuideId?: string | null
): TissXmlDraftValidationIssue {
  return {
    code,
    message,
    severity,
    path,
    entity,
    preGuideId: preGuideId || null,
  };
}

function getRoot(xml: string) {
  const withoutDeclaration = xml.replace(/^\s*<\?xml[\s\S]*?\?>/i, "").trim();
  const match = withoutDeclaration.match(/^<([A-Za-z_][\w:.-]*)(\s[^>]*)?>/);
  if (!match) return { name: "", attrs: "" };
  return { name: match[1], attrs: match[2] || "" };
}

function getAttr(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? match[1] : "";
}

function getTag(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? match[1].trim() : "";
}

function getSections(xml: string, name: string) {
  const sections: string[] = [];
  const regex = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) sections.push(match[1]);
  return sections;
}

function getOpenTag(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}\\b([^>]*)>`, "i"));
  return match ? match[1] || "" : "";
}

function validateWellFormedXml(xml: string) {
  const errors: TissXmlDraftValidationIssue[] = [];
  const stack: string[] = [];
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, "");
  const tagRegex = /<[^>]+>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(stripped))) {
    const raw = match[0];
    if (/^<\?/.test(raw) || /^<!/.test(raw)) continue;
    const closing = /^<\//.test(raw);
    const selfClosing = /\/>$/.test(raw);
    const nameMatch = raw.match(/^<\/?\s*([A-Za-z_][\w:.-]*)/);
    if (!nameMatch) {
      errors.push(issue("XML_MALFORMED", "O XML possui uma tag inválida.", "blocking", "xml"));
      continue;
    }
    const name = nameMatch[1];
    if (closing) {
      const expected = stack.pop();
      if (expected !== name) {
        errors.push(issue("XML_MALFORMED", `A tag ${name} não fecha a estrutura esperada.`, "blocking", "xml"));
        break;
      }
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    errors.push(issue("XML_MALFORMED", "O XML possui tags abertas sem fechamento.", "blocking", "xml"));
  }
  return errors;
}

function isPlausibleTissVersion(version: string) {
  return TISS_VERSION_PATTERN.test(version) && !TEST_VERSION_PATTERN.test(version);
}

function amountToCents(value: string) {
  const normalized = Number(value.replace(",", "."));
  if (!Number.isFinite(normalized)) return null;
  return Math.round(normalized * 100);
}

function requireTag(
  errors: TissXmlDraftValidationIssue[],
  xml: string,
  name: string,
  code: string,
  message: string,
  path: string,
  entity: string,
  preGuideId?: string | null
) {
  if (!text(getTag(xml, name))) errors.push(issue(code, message, "blocking", path, entity, preGuideId));
}

function validateNewDraft(xml: string, rootAttrs: string, errors: TissXmlDraftValidationIssue[], warnings: TissXmlDraftValidationIssue[]) {
  const version = getAttr(rootAttrs, "version");
  if (!version || !isPlausibleTissVersion(version)) {
    errors.push(issue("TISS_VERSION_INVALID", "Versão TISS ausente ou inválida no rascunho.", "blocking", "tissSpSadtDraft.@version", "draft"));
  }

  requireTag(errors, xml, "provider", "PROVIDER_MISSING", "Bloco do prestador não encontrado.", "tissSpSadtDraft.provider", "provider");
  requireTag(errors, xml, "payer", "PAYER_MISSING", "Bloco da operadora/pagador não encontrado.", "tissSpSadtDraft.payer", "payer");
  requireTag(errors, xml, "spSadtGuides", "GUIDES_MISSING", "Bloco de guias SP/SADT não encontrado.", "tissSpSadtDraft.spSadtGuides", "guide");

  const guideSections = getSections(xml, "spSadtGuide");
  if (guideSections.length === 0) {
    errors.push(issue("GUIDES_MISSING", "O rascunho XML precisa conter pelo menos uma guia.", "blocking", "tissSpSadtDraft.spSadtGuides", "guide"));
    return;
  }

  const guideCount = Number(getTag(getTag(xml, "batch"), "guideCount"));
  if (!Number.isFinite(guideCount) || guideCount !== guideSections.length) {
    errors.push(issue("GUIDE_COUNT_MISMATCH", "A quantidade de guias no cabeçalho não bate com as guias do XML.", "blocking", "tissSpSadtDraft.batch.guideCount", "batch"));
  }

  const batchTotalCents = amountToCents(getTag(getTag(xml, "batch"), "totalAmount"));
  let summedGuideCents = 0;
  guideSections.forEach((guideXml, index) => {
    const attrs = getOpenTag(xml, "spSadtGuide");
    const preGuideId = getAttr(attrs, "preGuideId") || null;
    const basePath = `tissSpSadtDraft.spSadtGuides.${index}`;
    const beneficiary = getTag(guideXml, "beneficiary");
    const professional = getTag(guideXml, "professional");
    const procedure = getTag(guideXml, "procedure");
    const values = getTag(guideXml, "values");
    const authorization = getTag(guideXml, "authorization");

    if (!text(beneficiary)) errors.push(issue("BENEFICIARY_MISSING", "Beneficiário ausente na guia.", "blocking", `${basePath}.beneficiary`, "beneficiary", preGuideId));
    if (!text(professional)) errors.push(issue("PROFESSIONAL_MISSING", "Profissional executante ausente na guia.", "blocking", `${basePath}.professional`, "professional", preGuideId));
    if (!text(authorization)) errors.push(issue("AUTHORIZATION_MISSING", "Autorização/guia ausente na guia.", "blocking", `${basePath}.authorization`, "authorization", preGuideId));
    if (!text(procedure)) {
      errors.push(issue("PROCEDURE_MISSING", "Procedimento ausente na guia.", "blocking", `${basePath}.procedure`, "procedure", preGuideId));
    } else {
      requireTag(errors, procedure, "tussCode", "TUSS_CODE_MISSING", "Código TUSS ausente na guia.", `${basePath}.procedure.tussCode`, "procedure", preGuideId);
      requireTag(errors, procedure, "quantity", "QUANTITY_MISSING", "Quantidade ausente na guia.", `${basePath}.procedure.quantity`, "procedure", preGuideId);
    }
    if (!text(values)) {
      errors.push(issue("VALUE_MISSING", "Valor ausente na guia.", "blocking", `${basePath}.values`, "value", preGuideId));
    } else {
      const guideAmountCents = amountToCents(getTag(values, "totalAmount"));
      if (guideAmountCents === null || guideAmountCents <= 0) {
        errors.push(issue("VALUE_MISSING", "Valor decimal da guia ausente ou inválido.", "blocking", `${basePath}.values.totalAmount`, "value", preGuideId));
      } else {
        summedGuideCents += guideAmountCents;
      }
    }
  });

  if (batchTotalCents === null || batchTotalCents !== summedGuideCents) {
    errors.push(issue("TOTAL_AMOUNT_MISMATCH", "O valor total do cabeçalho não bate com a soma das guias.", "blocking", "tissSpSadtDraft.batch.totalAmount", "batch"));
  }

  if (!text(getTag(getTag(xml, "provider"), "documentNumber"))) {
    errors.push(issue("PROVIDER_DOCUMENT_MISSING", "Documento do prestador ausente no rascunho.", "blocking", "tissSpSadtDraft.provider.documentNumber", "provider"));
  }
  if (!text(getTag(getTag(xml, "payer"), "ansRegistration"))) {
    errors.push(issue("PAYER_ANS_MISSING", "Registro ANS da operadora ausente no rascunho.", "blocking", "tissSpSadtDraft.payer.ansRegistration", "payer"));
  }

  if (warnings.length === 0 && xml.includes("<technicalWarnings>")) {
    warnings.push(issue("TECHNICAL_WARNINGS_PRESENT", "O rascunho contém avisos técnicos para revisão.", "warning", "tissSpSadtDraft.technicalWarnings", "draft"));
  }
}

export function validateTissXmlDraft(xmlContent: string): TissXmlDraftValidationResult {
  const xml = text(xmlContent);
  const errors: TissXmlDraftValidationIssue[] = [];
  const warnings: TissXmlDraftValidationIssue[] = [];

  if (!xml) {
    errors.push(issue("XML_EMPTY", "O conteúdo XML está vazio.", "blocking", "xml"));
  } else {
    errors.push(...validateWellFormedXml(xml));
    const root = getRoot(xml);
    if (!root.name) {
      errors.push(issue("XML_ROOT_MISSING", "Raiz do XML não encontrada.", "blocking", "xml"));
    } else if (root.name === "vertoTissXmlDraft") {
      warnings.push(issue("VERTO_INTERNAL_LEGACY_DRAFT", "Este rascunho usa o formato interno legado da Verto.", "warning", "vertoTissXmlDraft", "draft"));
    } else if (root.name === "tissSpSadtDraft") {
      if (errors.length === 0) validateNewDraft(xml, root.attrs, errors, warnings);
    } else {
      errors.push(issue("XML_ROOT_UNSUPPORTED", "Raiz do XML não reconhecida para rascunho TISS da Verto.", "blocking", root.name, "draft"));
    }
  }

  warnings.push(issue(
    "TISS_XSD_VALIDATION_NOT_CONFIGURED",
    "Validação contra XSD oficial ainda não configurada.",
    "warning",
    "xsdValidation",
    "draft"
  ));

  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
    validatedAt: new Date().toISOString(),
    errors,
    warnings,
    xsdValidation: {
      status: "not_configured",
      message: "A validação contra XSD oficial ainda não está configurada.",
    },
  };
}
