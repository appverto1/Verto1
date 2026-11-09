import {parseManualOpportunityPreviewInput,parseManualOpportunitySaveInput} from './salesKanbanOpportunityCreationInput';

// Verto CRM Task 02 — exact extraction of the existing guarded manual acquisition flow.
// No new persistence authority: the Supabase RPC remains atomic and idempotent.
type Deps = {
  supabase: any;
  salesGuard: any[];
  sanitizeString: (value: unknown, limit: number) => string;
  isUuid: (value: string) => boolean;
  boardError: (res: any, message?: string) => any;
};

export function registerSalesKanbanOpportunityCreationRoutes(
  app: any,
  { supabase, salesGuard, sanitizeString, isUuid, boardError }: Deps,
): void {
  // Preview only: the create RPC and its unique index remain the final write authority.
  // One indexed batch lookup, independent of Kanban pagination or visible stage.
  app.post('/api/owner/sales/kanban/opportunities/duplicates', ...salesGuard, async (req: any, res: any) => {
    const preview = parseManualOpportunityPreviewInput(req.body?.phones);
    if (!preview.ok) return res.status(400).json({success:false,error:preview.error});
    const {normalized,counts,unique} = preview;
    try {
      const existingByPhone = new Map<string,{id:string;name:string|null;phone:string|null;status:string}>();
      if (unique.length) {
        const found = await supabase.from('sales_leads')
          .select('id,name,phone,status,normalized_phone')
          .in('normalized_phone',unique).is('deleted_at',null).limit(101);
        if (found.error || (found.data||[]).length > 100) throw found.error || Error('DUPLICATE_LOOKUP_LIMIT');
        for (const lead of found.data||[]) {
          existingByPhone.set(lead.normalized_phone,{
            id:lead.id,name:lead.name,phone:lead.phone,status:lead.status,
          });
        }
      }
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,matches:normalized.map(phone=>({
        normalizedPhone:phone,
        invalid:phone===null,
        inBatch:phone!==null && (counts.get(phone)||0)>1,
        existing:phone===null?null:existingByPhone.get(phone)||null,
      }))});
    } catch { return boardError(res,'Não foi possível verificar números repetidos.'); }
  });

  // Owner-only manually created opportunities. Reuse the SQL authority for
  // atomic batches, idempotency and audit; never let browser-controlled roles authorize writes.
  app.post('/api/owner/sales/kanban/opportunities', ...salesGuard, async (req: any, res: any) => {
    const creation = parseManualOpportunitySaveInput(req,{sanitizeString,isUuid});
    if (!creation.ok) return res.status(400).json({success:false,error:creation.error});
    const {phones,channelsByPhone,detailsByPhone,withDetails,actorId,key} = creation;
    try {
      const result = await supabase.rpc(
        withDetails ? 'create_sales_kanban_opportunities_v3' : 'create_sales_kanban_opportunities_v2',{
        p_phones:phones,p_actor_id:actorId,p_action_key:key,p_channels:channelsByPhone,
        ...(withDetails ? {p_details:detailsByPhone} : {}),
      });
      if (result.error) {
        if (/PHONE_ALREADY_EXISTS|DUPLICATE_IN_BATCH|DUPLICATE_EMAIL_IN_BATCH|IDEMPOTENCY_CONFLICT|23505/.test(String(result.error.message)+' '+result.error.code))
          return res.status(409).json({success:false,error:'Número ou e-mail já cadastrado ou repetido. Nenhuma oportunidade foi criada.'});
        if (/ACQUISITION_CHANNEL_UNAVAILABLE|DUPLICATE_BATCH_CHANNEL/.test(String(result.error.message)))
          return res.status(409).json({success:false,error:'Canal de aquisição inválido ou desativado. Nenhuma oportunidade foi criada.'});
        if (/INVALID_BATCH_CHANNELS/.test(String(result.error.message)))
          return res.status(400).json({success:false,error:'Revise a seleção de canais dos contatos.'});
        if (/INVALID_CREATION_DETAILS/.test(String(result.error.message)))
          return res.status(400).json({success:false,error:'Revise nome, clínica e e-mail dos contatos.'});
        if (/INVALID_PHONE|INVALID_CREATION_KEY/.test(String(result.error.message)))
          return res.status(400).json({success:false,error:'Confira o formato dos números (DDD obrigatório).'});
        throw result.error;
      }
      return res.status(201).json({success:true,leads:result.data});
    } catch {
      return boardError(res,'Não foi possível cadastrar as oportunidades.');
    }
  });

}
