export type PatientInsuranceEligibility = {
  insuranceType: string;
  insuranceName: string;
  insuranceCardNumber: string;
  insuranceCardValidUntil: string;
  insurancePlanCategory: string;
  insuranceHolderName: string;
  insuranceHolderCpf: string;
  insuranceHolderRelationship: string;
  insuranceEligibilityNotes: string;
  convenioTipo: string;
  convenioNome: string;
  convenioCarteirinha: string;
  convenioCarteirinhaValidade: string;
  convenioPlanoCategoria: string;
  convenioTitularNome: string;
  convenioTitularCpf: string;
  convenioTitularRelacao: string;
  convenioElegibilidadeObs: string;
  holderPrefilledFromResponsible: boolean;
};

type NormalizeOptions = {
  useResponsibleFallback?: boolean;
};

const asObject = (value: any) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const firstText = (...values: any[]) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
};

const normalizeInsuranceType = (value: string) => {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (['convenio', 'insurance', 'convênio'].includes(normalized)) return 'convenio';
  if (['particular', 'private'].includes(normalized)) return 'particular';
  return normalized || 'particular';
};

export function normalizePatientInsuranceEligibility(
  record: any,
  options: NormalizeOptions = {},
): PatientInsuranceEligibility {
  const root = asObject(record);
  const payload = asObject(root.payload);
  const rootAnamnese = asObject(root.anamnese);
  const payloadAnamnese = asObject(payload.anamnese);
  const anamnesisData = asObject(root.anamnesisData);
  const metadata = asObject(root.metadata);
  const guardian = {
    ...asObject(metadata.guardian),
    ...asObject(metadata.responsible),
    ...asObject(root.guardian),
    ...asObject(root.responsible),
    ...asObject(payload.guardian),
    ...asObject(payload.responsible),
    ...asObject(payloadAnamnese.guardian),
    ...asObject(anamnesisData.guardian),
  };

  const insuranceType = normalizeInsuranceType(firstText(
    root.insuranceType,
    root.convenioTipo,
    root.insurance_type,
    payload.insuranceType,
    payload.convenioTipo,
    payload.insurance_type,
    payloadAnamnese.insuranceType,
    payloadAnamnese.convenioTipo,
    rootAnamnese.insuranceType,
    rootAnamnese.convenioTipo,
    anamnesisData.insuranceType,
    anamnesisData.convenioTipo,
  ));

  const insuranceName = firstText(
    root.insuranceName,
    root.convenioNome,
    root.insurance_name,
    payload.insuranceName,
    payload.convenioNome,
    payload.insurance_name,
    payloadAnamnese.insuranceName,
    payloadAnamnese.convenioNome,
    rootAnamnese.insuranceName,
    rootAnamnese.convenioNome,
    anamnesisData.insuranceName,
    anamnesisData.convenioNome,
  );

  const insuranceCardNumber = firstText(
    root.insuranceCardNumber,
    root.convenioCarteirinha,
    root.cardNumber,
    root.insurance_card_number,
    payload.insuranceCardNumber,
    payload.convenioCarteirinha,
    payload.cardNumber,
    payload.insurance_card_number,
    payloadAnamnese.insuranceCardNumber,
    payloadAnamnese.convenioCarteirinha,
    payloadAnamnese.cardNumber,
    payloadAnamnese.insurance_card_number,
    rootAnamnese.insuranceCardNumber,
    rootAnamnese.convenioCarteirinha,
    anamnesisData.insuranceCardNumber,
    anamnesisData.convenioCarteirinha,
  );

  const insuranceCardValidUntil = firstText(
    root.insuranceCardValidUntil,
    root.convenioCarteirinhaValidade,
    root.insurance_card_valid_until,
    payload.insuranceCardValidUntil,
    payload.convenioCarteirinhaValidade,
    payload.insurance_card_valid_until,
    payloadAnamnese.insuranceCardValidUntil,
    payloadAnamnese.convenioCarteirinhaValidade,
    payloadAnamnese.insurance_card_valid_until,
    rootAnamnese.insuranceCardValidUntil,
    rootAnamnese.convenioCarteirinhaValidade,
    anamnesisData.insuranceCardValidUntil,
    anamnesisData.convenioCarteirinhaValidade,
  );

  const insurancePlanCategory = firstText(
    root.insurancePlanCategory,
    root.convenioPlanoCategoria,
    root.insurance_plan_category,
    payload.insurancePlanCategory,
    payload.convenioPlanoCategoria,
    payload.insurance_plan_category,
    payloadAnamnese.insurancePlanCategory,
    payloadAnamnese.convenioPlanoCategoria,
    payloadAnamnese.insurance_plan_category,
    rootAnamnese.insurancePlanCategory,
    rootAnamnese.convenioPlanoCategoria,
    anamnesisData.insurancePlanCategory,
    anamnesisData.convenioPlanoCategoria,
  );

  const responsibleName = firstText(
    root.responsavelNome,
    root.responsibleName,
    root.responsible_name,
    payload.responsavelNome,
    payload.responsibleName,
    payload.responsible_name,
    payloadAnamnese.responsavelNome,
    guardian.nome,
    guardian.name,
  );
  const responsibleCpf = firstText(
    root.responsavelCpf,
    root.responsibleCpf,
    root.responsible_cpf,
    payload.responsavelCpf,
    payload.responsibleCpf,
    payload.responsible_cpf,
    payloadAnamnese.responsavelCpf,
    guardian.cpf,
  );
  const responsibleRelationship = firstText(
    root.responsavelRelacao,
    root.responsibleRelationship,
    root.responsible_relationship,
    payload.responsavelRelacao,
    payload.responsibleRelationship,
    payload.responsible_relationship,
    payloadAnamnese.responsavelRelacao,
    guardian.relacao,
    guardian.relationship,
    metadata.responsibleRelationship,
  );

  const persistedHolderName = firstText(
    root.insuranceHolderName,
    root.convenioTitularNome,
    root.insurance_holder_name,
    payload.insuranceHolderName,
    payload.convenioTitularNome,
    payload.insurance_holder_name,
    payloadAnamnese.insuranceHolderName,
    payloadAnamnese.convenioTitularNome,
    rootAnamnese.insuranceHolderName,
    rootAnamnese.convenioTitularNome,
    anamnesisData.insuranceHolderName,
    anamnesisData.convenioTitularNome,
  );
  const persistedHolderCpf = firstText(
    root.insuranceHolderCpf,
    root.convenioTitularCpf,
    root.insurance_holder_cpf,
    payload.insuranceHolderCpf,
    payload.convenioTitularCpf,
    payload.insurance_holder_cpf,
    payloadAnamnese.insuranceHolderCpf,
    payloadAnamnese.convenioTitularCpf,
    rootAnamnese.insuranceHolderCpf,
    rootAnamnese.convenioTitularCpf,
    anamnesisData.insuranceHolderCpf,
    anamnesisData.convenioTitularCpf,
  );
  const persistedHolderRelationship = firstText(
    root.insuranceHolderRelationship,
    root.convenioTitularRelacao,
    root.insurance_holder_relationship,
    payload.insuranceHolderRelationship,
    payload.convenioTitularRelacao,
    payload.insurance_holder_relationship,
    payloadAnamnese.insuranceHolderRelationship,
    payloadAnamnese.convenioTitularRelacao,
    rootAnamnese.insuranceHolderRelationship,
    rootAnamnese.convenioTitularRelacao,
    anamnesisData.insuranceHolderRelationship,
    anamnesisData.convenioTitularRelacao,
  );

  const shouldUseResponsibleFallback = Boolean(
    options.useResponsibleFallback &&
    insuranceType === 'convenio' &&
    !persistedHolderName &&
    !persistedHolderCpf &&
    !persistedHolderRelationship &&
    (responsibleName || responsibleCpf || responsibleRelationship),
  );

  const insuranceHolderName = persistedHolderName || (shouldUseResponsibleFallback ? responsibleName : '');
  const insuranceHolderCpf = persistedHolderCpf || (shouldUseResponsibleFallback ? responsibleCpf : '');
  const insuranceHolderRelationship = persistedHolderRelationship || (shouldUseResponsibleFallback ? responsibleRelationship : '');

  const insuranceEligibilityNotes = firstText(
    root.insuranceEligibilityNotes,
    root.convenioElegibilidadeObs,
    root.eligibilityNotes,
    root.eligibility_notes,
    payload.insuranceEligibilityNotes,
    payload.convenioElegibilidadeObs,
    payload.eligibilityNotes,
    payload.eligibility_notes,
    payloadAnamnese.insuranceEligibilityNotes,
    payloadAnamnese.convenioElegibilidadeObs,
    payloadAnamnese.eligibilityNotes,
    payloadAnamnese.eligibility_notes,
    rootAnamnese.insuranceEligibilityNotes,
    rootAnamnese.convenioElegibilidadeObs,
    anamnesisData.insuranceEligibilityNotes,
    anamnesisData.convenioElegibilidadeObs,
  );

  return {
    insuranceType,
    insuranceName,
    insuranceCardNumber,
    insuranceCardValidUntil,
    insurancePlanCategory,
    insuranceHolderName,
    insuranceHolderCpf,
    insuranceHolderRelationship,
    insuranceEligibilityNotes,
    convenioTipo: insuranceType,
    convenioNome: insuranceName,
    convenioCarteirinha: insuranceCardNumber,
    convenioCarteirinhaValidade: insuranceCardValidUntil,
    convenioPlanoCategoria: insurancePlanCategory,
    convenioTitularNome: insuranceHolderName,
    convenioTitularCpf: insuranceHolderCpf,
    convenioTitularRelacao: insuranceHolderRelationship,
    convenioElegibilidadeObs: insuranceEligibilityNotes,
    holderPrefilledFromResponsible: shouldUseResponsibleFallback,
  };
}

