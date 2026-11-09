import {parseSalesKanbanMovementInput} from './salesKanbanActivityInput';
// Super Admin CRM Kanban card movement: exact extraction.
// SQL RPC retains row lock, idempotency, audit and conversion protection.
type Deps = {
  supabase:any;
  salesGuard:any[];
  isUuid:(id:string)=>boolean;
  sanitizeString:(value:unknown,max:number)=>string;
  boardError:(res:any,message?:string)=>any;
};
export function registerSalesKanbanMovementRoutes(
  app:any,
  {supabase,salesGuard,isUuid,sanitizeString,boardError}:Deps,
):void{
  app.post('/api/owner/sales/kanban/leads/:leadId/move', ...salesGuard, async (req: any, res: any) => {
    const input = parseSalesKanbanMovementInput(req,{isUuid,sanitizeString});
    if (!input.ok) return res.status(400).json({success:false,error:input.error});
    const {leadId,columnId,actorId,key} = input;
    try {
      const target = await supabase.from('sales_kanban_columns').select('kind').eq('id',columnId).maybeSingle();
      if(target.error)throw target.error;
      if(target.data?.kind==='lost')
        return res.status(409).json({success:false,error:'Selecione um motivo de perda antes de mover o card.'});
      const result = await supabase.rpc('move_sales_kanban_lead_v1',{
        p_lead_id:leadId,p_column_id:columnId,p_actor_id:actorId,p_action_key:key,
      });
      if (result.error) {
        const m = String(result.error.message || '');
        if (m.includes('LEAD_NOT_FOUND') || m.includes('COLUMN_NOT_FOUND'))
          return res.status(404).json({success:false,error:'Lead ou coluna inexistente.'});
        if (/CONVERTED_LEAD_IMMUTABLE|CANNOT_HIDE_CLOSED_LEAD|PAYMENT_REQUIRED|IDEMPOTENCY_CONFLICT/.test(m))
          return res.status(409).json({success:false,error:'Movimentação incompatível com as regras comerciais.'});
        throw result.error;
      }
      return res.json({success:true,data:result.data});
    } catch { return boardError(res,'Não foi possível mover o lead.'); }
  });

}
