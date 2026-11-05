import {parseSalesHistoryLeadIds,parseSalesProspectingAttemptInput,parseSalesProspectingAttemptTimeInput,parseSalesDecisorContactInput,parseSalesFollowupInput,parseSalesMarkLostInput} from './salesKanbanActivityInput';
// Super Admin CRM attempts, decision-maker contacts, follow-ups and history.
// Exact extraction: original session/TOTP guards and SQL RPCs remain authoritative.
type Deps = {
  supabase:any;
  checkAuth:any;
  checkPlatformAdmin:any;
  isUuid:(id:string)=>boolean;
  sanitizeString:(value:unknown,max:number)=>string;
};
export function registerSalesProspectingActivityRoutes(
  app:any,
  {supabase,checkAuth,checkPlatformAdmin,isUuid,sanitizeString}:Deps,
):void{
  app.get('/api/owner/sales/prospecting/attempts', checkAuth, checkPlatformAdmin, async (req: any, res: any) => {
    const input = parseSalesHistoryLeadIds(req.query?.leadIds, isUuid);
    if (!input.ok) return res.status(400).json({ success: false, error: input.error });
    const {leadIds} = input;
    try {
      const actorId=sanitizeString(req.session?.user?.id,120);
      const [attempts, leads, followups] = await Promise.all([
        supabase.from('sales_prospecting_attempts')
          .select('id,lead_id,channel,outcome,occurred_at,script_version_id,contact_result')
          .in('lead_id', leadIds)
          .order('occurred_at', { ascending: false })
          .limit(1000),
        supabase.from('sales_leads').select('id,status,lost_at,loss_reason_id')
          .in('id', leadIds).is('deleted_at', null).limit(100),
        supabase.from('sales_contact_followups')
          .select('id,lead_id,contact_due_at,status')
          .eq('actor_user_id',actorId).in('lead_id',leadIds).limit(100),
      ]);
      if (attempts.error || leads.error || followups.error) throw attempts.error || leads.error || followups.error;
      return res.json({ success: true, data: attempts.data || [], leads: leads.data || [], followups: followups.data || [] });
    } catch {
      return res.status(500).json({ success: false, error: 'Histórico indisponível.' });
    }
  });

  app.post('/api/owner/sales/leads/:leadId/prospecting-attempts',
    checkAuth, checkPlatformAdmin, async (req: any, res: any) => {
      const input = parseSalesProspectingAttemptInput(req,{isUuid,sanitizeString});
      if (!input.ok) return res.status(400).json({success:false,error:input.error});
      const {leadId,channel,outcome,key,actorId} = input;
      try {
        const { data, error } = await supabase.rpc('record_sales_prospecting_attempt_v1', {
          p_lead_id: leadId, p_channel: channel, p_outcome: outcome,
          p_action_key: key, p_actor_user_id: actorId,
        });
        if (error) {
          const message = String(error.message || '');
          if (message.includes('LEAD_NOT_FOUND')) return res.status(404).json({ success: false, error: 'Lead não encontrado.' });
          if (message.includes('PROSPECTING_OUTSIDE_BUSINESS_HOURS')) {
            return res.status(409).json({success:false,error:'As tentativas devem ocorrer de segunda a sexta, entre 9h e 17h30 (Brasília).'});
          }
          if (message.includes('PROSPECTING_ALREADY_TODAY')) {
            return res.status(409).json({success:false,error:'Já existe uma tentativa registrada hoje para esta oportunidade. Siga a próxima sugestão em outro dia útil.'});
          }
          if (/IDEMPOTENCY_CONFLICT|CHANNEL_ATTEMPT_LIMIT|PROSPECTING_NOT_ALLOWED|DECISOR_ALREADY_CONTACTED/.test(message)) {
            return res.status(409).json({ success: false, error: 'Limite atingido, lead indisponível ou decisor já contatado.' });
          }
          throw error;
        }
        return res.json({ success: true, data });
      } catch {
        return res.status(500).json({ success: false, error: 'Não foi possível registrar a ligação.' });
      }
    },
  );


  // Save actual call time; legacy instant-attempt endpoint remains unchanged for compatibility.
  app.put('/api/owner/sales/leads/:leadId/prospecting-attempt-time',
    checkAuth,checkPlatformAdmin,async(req:any,res:any)=>{
      const input = parseSalesProspectingAttemptTimeInput(req,{isUuid,sanitizeString});
      if (!input.ok) return res.status(400).json({success:false,error:input.error});
      const {leadId,actorId,attemptId,channel,occurredAt,key,scriptVersionId} = input;
      try{
        const {data,error}=await supabase.rpc('save_sales_prospecting_attempt_time_v2',{
          p_lead_id:leadId,p_attempt_id:attemptId||null,p_channel:channel,
          p_occurred_at:occurredAt,p_action_key:key,p_actor_user_id:actorId,p_script_version_id:scriptVersionId,
        });
        if(error){
          const message=String(error.message||'');
          if(/LEAD_NOT_FOUND|ATTEMPT_NOT_FOUND/.test(message))
            return res.status(404).json({success:false,error:'Tentativa não encontrada.'});
          if(/INVALID_ATTEMPT_TIME/.test(message))
            return res.status(400).json({success:false,error:'Informe uma data e hora reais, sem selecionar um horário futuro.'});
          if(/PROSPECTING_NOT_ALLOWED/.test(message))
            return res.status(409).json({success:false,error:'Oportunidade removida ou com preferência explícita de não receber contatos.'});
          if(/SCRIPT_NOT_ACTIVE|SCRIPT_REQUIRED/.test(message))
            return res.status(409).json({success:false,error:'O fluxo escolhido não está vigente. Selecione outra versão.'});
          if(/IDEMPOTENCY_CONFLICT/.test(message))
            return res.status(409).json({success:false,error:'Esta tentativa já foi salva com outros dados. Atualize o histórico antes de tentar novamente.'});
          throw error;
        }
        return res.json({success:true,data});
      }catch{return res.status(500).json({success:false,error:'Não foi possível salvar o horário da tentativa.'});}
    });

  // The user-supplied timestamp is converted on the client, but is checked
  // again by the database. A successful button press is the only write.
  app.put('/api/owner/sales/leads/:leadId/decisor-contact',
    checkAuth,checkPlatformAdmin,async (req:any,res:any)=>{
      const input = parseSalesDecisorContactInput(req,{isUuid,sanitizeString});
      if (!input.ok) return res.status(400).json({success:false,error:input.error});
      const {leadId,actorId,channel,attemptId,occurredAt,key,scriptVersionId,contactResult} = input;
      try{
        const {data,error}=await supabase.rpc('save_sales_decisor_contact_v2',{
          p_lead_id:leadId,p_attempt_id:attemptId||null,p_channel:channel,
          p_occurred_at:occurredAt,p_action_key:key,p_actor_user_id:actorId,
          p_script_version_id:scriptVersionId,p_contact_result:contactResult,
        });
        if(error){
          const message=String(error.message||'');
          if(/LEAD_NOT_FOUND|CONTACT_NOT_FOUND/.test(message))
            return res.status(404).json({success:false,error:'Registro não encontrado.'});
          if(/INVALID_CONTACT_TIME|INVALID_CONTACT_RESULT/.test(message))
            return res.status(400).json({success:false,error:'Informe uma data e hora reais no passado e classifique o resultado do contato.'});
          if(/PROSPECTING_NOT_ALLOWED/.test(message))
            return res.status(409).json({success:false,error:'Oportunidade removida ou com preferência explícita de não receber contatos.'});
          if(/SCRIPT_NOT_ACTIVE|SCRIPT_REQUIRED/.test(message))
            return res.status(409).json({success:false,error:'O fluxo escolhido não está vigente. Selecione outra versão.'});
          if(/IDEMPOTENCY_CONFLICT/.test(message))
            return res.status(409).json({success:false,error:'Este contato já foi salvo com outros dados. Atualize o histórico antes de tentar novamente.'});
          throw error;
        }
        return res.json({success:true,data});
      }catch{return res.status(500).json({success:false,error:'Não foi possível salvar o contato.'});}
    });

  app.put('/api/owner/sales/leads/:leadId/followup',
    checkAuth,checkPlatformAdmin,async (req:any,res:any)=>{
      const input = parseSalesFollowupInput(req,{isUuid,sanitizeString});
      if (!input.ok) return res.status(400).json({success:false,error:input.error});
      const {leadId,actorId,key,due} = input;
      try{
        const {data,error}=await supabase.rpc('save_sales_contact_followup_v1',{
          p_lead_id:leadId,p_actor_user_id:actorId,
          p_contact_due_at:due,p_action_key:key,
        });
        if(error){
          const message=String(error.message||'');
          if(/LEAD_NOT_FOUND|FOLLOWUP_NOT_FOUND/.test(message))
            return res.status(404).json({success:false,error:'Retorno não encontrado.'});
          if(/INVALID_FOLLOWUP_DATE|IDEMPOTENCY_CONFLICT/.test(message))
            return res.status(400).json({success:false,error:'Informe uma data futura válida para o retorno.'});
          throw error;
        }
        return res.json({success:true,followup:data});
      }catch{return res.status(500).json({success:false,error:'Não foi possível salvar o retorno.'});}
    });

  app.post('/api/owner/sales/leads/:leadId/mark-lost',
    checkAuth, checkPlatformAdmin, async (req: any, res: any) => {
      const input = parseSalesMarkLostInput(req,{isUuid,sanitizeString});
      if (!input.ok) return res.status(400).json({success:false,error:input.error});
      const {leadId,key,actorId,reasonId} = input;
      try {
        const { data, error } = await supabase.rpc('mark_sales_lead_lost_with_reason_v1', {
          p_lead_id: leadId, p_reason_id: reasonId, p_action_key: key, p_actor_user_id: actorId,
        });
        if (error) {
          const message = String(error.message || '');
          if (message.includes('LEAD_NOT_FOUND')) return res.status(404).json({ success: false, error: 'Lead não encontrado.' });
          if (message.includes('CONVERTED_LEAD_CANNOT_BE_LOST')) {
            return res.status(409).json({ success: false, error: 'Cliente convertido não pode ser perdido.' });
          }
          if (/LOSS_REASON_UNAVAILABLE|IDEMPOTENCY_CONFLICT/.test(message))
            return res.status(409).json({success:false,error:'Motivo indisponível ou operação já utilizada. Atualize a lista.'});
          throw error;
        }
        return res.json({ success: true, data });
      } catch {
        return res.status(500).json({ success: false, error: 'Não foi possível marcar o lead como perdido.' });
      }
    },
  );
}
