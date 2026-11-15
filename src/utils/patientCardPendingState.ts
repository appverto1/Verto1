// Read-only display policy for the patient card. The backend remains authoritative
// for saving and reviewing anamnesis and for access to the patient record.
const normalizedStatus = (value: unknown) => String(value || '').trim().toUpperCase();

export const hasCompletedPatientAnamnesis = (patient: any, flow: any): boolean => {
  const responseStatus = normalizedStatus(flow?.response?.status);
  const requestStatus = normalizedStatus(flow?.request?.status);

  if (['SUBMITTED', 'REVIEWED'].includes(responseStatus) ||
      ['SUBMITTED', 'REVIEWED'].includes(requestStatus)) return true;

  // A server-confirmed draft or outstanding request takes precedence over
  // legacy patient fields (which may have been saved before submission).
  if (responseStatus || requestStatus) return false;

  const onboarding = normalizedStatus(
    flow?.patient?.onboardingStatus || patient?.onboardingStatus || patient?.onboarding_status
  );
  if (['ANAMNESIS_SUBMITTED', 'ANAMNESIS_REVIEWED', 'READY_FOR_CARE'].includes(onboarding)) {
    return true;
  }

  const answers = patient?.anamnesisData || patient?.anamnese || patient?.anamnesis_data;
  const hasSavedAnswers = answers && typeof answers === 'object'
    && !Array.isArray(answers)
    && Object.keys(answers).some((key) =>
      !['formType', 'questionLabels', 'template_snapshot', 'anamnesisTemplateVersion', 'template_version'].includes(key)
    );
  return Boolean(
    hasSavedAnswers &&
    (patient?.lastAnamnesisAt || patient?.last_anamnesis_at) &&
    patient?.anamnesisPending !== true &&
    patient?.anamnesis_pending !== true
  );
};
