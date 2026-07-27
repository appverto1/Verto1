export type TissAntiGlosaChecklistStatus = "ok" | "attention" | "blocking" | "not_applicable";
export type AntiGlosaSeverity = "info" | "warning" | "blocking";
export type AntiGlosaStatus = "ready_for_xml" | "low_risk" | "medium_risk" | "blocked";

export type TissAntiGlosaChecklistItem = {
  code: string;
  label: string;
  status: TissAntiGlosaChecklistStatus;
  riskClass: string;
  category?: string;
  relatedIssueCodes: string[];
  antiGlosaIssueCode?: string;
  severity?: AntiGlosaSeverity;
  title?: string;
  description?: string;
  fieldPath?: string;
  recommendedAction?: string;
  suggestedAction?: string;
};

export type AntiGlosaIssue = {
  code: string;
  severity: AntiGlosaSeverity;
  title: string;
  description: string;
  fieldPath?: string;
  recommendedAction?: string;
  preGuideId?: string | null;
};

export type AntiGlosaBatchIssue = AntiGlosaIssue & {
  guideNumber?: string | null;
  occurrenceCount?: number;
  preGuideIds?: string[];
  examples?: Array<{
    preGuideId?: string | null;
    patientName?: string | null;
    scheduledStart?: string | null;
  }>;
};

export type AntiGlosaBatchValidationResult = {
  antiGlosaStatus: AntiGlosaStatus;
  canGenerateXml: boolean;
  issues: AntiGlosaBatchIssue[];
  blockingIssuesCount: number;
  warningIssuesCount: number;
};

export type TissAntiGlosaChecklistResult = {
  status: "ready" | "pending" | "not_applicable";
  antiGlosaStatus: AntiGlosaStatus;
  canGenerateXml: boolean;
  issues: AntiGlosaIssue[];
  blockingCount: number;
  attentionCount: number;
  blockingIssuesCount: number;
  warningIssuesCount: number;
  okCount: number;
  notApplicableCount: number;
  items: TissAntiGlosaChecklistItem[];
};

const text = (value: unknown) => String(value ?? "").trim();

const ISSUE_TO_ITEM: Record<string, string> = {
  PAYER_TISS_PROFILE_MISSING: "payer_configured",
  PAYER_CONFIGURATION_INCOMPLETE: "payer_configured",
  PAYER_TISS_VERSION_MISSING: "payer_configured",
  PAYER_ANS_REGISTRATION_MISSING: "payer_configured",
  PAYER_CONTRACTED_PROVIDER_CODE_MISSING: "provider_code",
  PAYER_CID_REQUIRED: "payer_configured",
  BENEFICIARY_CARD_MISSING: "beneficiary_card",
  BENEFICIARY_CARD_VALIDITY_MISSING: "beneficiary_card_validity",
  BENEFICIARY_CARD_EXPIRED: "beneficiary_card_validity",
  PAYER_TUSS_MAPPING_MISSING: "procedure_tuss_mapping",
  PAYER_TUSS_MAPPING_EXPIRED: "procedure_tuss_mapping",
  PROCEDURE_MISSING: "procedure_tuss_mapping",
  TUSS_CODE_MISSING: "procedure_tuss_mapping",
  TUSS_DESCRIPTION_MISSING: "procedure_tuss_mapping",
  PROFESSIONAL_NOT_DEFINED: "professional_defined",
  PROFESSIONAL_MISSING: "professional_defined",
  PROFESSIONAL_BILLING_PROFILE_MISSING: "professional_registry",
  PROFESSIONAL_REGISTRY_MISSING: "professional_registry",
  PROFESSIONAL_COUNCIL_STATE_MISSING: "professional_registry",
  CBO_MISSING: "professional_cbo",
  PROVIDER_CODE_MISSING: "provider_code",
  CNES_MISSING: "provider_code",
  AUTHORIZATION_REQUIRED: "authorization_valid",
  AUTHORIZATION_MISSING: "authorization_valid",
  AUTHORIZATION_INACTIVE: "authorization_valid",
  AUTHORIZATION_NOT_STARTED: "authorization_valid",
  AUTHORIZATION_EXPIRED: "authorization_valid",
  AUTHORIZATION_EXHAUSTED: "authorization_valid",
  GUIDE_MISSING: "guide_number",
  AUTHORIZED_PROCEDURE_NOT_INFORMED: "authorization_procedure_match",
  AUTHORIZATION_PROCEDURE_MISMATCH: "authorization_procedure_match",
  RESPONSIBLE_SIGNATURE_REQUIRED: "responsible_signature",
  DURATION_MISSING: "actual_duration",
  AMOUNT_MISSING: "amount_calculated",
  PAYER_PROCEDURE_PRICE_MISSING: "amount_calculated",
  PAYER_PROCEDURE_PRICE_CONFLICT: "amount_calculated",
};

