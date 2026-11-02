import type { Express } from 'express';
import {
  financialContinuationPreview,
  previewSessionContinuation,
  resolveCanonicalSessionEnd,
  type ContinuationChoice
} from '../src/utils/sessionContinuationPolicy';
import { appointmentClinicalSpecialtyKey } from '../src/utils/sessionSpecialtyIsolation';
import { clinicalSpecialtyScopeKey } from '../src/utils/clinicalSpecialties';

type Dependencies = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  portalActionLimiter: any;
  enforcePayloadLimit: (req: any, res: any, maxBytes: number, label: string) => boolean;
  requireClinicCapability: (capability: string) => any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
};

const uuid = (value: unknown) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const ts = (value: unknown) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const activeAppointment = (a: any) => {
  const status = String(a?.status || '').toLowerCase();
  return a && a.is_active !== false && !a.deleted_at &&
    !['cancelled', 'canceled', 'cancelada', 'cancelado', 'cancelled_by_clinic', 'cancelado_pela_clinica', 'deleted', 'no_show', 'missed', 'completed'].includes(status);
};
const stableService = (service: unknown) => clinicalSpecialtyScopeKey(String(service || ''));
const safeCents = (value: unknown) => {
  const x = Number(value);
  return value !== null && value !== undefined && value !== '' &&
    Number.isFinite(x) && x >= 0 && Number.isSafeInteger(Math.round(x * 100)) ?
      Math.round(x * 100) : null;
};

