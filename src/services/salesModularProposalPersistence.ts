// Task 04: retain the existing authenticated request; pricing and frozen snapshots
// remain authoritative in the backend. No additional requests or client-side writes.
export type SalesProposalRequest = (url: string, init?: RequestInit) => Promise<any>;
const simulationUrl = (leadId: string) =>
  '/api/owner/sales/leads/' + encodeURIComponent(leadId) + '/modular-simulations';

export const loadSalesModularProposalData = (request: SalesProposalRequest, leadId: string) =>
  Promise.all([
    request('/api/owner/sales/pricing-catalogs?compact=1'),
    request('/api/owner/sales/profitability-assumptions?context=new_proposal'),
    request(simulationUrl(leadId) + '?page=1&pageSize=50')
  ]);

export const saveSalesModularScenario = (
  request: SalesProposalRequest, leadId: string, key: string, payload: Record<string, unknown>
) => request(simulationUrl(leadId), {
  method: 'POST',
  headers: { 'X-Idempotency-Key': key },
  body: JSON.stringify(payload)
});

export const selectSalesModularScenario = (
  request: SalesProposalRequest, leadId: string, simulationId: string
) => request(
  '/api/owner/sales/leads/' + encodeURIComponent(leadId) +
    '/simulations/' + encodeURIComponent(simulationId) + '/select',
  { method: 'POST', body: JSON.stringify({}) }
);

export const renameSalesModularScenario = (
  request: SalesProposalRequest, leadId: string, simulationId: string, scenarioName: string
) => request(simulationUrl(leadId) + '/' + encodeURIComponent(simulationId), {
  method: 'PATCH',
  body: JSON.stringify({ action: 'rename', scenarioName })
});

export const archiveSalesModularScenario = (
  request: SalesProposalRequest, leadId: string, simulationId: string
) => request(simulationUrl(leadId) + '/' + encodeURIComponent(simulationId), {
  method: 'PATCH',
  body: JSON.stringify({ action: 'archive' })
});


// The existing request() is the only HTTP read. Never acknowledge a Save
// solely because the HTTP status is 2xx or JSON is parseable.
export const readConfirmedSalesModularProposalResponse = async (response: Response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success !== true) {
    const fetchError = new Error(
      data?.error || 'Não foi possível concluir esta ação.'
    );
    (fetchError as any).code = data?.code;
    throw fetchError;
  }
  return data;
};
