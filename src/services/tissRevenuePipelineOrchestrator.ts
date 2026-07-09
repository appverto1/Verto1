export type TissRevenuePipelineReason =
  | 'appointment_created'
  | 'appointment_updated'
  | 'session_completed'
  | 'authorization_changed'
  | 'tuss_mapping_changed'
  | 'price_changed'
  | 'manual_revalidation';

export type TissRevenuePipelineMode = 'best_effort' | 'blocking_validation';

export type TissRevenuePipelineRevalidateAppointment = (params: {
  appointmentId: string;
  user: any;
  scopedAppointment?: any;
  source: string;
  forceClosure?: boolean;
  overwriteExplicitContext?: boolean;
}) => Promise<any>;

export type TissRevenuePipelineResult = {
  ok: boolean;
  appointmentId: string;
  reason: TissRevenuePipelineReason;
  mode: TissRevenuePipelineMode;
  source: string;
  result?: any;
  status?: number;
  error?: string;
};

const reasonSourceMap: Record<TissRevenuePipelineReason, string> = {
  appointment_created: 'tiss_pipeline_appointment_created',
  appointment_updated: 'tiss_pipeline_appointment_updated',
  session_completed: 'tiss_pipeline_session_completed',
  authorization_changed: 'tiss_pipeline_authorization_changed',
  tuss_mapping_changed: 'tiss_pipeline_tuss_mapping_changed',
  price_changed: 'tiss_pipeline_price_changed',
  manual_revalidation: 'tiss_pipeline_manual_revalidation',
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function tissPipelineSourceForReason(reason: TissRevenuePipelineReason) {
  return reasonSourceMap[reason] || 'tiss_pipeline_manual_revalidation';
}

export async function runTissPipelineForAppointment(input: {
  appointmentId: string;
  user: any;
  reason: TissRevenuePipelineReason;
  revalidateAppointment: TissRevenuePipelineRevalidateAppointment;
  mode?: TissRevenuePipelineMode;
  scopedAppointment?: any;
  forceClosure?: boolean;
  overwriteExplicitContext?: boolean;
  logger?: Pick<Console, 'warn'>;
}): Promise<TissRevenuePipelineResult> {
  const appointmentId = String(input.appointmentId || '').trim();
  const mode = input.mode || 'best_effort';
  const source = tissPipelineSourceForReason(input.reason);

  if (!uuidPattern.test(appointmentId)) {
    return {
      ok: false,
      appointmentId,
      reason: input.reason,
      mode,
      source,
      status: 400,
      error: 'Consulta inválida para pipeline TISS.',
    };
  }

  try {
    const result = await input.revalidateAppointment({
      appointmentId,
      user: input.user,
      scopedAppointment: input.scopedAppointment,
      source,
      forceClosure: input.forceClosure !== false,
      overwriteExplicitContext: Boolean(input.overwriteExplicitContext),
    });
    return {
      ok: Boolean(result?.ok),
      appointmentId,
      reason: input.reason,
      mode,
      source,
      result,
      status: result?.status,
      error: result?.ok ? undefined : result?.error || 'Pré-guia não materializada.',
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    if (mode === 'best_effort') {
      input.logger?.warn?.('[TISS Pipeline] revalidação automática falhou:', {
        appointmentId,
        reason: input.reason,
        message,
      });
      return {
        ok: false,
        appointmentId,
        reason: input.reason,
        mode,
        source,
        status: 500,
        error: message,
      };
    }
    throw error;
  }
}

export async function runTissPipelineForAppointments(input: {
  appointmentIds: string[];
  user: any;
  reason: TissRevenuePipelineReason;
  revalidateAppointment: TissRevenuePipelineRevalidateAppointment;
  mode?: TissRevenuePipelineMode;
  concurrency?: number;
  logger?: Pick<Console, 'warn'>;
}): Promise<TissRevenuePipelineResult[]> {
  const uniqueAppointmentIds = Array.from(new Set((input.appointmentIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  const concurrency = Math.min(12, Math.max(1, Math.floor(Number(input.concurrency || 4) || 4)));
  const results: TissRevenuePipelineResult[] = [];

  for (let index = 0; index < uniqueAppointmentIds.length; index += concurrency) {
    const batch = uniqueAppointmentIds.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map((appointmentId) => runTissPipelineForAppointment({
      appointmentId,
      user: input.user,
      reason: input.reason,
      revalidateAppointment: input.revalidateAppointment,
      mode: input.mode || 'best_effort',
      logger: input.logger,
    })));
    results.push(...batchResults);
  }

  return results;
}