const ISSUE_CODE_MAP: Record<string, string> = {
  BENEFICIARY_CARD_MISSING: "MISSING_CARD_NUMBER",
  AUTHORIZATION_REQUIRED: "MISSING_AUTHORIZATION",
  AUTHORIZATION_MISSING: "MISSING_AUTHORIZATION",
  AUTHORIZATION_INACTIVE: "MISSING_AUTHORIZATION",
  AUTHORIZATION_NOT_STARTED: "AUTHORIZATION_NOT_STARTED",
  AUTHORIZATION_EXPIRED: "AUTHORIZATION_EXPIRED",
  AUTHORIZATION_EXHAUSTED: "AUTHORIZATION_INSUFFICIENT_BALANCE",
  GUIDE_MISSING: "MISSING_OPERATOR_GUIDE",
  AUTHORIZED_PROCEDURE_NOT_INFORMED: "MISSING_TUSS_MAPPING",
  AUTHORIZATION_PROCEDURE_MISMATCH: "MISSING_TUSS_MAPPING",
  PAYER_TUSS_MAPPING_MISSING: "MISSING_TUSS_MAPPING",
  PAYER_TUSS_MAPPING_EXPIRED: "MISSING_TUSS_MAPPING",
  TUSS_CODE_MISSING: "MISSING_TUSS_MAPPING",
  TUSS_DESCRIPTION_MISSING: "MISSING_TUSS_MAPPING",
  PAYER_PROCEDURE_PRICE_MISSING: "MISSING_NEGOTIATED_PRICE",
  AMOUNT_MISSING: "MISSING_NEGOTIATED_PRICE",
  PAYER_PROCEDURE_PRICE_CONFLICT: "PRICE_MISMATCH",
  PAYER_PROCEDURE_PRICE_UNRESOLVED_SNAPSHOT_PRESERVED: "PRICE_MISMATCH",
  PROVIDER_CODE_MISSING: "MISSING_PROVIDER_CODE",
  PAYER_CONTRACTED_PROVIDER_CODE_MISSING: "MISSING_PROVIDER_CODE",
  CNES_MISSING: "MISSING_CNES",
  PROFESSIONAL_BILLING_PROFILE_MISSING: "MISSING_PROFESSIONAL_COUNCIL",
  PROFESSIONAL_REGISTRY_MISSING: "MISSING_PROFESSIONAL_COUNCIL_NUMBER",
  PROFESSIONAL_COUNCIL_STATE_MISSING: "MISSING_PROFESSIONAL_COUNCIL_UF",
  CBO_MISSING: "MISSING_CBOS",
  PAYER_ATTENDANCE_TYPE_INVALID: "MISSING_CARE_TYPE",
  PAYER_ATTENDANCE_REGIME_INVALID: "MISSING_ATTENDANCE_REGIME",
  PAYER_ATTENDANCE_CHARACTER_INVALID: "MISSING_ATTENDANCE_CHARACTER",
  RESPONSIBLE_SIGNATURE_REQUIRED: "OPERATOR_REQUIRES_SIGNATURE",
};

const ITEM_CODE_MAP: Record<string, string> = {
  beneficiary_card: "MISSING_CARD_NUMBER",
  procedure_tuss_mapping: "MISSING_TUSS_MAPPING",
  professional_registry: "MISSING_PROFESSIONAL_COUNCIL",
  professional_cbo: "MISSING_CBOS",
  provider_code: "MISSING_PROVIDER_CODE",
  authorization_valid: "MISSING_AUTHORIZATION",
  guide_number: "MISSING_OPERATOR_GUIDE",
  authorization_password: "MISSING_AUTHORIZATION_PASSWORD",
  responsible_signature: "OPERATOR_REQUIRES_SIGNATURE",
  physical_guide_printed: "OPERATOR_REQUIRES_ATTACHMENT",
  physical_guide_signed: "OPERATOR_REQUIRES_SIGNATURE",
  physical_guide_stamped: "OPERATOR_SPECIFIC_RULE",
  clinical_report_linked: "OPERATOR_REQUIRES_REPORT",
  amount_calculated: "MISSING_NEGOTIATED_PRICE",
  authorization_procedure_match: "MISSING_TUSS_MAPPING",
};

const ITEM_CATEGORY_MAP: Record<string, string> = {
  payer_configured: "payer",
  beneficiary_card: "beneficiary",
  beneficiary_card_validity: "beneficiary",
  procedure_tuss_mapping: "procedure",
  professional_defined: "professional",
  professional_registry: "professional",
  professional_cbo: "professional",
  provider_code: "provider",
  authorization_valid: "authorization",
  guide_number: "authorization",
  authorization_password: "authorization",
  authorization_procedure_match: "authorization",
  responsible_signature: "execution",
  actual_duration: "execution",
  amount_calculated: "amount",
  physical_guide_printed: "physical_documents",
  physical_guide_signed: "physical_documents",
  physical_guide_stamped: "physical_documents",
  clinical_report_linked: "physical_documents",
};

const ISSUE_TITLES: Record<string, string> = {
  MISSING_CARD_NUMBER: "Carteirinha ausente",
  MISSING_AUTHORIZATION: "Autorização obrigatória ausente",
  MISSING_AUTHORIZATION_PASSWORD: "Senha obrigatória ausente",
  MISSING_OPERATOR_GUIDE: "Guia da operadora ausente",
  AUTHORIZATION_EXPIRED: "Autorização vencida para a data da sessão",
  AUTHORIZATION_NOT_STARTED: "Autorização ainda não vigente na data da sessão",
  AUTHORIZATION_INSUFFICIENT_BALANCE: "Quantidade autorizada insuficiente",
  MISSING_NEGOTIATED_PRICE: "Valor negociado ausente",
  PRICE_MISMATCH: "Valor da sessão diferente do valor contratado",
  MISSING_TUSS_MAPPING: "TUSS sem De/Para ativo",
  LEGACY_OR_INVALID_TUSS_CODE: "Código TUSS legado/inadequado para XML",
  MISSING_PROVIDER_CODE: "Código do prestador na operadora ausente",
  MISSING_CNES: "Clínica sem CNES",
  MISSING_PROFESSIONAL_COUNCIL: "Profissional sem conselho",
  MISSING_PROFESSIONAL_COUNCIL_NUMBER: "Profissional sem número do conselho",
  MISSING_PROFESSIONAL_COUNCIL_UF: "Profissional sem UF do conselho",
  MISSING_CBOS: "Profissional sem CBOS",
  MISSING_CARE_TYPE: "Tipo de atendimento ausente",
  MISSING_ATTENDANCE_REGIME: "Regime de atendimento ausente",
  MISSING_ATTENDANCE_CHARACTER: "Caráter de atendimento ausente",
  MISSING_ACCIDENT_INDICATION: "Indicação de acidente ausente",
  OPERATOR_REQUIRES_ATTACHMENT: "Operadora exige anexo antes do envio",
  OPERATOR_REQUIRES_REPORT: "Operadora exige relatório antes do envio",
  OPERATOR_REQUIRES_SIGNATURE: "Operadora exige assinatura antes do envio",
  OPERATOR_ANTI_GLOSA_PROFILE_NOT_REVIEWED: "Exigências da operadora ainda não revisadas",
  DUPLICATED_PROVIDER_GUIDE_NUMBER_IN_BATCH: "Número de guia repetido no lote",
  OPERATOR_SPECIFIC_RULE: "Regra específica da operadora",
};

