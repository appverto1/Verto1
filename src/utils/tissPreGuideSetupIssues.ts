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

  const detailedIssues = unique(
    (Array.isArray(checklist?.issues) ? checklist.issues : []).map(issueText),
  );
  if (detailedIssues.length > 0) return detailedIssues;

  const itemIssues = unique(
    (Array.isArray(checklist?.items) ? checklist.items : [])
      .filter((item: any) => ['blocking', 'attention'].includes(text(item?.status).toLowerCase()))
      .flatMap((item: any) => {
        const relatedCodes = Array.isArray(item?.relatedIssueCodes) ? item.relatedIssueCodes : [];
        if (relatedCodes.length > 0) return relatedCodes.map(tissPreGuideIssueLabel);
        const directText = issueText(item);
        if (directText) return [directText];
        return [text(item?.label)];
      }),
  );
  if (itemIssues.length > 0) return itemIssues;

  const validationIssues = unique(
    (Array.isArray(preGuide?.validationErrorCodes) ? preGuide.validationErrorCodes : [])
      .map(tissPreGuideIssueLabel),
  );
  if (validationIssues.length > 0) return validationIssues;

  const status = text(preGuide?.status).toLowerCase();
  return status && status !== 'valid'
    ? ['A Pré-guia ainda possui dados obrigatórios pendentes.']
    : [];
}
