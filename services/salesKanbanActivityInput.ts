// Pure input preparation for Super Admin Kanban activity and prospecting.
// The existing authenticated routes retain all database writes, RPCs and error handling.
type InputDeps = {
  isUuid: (id: string) => boolean;
  sanitizeString: (value: unknown, max: number) => string;
};

export function parseSalesHistoryLeadIds(rawLeadIds: unknown, isUuid: InputDeps['isUuid']) {
  const leadIds = [...new Set(String(rawLeadIds || '').split(',').filter(Boolean))];
  if (leadIds.length === 0 || leadIds.length > 100 || leadIds.some((id) => !isUuid(id))) {
    return { ok: false as const, error: 'Lista de leads inválida.' };
  }
  return { ok: true as const, leadIds };
}

export function parseSalesKanbanMovementInput(req: any, { isUuid, sanitizeString }: InputDeps) {
  const leadId = sanitizeString(req.params?.leadId,120);
  const columnId = sanitizeString(req.body?.columnId,120);
  const actorId = sanitizeString(req.session?.user?.id,120);
  const key = sanitizeString(req.headers?.['x-idempotency-key'],120);
  if (![leadId,columnId,actorId].every(isUuid) || key.length < 12)
    return { ok: false as const, error: 'Movimentação inválida.' };
  return { ok: true as const, leadId, columnId, actorId, key };
}

export function parseSalesProspectingAttemptInput(req: any, { isUuid, sanitizeString }: InputDeps) {
  const leadId = sanitizeString(req.params?.leadId, 120);
  const channel = sanitizeString(req.body?.channel, 32);
  const outcome = sanitizeString(req.body?.outcome, 32);
  const key = sanitizeString(req.headers?.['x-idempotency-key'], 120);
  const actorId = sanitizeString(req.session?.user?.id, 120);
  if (!isUuid(leadId) || !isUuid(actorId)
    || !['phone', 'whatsapp_call'].includes(channel)
    || !['no_decisor', 'decisor_spoken'].includes(outcome)
    || key.length < 12 || key.length > 120) {
    return { ok: false as const, error: 'Tentativa inválida.' };
  }
  return { ok: true as const, leadId, channel, outcome, key, actorId };
}

export function parseSalesProspectingAttemptTimeInput(req: any, { isUuid, sanitizeString }: InputDeps) {
  const leadId=sanitizeString(req.params?.leadId,120);
  const actorId=sanitizeString(req.session?.user?.id,120);
  const attemptId=sanitizeString(req.body?.attemptId,120);
  const channel=sanitizeString(req.body?.channel,32);
  const occurredAt=req.body?.occurredAt;
  const key=sanitizeString(req.headers?.['x-idempotency-key'],120);
  const scriptVersionId=req.body?.scriptVersionId??null;
  if((scriptVersionId!==null&&!isUuid(scriptVersionId))||!isUuid(leadId)||!isUuid(actorId)||(attemptId&&!isUuid(attemptId))
    ||!['phone','whatsapp_call'].includes(channel)
    ||typeof occurredAt!=='string'||occurredAt.length>40
    ||!/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(occurredAt)
    ||!Number.isFinite(Date.parse(occurredAt))||key.length<12||key.length>120)
    return { ok: false as const, error: 'Data, horário ou canal inválidos.' };
  return { ok: true as const, leadId, actorId, attemptId, channel, occurredAt, key, scriptVersionId };
}

export function parseSalesDecisorContactInput(req: any, { isUuid, sanitizeString }: InputDeps) {
  const leadId=sanitizeString(req.params?.leadId,120);
  const actorId=sanitizeString(req.session?.user?.id,120);
  const channel=sanitizeString(req.body?.channel,32);
  const attemptId=sanitizeString(req.body?.attemptId,120);
  const occurredAt=req.body?.occurredAt;
  const key=sanitizeString(req.headers?.['x-idempotency-key'],120);
  const scriptVersionId=req.body?.scriptVersionId??null;
  const contactResult=req.body?.contactResult??null;
  if((scriptVersionId!==null&&!isUuid(scriptVersionId))||
     (contactResult!==null&&!['interested','not_interested'].includes(contactResult))||
     !isUuid(leadId)||!isUuid(actorId)||(attemptId&&!isUuid(attemptId))
     ||!['phone','whatsapp_call','whatsapp_message'].includes(channel)
     ||typeof occurredAt!=='string'||occurredAt.length>40
     ||!/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(occurredAt)
     ||!Number.isFinite(Date.parse(occurredAt))||key.length<12||key.length>120)
    return { ok: false as const, error: 'Data, hora ou canal inválidos.' };
  return { ok: true as const, leadId, actorId, channel, attemptId, occurredAt, key, scriptVersionId, contactResult };
}

export function parseSalesFollowupInput(req: any, { isUuid, sanitizeString }: InputDeps) {
  const leadId=sanitizeString(req.params?.leadId,120);
  const actorId=sanitizeString(req.session?.user?.id,120);
  const key=sanitizeString(req.headers?.['x-idempotency-key'],120);
  const due=req.body?.contactDueAt;
  if(!isUuid(leadId)||!isUuid(actorId)||key.length<12||key.length>120
     ||(due!==null&&(typeof due!=='string'||due.length>40
       ||!/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(due)
       ||!Number.isFinite(Date.parse(due)))))
    return { ok: false as const, error: 'Data ou horário de retorno inválidos.' };
  return { ok: true as const, leadId, actorId, key, due };
}

export function parseSalesMarkLostInput(req: any, { isUuid, sanitizeString }: InputDeps) {
  const leadId = sanitizeString(req.params?.leadId, 120);
  const key = sanitizeString(req.headers?.['x-idempotency-key'], 120);
  const actorId = sanitizeString(req.session?.user?.id, 120);
  const reasonId = sanitizeString(req.body?.reasonId,120);
  if (!isUuid(leadId) || !isUuid(actorId) || !isUuid(reasonId) ||
      key.length < 12 || key.length > 120) {
    return { ok: false as const, error: 'Selecione um motivo de perda antes de salvar.' };
  }
  return { ok: true as const, leadId, key, actorId, reasonId };
}