const ISSUE_ACTIONS: Record<string, string> = {
  MISSING_CARD_NUMBER: "Corrija a carteirinha na aba Convênio e elegibilidade do paciente.",
  MISSING_AUTHORIZATION: "Abra Autorizações TISS do paciente e cadastre uma autorização vigente.",
  MISSING_AUTHORIZATION_PASSWORD: "Informe a senha/autorização na autorização TISS do paciente.",
  MISSING_OPERATOR_GUIDE: "Informe o número da guia na autorização ou no pagador da sessão.",
  AUTHORIZATION_EXPIRED: "Atualize a validade ou cadastre uma nova autorização vigente.",
  AUTHORIZATION_NOT_STARTED: "Use uma autorização vigente na data da sessão.",
  AUTHORIZATION_INSUFFICIENT_BALANCE: "Atualize o saldo ou cadastre nova autorização antes do XML.",
  MISSING_NEGOTIATED_PRICE: "Cadastre o valor negociado ativo em Convênios e TISS > Tabela de valores.",
  PRICE_MISMATCH: "Confira o valor contratado e revalide a Pré-guia.",
  MISSING_TUSS_MAPPING: "Revise o De/Para TUSS ativo do convênio antes do XML.",
  LEGACY_OR_INVALID_TUSS_CODE: "Revise o De/Para TUSS do convênio e use o código ativo adequado.",
  MISSING_PROVIDER_CODE: "Informe o código do prestador no perfil TISS da operadora.",
  MISSING_CNES: "Informe o CNES nos dados TISS da clínica.",
  MISSING_PROFESSIONAL_COUNCIL: "Complete o perfil faturável do profissional.",
  MISSING_PROFESSIONAL_COUNCIL_NUMBER: "Informe o número do conselho do profissional.",
  MISSING_PROFESSIONAL_COUNCIL_UF: "Informe a UF do conselho do profissional.",
  MISSING_CBOS: "Informe o CBOS no perfil faturável do profissional.",
  MISSING_CARE_TYPE: "Configure o tipo de atendimento TISS da operadora.",
  MISSING_ATTENDANCE_REGIME: "Configure o regime de atendimento TISS da operadora.",
  MISSING_ATTENDANCE_CHARACTER: "Configure o caráter de atendimento TISS da operadora.",
  OPERATOR_REQUIRES_ATTACHMENT: "Anexe ou confira a documentação exigida pela operadora.",
  OPERATOR_REQUIRES_REPORT: "Vincule o relatório/evolução exigido pela operadora.",
  OPERATOR_REQUIRES_SIGNATURE: "Colete ou confira a assinatura exigida pela operadora.",
  OPERATOR_ANTI_GLOSA_PROFILE_NOT_REVIEWED: "Abra Convênios e TISS > Exigências anti-glosa da operadora e marque as exigências reais ou confirme que não há exigências adicionais.",
  DUPLICATED_PROVIDER_GUIDE_NUMBER_IN_BATCH: "Confirme se a operadora aceita repetir o número da guia para sessões da mesma autorização. Se não aceitar, informe números de guia distintos antes de gerar o XML.",
  OPERATOR_SPECIFIC_RULE: "Confira as regras específicas cadastradas para esta operadora.",
};

const LEGACY_TUSS_CODES = new Set(["10101012", "TESTE-ABA"]);