export function mirrorPatientInsuranceEligibilityAliases<T extends Record<string, any>>(
  input: T,
  options: NormalizeOptions = {},
): T {
  const normalized = normalizePatientInsuranceEligibility(input, options);
  return {
    ...input,
    insuranceType: normalized.insuranceType,
    insuranceName: normalized.insuranceName,
    insuranceCardNumber: normalized.insuranceCardNumber,
    cardNumber: normalized.insuranceCardNumber,
    insuranceCardValidUntil: normalized.insuranceCardValidUntil,
    insurancePlanCategory: normalized.insurancePlanCategory,
    insuranceHolderName: normalized.insuranceHolderName,
    insuranceHolderCpf: normalized.insuranceHolderCpf,
    insuranceHolderRelationship: normalized.insuranceHolderRelationship,
    insuranceEligibilityNotes: normalized.insuranceEligibilityNotes,
    eligibilityNotes: normalized.insuranceEligibilityNotes,
    convenioTipo: normalized.convenioTipo,
    convenioNome: normalized.convenioNome,
    convenioCarteirinha: normalized.convenioCarteirinha,
    convenioCarteirinhaValidade: normalized.convenioCarteirinhaValidade,
    convenioPlanoCategoria: normalized.convenioPlanoCategoria,
    convenioTitularNome: normalized.convenioTitularNome,
    convenioTitularCpf: normalized.convenioTitularCpf,
    convenioTitularRelacao: normalized.convenioTitularRelacao,
    convenioElegibilidadeObs: normalized.convenioElegibilidadeObs,
  };
}