// Intentionally read-only. An answer is a preview, never an authorization to
// cancel, bill, extend or close a session. The eventual write RPC must recheck
// everything inside ONE transaction and own its own idempotency record.
export function registerP0504ContinuationPreviewRoutes(app: Express, deps: Dependencies) {
  const {supabase, noStoreDynamicResponse, checkAuth, portalActionLimiter,
    enforcePayloadLimit, requireClinicCapability, sanitizeString, currentClinicId} = deps;

  app.get('/api/clinic/sessions/:sessionId/continuation-preview',
    noStoreDynamicResponse, checkAuth, requireClinicCapability('session.finish'),
    async (req: any, res: any) => {
      const actorId = sanitizeString(req.session?.user?.id, 120);
      const clinicId = sanitizeString(currentClinicId(req.session?.user), 120);
      const sessionId = sanitizeString(req.params.sessionId, 180);
      if (!uuid(actorId) || !uuid(clinicId) || !sessionId || sessionId.length > 120)
        return res.status(403).json({success:false,code:'SESSION_CONTINUATION_ACCESS_DENIED'});
      try {
        const {data:session,error:sessionError} = await supabase.from('aba_sessions')
          .select('id,clinic_id,organization_id,patient_id,therapist_id,appointment_id,status,service_type,specialty_snapshot,therapeutic_plan_id,started_at,actual_start_at,effective_end_at')
          .eq('id',sessionId).eq('clinic_id',clinicId).limit(1).maybeSingle();
        if (sessionError) throw sessionError;
        if (!session?.id || !uuid(session.appointment_id) ||
            !['active','in_progress'].includes(String(session.status || '').toLowerCase()))
          return res.status(409).json({success:false,code:'SESSION_CONTINUATION_NOT_ELIGIBLE'});

        const {data:appointment,error:appointmentError} = await supabase.from('appointments')
          .select('id,clinic_id,organization_id,patient_id,therapist_id,scheduled_at,scheduled_start_at,scheduled_end_at,duration_minutes,scheduled_duration_minutes,room_id,status,service_type,approach,source_payload,deleted_at,is_active')
          .eq('id',session.appointment_id).eq('clinic_id',clinicId).limit(1).maybeSingle();
        if (appointmentError) throw appointmentError;
        if (!appointment?.id || !activeAppointment(appointment) ||
            String(appointment.patient_id) !== String(session.patient_id) ||
            String(appointment.therapist_id) !== String(session.therapist_id) ||
            String(appointment.organization_id || appointment.clinic_id) !== clinicId ||
            String(session.organization_id || session.clinic_id) !== clinicId)
          return res.status(409).json({success:false,code:'SESSION_CONTINUATION_SCOPE_INVALID'});

        const modality = String(appointment.source_payload?.sessionModality ||
          appointment.source_payload?.session_modality || '').toUpperCase();
        if (modality === 'GROUP' || appointment.source_payload?.sessionGroupId ||
            appointment.source_payload?.session_group_id)
          return res.status(409).json({success:false,code:'SESSION_CONTINUATION_GROUP_REQUIRES_REVIEW'});

        const role = String(req.authorizationContext?.role || req.effectiveClinicRole ||
          req.session?.user?.clinicRole || req.session?.user?.role || '').toLowerCase();
        if (!['owner','admin','director','coordinator','supervisor'].includes(role) &&
            String(appointment.therapist_id) !== actorId)
          return res.status(403).json({success:false,code:'SESSION_CONTINUATION_PROFESSIONAL_DENIED'});

        const specialty = appointmentClinicalSpecialtyKey(appointment);
        const declaredSpecialty = stableService(session.service_type);
        const snapshotSpecialty = stableService(session.specialty_snapshot);
        const sessionSpecialty = declaredSpecialty || snapshotSpecialty;
        if (!specialty || !sessionSpecialty || specialty !== sessionSpecialty ||
            (snapshotSpecialty && snapshotSpecialty !== specialty))
          return res.status(409).json({success:false,code:'SESSION_CONTINUATION_SPECIALTY_UNVERIFIED'});

        const planFromAppointment = String(appointment.source_payload?.therapeuticPlanId ||
          appointment.source_payload?.therapeutic_plan_id || '').trim();
        if (planFromAppointment && planFromAppointment !== String(session.therapeutic_plan_id || ''))
          return res.status(409).json({success:false,code:'SESSION_CONTINUATION_PLAN_INVALID'});

        const duration = Number(appointment.scheduled_duration_minutes || appointment.duration_minutes);
        const started = session.actual_start_at || session.started_at;
        const input = {
          scheduledEndAt: String(appointment.scheduled_end_at || ''),
          actualStartedAt: String(started || ''),
          scheduledBaseDurationMinutes:duration,
          persistedEffectiveEndAt:session.effective_end_at || null,
        };
        const effectiveEnd = resolveCanonicalSessionEnd(input);
        if (!effectiveEnd) return res.status(409).json({success:false,code:'SESSION_CONTINUATION_TIME_UNVERIFIED'});

        const maximumEnd = previewSessionContinuation(input,'FULL')?.proposedEndAt;
        if (!maximumEnd) return res.status(409).json({success:false,code:'SESSION_CONTINUATION_DURATION_INVALID'});

        // Deliberately bounded clinic read and bounded time horizon. If too many
        // appointments match, fail closed rather than silently miss conflicts.
        const earliest = new Date(Date.parse(effectiveEnd) - 240 * 60_000).toISOString();
        const conflictColumns = 'id,clinic_id,patient_id,therapist_id,room_id,scheduled_at,scheduled_start_at,scheduled_end_at,duration_minutes,scheduled_duration_minutes,status,is_active,deleted_at';
        // Some legacy appointments use scheduled_at, while newer writes also
        // carry scheduled_start_at. An OR assembled from user strings would be
        // unsafe; use two bounded indexed reads and deduplicate by persisted ID.
        const [legacyWindow,canonicalWindow] = await Promise.all([
          supabase.from('appointments').select(conflictColumns)
            .eq('clinic_id',clinicId).gte('scheduled_at',earliest)
            .lt('scheduled_at',maximumEnd).limit(201),
          supabase.from('appointments').select(conflictColumns)
            .eq('clinic_id',clinicId).gte('scheduled_start_at',earliest)
            .lt('scheduled_start_at',maximumEnd).limit(201)
        ]);
        if (legacyWindow.error || canonicalWindow.error)
          throw legacyWindow.error || canonicalWindow.error;
        if (!Array.isArray(legacyWindow.data) || !Array.isArray(canonicalWindow.data) ||
            legacyWindow.data.length > 200 || canonicalWindow.data.length > 200)
          return res.status(409).json({success:false,code:'SESSION_CONTINUATION_CONFLICT_SCAN_INCOMPLETE'});
        const nearby = [...new Map([...legacyWindow.data,...canonicalWindow.data]
          .map((row:any)=>[String(row.id),row])).values()];

        const choices: ContinuationChoice[] = [5,10,15,'FULL'];
        const choicePreviews = choices.map(choice => {
          const preview = previewSessionContinuation(input,choice);
          if (!preview) return null;
          const startMs = Date.parse(effectiveEnd), endMs = Date.parse(preview.proposedEndAt);
          const conflicts = nearby.filter((a: any) => {
            if (!activeAppointment(a) || a.id === appointment.id) return false;
            if (String(a.clinic_id) !== clinicId) return false;
            const apptStart = ts(a.scheduled_start_at || a.scheduled_at);
            const otherDuration = Number(a.scheduled_duration_minutes || a.duration_minutes);
            const apptEnd = ts(a.scheduled_end_at) ??
              (apptStart !== null && Number.isFinite(otherDuration) && otherDuration > 0 && otherDuration <= 240 ?
                apptStart + otherDuration * 60_000 : null);
            const sharesResource = String(a.therapist_id) === String(appointment.therapist_id) ||
              String(a.patient_id) === String(appointment.patient_id) ||
              (Boolean(appointment.room_id) && String(a.room_id) === String(appointment.room_id));
            // An unknown interval is a hard block, not an empty slot.
            return sharesResource && (apptStart === null || apptEnd === null ||
              (apptStart < endMs && apptEnd > startMs));
          });
          return {
            ...preview,
            conflictCount: conflicts.length,
            hasStartedConflict: conflicts.some((a: any) => ['in_progress','active','started'].includes(String(a.status || '').toLowerCase())),
            clinicConflictFree: conflicts.length === 0,
            canCommitWithoutConflict: false, // Cross-clinic and concurrent reservations require a locked transactional check.
            canCancelConflicts: false, // Only the future transaction may authorize this.
            conflictingStartsAt: conflicts.slice(0,10).map((a: any) =>
              String(a.scheduled_start_at || a.scheduled_at)),
          };
        });
        const {data:engine,error:engineError} = await supabase.rpc('resolve_appointment_financial_engine_v1',{
          p_organization_id:clinicId,p_appointment_id:appointment.id,
          p_patient_id:appointment.patient_id,
          p_service_type:appointment.service_type || appointment.approach || null,
          p_source:appointment.source_payload || {}
        });
        if (engineError) throw engineError;
        let priceCents: number | null = null;
        const financialEngine = String(engine || '').toUpperCase();
        if (financialEngine === 'AT_SESSION') {
          const {data:snapshot,error:priceError} = await supabase
            .from('appointment_private_financial_snapshots').select('final_amount')
            .eq('organization_id',clinicId).eq('appointment_id',appointment.id)
            .order('snapshot_version',{ascending:false}).limit(1).maybeSingle();
          if (priceError) throw priceError;
          priceCents = safeCents(snapshot?.final_amount);
        }
        // Monthly session invoices require an immutable plan-version resolution.
        // Until that is transactional, never quote guessed financial values.
        const financial = priceCents === null ? null : financialContinuationPreview(priceCents,'FULL',1);
        return res.json({
          success:true,
          data:{
            sessionId:session.id,appointmentId:appointment.id,clinicId,
            baseDurationMinutes:duration,effectiveEndAt:effectiveEnd,
            financialEngine,
            financialPreviewAvailable:financial !== null,
            financial,
            choices:choicePreviews,
            previewOnly:true,commitAuthorized:false,
            reason:'CONTINUATION_TRANSACTION_NOT_AVAILABLE'
          }
        });
      } catch (e:any) {
        console.warn('[P0-504] continuation preview unavailable',{
          code:sanitizeString(e?.code,70),message:sanitizeString(e?.message,160)
        });
        return res.status(503).json({success:false,code:'SESSION_CONTINUATION_PREVIEW_UNAVAILABLE'});
      }
    });
  // Explicit persistence authority. Never save from a preview, timer or cache.
  app.post('/api/clinic/sessions/:sessionId/short-extension',
    portalActionLimiter, noStoreDynamicResponse, checkAuth,
    requireClinicCapability('session.finish'),
    async (req:any,res:any) => {
      if (!enforcePayloadLimit(req,res,2048,'Extensão curta da sessão')) return;
      const actorId=sanitizeString(req.session?.user?.id,120);
      const clinicId=sanitizeString(currentClinicId(req.session?.user),120);
      const sessionId=sanitizeString(req.params.sessionId,180);
      const minutes=req.body?.additionalMinutes;
      const key=sanitizeString(req.body?.idempotencyKey,128);
      if (!uuid(actorId) || !uuid(clinicId) || !sessionId || sessionId.length>180)
        return res.status(403).json({success:false,code:'P0504_SHORT_EXTENSION_ACCESS_DENIED'});
      if (typeof minutes!=='number' || ![5,10,15].includes(minutes) ||
          typeof req.body?.idempotencyKey!=='string' || key.length<8)
        return res.status(422).json({success:false,code:'P0504_SHORT_EXTENSION_INPUT_INVALID'});
      try {
        const result=await supabase.rpc('extend_aba_session_short_v1',{
          p_clinic_id:clinicId,p_actor_id:actorId,p_session_id:sessionId,
          p_additional_minutes:minutes,p_idempotency_key:key
        });
        if (result.error) {
          const code=String(result.error?.message || result.error?.code || '');
          if (/P0504_SHORT_EXTENSION_(?:ACCESS_DENIED|ACTOR_MISMATCH)/.test(code))
            return res.status(403).json({success:false,code:'P0504_SHORT_EXTENSION_ACCESS_DENIED'});
          if (/P0504_SHORT_EXTENSION_(?:CONFLICT|IDEMPOTENCY_CONFLICT|SESSION_NOT_ACTIVE|APPOINTMENT_INVALID|GROUP_NOT_SUPPORTED|SPECIALTY_UNVERIFIED|WINDOW_INVALID|TIME_UNVERIFIED|INTERVAL_INVALID)/.test(code))
            return res.status(409).json({success:false,code:'P0504_SHORT_EXTENSION_BLOCKED'});
          if (/P0504_SHORT_EXTENSION_INVALID_INPUT/.test(code))
            return res.status(422).json({success:false,code:'P0504_SHORT_EXTENSION_INPUT_INVALID'});
          throw result.error;
        }
        if (result.data?.success!==true || result.data?.billableUnitsCreated!==0 ||
            result.data?.calendarReservationConfirmed!==false)
          return res.status(503).json({success:false,code:'P0504_SHORT_EXTENSION_RESULT_INVALID'});
        return res.json(result.data);
      } catch(error:any) {
        console.warn('[P0-504] short extension unavailable',{code:sanitizeString(error?.code,70)});
        return res.status(503).json({success:false,code:'P0504_SHORT_EXTENSION_UNAVAILABLE'});
      }
    });

}