const CATALOG: Array<Omit<TissAntiGlosaChecklistItem, "status" | "relatedIssueCodes"> & {
  requirementPath?: string;
  okWhen?: (snapshot: Record<string, any>) => boolean;
  notApplicableWhen?: (snapshot: Record<string, any>) => boolean;
}> = [
  {
    code: "payer_configured",
    label: "Dados do pagador configurados",
    riskClass: "risco de glosa administrativa",
    suggestedAction: "Configurar convênio",
    okWhen: (snapshot) => Boolean(snapshot.payer?.profileId && snapshot.payer?.ansRegistration),
  },
  {
    code: "beneficiary_card",
    label: "Carteirinha informada",
    riskClass: "risco de identificação do beneficiário",
    suggestedAction: "Corrigir paciente",
    requirementPath: "requiresBeneficiaryCard",
    okWhen: (snapshot) => Boolean(snapshot.beneficiary?.cardNumber),
  },
  {
    code: "beneficiary_card_validity",
    label: "Validade da carteirinha válida",
    riskClass: "risco de elegibilidade vencida",
    suggestedAction: "Corrigir paciente",
    requirementPath: "requiresBeneficiaryCardValidity",
    okWhen: (snapshot) => Boolean(snapshot.beneficiary?.cardValidUntil),
  },
  {
    code: "procedure_tuss_mapping",
    label: "Procedimento TUSS mapeado",
    riskClass: "risco de procedimento sem De/Para",
    suggestedAction: "Configurar convênio",
    okWhen: (snapshot) => Boolean(snapshot.procedure?.tussCode && snapshot.procedure?.name),
  },
  {
    code: "professional_defined",
    label: "Profissional executante informado",
    riskClass: "risco de executante não identificado",
    suggestedAction: "Vincular profissional ao atendimento",
    okWhen: (snapshot) => Boolean(snapshot.professional?.id && snapshot.professional?.name),
  },
  {
    code: "professional_registry",
    label: "Conselho profissional informado",
    riskClass: "risco de identificação profissional",
    suggestedAction: "Editar perfil faturável do profissional",
    requirementPath: "requiresExecutantRegistry",
    okWhen: (snapshot) => Boolean(snapshot.professional?.councilType && snapshot.professional?.councilNumber && snapshot.professional?.councilState),
  },
  {
    code: "professional_cbo",
    label: "CBO informado",
    riskClass: "risco de CBO ausente",
    suggestedAction: "Editar perfil faturável do profissional",
    requirementPath: "requiresCbo",
    okWhen: (snapshot) => Boolean(snapshot.professional?.cboCode),
  },
  {
    code: "provider_code",
    label: "Código/CNES do prestador informado quando exigido",
    riskClass: "risco de identificação do prestador",
    suggestedAction: "Editar Dados da clínica",
    okWhen: (snapshot) => Boolean(snapshot.provider?.providerCode || snapshot.provider?.cnesCode),
  },
  {
    code: "authorization_valid",
    label: "Autorização válida",
    riskClass: "risco de negativa por autorização",
    suggestedAction: "Adicionar autorização",
    requirementPath: "requiresAuthorization",
    okWhen: (snapshot) => Boolean(snapshot.authorization?.authorizationId && snapshot.authorization?.authorizationCode),
  },
  {
    code: "guide_number",
    label: "Número da guia informado",
    riskClass: "risco de guia ausente",
    suggestedAction: "Atualizar autorização",
    requirementPath: "requiresGuideNumber",
    okWhen: (snapshot) => Boolean(snapshot.authorization?.guideNumber),
  },
  {
    code: "authorization_password",
    label: "Senha/autorização informada",
    riskClass: "risco de senha de autorização ausente",
    suggestedAction: "Atualizar autorização",
    requirementPath: "requiresAuthorizationPassword",
    okWhen: (snapshot) => Boolean(snapshot.authorization?.authorizationCode),
  },
  {
    code: "responsible_signature",
    label: "Assinatura do responsável coletada",
    riskClass: "risco de glosa administrativa por assinatura",
    suggestedAction: "Coletar assinatura",
    requirementPath: "requiresResponsibleSignature",
    okWhen: (snapshot) => Boolean(snapshot.signature?.present),
  },
  {
    code: "physical_guide_printed",
    label: "Guia física impressa",
    riskClass: "risco operacional de documentação física",
    suggestedAction: "Conferir guia física",
    requirementPath: "requiresPhysicalGuide",
  },
  {
    code: "physical_guide_signed",
    label: "Guia física assinada",
    riskClass: "risco operacional de assinatura física",
    suggestedAction: "Conferir guia assinada",
    requirementPath: "requiresSignedGuide",
  },
  {
    code: "physical_guide_stamped",
    label: "Guia carimbada/datada",
    riskClass: "risco operacional de carimbo/data",
    suggestedAction: "Conferir guia carimbada/datada",
    requirementPath: "requiresStampedDatedGuide",
  },
  {
    code: "clinical_report_linked",
    label: "Evolução/relatório vinculado",
    riskClass: "risco de documentação assistencial ausente",
    suggestedAction: "Vincular relatório/evolução",
    requirementPath: "requiresReport",
  },
  {
    code: "actual_duration",
    label: "Duração real preenchida",
    riskClass: "risco de divergência operacional",
    suggestedAction: "Corrigir duração do atendimento",
    okWhen: (snapshot) => Number(snapshot.appointment?.durationMinutes || 0) > 0,
  },
  {
    code: "amount_calculated",
    label: "Valor calculado",
    riskClass: "risco de faturamento sem valor",
    suggestedAction: "Revalidar procedimento/TUSS",
    okWhen: (snapshot) => Number(snapshot.procedure?.totalAmountCents || 0) > 0,
  },
  {
    code: "authorization_procedure_match",
    label: "Sem divergência de procedimento autorizado",
    riskClass: "risco de procedimento divergente",
    suggestedAction: "Revisar autorização",
    okWhen: (snapshot) => {
      const authorizedTuss = text(snapshot.authorization?.procedureTussCode);
      const expectedAuthorizedTuss = text(
        snapshot.authorization?.expectedAuthorizedTussCode ||
          snapshot.procedure?.authorizedCode ||
          snapshot.procedure?.officialTussCode ||
          snapshot.procedure?.tussCode,
      );
      return !authorizedTuss || !expectedAuthorizedTuss || authorizedTuss === expectedAuthorizedTuss;
    },
  },
];

function requirements(snapshot: Record<string, any>) {
  return snapshot.payer?.requirements || {};
}

