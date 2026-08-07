import { tissPreGuideIssueLabel } from '../services/tissPreGuideEngine';

const text = (value: unknown) => String(value ?? '').trim();

const unique = (values: unknown[]) => Array.from(new Set(values.map(text).filter(Boolean)));

const issueText = (issue: any) =>
  text(issue?.description || issue?.title || issue?.label || issue?.message);

export function shouldShowTissPreGuidePreparation(status: unknown) {
  return text(status).toLowerCase() === 'not_tested';
}

/**
 * Converts the technical pre-guide/checklist contract into concise copy for
 * the setup UI. Status enums such as `pending_data` are never user-facing.
 */
export function collectTissPreGuideSetupIssues(preGuide: any, checklistInput?: any) {
  const checklist = checklistInput && typeof checklistInput === 'object'
    ? checklistInput
    : preGuide?.antiGlosaChecklist && typeof preGuide.antiGlosaChecklist === 'object'
      ? preGuide.antiGlosaChecklist
      : {};

  const checklistIssues = Array.isArray(checklist?.issues) ? checklist.issues : [];
  const blockingDetailedIssues = unique(
    checklistIssues
      .filter((issue: any) => text(issue?.severity).toLowerCase() === 'blocking')
      .map(issueText),
  );
  const legacyDetailedIssues = unique(
    checklistIssues
      .filter((issue: any) => !text(issue?.severity))
      .map(issueText),
  );
  const blockingItemIssues = unique(
    (Array.isArray(checklist?.items) ? checklist.items : [])
      .filter((item: any) => text(item?.status).toLowerCase() === 'blocking')
      .flatMap((item: any) => {
        const relatedCodes = Array.isArray(item?.relatedIssueCodes) ? item.relatedIssueCodes : [];
        if (relatedCodes.length > 0) return relatedCodes.map(tissPreGuideIssueLabel);
        const directText = issueText(item);
        if (directText) return [directText];
        return [text(item?.label)];
      }),
  );
  const validationIssues = unique(
    [
      ...(Array.isArray(preGuide?.validationErrors) ? preGuide.validationErrors.map(issueText) : []),
      ...(Array.isArray(preGuide?.validation_errors) ? preGuide.validation_errors.map(issueText) : []),
      ...(Array.isArray(preGuide?.validationErrorCodes) ? preGuide.validationErrorCodes.map(tissPreGuideIssueLabel) : []),
      ...(Array.isArray(preGuide?.validation_error_codes) ? preGuide.validation_error_codes.map(tissPreGuideIssueLabel) : []),
    ],
  );
  if (blockingDetailedIssues.length > 0) {
    return unique([...blockingDetailedIssues, ...validationIssues, ...blockingItemIssues]);
  }
  // Old checklist snapshots did not persist severity. Preserve their richer
  // copy, but never let a classified warning hide current validation errors.
  if (legacyDetailedIssues.length > 0) return legacyDetailedIssues;
  if (validationIssues.length > 0 || blockingItemIssues.length > 0) {
    return unique([...validationIssues, ...blockingItemIssues]);
  }

  const warningIssues = unique([
    ...checklistIssues
      .filter((issue: any) => text(issue?.severity).toLowerCase() === 'warning')
      .map(issueText),
    ...(Array.isArray(checklist?.items) ? checklist.items : [])
      .filter((item: any) => text(item?.status).toLowerCase() === 'attention')
      .flatMap((item: any) => {
        const relatedCodes = Array.isArray(item?.relatedIssueCodes) ? item.relatedIssueCodes : [];
        return relatedCodes.length > 0 ? relatedCodes.map(tissPreGuideIssueLabel) : [issueText(item) || text(item?.label)];
      }),
    ...(Array.isArray(preGuide?.validationWarningCodes) ? preGuide.validationWarningCodes.map(tissPreGuideIssueLabel) : []),
    ...(Array.isArray(preGuide?.validation_warning_codes) ? preGuide.validation_warning_codes.map(tissPreGuideIssueLabel) : []),
  ]);
  if (warningIssues.length > 0) return warningIssues;

  const status = text(preGuide?.status).toLowerCase();
  return status && status !== 'valid'
    ? ['A Pré-guia ainda possui dados obrigatórios pendentes.']
    : [];
}
