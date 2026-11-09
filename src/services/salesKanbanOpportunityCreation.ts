// Manual Kanban acquisition transport; owner authentication remains in request()
// and the existing backend guard. Only an explicit Save creates opportunities.
export type SalesKanbanRequest = (url: string, init?: RequestInit) => Promise<any>;
export type OpportunityDuplicateMatch = {
  normalizedPhone: string | null;
  invalid: boolean;
  inBatch: boolean;
  existing: { id: string; name: string | null; phone: string | null; status: string } | null;
};

export const splitOpportunityPhones = (draft: string): string[] =>
  draft.split(/[\n,;]+/).map(v => v.trim()).filter(Boolean);

export const previewOpportunityDuplicates = (
  request: SalesKanbanRequest,
  phonesDraft: string,
): Promise<{success: boolean; matches: OpportunityDuplicateMatch[]}> =>
  request('/api/owner/sales/kanban/opportunities/duplicates', {
    method:'POST',body:JSON.stringify({phones:splitOpportunityPhones(phonesDraft)}),
  });

export type OpportunityContactDetails = { name?: string; clinicName?: string; email?: string };

export const createManualOpportunities = (
  request: SalesKanbanRequest,
  phones: string[],
  channelsByPhone: string[][],
  key: string,
  detailsByPhone?: OpportunityContactDetails[],
): Promise<{success: boolean; leads: any[]}> =>
  request('/api/owner/sales/kanban/opportunities', {
    method:'POST',headers:{'X-Idempotency-Key':key},
    body:JSON.stringify(detailsByPhone ? {phones,channelsByPhone,detailsByPhone} : {phones,channelsByPhone}),
  });