const booleanRequirement = (snapshot: Record<string, any>, camelKey: string, snakeKey?: string) => {
  const payerRequirements = requirements(snapshot);
  return Boolean(
    payerRequirements[camelKey] ??
      (snakeKey ? payerRequirements[snakeKey] : undefined) ??
      snapshot.payer?.[camelKey] ??
      (snakeKey ? snapshot.payer?.[snakeKey] : undefined),
  );
};

const hasInsurancePayerContext = (snapshot: Record<string, any>) =>
  Boolean(snapshot.payer?.id || snapshot.payer?.profileId || snapshot.payer?.name);

const hasReviewedAntiGlosaProfile = (snapshot: Record<string, any>) =>
  booleanRequirement(snapshot, "antiGlosaReviewed", "anti_glosa_reviewed") ||
  booleanRequirement(snapshot, "operatorHasNoAdditionalRequirements", "operator_has_no_additional_requirements");

function isRequired(snapshot: Record<string, any>, requirementPath?: string) {
  if (!requirementPath) return true;
  return Boolean(requirements(snapshot)[requirementPath]);
}

const normalize = (value: unknown) =>
  text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || text(value) === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const antiGlosaTitle = (code: string) => ISSUE_TITLES[code] || code;

const addIssue = (issues: AntiGlosaIssue[], issue: AntiGlosaIssue) => {
  if (issues.some((item) => item.code === issue.code && item.fieldPath === issue.fieldPath)) return;
  issues.push(issue);
};

const isAbaLikePreGuide = (snapshot: Record<string, any>) => {
  const haystack = [
    snapshot.procedure?.internalCode,
    snapshot.procedure?.name,
    snapshot.procedure?.specialty,
    snapshot.authorization?.procedureCode,
    snapshot.authorization?.procedureName,
  ].map(normalize).join("_");
  return haystack.includes("ABA");
};

const dateOnly = (value: unknown) => text(value).slice(0, 10);

function addUniversalTissBillingIssues(params: {
  issues: AntiGlosaIssue[];
  snapshot: Record<string, any>;
  preGuideId?: string | null;
}) {
  const { issues, snapshot } = params;
  if (!hasInsurancePayerContext(snapshot)) return;
  const preGuideId = params.preGuideId || null;
  const scheduledStart = text(snapshot.appointment?.scheduledStart);
  const authorization = snapshot.authorization || {};
  const hasAuthorizationContext = Boolean(
    text(authorization.authorizationId) ||
      text(authorization.authorizationCode) ||
      text(authorization.guideNumber) ||
      text(authorization.authorizationValidFrom) ||
      text(authorization.authorizationValidUntil),
  );
  const addBlocking = (code: string, description: string, fieldPath: string) => addIssue(issues, {
    code,
    severity: "blocking",
    title: antiGlosaTitle(code),
    description,
    fieldPath,
    recommendedAction: ISSUE_ACTIONS[code],
    preGuideId,
  });

  if (!text(snapshot.beneficiary?.cardNumber)) {
    addBlocking("MISSING_CARD_NUMBER", "Atendimento de convênio precisa identificar a carteirinha do beneficiário.", "beneficiary_card");
  }
  if (!text(snapshot.procedure?.tussCode) || !text(snapshot.procedure?.name)) {
    addBlocking("MISSING_TUSS_MAPPING", "Pré-guia de convênio precisa de procedimento TUSS oficial resolvido por De/Para.", "procedure_tuss_mapping");
  }
  if (!numberOrNull(snapshot.procedure?.totalAmountCents) || Number(snapshot.procedure?.totalAmountCents || 0) <= 0) {
    addBlocking("MISSING_NEGOTIATED_PRICE", "Pré-guia de convênio precisa de valor negociado positivo antes do XML.", "amount_calculated");
  }
  if (!text(snapshot.provider?.providerCode) && !text(snapshot.payer?.contractedProviderCode) && !text(snapshot.payer?.operatorProviderCode)) {
    addBlocking("MISSING_PROVIDER_CODE", "Código do prestador/contratado na operadora precisa estar configurado.", "provider_code");
  }
  if (!text(snapshot.provider?.cnesCode)) {
    addBlocking("MISSING_CNES", "CNES do prestador precisa estar configurado para a conferência TISS.", "provider_code");
  }
  if (!text(snapshot.professional?.councilType)) {
    addBlocking("MISSING_PROFESSIONAL_COUNCIL", "Profissional executante precisa de conselho informado.", "professional_registry");
  }
  if (!text(snapshot.professional?.councilNumber)) {
    addBlocking("MISSING_PROFESSIONAL_COUNCIL_NUMBER", "Profissional executante precisa de número do conselho informado.", "professional_registry");
  }
  if (!text(snapshot.professional?.councilState)) {
    addBlocking("MISSING_PROFESSIONAL_COUNCIL_UF", "Profissional executante precisa de UF do conselho informada.", "professional_registry");
  }
  if (!text(snapshot.professional?.cboCode)) {
    addBlocking("MISSING_CBOS", "Profissional executante precisa de CBOS informado.", "professional_cbo");
  }
  if (hasAuthorizationContext && !text(authorization.authorizationCode)) {
    addBlocking("MISSING_AUTHORIZATION", "Autorização vinculada sem senha/código informado.", "authorization_valid");
  }
  if (hasAuthorizationContext && !text(authorization.guideNumber)) {
    addBlocking("MISSING_OPERATOR_GUIDE", "Autorização vinculada sem número de guia informado.", "guide_number");
  }
  if (text(authorization.authorizationValidFrom) && scheduledStart && dateOnly(authorization.authorizationValidFrom) > dateOnly(scheduledStart)) {
    addBlocking("AUTHORIZATION_NOT_STARTED", "Autorização ainda não estava vigente na data da sessão.", "authorization_valid");
  }
  if (text(authorization.authorizationValidUntil) && scheduledStart && dateOnly(authorization.authorizationValidUntil) < dateOnly(scheduledStart)) {
    addBlocking("AUTHORIZATION_EXPIRED", "Autorização estava vencida na data da sessão.", "authorization_valid");
  }
  const authorizedQuantity = numberOrNull(authorization.authorizedQuantity);
  const usedQuantity = numberOrNull(authorization.usedQuantity);
  if (authorizedQuantity !== null && authorizedQuantity > 0 && usedQuantity !== null && usedQuantity >= authorizedQuantity) {
    addBlocking("AUTHORIZATION_INSUFFICIENT_BALANCE", "Quantidade autorizada já foi consumida.", "authorization_valid");
  }
}

