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
    const phones = req.body?.phones;
    if (!Array.isArray(phones) || phones.length < 1 || phones.length > 100 ||
        phones.some((value: unknown) => typeof value !== 'string' || value.length > 40)) {
      return res.status(400).json({success:false,error:'Informe entre 1 e 100 telefones.'});
    }
    const normalized = (phones as string[]).map(value => {
      let digits = value.replace(/[^0-9]/g, '');
      if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
      return /^55[1-9][0-9][0-9]{8,9}$/.test(digits) ? digits : null;
    });
    const counts = new Map<string,number>();
    for (const phone of normalized) if (phone) counts.set(phone,(counts.get(phone)||0)+1);
    const unique = [...counts.keys()];
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
    const phones = req.body?.phones;
    const channelsByPhone = req.body?.channelsByPhone;
    const actorId = sanitizeString(req.session?.user?.id, 120);
    const key = sanitizeString(req.headers?.['x-idempotency-key'], 120);
    if (!isUuid(actorId) || key.length < 12 || key.length > 120 ||
        !Array.isArray(phones) || phones.length < 1 || phones.length > 100 ||
        phones.some((v: unknown) => typeof v !== 'string' || v.length > 40) ||
        !Array.isArray(channelsByPhone) || channelsByPhone.length!==phones.length ||
        channelsByPhone.some((row:unknown)=>!Array.isArray(row)||row.length>20||
          row.some((id:unknown)=>typeof id!=='string'||!isUuid(id))||
          new Set(row).size!==row.length)) {
      return res.status(400).json({ success:false,error:'Informe entre 1 e 100 telefones válidos.' });
    }
    try {
      const result = await supabase.rpc('create_sales_kanban_opportunities_v2',{
        p_phones:phones,p_actor_id:actorId,p_action_key:key,p_channels:channelsByPhone,
      });
      if (result.error) {
        if (/PHONE_ALREADY_EXISTS|DUPLICATE_IN_BATCH|IDEMPOTENCY_CONFLICT|23505/.test(String(result.error.message)+' '+result.error.code))
          return res.status(409).json({success:false,error:'Número já cadastrado ou repetido. Nenhuma oportunidade foi criada.'});
        if (/ACQUISITION_CHANNEL_UNAVAILABLE|DUPLICATE_BATCH_CHANNEL/.test(String(result.error.message)))
          return res.status(409).json({success:false,error:'Canal de aquisição inválido ou desativado. Nenhuma oportunidade foi criada.'});
        if (/INVALID_BATCH_CHANNELS/.test(String(result.error.message)))
          return res.status(400).json({success:false,error:'Revise a seleção de canais dos contatos.'});
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
