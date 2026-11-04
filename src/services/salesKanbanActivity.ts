// Shared frontend transport for a single existing owner-authenticated request().
export type OwnerSalesRequest=(url:string,init?:RequestInit)=>Promise<any>;
export const loadSalesProspectingHistory=(request:OwnerSalesRequest,leadIds:string)=>
  request('/api/owner/sales/prospecting/attempts?leadIds='+leadIds);
export const moveSalesKanbanLead=(request:OwnerSalesRequest,leadId:string,columnId:string,key:string)=>
  request('/api/owner/sales/kanban/leads/'+leadId+'/move',{
    method:'POST',headers:{'X-Idempotency-Key':key},body:JSON.stringify({columnId}),
  });
export const persistSalesAttemptTime=(request:OwnerSalesRequest,leadId:string,key:string,payload:Record<string,unknown>)=>
  request('/api/owner/sales/leads/'+leadId+'/prospecting-attempt-time',{
    method:'PUT',headers:{'X-Idempotency-Key':key},body:JSON.stringify(payload),
  });
export const persistSalesDecisorContact=(request:OwnerSalesRequest,leadId:string,key:string,payload:Record<string,unknown>)=>
  request('/api/owner/sales/leads/'+leadId+'/decisor-contact',{
    method:'PUT',headers:{'X-Idempotency-Key':key},body:JSON.stringify(payload),
  });
export const persistSalesFollowup=(request:OwnerSalesRequest,leadId:string,key:string,contactDueAt:string|null)=>
  request('/api/owner/sales/leads/'+leadId+'/followup',{
    method:'PUT',headers:{'X-Idempotency-Key':key},body:JSON.stringify({contactDueAt}),
  });
export const persistSalesLoss=(request:OwnerSalesRequest,leadId:string,key:string,reasonId:string)=>
  request('/api/owner/sales/leads/'+leadId+'/mark-lost',{
    method:'POST',headers:{'X-Idempotency-Key':key},body:JSON.stringify({reasonId})
  });