function summarizeAntiGlosaChecklist(params: {
  checklist: Partial<TissAntiGlosaChecklistResult>;
  snapshot?: Record<string, any> | null;
  preGuideId?: string | null;
}) {
  const snapshot = params.snapshot || {};
  const issues: AntiGlosaIssue[] = [];
  const items = Array.isArray(params.checklist.items) ? params.checklist.items : [];
  for (const item of items) {
    const itemStatus = text(item.status);
    if (!["blocking", "attention"].includes(itemStatus)) continue;
    const relatedCodes = Array.isArray(item.relatedIssueCodes) ? item.relatedIssueCodes.map(normalize).filter(Boolean) : [];
    const code = relatedCodes.map((related) => ISSUE_CODE_MAP[related]).find(Boolean) || ITEM_CODE_MAP[item.code] || "OPERATOR_SPECIFIC_RULE";
    const severity: AntiGlosaSeverity = itemStatus === "blocking" ? "blocking" : "warning";
    addIssue(issues, {
      code,
      severity,
      title: antiGlosaTitle(code),
      description: item.riskClass || "Risco operacional de glosa identificado antes da geração do XML oficial.",
      fieldPath: item.code,
      recommendedAction: item.suggestedAction || ISSUE_ACTIONS[code],
      preGuideId: params.preGuideId || null,
    });
  }

  addUniversalTissBillingIssues({ issues, snapshot, preGuideId: params.preGuideId || null });

  const tussCode = text(snapshot.procedure?.tussCode).toUpperCase();
  if (LEGACY_TUSS_CODES.has(tussCode) && isAbaLikePreGuide(snapshot)) {
    addIssue(issues, {
      code: "LEGACY_OR_INVALID_TUSS_CODE",
      severity: "blocking",
      title: antiGlosaTitle("LEGACY_OR_INVALID_TUSS_CODE"),
      description: "Este código TUSS parece legado ou inadequado para o XML atual.",
      fieldPath: "procedure.tussCode",
      recommendedAction: ISSUE_ACTIONS.LEGACY_OR_INVALID_TUSS_CODE,
      preGuideId: params.preGuideId || null,
    });
  }

  const negotiated = numberOrNull(snapshot.procedure?.payerNegotiatedAmountCents);
  const unitAmount = numberOrNull(snapshot.procedure?.unitAmountCents);
  const totalAmount = numberOrNull(snapshot.procedure?.totalAmountCents);
  const quantity = numberOrNull(snapshot.procedure?.quantity) || 1;
  if (negotiated !== null && unitAmount !== null && negotiated > 0 && unitAmount > 0 && negotiated !== unitAmount) {
    addIssue(issues, {
      code: "PRICE_MISMATCH",
      severity: "warning",
      title: antiGlosaTitle("PRICE_MISMATCH"),
      description: "O valor unitário da sessão não confere com o valor negociado ativo.",
      fieldPath: "procedure.unitAmountCents",
      recommendedAction: ISSUE_ACTIONS.PRICE_MISMATCH,
      preGuideId: params.preGuideId || null,
    });
  }
  if (negotiated !== null && totalAmount !== null && negotiated > 0 && totalAmount > 0 && negotiated * quantity !== totalAmount) {
    addIssue(issues, {
      code: "PRICE_MISMATCH",
      severity: "warning",
      title: antiGlosaTitle("PRICE_MISMATCH"),
      description: "O total da sessão não confere com quantidade e valor negociado ativo.",
      fieldPath: "procedure.totalAmountCents",
      recommendedAction: ISSUE_ACTIONS.PRICE_MISMATCH,
      preGuideId: params.preGuideId || null,
    });
  }

  if (hasInsurancePayerContext(snapshot) && !hasReviewedAntiGlosaProfile(snapshot)) {
    addIssue(issues, {
      code: "OPERATOR_ANTI_GLOSA_PROFILE_NOT_REVIEWED",
      severity: "warning",
      title: antiGlosaTitle("OPERATOR_ANTI_GLOSA_PROFILE_NOT_REVIEWED"),
      description: "Revise o contrato ou portal da operadora e confirme as exigências anti-glosa para reduzir risco de glosa.",
      fieldPath: "payer.requirements.antiGlosaReviewed",
      recommendedAction: ISSUE_ACTIONS.OPERATOR_ANTI_GLOSA_PROFILE_NOT_REVIEWED,
      preGuideId: params.preGuideId || null,
    });
  }

  const blockingIssuesCount = issues.filter((issue) => issue.severity === "blocking").length;
  const warningIssuesCount = issues.filter((issue) => issue.severity === "warning").length;
  const infoCount = issues.filter((issue) => issue.severity === "info").length;
  const antiGlosaStatus: AntiGlosaStatus = blockingIssuesCount > 0
    ? "blocked"
    : warningIssuesCount > 0
      ? "medium_risk"
      : infoCount > 0
        ? "low_risk"
        : "ready_for_xml";
  return {
    antiGlosaStatus,
    canGenerateXml: blockingIssuesCount === 0,
    issues,
    blockingIssuesCount,
    warningIssuesCount,
  };
}

