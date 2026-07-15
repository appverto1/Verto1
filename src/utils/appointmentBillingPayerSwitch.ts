export const PAYER_DEPENDENT_BILLING_FIELDS = [
  'insuranceCardNumber',
  'insurancePlanName',
  'insuranceHolderName',
  'insuranceCardValidUntil',
  'guideNumber',
  'authorizationCode',
  'patientTissAuthorizationId',
  'procedureCode'
] as const;

type BillingFormLike = Record<string, any>;

const text = (value: any) => String(value ?? '').trim();

export const clearPayerDependentBillingFields = <T extends BillingFormLike>(form: T): T => ({
  ...form,
  insuranceCardNumber: '',
  insurancePlanName: '',
  insuranceHolderName: '',
  insuranceCardValidUntil: '',
  guideNumber: '',
  authorizationCode: '',
  patientTissAuthorizationId: '',
  procedureCode: '',
  source: 'PATIENT_DEFAULT'
});

export const buildPayerScopedBillingForm = <T extends BillingFormLike>(
  previous: T,
  params: {
    payerId?: any;
    payerName?: any;
    suggestion?: any;
  }
): T => {
  const suggestion = params.suggestion || {};
  const tissAuthorization = suggestion.tissAuthorization || suggestion.tiss_authorization || {};
  const authorizationId = text(
    suggestion.patientTissAuthorizationId ||
      suggestion.patient_tiss_authorization_id ||
      suggestion.authorizationId ||
      suggestion.authorization_id ||
      tissAuthorization.authorizationId ||
      tissAuthorization.patientTissAuthorizationId
  );
  return {
    ...clearPayerDependentBillingFields(previous),
    payerId: text(suggestion.payerId || suggestion.payer_id || params.payerId),
    payerName: text(suggestion.payerName || suggestion.payer_name_snapshot || params.payerName),
    serviceType: text(suggestion.serviceType || suggestion.service_type || previous.serviceType),
    insuranceCardNumber: text(suggestion.insuranceCardNumber || suggestion.insurance_card_number),
    insurancePlanName: text(suggestion.insurancePlanName || suggestion.insurance_plan_name),
    insuranceHolderName: text(suggestion.insuranceHolderName || suggestion.insurance_holder_name),
    insuranceCardValidUntil: text(suggestion.insuranceCardValidUntil || suggestion.insurance_card_valid_until),
    guideNumber: text(suggestion.guideNumber || suggestion.guide_number || tissAuthorization.guideNumber || tissAuthorization.guide_number),
    authorizationCode: text(
      suggestion.authorizationCode ||
        suggestion.authorization_code ||
        tissAuthorization.authorizationCode ||
        tissAuthorization.authorization_code
    ),
    patientTissAuthorizationId: authorizationId,
    source: authorizationId ? 'PATIENT_TISS_AUTHORIZATION' : text(suggestion.source) || 'PATIENT_DEFAULT'
  };
};

export const payerScopedBillingSourceLabel = (params: {
  field: 'card' | 'plan' | 'guide' | 'authorization';
  form: BillingFormLike;
}) => {
  const form = params.form || {};
  if (params.field === 'card') {
    return text(form.insuranceCardNumber)
      ? 'Origem: cadastro do paciente neste convenio'
      : 'Nao encontrado no cadastro deste convenio';
  }
  if (params.field === 'plan') {
    return text(form.insurancePlanName)
      ? 'Origem: cadastro/plano do paciente neste convenio'
      : 'Nao encontrado no cadastro deste convenio';
  }
  const hasAuthorization = Boolean(text(form.patientTissAuthorizationId));
  const hasValue = params.field === 'guide'
    ? Boolean(text(form.guideNumber))
    : Boolean(text(form.authorizationCode));
  if (hasAuthorization && hasValue) return 'Origem: autorizacao TISS vigente';
  return 'Nenhuma autorizacao TISS vigente encontrada para este convenio';
};
