/**
 * Recebimentos de sessões próprias: acesso financeiro estritamente limitado
 * ao profissional ativo e às sessões concluídas atribuídas a ele.
 * Não concede acesso ao ledger da clínica nem operações de desconto/estorno.
 */
export function createProfessionalFinancialReceiptHandlers(deps: {
  supabase: any;
  currentClinicId: (user: any) => any;
  sanitizeString: (value: any, length: number) => string;
  isUuid: (value: any) => boolean;
  patientFinanceErrorResponse: (error: any) => { status: number; error: string };
}) {
  const { supabase, currentClinicId, sanitizeString, isUuid, patientFinanceErrorResponse } = deps;
  const failed = (res: any, status: number, error: string) =>
    res.status(status).json({ success: false, error });
  const validSession = (appointment: any) => Boolean(
    appointment?.actual_end_at ||
    ['completed', 'complete', 'concluida', 'concluída', 'concluído', 'concluido']
      .includes(String(appointment?.status || '').toLowerCase())
  );
  const actorContext = async (req: any, res: any) => {
    const userId = sanitizeString(req.session?.user?.id, 100);
    const organizationId = sanitizeString(currentClinicId(req.session?.user), 100);
    if (!isUuid(userId) || !isUuid(organizationId)) {
      failed(res, 401, 'Sessão autenticada inválida.');
      return null;
    }
    const { data, error } = await supabase.from('clinic_memberships')
      .select('user_id,role,status')
      .eq('clinic_id', organizationId)
      .eq('user_id', userId)
      .eq('role', 'therapist')
      .eq('status', 'active')
      .limit(1).maybeSingle();
    if (error) throw error;
    if (!data) {
      failed(res, 403, 'Este recebimento é permitido somente para o profissional ativo de um atendimento próprio.');
      return null;
    }
    return { userId, organizationId };
  };
  const appointmentForActor = async (context: any, appointmentId: string) => {
    if (!isUuid(appointmentId)) return null;
    const { data, error } = await supabase.from('appointments')
      .select('id,organization_id,patient_id,therapist_id,status,actual_end_at,scheduled_at,service_type')
      .eq('id', appointmentId)
      .eq('organization_id', context.organizationId)
      .eq('therapist_id', context.userId)
      .is('deleted_at', null)
      .limit(1).maybeSingle();
    if (error) throw error;
    return data && validSession(data) ? data : null;
  };
  const chargeForActor = async (context: any, appointmentId: string, paymentId: string) => {
    const appt = await appointmentForActor(context, appointmentId);
    if (!appt) return null;
    const { data: charge, error } = await supabase.from('payments')
      .select('id,organization_id,patient_id,appointment_id,source,amount,balance_amount,paid_amount,financial_status,private_price_source')
      .eq('id', paymentId)
      .eq('organization_id', context.organizationId)
      .eq('patient_id', appt.patient_id)
      .limit(1).maybeSingle();
    if (error) throw error;
    if (!charge || Number(charge.balance_amount) <= 0 ||
        ['canceled', 'cancelled', 'refunded'].includes(String(charge.financial_status || '').toLowerCase()) ||
        ['MONTHLY_COMPETENCE', 'GROUPED_APPOINTMENTS'].includes(String(charge.source || '').toUpperCase())) return null;
    const { data: items, error: itemsError } = await supabase
      .from('payment_appointment_items')
      .select('appointment_id,active')
      .eq('payment_id', paymentId)
      .eq('organization_id', context.organizationId);
    if (itemsError) throw itemsError;
    const activeItems = (items || []).filter((item: any) => item.active !== false);
    if (activeItems.length > 1 || (activeItems.length === 1 && String(activeItems[0].appointment_id) !== appointmentId)) return null;
    if (!activeItems.length && String(charge.appointment_id || '') !== appointmentId) return null;
    return { appt, charge };
  };
  return {
    list: async (req: any, res: any) => {
      try {
        const context = await actorContext(req, res);
        if (!context) return;
        const appointmentsResult = await supabase.from('appointments')
          .select('id,patient_id,scheduled_at,service_type,status,actual_end_at')
          .eq('organization_id', context.organizationId)
          .eq('therapist_id', context.userId)
          .is('deleted_at', null)
          .order('scheduled_at', { ascending: false })
          .limit(100);
        if (appointmentsResult.error) throw appointmentsResult.error;
        const appointments = (appointmentsResult.data || []).filter(validSession);
        if (!appointments.length) return res.json({ success: true, data: [] });
        const ids = appointments.map((a: any) => a.id);
        const { data: direct, error: directError } = await supabase.from('payments')
          .select('id,patient_id,appointment_id,source,amount,balance_amount,paid_amount,financial_status')
          .eq('organization_id', context.organizationId)
          .in('appointment_id', ids)
          .limit(200);
        if (directError) throw directError;
        const { data: links, error: linksError } = await supabase.from('payment_appointment_items')
          .select('payment_id,appointment_id,active')
          .eq('organization_id', context.organizationId)
          .in('appointment_id', ids)
          .limit(200);
        if (linksError) throw linksError;
        const paymentIds = Array.from(new Set((links || []).map((x: any) => String(x.payment_id)).filter(Boolean)));
        const { data: linked, error: linkedError } = paymentIds.length
          ? await supabase.from('payments')
            .select('id,patient_id,appointment_id,source,amount,balance_amount,paid_amount,financial_status')
            .eq('organization_id', context.organizationId).in('id', paymentIds).limit(200)
          : { data: [], error: null };
        if (linkedError) throw linkedError;
        const activeByPayment = new Map<string, string[]>();
        for (const item of links || []) {
          if (item.active === false) continue;
          const id = String(item.payment_id);
          activeByPayment.set(id, [...(activeByPayment.get(id) || []), String(item.appointment_id)]);
        }
        const charges = Array.from(new Map([...(direct || []), ...(linked || [])]
          .map((payment: any) => [String(payment.id), payment])).values());
        const safePayments = new Map<string, any>();
        for (const charge of charges) {
          const itemIds = activeByPayment.get(String(charge.id)) || [];
          if (itemIds.length > 1 ||
            ['MONTHLY_COMPETENCE', 'GROUPED_APPOINTMENTS'].includes(String(charge.source || '').toUpperCase())) continue;
          const appointmentId = itemIds.length === 1 ? itemIds[0] : String(charge.appointment_id || '');
          const appt = appointments.find((a: any) => String(a.id) === appointmentId);
          if (appt && String(appt.patient_id) === String(charge.patient_id)) safePayments.set(appointmentId, charge);
        }
        const patientIds = Array.from(new Set(appointments.map((a: any) => a.patient_id)));
        const { data: patients, error: patientError } = await supabase.from('patients')
          .select('id,name').eq('clinic_id', context.organizationId)
          .in('id', patientIds).limit(100);
        if (patientError) throw patientError;
        const names = new Map((patients || []).map((patient: any) => [String(patient.id), String(patient.name)]));
        return res.json({
          success: true,
          data: appointments.map((appointment: any) => {
            const charge = safePayments.get(String(appointment.id));
            return {
              appointmentId: appointment.id,
              patientName: names.get(String(appointment.patient_id)) || 'Paciente',
              service: appointment.service_type,
              scheduledAt: appointment.scheduled_at,
              chargeId: charge?.id || null,
              total: Number(charge?.amount || 0),
              paid: Number(charge?.paid_amount || 0),
              balance: Number(charge?.balance_amount || 0)
            };
          })
        });
      } catch (error: any) {
        const safe = patientFinanceErrorResponse(error);
        return failed(res, safe.status, safe.error);
      }
    },
    record: async (req: any, res: any) => {
      try {
        const context = await actorContext(req, res);
        if (!context) return;
        const appointmentId = sanitizeString(req.body?.appointmentId, 100);
        const paymentId = sanitizeString(req.params.paymentId, 120);
        const key = sanitizeString(req.body?.idempotencyKey || req.headers?.['x-idempotency-key'], 180);
        const method = sanitizeString(req.body?.method, 30).toLowerCase();
        const notes = sanitizeString(req.body?.notes, 1200);
        const amount = Number(req.body?.amount);
        if (!key || !Number.isFinite(amount) || amount <= 0 ||
            Math.round(amount * 100) !== amount * 100 ||
            !['pix', 'card', 'cash', 'transfer'].includes(method)) {
          return failed(res, 400, 'Informe valor, método e chave da operação válidos.');
        }
        const resolved = await chargeForActor(context, appointmentId, paymentId);
        if (!resolved) return failed(res, 403, 'Cobrança indisponível ou não vinculada a uma sessão própria concluída.');
        const balance = Number(resolved.charge.balance_amount);
        if (Math.round(amount * 100) > Math.round(balance * 100)) {
          return failed(res, 409, 'O valor recebido excede o saldo da cobrança.');
        }
        if (Math.round(amount * 100) < Math.round(balance * 100) && !notes.trim()) {
          return failed(res, 400, 'Justifique o recebimento parcial e o saldo restante.');
        }
        const { data: snapshot, error: snapshotError } = await supabase.from('appointment_private_financial_snapshots')
          .select('allow_partial_payment,allowed_payment_methods')
          .eq('organization_id', context.organizationId)
          .eq('payment_id', paymentId)
          .order('snapshot_version', { ascending: false })
          .limit(1).maybeSingle();
        if (snapshotError) throw snapshotError;
        if (snapshot?.allow_partial_payment === false && amount < balance) {
          return failed(res, 409, 'O plano particular não permite pagamento parcial.');
        }
        if (Array.isArray(snapshot?.allowed_payment_methods) && snapshot.allowed_payment_methods.length &&
            !snapshot.allowed_payment_methods.includes(method)) {
          return failed(res, 409, 'Forma de pagamento não permitida para este atendimento.');
        }
        const rpc = resolved.charge.private_price_source
          ? 'apply_private_patient_financial_operation_v2'
          : 'apply_patient_financial_operation';
        const result = await supabase.rpc(rpc, {
          p_organization_id: context.organizationId,
          p_payment_id: paymentId,
          p_operation: amount < balance ? 'PARTIAL_PAYMENT' : 'PAYMENT',
          p_amount: amount,
          p_due_date: null,
          p_method: method,
          p_transaction_at: null,
          p_proof_url: null,
          p_proof_file_name: null,
          p_proof_content_type: null,
          p_notes: notes || null,
          p_idempotency_key: key,
          p_actor_id: context.userId
        });
        if (result.error) throw result.error;
        return res.json({ success: true, data: result.data });
      } catch (error: any) {
        const safe = patientFinanceErrorResponse(error);
        return failed(res, safe.status, safe.error);
      }
    }
  };
}