export function validateAntiGlosaForPreGuide(input: {
  preGuide?: Record<string, any> | null;
  status?: string | null;
  errors?: Array<{ code?: string; severity?: string }> | null;
  warnings?: Array<{ code?: string; severity?: string }> | null;
  errorCodes?: string[] | null;
  warningCodes?: string[] | null;
  snapshot?: Record<string, any> | null;
  antiGlosaChecklist?: Partial<TissAntiGlosaChecklistResult> | null;
}): Pick<TissAntiGlosaChecklistResult, "antiGlosaStatus" | "canGenerateXml" | "issues" | "blockingIssuesCount" | "warningIssuesCount"> {
  const preGuide = input.preGuide || {};
  const snapshot = input.snapshot || preGuide.snapshot || preGuide.snapshot_data || {};
  const preGuideId = text(preGuide.id || preGuide.preGuideId || preGuide.pre_guide_id) || null;
  const checklist = input.antiGlosaChecklist || preGuide.antiGlosaChecklist || preGuide.anti_glosa_checklist || snapshot.antiGlosaChecklist || buildTissAntiGlosaChecklist({
    status: input.status || preGuide.status,
    errors: input.errors || preGuide.validationErrors || preGuide.validation_errors,
    warnings: input.warnings || preGuide.validationWarnings || preGuide.validation_warnings,
    errorCodes: input.errorCodes || preGuide.validationErrorCodes || preGuide.validation_error_codes,
    warningCodes: input.warningCodes || preGuide.validationWarningCodes || preGuide.validation_warning_codes,
    snapshot,
  });
  return summarizeAntiGlosaChecklist({ checklist, snapshot, preGuideId });
}

const firstTextValue = (...values: unknown[]) => values.map(text).find(Boolean) || "";

const normalizedGuideKey = (value: unknown) => text(value).replace(/\s+/g, " ").toUpperCase();

const truthyConfigValue = (value: unknown) => {
  if (value === true) return true;
  const normalized = text(value).toLowerCase();
  return ["1", "true", "yes", "sim"].includes(normalized);
};

const batchPreGuideSnapshot = (preGuide: Record<string, any>) => (
  preGuide.snapshot || preGuide.snapshot_data || {}
);

const batchProviderGuideNumber = (preGuide: Record<string, any>) => {
  const snapshot = batchPreGuideSnapshot(preGuide);
  return firstTextValue(
    preGuide.providerGuideNumber,
    preGuide.provider_guide_number,
    preGuide.guideNumber,
    preGuide.guide_number,
    snapshot.authorization?.providerGuideNumber,
    snapshot.authorization?.provider_guide_number,
    snapshot.authorization?.guideNumber,
    snapshot.authorization?.guide_number,
    snapshot.guide?.providerGuideNumber,
    snapshot.guide?.provider_guide_number,
    snapshot.guide?.number,
  );
};

const payerAllowsRepeatedGuideNumber = (preGuide: Record<string, any>) => {
  const snapshot = batchPreGuideSnapshot(preGuide);
  const requirements = snapshot.payer?.requirements || snapshot.payerRequirements || snapshot.payer_requirements || {};
  return truthyConfigValue(requirements.operatorAllowsRepeatedGuideNumberForSameAuthorization) ||
    truthyConfigValue(requirements.operator_allows_repeated_guide_number_for_same_authorization) ||
    truthyConfigValue(requirements.allowsRepeatedGuideNumberForSameAuthorization) ||
    truthyConfigValue(requirements.allows_repeated_guide_number_for_same_authorization);
};

export function validateAntiGlosaBatchForOfficialXml(input: {
  preGuides?: Array<Record<string, any>> | null;
  operatorAllowsRepeatedGuideNumberForSameAuthorization?: boolean | null;
}): AntiGlosaBatchValidationResult {
  const preGuides = Array.isArray(input.preGuides) ? input.preGuides : [];
  const allowsRepeatedGuideNumber = input.operatorAllowsRepeatedGuideNumberForSameAuthorization === true ||
    preGuides.some(payerAllowsRepeatedGuideNumber);
  if (allowsRepeatedGuideNumber || preGuides.length < 2) {
    return {
      antiGlosaStatus: "ready_for_xml",
      canGenerateXml: true,
      issues: [],
      blockingIssuesCount: 0,
      warningIssuesCount: 0,
    };
  }

  const byProviderGuideNumber = new Map<string, Array<Record<string, any>>>();
  const originalGuideNumbers = new Map<string, string>();
  for (const preGuide of preGuides) {
    const guideNumber = batchProviderGuideNumber(preGuide);
    const key = normalizedGuideKey(guideNumber);
    if (!key) continue;
    originalGuideNumbers.set(key, guideNumber);
    const grouped = byProviderGuideNumber.get(key) || [];
    grouped.push(preGuide);
    byProviderGuideNumber.set(key, grouped);
  }

  const issues: AntiGlosaBatchIssue[] = [];
  for (const [key, repeatedPreGuides] of byProviderGuideNumber.entries()) {
    if (repeatedPreGuides.length < 2) continue;
    const guideNumber = originalGuideNumbers.get(key) || key;
    issues.push({
      code: "DUPLICATED_PROVIDER_GUIDE_NUMBER_IN_BATCH",
      severity: "warning",
      title: antiGlosaTitle("DUPLICATED_PROVIDER_GUIDE_NUMBER_IN_BATCH"),
      description: "Há mais de uma guia SP/SADT no mesmo lote usando o mesmo número de guia do prestador. Algumas operadoras exigem numeração única por guia, mesmo quando a senha/autorização cobre várias sessões.",
      recommendedAction: ISSUE_ACTIONS.DUPLICATED_PROVIDER_GUIDE_NUMBER_IN_BATCH,
      guideNumber,
      occurrenceCount: repeatedPreGuides.length,
      preGuideIds: repeatedPreGuides.map((item) => text(item.id || item.preGuideId || item.pre_guide_id)).filter(Boolean),
      examples: repeatedPreGuides.slice(0, 5).map((item) => ({
        preGuideId: text(item.id || item.preGuideId || item.pre_guide_id) || null,
        patientName: firstTextValue(item.patientName, item.patient_name, batchPreGuideSnapshot(item).beneficiary?.name) || null,
        scheduledStart: firstTextValue(item.scheduledStart, item.scheduled_start, item.scheduled_start_at, batchPreGuideSnapshot(item).appointment?.scheduledStart) || null,
      })),
    });
  }

  return {
    antiGlosaStatus: issues.length > 0 ? "medium_risk" : "ready_for_xml",
    canGenerateXml: true,
    issues,
    blockingIssuesCount: 0,
    warningIssuesCount: issues.length,
  };
}

