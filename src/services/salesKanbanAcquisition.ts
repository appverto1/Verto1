import type { OwnerSalesRequest } from './salesKanbanActivity';

// Item 03: existing Super Admin acquisition-channel requests. The caller
// retains session auth, Save actions, idempotency keys and UI state.
export const loadSalesKanbanAcquisitionBoard = (request: OwnerSalesRequest, encodedLeadIds?: string) =>
  request('/api/owner/sales/acquisition/board' + (encodedLeadIds === undefined ? '' : '?leadIds=' + encodedLeadIds));

export const persistSalesKanbanAcquisition = (request: OwnerSalesRequest, leadId: string, key: string, channelIds: string[]) =>
  request('/api/owner/sales/acquisition/leads/' + leadId, {
    method: 'PUT', headers: { 'X-Idempotency-Key': key },
    body: JSON.stringify({ channelIds }),
  });

export const persistSalesKanbanAcquisitionBulk = (
  request: OwnerSalesRequest, key: string,
  selections: Array<{leadId: string; channelIds: string[]}>,
) =>
  request('/api/owner/sales/acquisition/leads/bulk', {
    method: 'PUT', headers: { 'X-Idempotency-Key': key },
    body: JSON.stringify({ selections }),
  });
