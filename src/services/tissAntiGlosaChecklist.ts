export type TissAntiGlosaChecklistStatus = "ok" | "attention" | "blocking" | "not_applicable";

export type TissAntiGlosaChecklistItem = {
  code: string;
  label: string;
  status: TissAntiGlosaChecklistStatus;
  riskClass: string;
  relatedIssueCodes: string[];
  suggestedAction?: string;
};

export type TissAntiGlosaChecklistResult = {
  status: "ready" | "pending" | "not_applicable";
  blockingCount: number;
  attentionCount: number;
  okCount: number;
  notApplicableCount: number;
  items: TissAntiGlosaChecklistItem[];
};

const text = (value: unknown) => String(value ?? "").trim();

const ISSUE_TO_ITEM: Record<string, string> = {
  PAYER_TISS_PROFILE_MISSING: "payer_configured",
  PAYER_ANS_REGISTRATION_MISSING: "payer_configured",
  PAYER_CONTRACTED_PROVIDER_CODE_MISSING: "provider_code",
  PAYER_CID_REQUIRED: "payer_configured",
  BENEFICIARY_CARD_MISSING: "beneficiary_card",
  BENEFICIARY_CARD_VALIDITY_MISSING: "beneficiary_card_validity",
  BENEFICIARY_CARD_EXPIRED: "beneficiary_card_validity",
  PAYER_TUSS_MAPPING_MISSING: "procedure_tuss_mapping",
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
};

const CATALOG: Array<Omit<TissAntiGlosaChecklistItem, "status" | "relatedIssueCodes"> & {
  requirementPath?: string;
  okWhen?: (snapshot: Record<string, any>) => boolean;
  notApplicableWhen?: (snapshot: Record<string, any>) => boolean;
}> = [
  {
    code: "payer_configured",
    label: "Dados do pagador configurados",
    riskClass: "risco de glosa administrativa",
    suggestedAction: "Editar perfil TISS do pagador",
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
    suggestedAction: "Mapear TUSS do pagador",
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
    requirementPath: "requiresPhysicalGuidePrinted",
  },
  {
    code: "physical_guide_signed",
    label: "Guia física assinada",
    riskClass: "risco operacional de assinatura física",
    suggestedAction: "Conferir guia assinada",
    requirementPath: "requiresPhysicalGuideSigned",
  },
  {
    code: "physical_guide_stamped",
    label: "Guia carimbada/datada",
    riskClass: "risco operacional de carimbo/data",
    suggestedAction: "Conferir guia carimbada/datada",
    requirementPath: "requiresPhysicalGuideStamped",
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
      const tuss = text(snapshot.procedure?.tussCode);
      return !authorizedTuss || !tuss || authorizedTuss === tuss;
    },
  },
];

function requirements(snapshot: Record<string, any>) {
  return snapshot.payer?.requirements || {};
}

function isRequired(snapshot: Record<string, any>, requirementPath?: string) {
  if (!requirementPath) return true;
  return Boolean(requirements(snapshot)[requirementPath]);
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
      suggestedAction: item.suggestedAction,
      status: "not_applicable" as const,
      relatedIssueCodes: [],
    }));
    return {
      status: "not_applicable",
      blockingCount: 0,
      attentionCount: 0,
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
        suggestedAction: item.suggestedAction,
        status: "ok" as const,
        relatedIssueCodes,
      };
    }
    return {
      code: item.code,
      label: item.label,
      riskClass: item.riskClass,
      suggestedAction: item.suggestedAction,
      status: item.requirementPath ? "blocking" as const : "attention" as const,
      relatedIssueCodes,
    };
  });

  const blockingCount = items.filter((item) => item.status === "blocking").length;
  const attentionCount = items.filter((item) => item.status === "attention").length;
  const okCount = items.filter((item) => item.status === "ok").length;
  const notApplicableCount = items.filter((item) => item.status === "not_applicable").length;
  return {
    status: blockingCount > 0 ? "pending" : "ready",
    blockingCount,
    attentionCount,
    okCount,
    notApplicableCount,
    items,
  };
}