export function buildTissAntiGlosaChecklist(input: {
  status?: string | null;
  errors?: Array<{ code?: string; severity?: string }> | null;
  warnings?: Array<{ code?: string; severity?: string }> | null;
  errorCodes?: string[] | null;
  warningCodes?: string[] | null;
  snapshot?: Record<string, any> | null;
}): TissAntiGlosaChecklistResult {
  const status = text(input.status).toLowerCase();
  if (status === "not_applicable") {
    const items = CATALOG.map((item) => ({
      code: item.code,
      label: item.label,
      riskClass: item.riskClass,
      category: ITEM_CATEGORY_MAP[item.code] || "operational",
      suggestedAction: item.suggestedAction,
      status: "not_applicable" as const,
      relatedIssueCodes: [],
    }));
    return {
      status: "not_applicable",
      antiGlosaStatus: "ready_for_xml",
      canGenerateXml: false,
      issues: [],
      blockingCount: 0,
      attentionCount: 0,
      blockingIssuesCount: 0,
      warningIssuesCount: 0,
      okCount: 0,
      notApplicableCount: items.length,
      items,
    };
  }

  const snapshot = input.snapshot || {};
  const codes = [
    ...(Array.isArray(input.errorCodes) ? input.errorCodes : []),
    ...(Array.isArray(input.warningCodes) ? input.warningCodes : []),
    ...(Array.isArray(input.errors) ? input.errors.map((item) => item.code) : []),
    ...(Array.isArray(input.warnings) ? input.warnings.map((item) => item.code) : []),
  ].map((code) => text(code)).filter(Boolean);

  const relatedByItem = new Map<string, string[]>();
  for (const code of codes) {
    const itemCode = ISSUE_TO_ITEM[code];
    if (!itemCode) continue;
    const related = relatedByItem.get(itemCode) || [];
    if (!related.includes(code)) related.push(code);
    relatedByItem.set(itemCode, related);
  }

  const items = CATALOG.map((item) => {
    const relatedIssueCodes = relatedByItem.get(item.code) || [];
    if (!isRequired(snapshot, item.requirementPath)) {
      return {
        code: item.code,
        label: item.label,
        riskClass: item.riskClass,
        category: ITEM_CATEGORY_MAP[item.code] || "operational",
        suggestedAction: item.suggestedAction,
        status: "not_applicable" as const,
        relatedIssueCodes,
      };
    }
    if (relatedIssueCodes.length > 0) {
      return {
        code: item.code,
        label: item.label,
        riskClass: item.riskClass,
        category: ITEM_CATEGORY_MAP[item.code] || "operational",
        suggestedAction: item.suggestedAction,
        status: "blocking" as const,
        relatedIssueCodes,
      };
    }
    if (item.okWhen && item.okWhen(snapshot)) {
      return {
        code: item.code,
        label: item.label,
        riskClass: item.riskClass,
        category: ITEM_CATEGORY_MAP[item.code] || "operational",
        suggestedAction: item.suggestedAction,
        status: "ok" as const,
        relatedIssueCodes,
      };
    }
    return {
      code: item.code,
      label: item.label,
      riskClass: item.riskClass,
      category: ITEM_CATEGORY_MAP[item.code] || "operational",
      suggestedAction: item.suggestedAction,
      status: item.requirementPath ? "blocking" as const : "attention" as const,
      relatedIssueCodes,
    };
  });

  const blockingCount = items.filter((item) => item.status === "blocking").length;
  const attentionCount = items.filter((item) => item.status === "attention").length;
  const okCount = items.filter((item) => item.status === "ok").length;
  const notApplicableCount = items.filter((item) => item.status === "not_applicable").length;
  const operational = summarizeAntiGlosaChecklist({ checklist: { items }, snapshot });
  return {
    status: blockingCount > 0 ? "pending" : "ready",
    antiGlosaStatus: operational.antiGlosaStatus,
    canGenerateXml: operational.canGenerateXml,
    issues: operational.issues,
    blockingCount,
    attentionCount,
    blockingIssuesCount: operational.blockingIssuesCount,
    warningIssuesCount: operational.warningIssuesCount,
    okCount,
    notApplicableCount,
    items,
  };
}
