import crypto from 'crypto';
import type { Express } from 'express';
import { payloadHash } from './schoolPayloadHash';
import { createSchoolErrorResponse } from './schoolErrorResponse';
import { filterPatientFilesForActor } from '../src/utils/patientFileAccess';

type SchoolRouteDeps = {
  supabase: any;
  deploymentEnv?: 'staging' | 'production' | null;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: any) => any;
  resolvePatientListScopedPatientIds: (context: any) => Promise<string[] | null>;
  portalActionLimiter: any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
};


const safeIdempotencyKey = (value: any) => String(value || '').trim().slice(0, 180);
const safeArray = (value: any) => Array.isArray(value) ? value : [];
const uniq = (values: any[]) => Array.from(new Set(values.map(String).filter(Boolean)));
const parseListParam = (value: any) => uniq(String(value || '').split(',').map((item) => item.trim()).filter(Boolean));
const nowIso = () => new Date().toISOString();
const SCHOOL_DETAIL_COLUMNS = [
  'id','organization_id','clinic_id','legal_name','display_name','trade_name','school_type','education_network',
  'tax_id','inep_code','email','phone','whatsapp','website','postal_code','street','street_number',
  'address_complement','district','city','state','country','notes','responsible_professional_id','is_active',
  'created_at','updated_at','archived_at'
].join(',');
const SCHOOL_UNIT_DETAIL_COLUMNS = [
  'id','organization_id','school_id','name','code','email','phone','whatsapp','postal_code','street','street_number',
  'address_complement','district','city','state','country','is_active','created_at','updated_at','archived_at'
].join(',');
const SCHOOL_CONTACT_DETAIL_COLUMNS = [
  'id','organization_id','school_id','school_unit_id','name','role','department','email','phone','whatsapp',
  'preferred_contact_method','notes','is_primary','is_active','created_at','updated_at','archived_at'
].join(',');
const SCHOOL_MEETING_COLUMNS = [
  'id','organization_id','clinic_id','school_id','school_unit_id','meeting_type','title','description','agenda',
  'scheduled_start','scheduled_end','timezone','location_type','location','online_meeting_url','status','created_by',
  'responsible_professional_id','completed_at','cancelled_at','cancellation_reason','created_at','updated_at','version',
  'last_transition_at','previous_scheduled_start','previous_scheduled_end'
].join(',');
const SCHOOL_DOCUMENT_COLUMNS = [
  'id','organization_id','clinic_id','school_id','school_unit_id','patient_id','meeting_id','document_id',
  'document_type','visibility','document_date','created_by','created_at','updated_at','archived_at'
].join(',');
const SCHOOL_AUDIT_SUMMARY_COLUMNS = 'id,organization_id,clinic_id,actor_id,resource_type,resource_id,action,reason,created_at';
const SCHOOL_MEETING_PATIENT_COLUMNS = [
  'id','organization_id','meeting_id','patient_id','school_enrollment_id','participation_status','patient_agenda',
  'included_by','created_at','updated_at','removed_at','removed_by','removal_reason','attendance_marked_at',
  'attendance_marked_by','attendance_notes','actual_joined_at'
].join(',');
const SCHOOL_MEETING_PARTICIPANT_COLUMNS = [
  'id','organization_id','meeting_id','participant_type','professional_id','responsible_id','school_contact_id',
  'external_name','external_email','attendance_status','invited_at','confirmed_at','attended','notes','created_by',
  'created_at','updated_at','removed_at','removed_by','removal_reason','attendance_marked_at','attendance_marked_by',
  'attendance_notes','actual_joined_at'
].join(',');
const SCHOOL_MEETING_MINUTES_COLUMNS = [
  'id','organization_id','clinic_id','meeting_id','actual_start','actual_end','general_summary','decisions','referrals',
  'next_meeting_at','status','completed_by','completed_at','created_by','updated_by','created_at','updated_at',
  'task_sync_status','task_sync_error'
].join(',');
const SCHOOL_MEETING_REFERRAL_COLUMNS = [
  'id','organization_id','clinic_id','meeting_id','patient_id','title','description','responsible_user_id','due_at',
  'priority','status','task_id','task_error','created_by','created_at','updated_at'
].join(',');
const SCHOOL_ENROLLMENT_COLUMNS = [
  'id','organization_id','clinic_id','patient_id','school_id','school_unit_id','academic_year','grade_level',
  'class_name','shift','enrollment_code','teacher_contact_id','coordinator_contact_id','is_current','started_at',
  'ended_at','exit_reason','notes','created_at','updated_at','enrollment_type','ended_by'
].join(',');
const SCHOOL_CONSENT_COLUMNS = [
  'id','organization_id','clinic_id','patient_id','school_enrollment_id','consent_type','status',
  'granted_by_responsible_id','granted_at','expires_at','revoked_at','revocation_reason','document_id','notes',
  'created_by','updated_by','created_at','updated_at','consent_version','is_current','supersedes_consent_id','effective_at'
].join(',');
const SCHOOL_MIGRATION_REVIEW_COLUMNS = [
  'id','organization_id','clinic_id','patient_id','original_value','normalized_value','candidate_school_ids','status',
  'resolution_notes','resolved_by','resolved_at','created_at','source_field','decision','selected_school_id',
  'selected_school_unit_id','review_error','updated_at'
].join(',');
const deterministicUuid = (value: string) => {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
};

export function registerSchoolManagementRoutes(app: Express, deps: SchoolRouteDeps) {
  const { supabase, deploymentEnv, noStoreDynamicResponse, checkAuth, requireClinicCapability, resolvePatientListScopedPatientIds, portalActionLimiter, sanitizeString, currentClinicId } = deps;
  const withNotificationEnvironment = (row: any) => {
    if (deploymentEnv !== 'staging' && deploymentEnv !== 'production') {
      throw new Error('NOTIFICATION_ENV_NOT_CONFIGURED');
    }
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return {
      ...row,
      deployment_env: deploymentEnv,
      idempotency_key: `${deploymentEnv}:${String(row?.idempotency_key || '').replace(/^(staging|production):/, '')}`,
      metadata: { ...metadata, deploymentEnv },
    };
  };

  const pagination = (req: any, defaultSize = 25) => {
    const page = Math.max(1, Math.min(100000, Number(req.query?.page || 1) || 1));
    const pageSize = Math.max(10, Math.min(100, Number(req.query?.pageSize || defaultSize) || defaultSize));
    return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
  };

  const workspace = async (req: any) => {
    const user = req.session?.user || {};
    const clinicId = sanitizeString(currentClinicId(user), 120);
    const actorId = sanitizeString(user?.id, 120);
    const authorizationContext = req.authorizationContext;
    if (!clinicId || !actorId || !authorizationContext || authorizationContext.clinicId !== clinicId || authorizationContext.userId !== actorId) {
      throw Object.assign(new Error('SCHOOL_WORKSPACE_REQUIRED'), { statusCode: 403 });
    }
    const clinic = await supabase.from('clinics').select('id,school_organization_id').eq('id', clinicId).maybeSingle();
    if (clinic.error || !clinic.data?.school_organization_id) throw Object.assign(new Error('SCHOOL_ORGANIZATION_MIGRATION_REQUIRED'), { statusCode: 503 });
    const scopedPatientIds = await resolvePatientListScopedPatientIds(authorizationContext);
    return {
      user,
      actorId,
      clinicId,
      organizationId: String(clinic.data.school_organization_id),
      role: String(authorizationContext.role || '').toLowerCase(),
      authorizationContext,
      scopedPatientIds,
    };
  };

  const errorResponse = createSchoolErrorResponse(sanitizeString);

  const rpc = async (name: string, scope: any, payload: any, operationPayload: any) => {
    const idempotencyKey = safeIdempotencyKey(operationPayload?.idempotencyKey);
    if (!idempotencyKey) throw new Error('SCHOOL_IDEMPOTENCY_REQUIRED');
    const args = {
      p_actor_id: scope.actorId,
      p_clinic_id: scope.clinicId,
      p_organization_id: scope.organizationId,
      ...payload,
      p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash(operationPayload)
    };
    const result = await supabase.rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  };

  const canAccessPatients = async (scope: any, patientIds: string[], clinical = false) => {
    const ids = uniq(patientIds);
    if (!ids.length) return new Set<string>();
    if (clinical && scope.role === 'receptionist') return new Set<string>();
    const allowedByScope = Array.isArray(scope.scopedPatientIds)
      ? new Set(scope.scopedPatientIds.map(String))
      : null;
    const candidateIds = allowedByScope ? ids.filter((id) => allowedByScope.has(id)) : ids;
    if (!candidateIds.length) return new Set<string>();
    const result = await supabase.from('patients').select('id').eq('clinic_id', scope.clinicId).in('id', candidateIds);
    if (result.error) throw result.error;
    return new Set((result.data || []).map((row: any) => String(row.id)));
  };

  const ensureMeeting = async (scope: any, meetingId: string, requireClinical = false) => {
    const result = await supabase.from('school_meetings').select(`${SCHOOL_MEETING_COLUMNS},schools(id,display_name),school_units(id,name)`).eq('id', meetingId).eq('organization_id', scope.organizationId).eq('clinic_id', scope.clinicId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('SCHOOL_MEETING_NOT_FOUND');
    if (requireClinical && scope.role === 'receptionist') throw new Error('ACCESS_DENIED');
    if (Array.isArray(scope.scopedPatientIds)) {
      const [participant, patientLinks] = await Promise.all([
        supabase.from('school_meeting_participants').select('id').eq('meeting_id', meetingId).eq('professional_id', scope.actorId).is('removed_at', null).limit(1),
        supabase.from('school_meeting_patients').select('patient_id').eq('meeting_id', meetingId).neq('participation_status', 'REMOVED')
      ] as any);
      if (participant.error) throw participant.error;
      if (patientLinks.error) throw patientLinks.error;
      const allowed = await canAccessPatients(scope, (patientLinks.data || []).map((row: any) => row.patient_id), requireClinical);
      if (!(participant.data || []).length && !allowed.size) throw new Error('ACCESS_DENIED');
    }
    return result.data;
  };

  const notifyMeeting = async (scope: any, meeting: any, type: string, title: string, message: string, suffix: string) => {
    const [links, participants] = await Promise.all([
      supabase.from('school_meeting_patients').select('patient_id').eq('meeting_id', meeting.id).neq('participation_status', 'REMOVED'),
      supabase.from('school_meeting_participants').select('professional_id').eq('meeting_id', meeting.id).is('removed_at', null).not('professional_id', 'is', null)
    ] as any);
    const patientIds = uniq((links.data || []).map((row: any) => row.patient_id));
    if (!patientIds.length) return;
    const patients = await supabase.from('patients').select('id,email,responsible_user_id').in('id', patientIds);
    if (patients.error) throw patients.error;
    const familyRows = (patients.data || []).map((patient: any) => ({
      organization_id: scope.organizationId,
      clinic_id: scope.clinicId,
      recipient_user_id: patient.responsible_user_id || null,
      recipient_email: patient.email || null,
      patient_id: patient.id,
      type,
      title: title.slice(0, 180),
      message: message.slice(0, 500),
      idempotency_key: `school:${meeting.id}:${suffix}:patient:${patient.id}`,
      metadata: { schoolMeetingId: meeting.id, schoolId: meeting.school_id, administrativeOnly: true }
    }));
    const firstPatientId = String((patients.data || [])[0]?.id || patientIds[0]);
    const professionalIds = uniq([meeting.responsible_professional_id, ...(participants.data || []).map((row: any) => row.professional_id)]);
    const professionalRows = professionalIds.map((professionalId) => ({
      organization_id: scope.organizationId,
      clinic_id: scope.clinicId,
      recipient_user_id: professionalId,
      recipient_email: null,
      patient_id: firstPatientId,
      type,
      title: title.slice(0, 180),
      message: message.slice(0, 500),
      idempotency_key: `school:${meeting.id}:${suffix}:professional:${professionalId}`,
      metadata: { schoolMeetingId: meeting.id, schoolId: meeting.school_id, patientIds, administrativeOnly: true }
    }));
    const rows = [...familyRows, ...professionalRows].map(withNotificationEnvironment);
    if (rows.length) {
      const result = await supabase.from('portal_notifications').upsert(rows, { onConflict: 'deployment_env,idempotency_key', ignoreDuplicates: true });
      if (result.error) throw result.error;
    }
  };

  const schoolVisibilityIds = async (scope: any) => {
    if (!Array.isArray(scope.scopedPatientIds)) return null;
    const patientIds = uniq(scope.scopedPatientIds);
    const [enrollments, participants] = await Promise.all([
      patientIds.length ? supabase.from('patient_school_enrollments').select('school_id').eq('organization_id', scope.organizationId).eq('clinic_id', scope.clinicId).in('patient_id', patientIds) : Promise.resolve({ data: [] }),
      supabase.from('school_meeting_participants').select('meeting_id').eq('organization_id', scope.organizationId).eq('professional_id', scope.actorId).is('removed_at', null)
    ] as any);
    if (enrollments.error) throw enrollments.error;
    if (participants.error) throw participants.error;
    const meetingIds = (participants.data || []).map((row: any) => row.meeting_id);
    const meetings = meetingIds.length ? await supabase.from('school_meetings').select('school_id').eq('organization_id', scope.organizationId).eq('clinic_id', scope.clinicId).in('id', meetingIds) : { data: [], error: null };
    if ((meetings as any).error) throw (meetings as any).error;
    return uniq([...(enrollments.data || []).map((row: any) => row.school_id), ...((meetings as any).data || []).map((row: any) => row.school_id)]);
  };


  const schoolMeetingVisibilityIds = async (scope: any, schoolIds?: string[]) => {
    if (!Array.isArray(scope.scopedPatientIds)) return null;
    const scopedPatientIds = uniq(scope.scopedPatientIds);
    const [patientLinks, participantLinks] = await Promise.all([
      scopedPatientIds.length
        ? supabase.from('school_meeting_patients').select('meeting_id').in('patient_id', scopedPatientIds).neq('participation_status', 'REMOVED')
        : Promise.resolve({ data: [], error: null }),
      supabase.from('school_meeting_participants').select('meeting_id').eq('organization_id', scope.organizationId).eq('professional_id', scope.actorId).is('removed_at', null)
    ] as any);
    if ((patientLinks as any).error) throw (patientLinks as any).error;
    if ((participantLinks as any).error) throw (participantLinks as any).error;
    const candidateIds = uniq([
      ...((patientLinks as any).data || []).map((row: any) => row.meeting_id),
      ...((participantLinks as any).data || []).map((row: any) => row.meeting_id),
    ]);
    if (!candidateIds.length) return [];
    let query = supabase
      .from('school_meetings')
      .select('id')
      .eq('organization_id', scope.organizationId)
      .eq('clinic_id', scope.clinicId)
      .in('id', candidateIds);
    const safeSchoolIds = uniq(schoolIds || []);
    if (safeSchoolIds.length) query = query.in('school_id', safeSchoolIds);
    const result = await query.limit(Math.min(2000, candidateIds.length));
    if (result.error) throw result.error;
    return uniq((result.data || []).map((row: any) => row.id));
  };

  const ensureSchoolVisible = async (scope: any, schoolId: string) => {
    const school = await supabase.from('schools').select('id,organization_id,is_active,archived_at').eq('id', schoolId).eq('organization_id', scope.organizationId).maybeSingle();
    if (school.error) throw school.error;
    if (!school.data) throw new Error('SCHOOL_NOT_FOUND');
    if (Array.isArray(scope.scopedPatientIds)) {
      const visibleIds = await schoolVisibilityIds(scope);
      if (!visibleIds?.includes(String(schoolId))) throw new Error('ACCESS_DENIED');
    }
    return school.data;
  };

  app.get('/api/schools', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req: any, res: any) => {
    try {
      const scope = await workspace(req); const { page, pageSize, from, to } = pagination(req);
      const visibleIds = await schoolVisibilityIds(scope);
      if (visibleIds && !visibleIds.length) return res.json({ success: true, data: [], pagination: { page, pageSize, total: 0, totalPages: 1, hasNextPage: false } });
      let query = supabase.from('schools').select('id,organization_id,clinic_id,legal_name,display_name,trade_name,school_type,education_network,tax_id,inep_code,email,phone,whatsapp,city,state,is_active,responsible_professional_id,created_at,updated_at,archived_at', { count: 'exact' }).eq('organization_id', scope.organizationId);
      if (visibleIds) query = query.in('id', visibleIds);
      if (String(req.query?.includeArchived) !== 'true') query = query.eq('is_active', true).is('archived_at', null);
      const search = sanitizeString(req.query?.search, 160).replace(/[%_,]/g, '');
      if (search) query = query.or(`display_name.ilike.%${search}%,legal_name.ilike.%${search}%,trade_name.ilike.%${search}%`);
      for (const [q, col, max] of [['city','city',120],['state','state',2],['network','education_network',40],['type','school_type',40]] as any[]) {
        const value = sanitizeString(req.query?.[q], max); if (value) query = query.eq(col, q === 'state' || q === 'network' || q === 'type' ? value.toUpperCase() : value);
      }
      const result = await query.order('display_name').range(from, to); if (result.error) throw result.error;
      const schoolIds = (result.data || []).map((row: any) => row.id);
      const visibleMeetingIds = await schoolMeetingVisibilityIds(scope, schoolIds);
      let enrollmentQuery: any = schoolIds.length
        ? supabase.from('patient_school_enrollments').select('school_id,patient_id').eq('organization_id', scope.organizationId).eq('clinic_id', scope.clinicId).eq('is_current', true).in('school_id', schoolIds)
        : null;
      if (enrollmentQuery && Array.isArray(scope.scopedPatientIds)) {
        const scopedPatientIds = uniq(scope.scopedPatientIds);
        if (!scopedPatientIds.length) enrollmentQuery = null;
        else enrollmentQuery = enrollmentQuery.in('patient_id', scopedPatientIds);
      }
      let meetingsQuery: any = schoolIds.length
        ? supabase.from('school_meetings').select('id,school_id,title,status,scheduled_start').eq('organization_id', scope.organizationId).eq('clinic_id', scope.clinicId).in('school_id', schoolIds)
        : null;
      if (meetingsQuery && Array.isArray(visibleMeetingIds)) {
        if (!visibleMeetingIds.length) meetingsQuery = null;
        else meetingsQuery = meetingsQuery.in('id', visibleMeetingIds);
      }
      const [enrollments, units, contacts, meetings] = await Promise.all([
        enrollmentQuery || Promise.resolve({ data: [] }),
        schoolIds.length ? supabase.from('school_units').select('id,school_id,name,city,state,is_active,archived_at').eq('organization_id', scope.organizationId).in('school_id', schoolIds) : Promise.resolve({ data: [] }),
        schoolIds.length ? supabase.from('school_contacts').select('id,school_id,name,role,email,phone,whatsapp,is_primary,is_active,archived_at').eq('organization_id', scope.organizationId).in('school_id', schoolIds) : Promise.resolve({ data: [] }),
        meetingsQuery ? meetingsQuery.order('scheduled_start', { ascending: false }).limit(Math.min(2000, schoolIds.length * 30)) : Promise.resolve({ data: [] })
      ] as any);
      const now = Date.now();
      const data = (result.data || []).map((school: any) => {
        const related = (meetings.data || []).filter((m: any) => m.school_id === school.id);
        return { ...school,
          patientCount: new Set((enrollments.data || []).filter((e: any) => e.school_id === school.id).map((e: any) => e.patient_id)).size,
          units: (units.data || []).filter((u: any) => u.school_id === school.id && !u.archived_at),
          contacts: (contacts.data || []).filter((c: any) => c.school_id === school.id && c.is_active && !c.archived_at),
          nextMeeting: related.filter((m: any) => ['SCHEDULED','CONFIRMED','RESCHEDULED'].includes(m.status) && new Date(m.scheduled_start).getTime() >= now).sort((a: any,b: any)=>String(a.scheduled_start).localeCompare(String(b.scheduled_start)))[0] || null,
          lastMeeting: related.filter((m: any) => new Date(m.scheduled_start).getTime() < now).sort((a: any,b: any)=>String(b.scheduled_start).localeCompare(String(a.scheduled_start)))[0] || null
        };
      });
      const total = Number(result.count || 0);
      res.json({ success: true, data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), hasNextPage: page * pageSize < total } });
    } catch (error) { errorResponse(res, error, 'Não foi possível listar as escolas.'); }
  });

  app.get('/api/schools/autocomplete', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req: any, res: any) => {
    try {
      const scope = await workspace(req);
      const { page, pageSize, from, to } = pagination(req, 20);
      const visibleIds = await schoolVisibilityIds(scope);
      if (visibleIds && !visibleIds.length) {
        return res.json({ success: true, data: [], pagination: { page, pageSize, total: 0, totalPages: 1, hasNextPage: false } });
      }
      let query = supabase
        .from('schools')
        .select('id,display_name,legal_name,city,state,education_network,school_type,street,street_number,address_complement,district,postal_code', { count: 'exact' })
        .eq('organization_id', scope.organizationId)
        .eq('is_active', true)
        .is('archived_at', null);
      if (visibleIds) query = query.in('id', visibleIds);
      const search = sanitizeString(req.query?.search, 120).replace(/[%_,]/g, ''); if (search) query = query.or(`display_name.ilike.%${search}%,legal_name.ilike.%${search}%`);
      const result = await query.order('display_name').range(from, to);
      if (result.error) throw result.error;
      const schoolIds = uniq((result.data || []).map((school: any) => school.id));
      const units = schoolIds.length
        ? await supabase
            .from('school_units')
            .select('id,school_id,name,city,state,is_active')
            .eq('organization_id', scope.organizationId)
            .eq('is_active', true)
            .is('archived_at', null)
            .in('school_id', schoolIds)
            .order('name')
        : { data: [] };
      if ((units as any).error) throw (units as any).error;
      const unitsBySchool = new Map<string, any[]>();
      for (const unit of (units as any).data || []) {
        const key = String(unit.school_id);
        unitsBySchool.set(key, [...(unitsBySchool.get(key) || []), unit]);
      }
      const total = Number(result.count || 0);
      res.json({
        success: true,
        data: (result.data || []).map((school: any) => ({
          ...school,
          units: unitsBySchool.get(String(school.id)) || []
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          hasNextPage: page * pageSize < total
        }
      });
    } catch (error) { errorResponse(res, error); }
  });

  app.get('/api/schools/:schoolId/enrollment-options', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req: any, res: any) => {
    try {
      const scope = await workspace(req);
      const schoolId = sanitizeString(req.params.schoolId, 120);
      const school = await ensureSchoolVisible(scope, schoolId);
      const [units, contacts] = await Promise.all([
        supabase
          .from('school_units')
          .select('id,school_id,name,is_active,archived_at')
          .eq('organization_id', scope.organizationId)
          .eq('school_id', schoolId)
          .eq('is_active', true)
          .is('archived_at', null)
          .order('name'),
        supabase
          .from('school_contacts')
          .select('id,school_id,school_unit_id,name,role,is_primary,is_active,archived_at')
          .eq('organization_id', scope.organizationId)
          .eq('school_id', schoolId)
          .eq('is_active', true)
          .is('archived_at', null)
          .order('is_primary', { ascending: false })
          .order('name'),
      ] as any);
      if (units.error) throw units.error;
      if (contacts.error) throw contacts.error;
      res.json({
        success: true,
        data: {
          id: school.id,
          units: units.data || [],
          contacts: contacts.data || [],
        },
      });
    } catch (error) {
      errorResponse(res, error, 'Não foi possível carregar as opções do vínculo escolar.');
    }
  });

  app.post('/api/schools', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req: any, res: any) => {
    try {
      const scope = await workspace(req); const body = req.body || {};
      const name = sanitizeString(body.displayName || body.display_name, 200); if (!name) return res.status(400).json({ success: false, error: 'SCHOOL_NAME_REQUIRED' });
      const taxId = sanitizeString(body.taxId || body.tax_id, 30).replace(/\D/g, ''); const inepCode = sanitizeString(body.inepCode || body.inep_code, 30).replace(/\D/g, '');
      const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(colegio|escola|instituto|centro educacional|unidade|campus)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
      let duplicate = supabase.from('schools').select('id,display_name,city,state,tax_id,inep_code').eq('organization_id', scope.organizationId).is('archived_at', null).limit(10);
      if (taxId) duplicate = duplicate.eq('tax_id', taxId); else if (inepCode) duplicate = duplicate.eq('inep_code', inepCode); else duplicate = duplicate.eq('normalized_name', normalized).eq('city', sanitizeString(body.city, 160)).eq('state', sanitizeString(body.state, 2).toUpperCase());
      const candidates = await duplicate; if (candidates.error) throw candidates.error;
      if ((candidates.data || []).length && body.confirmPossibleDuplicate !== true) return res.status(409).json({ success: false, error: 'POSSIBLE_SCHOOL_DUPLICATE', candidates: candidates.data });
      const result = await rpc('school_create_school_v2', scope, { p_payload: body }, body); res.status(201).json(result);
    } catch (error) { errorResponse(res, error, 'Não foi possível cadastrar a escola.'); }
  });

  app.patch('/api/schools/:schoolId', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req: any, res: any) => {
    try {
      const scope = await workspace(req);
      const schoolId = sanitizeString(req.params.schoolId, 120);
      await ensureSchoolVisible(scope, schoolId);
      const result = await rpc('school_update_school_v2', scope, { p_school_id: schoolId, p_payload: req.body || {} }, req.body || {});
      res.json(result);
    } catch (error) { errorResponse(res, error); }
  });

  app.get('/api/schools/:schoolId', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req: any, res: any) => {
    try {
      const scope = await workspace(req);
      const schoolId = sanitizeString(req.params.schoolId, 120);
      await ensureSchoolVisible(scope, schoolId);
      const school = await supabase.from('schools').select(SCHOOL_DETAIL_COLUMNS).eq('id', schoolId).eq('organization_id', scope.organizationId).maybeSingle();
      if (school.error) throw school.error;
      if (!school.data) throw new Error('SCHOOL_NOT_FOUND');

      const section = sanitizeString(req.query?.section, 30).toLowerCase();
      if (section === 'summary') {
        const [units, contacts] = await Promise.all([
          supabase.from('school_units').select(SCHOOL_UNIT_DETAIL_COLUMNS).eq('organization_id', scope.organizationId).eq('school_id', schoolId).order('name'),
          supabase.from('school_contacts').select(SCHOOL_CONTACT_DETAIL_COLUMNS).eq('organization_id', scope.organizationId).eq('school_id', schoolId).order('is_primary', { ascending: false }).order('name'),
        ] as any);
        if (units.error) throw units.error;
        if (contacts.error) throw contacts.error;
        return res.json({ success: true, data: { ...school.data, units: units.data || [], contacts: contacts.data || [] } });
      }
      if (section === 'audit') {
        const audit = !['director', 'coordinator'].includes(scope.role)
          ? { data: [] }
          : await supabase.from('school_audit_events').select(SCHOOL_AUDIT_SUMMARY_COLUMNS).eq('organization_id', scope.organizationId).eq('resource_type', 'SCHOOL').eq('resource_id', schoolId).order('created_at', { ascending: false }).limit(100);
        if ((audit as any).error) throw (audit as any).error;
        return res.json({ success: true, data: { id: school.data.id, audit: (audit as any).data || [] } });
      }
      const [units, contacts, enrollments, meetings, documents, audit] = await Promise.all([
        supabase.from('school_units').select(SCHOOL_UNIT_DETAIL_COLUMNS).eq('organization_id', scope.organizationId).eq('school_id', schoolId).order('name'),
        supabase.from('school_contacts').select(SCHOOL_CONTACT_DETAIL_COLUMNS).eq('organization_id', scope.organizationId).eq('school_id', schoolId).order('is_primary', { ascending: false }).order('name'),
        supabase.from('patient_school_enrollments').select('id,patient_id,school_unit_id,academic_year,grade_level,class_name,shift,enrollment_type,is_current,started_at,ended_at').eq('organization_id', scope.organizationId).eq('school_id', schoolId).order('started_at', { ascending: false }).limit(500),
        supabase.from('school_meetings').select(SCHOOL_MEETING_COLUMNS).eq('organization_id', scope.organizationId).eq('school_id', schoolId).eq('clinic_id', scope.clinicId).order('scheduled_start', { ascending: false }).limit(200),
        supabase.from('school_document_links').select(SCHOOL_DOCUMENT_COLUMNS).eq('organization_id', scope.organizationId).eq('school_id', schoolId).is('archived_at', null).order('created_at', { ascending: false }).limit(200),
        !['director', 'coordinator'].includes(scope.role) ? Promise.resolve({ data: [] }) : supabase.from('school_audit_events').select(SCHOOL_AUDIT_SUMMARY_COLUMNS).eq('organization_id', scope.organizationId).eq('resource_type', 'SCHOOL').eq('resource_id', schoolId).order('created_at', { ascending: false }).limit(100)
      ] as any);
      for (const result of [units, contacts, enrollments, meetings, documents, audit]) if (result?.error) throw result.error;

      const enrollmentPatientIds = uniq((enrollments.data || []).map((row: any) => row.patient_id));
      const allowed = await canAccessPatients(scope, enrollmentPatientIds);
      const visibleEnrollments = (enrollments.data || []).filter((row: any) => allowed.has(String(row.patient_id)));
      const patientIds = uniq(visibleEnrollments.map((row: any) => row.patient_id));
      const patients = patientIds.length ? await supabase.from('patients').select('id,name,email,status').eq('clinic_id', scope.clinicId).in('id', patientIds) : { data: [] };
      if ((patients as any).error) throw (patients as any).error;

      const meetingIds = uniq((meetings.data || []).map((row: any) => row.id));
      const [meetingPatients, ownParticipation] = await Promise.all([
        meetingIds.length ? supabase.from('school_meeting_patients').select('meeting_id,patient_id').in('meeting_id', meetingIds).neq('participation_status', 'REMOVED') : Promise.resolve({ data: [] }),
        meetingIds.length && Array.isArray(scope.scopedPatientIds) ? supabase.from('school_meeting_participants').select('meeting_id').in('meeting_id', meetingIds).eq('professional_id', scope.actorId).is('removed_at', null) : Promise.resolve({ data: [] })
      ] as any);
      const ownMeetingIds = new Set((ownParticipation.data || []).map((row: any) => String(row.meeting_id)));
      const visibleMeetingIds = new Set((meetings.data || []).filter((meeting: any) => !Array.isArray(scope.scopedPatientIds) || meeting.responsible_professional_id === scope.actorId || ownMeetingIds.has(String(meeting.id)) || (meetingPatients.data || []).some((link: any) => link.meeting_id === meeting.id && allowed.has(String(link.patient_id)))).map((meeting: any) => String(meeting.id)));
      const visibleMeetings = (meetings.data || []).filter((meeting: any) => visibleMeetingIds.has(String(meeting.id)));
      const visibleDocuments = (documents.data || []).filter((link: any) => {
        if (link.patient_id && (scope.role === 'receptionist' || !allowed.has(String(link.patient_id)))) return false;
        return !link.meeting_id || visibleMeetingIds.has(String(link.meeting_id));
      });
      const documentIds = uniq(visibleDocuments.map((link: any) => link.document_id));
      const fileResult = documentIds.length ? await supabase.from('patient_files').select('id,file_name,mime_type,file_size_bytes,created_at,patient_id,uploaded_by,access_scope,patient_portal_visible,metadata').in('id', documentIds) : { data: [] };
      if ((fileResult as any).error) throw (fileResult as any).error;
      const visibleFileRows = await filterPatientFilesForActor({ supabase, rows: (fileResult as any).data || [], actorId: scope.actorId, actorRole: scope.role, logger: console });
      const fileMap = new Map(visibleFileRows.map((file: any) => [String(file.id), file]));
      const patientMap = new Map(((patients as any).data || []).map((patient: any) => [String(patient.id), patient]));
      const meetingMap = new Map(visibleMeetings.map((meeting: any) => [String(meeting.id), meeting]));

      res.json({
        success: true,
        data: {
          ...school.data,
          units: units.data || [],
          contacts: contacts.data || [],
          enrollments: visibleEnrollments,
          patients: (patients as any).data || [],
          meetings: visibleMeetings,
          documents: visibleDocuments.filter((link: any) => fileMap.has(String(link.document_id))).map((link: any) => ({
            ...link,
            document: fileMap.get(String(link.document_id)) || null,
            patients: link.patient_id ? patientMap.get(String(link.patient_id)) || null : null,
            school_meetings: link.meeting_id ? meetingMap.get(String(link.meeting_id)) || null : null,
          })),
          audit: audit.data || []
        }
      });
    } catch (error) { errorResponse(res, error, 'Não foi possível abrir a escola.'); }
  });

  app.get('/api/schools/:schoolId/units', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req: any, res: any) => {
    try { const scope = await workspace(req); await ensureSchoolVisible(scope, sanitizeString(req.params.schoolId,120)); const result = await supabase.from('school_units').select(SCHOOL_UNIT_DETAIL_COLUMNS).eq('organization_id', scope.organizationId).eq('school_id', sanitizeString(req.params.schoolId,120)).order('name'); if (result.error) throw result.error; res.json({ success: true, data: result.data || [] }); } catch (error) { errorResponse(res,error); }
  });
  app.post('/api/schools/:schoolId/units', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req: any,res:any)=>{ try{ const scope=await workspace(req); await ensureSchoolVisible(scope,sanitizeString(req.params.schoolId,120)); const result=await rpc('school_upsert_unit_v2',scope,{p_school_id:sanitizeString(req.params.schoolId,120),p_unit_id:null,p_payload:req.body||{}},req.body||{}); res.status(201).json(result);}catch(error){errorResponse(res,error);} });
  app.patch('/api/schools/:schoolId/units/:unitId', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req: any,res:any)=>{ try{ const scope=await workspace(req); await ensureSchoolVisible(scope,sanitizeString(req.params.schoolId,120)); const result=await rpc('school_upsert_unit_v2',scope,{p_school_id:sanitizeString(req.params.schoolId,120),p_unit_id:sanitizeString(req.params.unitId,120),p_payload:req.body||{}},req.body||{}); res.json(result);}catch(error){errorResponse(res,error);} });

  app.get('/api/schools/:schoolId/contacts', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req:any,res:any)=>{ try{const scope=await workspace(req);await ensureSchoolVisible(scope,sanitizeString(req.params.schoolId,120));const result=await supabase.from('school_contacts').select(SCHOOL_CONTACT_DETAIL_COLUMNS).eq('organization_id',scope.organizationId).eq('school_id',sanitizeString(req.params.schoolId,120)).order('is_primary',{ascending:false}).order('name');if(result.error)throw result.error;res.json({success:true,data:result.data||[]});}catch(error){errorResponse(res,error);} });
  app.post('/api/schools/:schoolId/contacts', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req:any,res:any)=>{try{const scope=await workspace(req);await ensureSchoolVisible(scope,sanitizeString(req.params.schoolId,120));const result=await rpc('school_upsert_contact_v2',scope,{p_school_id:sanitizeString(req.params.schoolId,120),p_contact_id:null,p_payload:req.body||{}},req.body||{});res.status(201).json(result);}catch(error){errorResponse(res,error);} });
  app.patch('/api/schools/:schoolId/contacts/:contactId', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req:any,res:any)=>{try{const scope=await workspace(req);await ensureSchoolVisible(scope,sanitizeString(req.params.schoolId,120));const result=await rpc('school_upsert_contact_v2',scope,{p_school_id:sanitizeString(req.params.schoolId,120),p_contact_id:sanitizeString(req.params.contactId,120),p_payload:req.body||{}},req.body||{});res.json(result);}catch(error){errorResponse(res,error);} });

  app.get('/api/patients/:patientId/school-enrollments', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req:any,res:any)=>{try{const scope=await workspace(req);const patientId=sanitizeString(req.params.patientId,120);const allowed=await canAccessPatients(scope,[patientId]);if(!allowed.has(patientId))throw new Error('PATIENT_ACCESS_DENIED');const result=await supabase.from('patient_school_enrollments').select(`${SCHOOL_ENROLLMENT_COLUMNS},schools(id,display_name,city,state),school_units(id,name),teacher:school_contacts!patient_school_enrollments_teacher_contact_id_fkey(id,name),coordinator:school_contacts!patient_school_enrollments_coordinator_contact_id_fkey(id,name)`).eq('organization_id',scope.organizationId).eq('patient_id',patientId).order('started_at',{ascending:false});if(result.error)throw result.error;res.json({success:true,data:result.data||[]});}catch(error){errorResponse(res,error);} });
  app.post('/api/patients/:patientId/school-enrollments', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req:any,res:any)=>{try{const scope=await workspace(req);const patientId=sanitizeString(req.params.patientId,120);const allowed=await canAccessPatients(scope,[patientId]);if(!allowed.has(patientId))throw new Error('PATIENT_ACCESS_DENIED');const result=await rpc('school_save_enrollment_v3',scope,{p_patient_id:patientId,p_payload:req.body||{}},req.body||{});res.status(201).json(result);}catch(error){errorResponse(res,error);} });
  app.patch('/api/patients/:patientId/school-enrollments/:enrollmentId', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req:any,res:any)=>{try{const scope=await workspace(req);const patientId=sanitizeString(req.params.patientId,120);const allowed=await canAccessPatients(scope,[patientId]);if(!allowed.has(patientId))throw new Error('PATIENT_ACCESS_DENIED');const body={...(req.body||{}),enrollmentId:sanitizeString(req.params.enrollmentId,120)};const result=await rpc('school_save_enrollment_v3',scope,{p_patient_id:patientId,p_payload:body},body);res.json(result);}catch(error){errorResponse(res,error);} });
  app.post('/api/patients/:patientId/school-enrollments/:enrollmentId/end', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req:any,res:any)=>{try{const scope=await workspace(req);const patientId=sanitizeString(req.params.patientId,120);const allowed=await canAccessPatients(scope,[patientId]);if(!allowed.has(patientId))throw new Error('PATIENT_ACCESS_DENIED');const body=req.body||{};const result=await rpc('school_end_enrollment_v2',scope,{p_patient_id:patientId,p_enrollment_id:sanitizeString(req.params.enrollmentId,120),p_reason:sanitizeString(body.reason,1000)||null},body);res.json(result);}catch(error){errorResponse(res,error);} });

  app.get('/api/schools/:schoolId/patients/autocomplete', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req:any,res:any)=>{
    try {
      const scope=await workspace(req);
      const schoolId=sanitizeString(req.params.schoolId,120);
      await ensureSchoolVisible(scope,schoolId);
      const {page,pageSize,from,to}=pagination(req,20);
      const search=sanitizeString(req.query?.search,120).replace(/[%_,]/g,'');
      let query=supabase
        .from('patients')
        .select('id,name,email,status',{count:'exact'})
        .eq('clinic_id',scope.clinicId)
        .or('status.is.null,status.neq.inactive');
      if(Array.isArray(scope.scopedPatientIds)){
        if(!scope.scopedPatientIds.length)return res.json({success:true,data:[],pagination:{page,pageSize,total:0,totalPages:1,hasNextPage:false}});
        query=query.in('id',scope.scopedPatientIds);
      }
      if(search)query=query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      const patients=await query.order('name').range(from,to);
      if(patients.error)throw patients.error;
      const patientIds=uniq((patients.data||[]).map((patient:any)=>patient.id));
      const enrollments=patientIds.length
        ? await supabase
            .from('patient_school_enrollments')
            .select('id,patient_id,school_id,enrollment_type,is_current,started_at')
            .eq('organization_id',scope.organizationId)
            .eq('clinic_id',scope.clinicId)
            .eq('is_current',true)
            .in('patient_id',patientIds)
        : {data:[]};
      if((enrollments as any).error)throw (enrollments as any).error;
      const linksByPatient=new Map<string,any[]>();
      for(const enrollment of (enrollments as any).data||[]){
        const key=String(enrollment.patient_id);
        linksByPatient.set(key,[...(linksByPatient.get(key)||[]),enrollment]);
      }
      const total=Number(patients.count||0);
      return res.json({
        success:true,
        data:(patients.data||[]).map((patient:any)=>{
          const links=linksByPatient.get(String(patient.id))||[];
          return {
            ...patient,
            alreadyLinkedToSchool:links.some((link:any)=>String(link.school_id)===schoolId),
            currentSchoolLinks:links
          };
        }),
        pagination:{page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize)),hasNextPage:page*pageSize<total}
      });
    } catch(error){errorResponse(res,error,'Não foi possível buscar pacientes para vínculo.');}
  });

  app.get('/api/patients/:patientId/care-locations', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req:any,res:any)=>{
    try {
      const scope=await workspace(req);
      const patientId=sanitizeString(req.params.patientId,120);
      const allowed=await canAccessPatients(scope,[patientId]);
      if(!allowed.has(patientId))throw new Error('PATIENT_ACCESS_DENIED');
      const [patient,enrollments]=await Promise.all([
        supabase
          .from('patients')
          .select('id,name,phone,cep,metadata,clinic_id')
          .eq('id',patientId)
          .eq('clinic_id',scope.clinicId)
          .maybeSingle(),
        supabase
          .from('patient_school_enrollments')
          .select('id,school_id,school_unit_id,enrollment_type,academic_year,grade_level,class_name,shift,teacher_contact_id,coordinator_contact_id,schools(id,display_name,street,street_number,address_complement,district,city,state,postal_code),school_units(id,name,street,street_number,address_complement,district,city,state,postal_code)')
          .eq('organization_id',scope.organizationId)
          .eq('clinic_id',scope.clinicId)
          .eq('patient_id',patientId)
          .eq('is_current',true)
          .order('enrollment_type')
      ] as any);
      if(patient.error)throw patient.error;
      if(enrollments.error)throw enrollments.error;
      if(!patient.data)throw new Error('PATIENT_NOT_FOUND');
      const contactIds=uniq((enrollments.data||[]).flatMap((row:any)=>[row.teacher_contact_id,row.coordinator_contact_id]).filter(Boolean));
      const schoolIds=uniq((enrollments.data||[]).map((row:any)=>row.school_id).filter(Boolean));
      const [contacts,availableUnits]=await Promise.all([
        contactIds.length
          ? supabase.from('school_contacts').select('id,school_id,school_unit_id,name,role,email,phone,whatsapp,is_primary').eq('organization_id',scope.organizationId).in('id',contactIds)
          : Promise.resolve({data:[]}),
        schoolIds.length
          ? supabase.from('school_units').select('id,school_id,name,street,street_number,address_complement,district,city,state,postal_code').eq('organization_id',scope.organizationId).in('school_id',schoolIds).eq('is_active',true).is('archived_at',null).order('name')
          : Promise.resolve({data:[]})
      ] as any);
      if((contacts as any).error)throw (contacts as any).error;
      if((availableUnits as any).error)throw (availableUnits as any).error;
      const contactMap=new Map(((contacts as any).data||[]).map((contact:any)=>[String(contact.id),contact]));
      const unitsBySchool=new Map<string,any[]>();
      for(const unit of ((availableUnits as any).data||[])){
        const key=String(unit.school_id);
        unitsBySchool.set(key,[...(unitsBySchool.get(key)||[]),unit]);
      }
      const metadata=patient.data.metadata&&typeof patient.data.metadata==='object'?patient.data.metadata:{};
      const address=metadata.address&&typeof metadata.address==='object'?metadata.address:{};
      const homeAddress={
        postalCode:sanitizeString(patient.data.cep||address.cep||address.postalCode,20)||null,
        street:sanitizeString(address.logradouro||address.street,180)||null,
        number:sanitizeString(address.numero||address.number,40)||null,
        complement:sanitizeString(address.complemento||address.complement,120)||null,
        district:sanitizeString(address.bairro||address.district||address.neighborhood,120)||null,
        city:sanitizeString(address.cidade||address.city,120)||null,
        state:sanitizeString(address.uf||address.state,2).toUpperCase()||null,
        reference:sanitizeString(address.referencia||address.reference,240)||null,
        operationalPhone:sanitizeString(patient.data.phone,40)||null
      };
      const homeAddressComplete=Boolean(homeAddress.street&&homeAddress.number&&homeAddress.city);
      return res.json({
        success:true,
        data:{
          patient:{id:patient.data.id,name:patient.data.name},
          home:{
            address:homeAddress,
            isComplete:homeAddressComplete,
            missing:[
              ...(!homeAddress.street?['logradouro']:[]),
              ...(!homeAddress.number?['número']:[]),
              ...(!homeAddress.city?['cidade']:[])
            ]
          },
          schools:(enrollments.data||[]).map((enrollment:any)=>({
            ...enrollment,
            teacher:contactMap.get(String(enrollment.teacher_contact_id))||null,
            coordinator:contactMap.get(String(enrollment.coordinator_contact_id))||null,
            availableUnits:unitsBySchool.get(String(enrollment.school_id))||[],
            requiresUnit:(unitsBySchool.get(String(enrollment.school_id))||[]).length>0&&!enrollment.school_unit_id
          }))
        }
      });
    } catch(error){errorResponse(res,error,'Não foi possível carregar os locais de atendimento deste paciente.');}
  });

  app.get('/api/patients/:patientId/school-consents', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req:any,res:any)=>{try{const scope=await workspace(req);const patientId=sanitizeString(req.params.patientId,120);const allowed=await canAccessPatients(scope,[patientId]);if(!allowed.has(patientId))throw new Error('PATIENT_ACCESS_DENIED');const result=await supabase.from('school_consents').select(`${SCHOOL_CONSENT_COLUMNS},patient_school_enrollments(id,school_id,school_unit_id),schools:patient_school_enrollments(schools(id,display_name))`).eq('organization_id',scope.organizationId).eq('patient_id',patientId).order('effective_at',{ascending:false});if(result.error)throw result.error;res.json({success:true,data:result.data||[],current:(result.data||[]).filter((c:any)=>c.is_current)});}catch(error){errorResponse(res,error);} });
  app.post('/api/patients/:patientId/school-consents', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async (req:any,res:any)=>{try{const scope=await workspace(req);const patientId=sanitizeString(req.params.patientId,120);const allowed=await canAccessPatients(scope,[patientId]);if(!allowed.has(patientId))throw new Error('PATIENT_ACCESS_DENIED');const body=req.body||{};const result=await rpc('school_record_consent_v2',scope,{p_patient_id:patientId,p_payload:body},body);const patient=await supabase.from('patients').select('id,email,responsible_user_id').eq('id',patientId).eq('clinic_id',scope.clinicId).maybeSingle();if(patient.data){const status=String(body.status||'PENDING').toUpperCase();const notification=await supabase.from('portal_notifications').upsert(withNotificationEnvironment({organization_id:scope.organizationId,clinic_id:scope.clinicId,recipient_user_id:patient.data.responsible_user_id||null,recipient_email:patient.data.email||null,patient_id:patientId,type:status==='PENDING'?'SCHOOL_CONSENT_PENDING':'SCHOOL_CONSENT_UPDATED',title:status==='PENDING'?'Autorização escolar pendente':'Autorização escolar atualizada',message:'O status de uma autorização escolar foi atualizado.',idempotency_key:`school:consent:${safeIdempotencyKey(body.idempotencyKey)}`,metadata:{consentType:body.consentType,status,administrativeOnly:true}}),{onConflict:'deployment_env,idempotency_key',ignoreDuplicates:true});if(notification.error)throw notification.error;}res.status(201).json(result);}catch(error){errorResponse(res,error);} });

  app.get('/api/schools/patients/search', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req:any,res:any)=>{
    try{
      const scope=await workspace(req);
      const {page,pageSize,from,to}=pagination(req);
      const professionalFilter=sanitizeString(req.query?.professionalId,120);
      const patientStatus=sanitizeString(req.query?.patientStatus,40);
      const consentStatus=sanitizeString(req.query?.consentStatus,40).toUpperCase();
      let candidatePatientIds:string[]|null=Array.isArray(scope.scopedPatientIds)?uniq(scope.scopedPatientIds):null;

      if(professionalFilter||patientStatus){
        let patientScope=supabase.from('patients').select('id').eq('clinic_id',scope.clinicId);
        if(professionalFilter==='unassigned')patientScope=patientScope.is('therapist_id',null);
        else if(professionalFilter)patientScope=patientScope.eq('therapist_id',professionalFilter);
        if(patientStatus)patientScope=patientScope.eq('status',patientStatus);
        if(candidatePatientIds){
          if(!candidatePatientIds.length)return res.json({success:true,data:[],pagination:{page,pageSize,total:0,totalPages:1,hasNextPage:false},filtersApplied:req.query||{}});
          patientScope=patientScope.in('id',candidatePatientIds);
        }
        const patientScopeResult=await patientScope.limit(10000);
        if(patientScopeResult.error)throw patientScopeResult.error;
        candidatePatientIds=uniq((patientScopeResult.data||[]).map((row:any)=>row.id));
        if(!candidatePatientIds.length)return res.json({success:true,data:[],pagination:{page,pageSize,total:0,totalPages:1,hasNextPage:false},filtersApplied:req.query||{}});
      }

      if(consentStatus){
        let consentQuery=supabase.from('school_consents').select('patient_id').eq('organization_id',scope.organizationId).eq('is_current',true);
        if(consentStatus==='EXPIRED')consentQuery=consentQuery.or(`status.eq.EXPIRED,and(status.eq.AUTHORIZED,expires_at.lt.${new Date().toISOString()})`);
        else consentQuery=consentQuery.eq('status',consentStatus);
        const consentResult=await consentQuery.limit(10000);
        if(consentResult.error)throw consentResult.error;
        const consentPatientIds=new Set(uniq((consentResult.data||[]).map((row:any)=>row.patient_id)));
        candidatePatientIds=candidatePatientIds?candidatePatientIds.filter((id)=>consentPatientIds.has(id)):Array.from(consentPatientIds);
        if(!candidatePatientIds.length)return res.json({success:true,data:[],pagination:{page,pageSize,total:0,totalPages:1,hasNextPage:false},filtersApplied:req.query||{}});
      }

      let query=supabase.from('patient_school_enrollments').select('id,patient_id,school_id,school_unit_id,academic_year,grade_level,class_name,shift,teacher_contact_id,coordinator_contact_id,enrollment_type,is_current,started_at,ended_at,schools!inner(id,display_name,city,state),school_units(id,name),teacher:school_contacts!patient_school_enrollments_teacher_contact_id_fkey(id,name),coordinator:school_contacts!patient_school_enrollments_coordinator_contact_id_fkey(id,name)',{count:'exact'}).eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId);
      const filters:any={schoolId:'school_id',unitId:'school_unit_id',gradeLevel:'grade_level',className:'class_name',shift:'shift',teacherContactId:'teacher_contact_id',coordinatorContactId:'coordinator_contact_id',enrollmentType:'enrollment_type'};
      for(const [key,column] of Object.entries(filters)){const value=sanitizeString(req.query?.[key],160);if(value)query=query.eq(column,value);}
      const city=sanitizeString(req.query?.city,160);if(city)query=query.eq('schools.city',city);
      const state=sanitizeString(req.query?.state,2).toUpperCase();if(state)query=query.eq('schools.state',state);
      if(candidatePatientIds)query=query.in('patient_id',candidatePatientIds);
      if(String(req.query?.includeHistorical)!=='true')query=query.eq('is_current',true);
      const result=await query.order('is_current',{ascending:false}).order('started_at',{ascending:false}).range(from,to);
      if(result.error)throw result.error;

      const patientIds=uniq((result.data||[]).map((row:any)=>row.patient_id));
      const [patientResult,consents,meetingLinks]=await Promise.all([
        patientIds.length?supabase.from('patients').select('id,name,birth_date,email,status,therapist_id,clinic_id').eq('clinic_id',scope.clinicId).in('id',patientIds):Promise.resolve({data:[]}),
        patientIds.length?supabase.from('school_consents').select('patient_id,consent_type,status,expires_at,revoked_at,effective_at').eq('organization_id',scope.organizationId).eq('is_current',true).in('patient_id',patientIds):Promise.resolve({data:[]}),
        patientIds.length?supabase.from('school_meeting_patients').select('patient_id,meeting_id').eq('organization_id',scope.organizationId).neq('participation_status','REMOVED').in('patient_id',patientIds):Promise.resolve({data:[]})
      ] as any);
      if(patientResult.error)throw patientResult.error;if(consents.error)throw consents.error;if(meetingLinks.error)throw meetingLinks.error;
      const meetingIds=uniq((meetingLinks.data||[]).map((row:any)=>row.meeting_id));
      const meetings=meetingIds.length?await supabase.from('school_meetings').select('id,title,status,scheduled_start').eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId).in('id',meetingIds).order('scheduled_start',{ascending:false}):{data:[]};
      if((meetings as any).error)throw (meetings as any).error;
      const patientMap=new Map((patientResult.data||[]).map((patient:any)=>[String(patient.id),patient]));
      const consentByPatient=new Map<string,any[]>();
      for(const consent of consents.data||[]){const key=String(consent.patient_id);const rows=consentByPatient.get(key)||[];rows.push(consent);consentByPatient.set(key,rows);}
      const meetingById=new Map((meetings.data||[]).map((meeting:any)=>[String(meeting.id),meeting]));
      const meetingsByPatient=new Map<string,any[]>();
      for(const link of meetingLinks.data||[]){const meeting=meetingById.get(String(link.meeting_id));if(!meeting)continue;const key=String(link.patient_id);const rows=meetingsByPatient.get(key)||[];rows.push(meeting);meetingsByPatient.set(key,rows);}
      const now=Date.now();
      const rows=(result.data||[]).map((row:any)=>{
        const patientKey=String(row.patient_id);const patientMeetings=meetingsByPatient.get(patientKey)||[];
        return{...row,patient:patientMap.get(patientKey),consents:consentByPatient.get(patientKey)||[],lastMeeting:patientMeetings.filter((meeting:any)=>meeting.scheduled_start&&new Date(meeting.scheduled_start).getTime()<now).sort((a:any,b:any)=>String(b.scheduled_start).localeCompare(String(a.scheduled_start)))[0]||null,nextMeeting:patientMeetings.filter((meeting:any)=>meeting.scheduled_start&&new Date(meeting.scheduled_start).getTime()>=now&&['SCHEDULED','CONFIRMED','RESCHEDULED'].includes(meeting.status)).sort((a:any,b:any)=>String(a.scheduled_start).localeCompare(String(b.scheduled_start)))[0]||null};
      });
      const total=Number(result.count||0);
      res.json({success:true,data:rows,pagination:{page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize)),hasNextPage:page*pageSize<total},filtersApplied:req.query||{}});
    }catch(error){errorResponse(res,error,'Não foi possível filtrar os pacientes por escola.');}
  });

  app.get('/api/school-meetings', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async (req:any,res:any)=>{
    try{
      const scope=await workspace(req);const {page,pageSize,from,to}=pagination(req);
      let visibleMeetingIds:string[]|null=null;
      if(Array.isArray(scope.scopedPatientIds)){
        const assignedIds=uniq(scope.scopedPatientIds);
        const [links,participants,responsible]=await Promise.all([
          assignedIds.length?supabase.from('school_meeting_patients').select('meeting_id').eq('organization_id',scope.organizationId).in('patient_id',assignedIds).neq('participation_status','REMOVED'):Promise.resolve({data:[]}),
          supabase.from('school_meeting_participants').select('meeting_id').eq('organization_id',scope.organizationId).eq('professional_id',scope.actorId).is('removed_at',null),
          supabase.from('school_meetings').select('id').eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId).eq('responsible_professional_id',scope.actorId)
        ] as any);
        visibleMeetingIds=uniq([...(links.data||[]).map((row:any)=>row.meeting_id),...(participants.data||[]).map((row:any)=>row.meeting_id),...(responsible.data||[]).map((row:any)=>row.id)]);
        if(!visibleMeetingIds.length)return res.json({success:true,data:[],pagination:{page,pageSize,total:0,totalPages:1,hasNextPage:false}});
      }
      let query=supabase.from('school_meetings').select(`${SCHOOL_MEETING_COLUMNS},schools(id,display_name),school_units(id,name)`,{count:'exact'}).eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId);
      if(visibleMeetingIds)query=query.in('id',visibleMeetingIds);
      for(const [q,c] of [['schoolId','school_id'],['unitId','school_unit_id'],['status','status'],['meetingType','meeting_type']] as any[]){const values=parseListParam(req.query?.[q]);if(values.length===1)query=query.eq(c,values[0]);else if(values.length>1)query=query.in(c,values);}
      if(req.query?.from)query=query.gte('scheduled_start',sanitizeString(req.query.from,80));if(req.query?.to)query=query.lte('scheduled_start',sanitizeString(req.query.to,80));
      const result=await query.order('scheduled_start',{ascending:false}).range(from,to);if(result.error)throw result.error;
      const total=Number(result.count||0);
      res.json({success:true,data:result.data||[],pagination:{page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize)),hasNextPage:page*pageSize<total}});
    }catch(error){errorResponse(res,error);}
  });

  app.get('/api/school-meetings/:meetingId', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async(req:any,res:any)=>{
    try{
      const scope=await workspace(req);const meeting=await ensureMeeting(scope,sanitizeString(req.params.meetingId,120));
      const [patientLinks,participants,minutes,documents,referrals,contacts]=await Promise.all([
        supabase.from('school_meeting_patients').select(`${SCHOOL_MEETING_PATIENT_COLUMNS},patients(id,name,email,therapist_id,responsible_user_id),patient_school_enrollments(id,grade_level,class_name,shift)`).eq('meeting_id',meeting.id).order('created_at'),
        supabase.from('school_meeting_participants').select(`${SCHOOL_MEETING_PARTICIPANT_COLUMNS},school_contacts(id,name,role,email,phone)`).eq('meeting_id',meeting.id).order('created_at'),
        scope.role === 'receptionist' ? Promise.resolve({ data: null }) : supabase.from('school_meeting_minutes').select(SCHOOL_MEETING_MINUTES_COLUMNS).eq('meeting_id',meeting.id).maybeSingle(),
        supabase.from('school_document_links').select(SCHOOL_DOCUMENT_COLUMNS).eq('meeting_id',meeting.id).is('archived_at',null).order('created_at',{ascending:false}),
        scope.role === 'receptionist' ? Promise.resolve({ data: [] }) : supabase.from('school_meeting_referrals').select(SCHOOL_MEETING_REFERRAL_COLUMNS).eq('meeting_id',meeting.id).order('created_at'),
        supabase.from('school_contacts').select('id,name,role,email,phone,school_unit_id,is_active').eq('organization_id',scope.organizationId).eq('school_id',meeting.school_id).eq('is_active',true).is('archived_at',null).order('name')
      ] as any);
      for(const result of [patientLinks,participants,minutes,documents,referrals,contacts])if(result?.error)throw result.error;
      const linkedPatientIds=uniq((patientLinks.data||[]).map((row:any)=>row.patient_id));
      const allowed=await canAccessPatients(scope,linkedPatientIds);
      const visiblePatients=(patientLinks.data||[]).filter((row:any)=>!Array.isArray(scope.scopedPatientIds)||allowed.has(String(row.patient_id)));
      const visiblePatientIds=new Set(visiblePatients.map((row:any)=>String(row.patient_id)));
      const visibleDocuments=(documents.data||[]).filter((row:any)=>!row.patient_id||(scope.role!=='receptionist'&&visiblePatientIds.has(String(row.patient_id))));
      const fileIds=uniq(visibleDocuments.map((row:any)=>row.document_id));
      const [fileResult,availableFiles]=await Promise.all([
        fileIds.length?supabase.from('patient_files').select('id,file_name,mime_type,file_size_bytes,patient_id,created_at,uploaded_by,access_scope,patient_portal_visible,metadata').in('id',fileIds):Promise.resolve({data:[]}),
        scope.role !== 'receptionist' && visiblePatients.length?supabase.from('patient_files').select('id,file_name,mime_type,file_size_bytes,patient_id,created_at,uploaded_by,access_scope,patient_portal_visible,metadata').in('patient_id',visiblePatients.map((row:any)=>row.patient_id)).order('created_at',{ascending:false}).limit(300):Promise.resolve({data:[]})
      ] as any);
      if(fileResult.error)throw fileResult.error;if(availableFiles.error)throw availableFiles.error;
      const [visibleLinkedFiles,visibleAvailableFiles]=await Promise.all([
        filterPatientFilesForActor({supabase,rows:fileResult.data||[],actorId:scope.actorId,actorRole:scope.role,logger:console}),
        filterPatientFilesForActor({supabase,rows:availableFiles.data||[],actorId:scope.actorId,actorRole:scope.role,logger:console})
      ]);
      const fileMap=new Map(visibleLinkedFiles.map((file:any)=>[String(file.id),file]));
      res.json({success:true,data:{...meeting,patients:visiblePatients,participants:participants.data||[],minutes:minutes.data||null,documents:visibleDocuments.filter((link:any)=>fileMap.has(String(link.document_id))).map((link:any)=>({...link,document:fileMap.get(String(link.document_id))||null})),availableDocuments:visibleAvailableFiles,referrals:(referrals.data||[]).filter((row:any)=>!row.patient_id||visiblePatientIds.has(String(row.patient_id))),schoolContacts:contacts.data||[]}});
    }catch(error){errorResponse(res,error);}
  });

  app.post('/api/school-meetings/batch', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const body=req.body||{};const patientIds=uniq(safeArray(body.patientIds));const allowed=await canAccessPatients(scope,patientIds);if(allowed.size!==patientIds.length)throw new Error('PATIENT_ACCESS_DENIED');const internalIds=uniq([...(safeArray(body.internalProfessionalIds)),body.responsibleProfessionalId].filter(Boolean));const result=await rpc('create_school_meeting_batch_v2',scope,{p_patient_ids:patientIds,p_internal_professional_ids:internalIds,p_payload:body},body);const meeting=result?.meeting||result?.data; if(meeting) await notifyMeeting(scope,meeting,'SCHOOL_MEETING_CREATED','Reunião escolar agendada',`${sanitizeString(meeting.title,180)} em ${new Date(meeting.scheduled_start).toLocaleString('pt-BR')}.`,'created');res.status(201).json(result);}catch(error){errorResponse(res,error,'Não foi possível criar a reunião em lote.');} });

  app.patch('/api/school-meetings/:meetingId', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{
    try{
      const scope=await workspace(req);const meetingId=sanitizeString(req.params.meetingId,120);await ensureMeeting(scope,meetingId);
      const body=req.body||{};
      const rawAction=String(body.action||body.status||'').toUpperCase();
      const actionMap:any={SCHEDULED:'SCHEDULE',CONFIRMED:'CONFIRM',RESCHEDULED:'RESCHEDULE',CANCELLED:'CANCEL',COMPLETED:'COMPLETE'};
      const action=actionMap[rawAction]||rawAction;
      const operation={...body,action};
      const result=await rpc('school_transition_meeting_v2',scope,{p_meeting_id:meetingId,p_action:action,p_payload:operation},operation);
      const meeting=result?.data||result?.meeting;
      if(meeting){
        const notification=action==='CANCEL'?['SCHOOL_MEETING_CANCELLED','Reunião escolar cancelada','cancelled']:action==='RESCHEDULE'?['SCHOOL_MEETING_RESCHEDULED','Reunião escolar reagendada','rescheduled']:action==='COMPLETE'?['SCHOOL_MEETING_COMPLETED','Reunião escolar concluída','completed']:action==='CONFIRM'?['SCHOOL_MEETING_CONFIRMED','Reunião escolar confirmada','confirmed']:['SCHOOL_MEETING_UPDATED','Reunião escolar atualizada','updated'];
        await notifyMeeting(scope,meeting,notification[0],notification[1],sanitizeString(meeting.title,180),`${notification[2]}:${safeIdempotencyKey(body.idempotencyKey)}`);
      }
      res.json(result);
    }catch(error){errorResponse(res,error);}
  });

  app.get('/api/school-meetings/:meetingId/patients', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async(req:any,res:any)=>{try{const scope=await workspace(req);const meeting=await ensureMeeting(scope,sanitizeString(req.params.meetingId,120));const result=await supabase.from('school_meeting_patients').select(`${SCHOOL_MEETING_PATIENT_COLUMNS},patients(id,name,email,therapist_id,responsible_user_id),patient_school_enrollments(id,grade_level,class_name,shift)`).eq('meeting_id',meeting.id).order('created_at');if(result.error)throw result.error;const allowed=await canAccessPatients(scope,(result.data||[]).map((row:any)=>row.patient_id));res.json({success:true,data:(result.data||[]).filter((row:any)=>!Array.isArray(scope.scopedPatientIds)||allowed.has(String(row.patient_id)))});}catch(error){errorResponse(res,error);} });
  app.post('/api/school-meetings/:meetingId/patients', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const meetingId=sanitizeString(req.params.meetingId,120);const meeting=await ensureMeeting(scope,meetingId);const patientIds=uniq(safeArray(req.body?.patientIds));const allowed=await canAccessPatients(scope,patientIds);if(allowed.size!==patientIds.length)throw new Error('PATIENT_ACCESS_DENIED');const result=await rpc('school_modify_meeting_patients_v2',scope,{p_meeting_id:meetingId,p_action:'ADD',p_patient_ids:patientIds,p_reason:null},req.body||{});await notifyMeeting(scope,meeting,'SCHOOL_MEETING_PATIENTS_ADDED','Participantes adicionados à reunião escolar',sanitizeString(meeting.title,180),`patients-added:${safeIdempotencyKey(req.body?.idempotencyKey)}`);res.json(result);}catch(error){errorResponse(res,error);} });
  app.delete('/api/school-meetings/:meetingId/patients', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const meetingId=sanitizeString(req.params.meetingId,120);const meeting=await ensureMeeting(scope,meetingId);const body=req.body||{};const result=await rpc('school_modify_meeting_patients_v2',scope,{p_meeting_id:meetingId,p_action:'REMOVE',p_patient_ids:uniq(safeArray(body.patientIds)),p_reason:sanitizeString(body.reason,1000)},body);await notifyMeeting(scope,meeting,'SCHOOL_MEETING_PATIENTS_REMOVED','Participação atualizada na reunião escolar',sanitizeString(meeting.title,180),`patients-removed:${safeIdempotencyKey(body.idempotencyKey)}`);res.json(result);}catch(error){errorResponse(res,error);} });

  app.post('/api/school-meetings/:meetingId/participants', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const meetingId=sanitizeString(req.params.meetingId,120);const meeting=await ensureMeeting(scope,meetingId);const result=await rpc('school_upsert_participant_v2',scope,{p_meeting_id:meetingId,p_participant_id:null,p_payload:req.body||{}},req.body||{});await notifyMeeting(scope,meeting,'SCHOOL_MEETING_PARTICIPANT_ADDED','Participante adicionado à reunião escolar',sanitizeString(meeting.title,180),`participant-added:${safeIdempotencyKey(req.body?.idempotencyKey)}`);res.status(201).json(result);}catch(error){errorResponse(res,error);} });
  app.patch('/api/school-meetings/:meetingId/participants/:participantId', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const meetingId=sanitizeString(req.params.meetingId,120);await ensureMeeting(scope,meetingId);const result=await rpc('school_upsert_participant_v2',scope,{p_meeting_id:meetingId,p_participant_id:sanitizeString(req.params.participantId,120),p_payload:req.body||{}},req.body||{});res.json(result);}catch(error){errorResponse(res,error);} });
  app.delete('/api/school-meetings/:meetingId/participants/:participantId', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const meetingId=sanitizeString(req.params.meetingId,120);await ensureMeeting(scope,meetingId);const body={...(req.body||{}),isActive:false,reason:req.body?.reason||'Removido da reunião',idempotencyKey:req.body?.idempotencyKey};const result=await rpc('school_upsert_participant_v2',scope,{p_meeting_id:meetingId,p_participant_id:sanitizeString(req.params.participantId,120),p_payload:body},body);res.json(result);}catch(error){errorResponse(res,error);} });

  app.patch('/api/school-meetings/:meetingId/attendance', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const meetingId=sanitizeString(req.params.meetingId,120);await ensureMeeting(scope,meetingId);const body=req.body||{};const result=await rpc('school_record_attendance_v2',scope,{p_meeting_id:meetingId,p_subject_type:sanitizeString(body.subjectType,20).toUpperCase(),p_subject_id:sanitizeString(body.subjectId,120),p_status:sanitizeString(body.status,30).toUpperCase(),p_notes:sanitizeString(body.notes,1000)||null,p_joined_at:sanitizeString(body.joinedAt,80)||null},body);res.json(result);}catch(error){errorResponse(res,error);} });

  app.get('/api/school-meetings/:meetingId/patient-notes', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), requireClinicCapability('clinical.history.view'), async(req:any,res:any)=>{try{const scope=await workspace(req);const meetingId=sanitizeString(req.params.meetingId,120);await ensureMeeting(scope,meetingId,true);let query=supabase.from('school_meeting_patient_notes').select('id,meeting_id,patient_id,note,decisions,referrals,visibility,version,is_current,supersedes_note_id,created_by,created_at,updated_at').eq('organization_id',scope.organizationId).eq('meeting_id',meetingId);const patientId=sanitizeString(req.query?.patientId,120);if(patientId)query=query.eq('patient_id',patientId);if(String(req.query?.includeHistory)!=='true')query=query.eq('is_current',true);const result=await query.order('patient_id').order('version',{ascending:false});if(result.error)throw result.error;const allowed=await canAccessPatients(scope,(result.data||[]).map((n:any)=>n.patient_id),true);res.json({success:true,data:(result.data||[]).filter((n:any)=>allowed.has(String(n.patient_id)))});}catch(error){errorResponse(res,error);} });

  app.put('/api/school-meetings/:meetingId/minutes', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), requireClinicCapability('clinical.notes.create'), async(req:any,res:any)=>{
    try{
      const scope=await workspace(req);const meetingId=sanitizeString(req.params.meetingId,120);const meeting=await ensureMeeting(scope,meetingId,true);const body=req.body||{};
      const result=await rpc('school_save_minutes_v2',scope,{p_meeting_id:meetingId,p_payload:body,p_patient_notes:safeArray(body.patientNotes),p_referrals:safeArray(body.referrals)},body);
      const pending=await supabase.from('school_meeting_referrals').select(SCHOOL_MEETING_REFERRAL_COLUMNS).eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId).eq('meeting_id',meetingId).eq('status','PENDING_TASK').order('created_at');
      if(pending.error)throw pending.error;
      if((pending.data||[]).length){
        const patientIds=uniq((pending.data||[]).map((referral:any)=>referral.patient_id).filter(Boolean));
        const patients=patientIds.length?await supabase.from('patients').select('id,email,clinic_id').eq('clinic_id',scope.clinicId).in('id',patientIds):{data:[]};
        if((patients as any).error)throw (patients as any).error;
        const patientMap=new Map(((patients as any).data||[]).map((patient:any)=>[String(patient.id),patient]));
        const taskRows=(pending.data||[]).filter((referral:any)=>referral.patient_id&&patientMap.has(String(referral.patient_id))).map((referral:any)=>({
          id:deterministicUuid(`school-referral-task:${referral.id}`),patient_id:referral.patient_id,patient_email:patientMap.get(String(referral.patient_id))?.email||null,title:referral.title,
          description:referral.description||`Encaminhamento da reunião escolar ${meeting.title}`,type:'school_meeting_referral',scheduled_at:referral.due_at,
          completed:false,therapist_id:referral.responsible_user_id,created_at:nowIso(),is_active:true
        }));
        const taskByReferral=new Map<string,any>();
        taskRows.forEach((task:any,index:number)=>taskByReferral.set(String((pending.data||[]).filter((referral:any)=>referral.patient_id&&patientMap.has(String(referral.patient_id)))[index].id),task));
        let taskError:any=null;
        if(taskRows.length){const tasks=await supabase.from('tasks').upsert(taskRows,{onConflict:'id',ignoreDuplicates:true}).select('id,patient_id,title,therapist_id');if(tasks.error)taskError=tasks.error;}
        const links=(pending.data||[]).map((referral:any)=>{
          const task=taskByReferral.get(String(referral.id));
          if(!referral.patient_id)return{referralId:referral.id,taskId:null,status:'TASK_FAILED',error:'O módulo canônico de tarefas exige paciente vinculado.'};
          if(!task)return{referralId:referral.id,taskId:null,status:'TASK_FAILED',error:taskError?.message||'Paciente fora do escopo da clínica.'};
          return{referralId:referral.id,taskId:task.id,status:taskError?'TASK_FAILED':'TASK_CREATED',error:taskError?.message||null};
        });
        const attachBody={links,idempotencyKey:`${safeIdempotencyKey(body.idempotencyKey)}:tasks`};
        await rpc('school_attach_referral_tasks_v2',scope,{p_meeting_id:meetingId,p_links:links},attachBody);
        if(!taskError){
          const notificationRows=(pending.data||[]).filter((referral:any)=>referral.patient_id&&referral.responsible_user_id&&taskByReferral.has(String(referral.id))).map((referral:any)=>({
            organization_id:scope.organizationId,clinic_id:scope.clinicId,recipient_user_id:referral.responsible_user_id,recipient_email:null,patient_id:referral.patient_id,
            type:'SCHOOL_TASK_ASSIGNED',title:'Novo encaminhamento escolar',message:sanitizeString(referral.title,180),
            idempotency_key:`school:${meetingId}:task:${referral.id}`,metadata:{schoolMeetingId:meetingId,schoolId:meeting.school_id,taskId:taskByReferral.get(String(referral.id)).id,administrativeOnly:true}
          })).map(withNotificationEnvironment);
          if(notificationRows.length){const notifications=await supabase.from('portal_notifications').upsert(notificationRows,{onConflict:'deployment_env,idempotency_key',ignoreDuplicates:true});if(notifications.error)throw notifications.error;}
        }
        if(taskError)throw taskError;
      }
      if(String(body.status||'').toUpperCase()==='COMPLETED'){
        const transitionBody={action:'COMPLETE',idempotencyKey:`${safeIdempotencyKey(body.idempotencyKey)}:complete`};
        await rpc('school_transition_meeting_v2',scope,{p_meeting_id:meetingId,p_action:'COMPLETE',p_payload:transitionBody},transitionBody);
        await notifyMeeting(scope,{...meeting,status:'COMPLETED'},'SCHOOL_MEETING_COMPLETED','Reunião escolar concluída',sanitizeString(meeting.title,180),`minutes-completed:${safeIdempotencyKey(body.idempotencyKey)}`);
      }
      res.json(result);
    }catch(error){errorResponse(res,error,'Não foi possível salvar a ata e os encaminhamentos.');}
  });

  app.get('/api/school-documents', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async(req:any,res:any)=>{try{const scope=await workspace(req);const requestedSchoolId=sanitizeString(req.query?.schoolId,120);if(requestedSchoolId)await ensureSchoolVisible(scope,requestedSchoolId);let query=supabase.from('school_document_links').select(SCHOOL_DOCUMENT_COLUMNS).eq('organization_id',scope.organizationId).is('archived_at',null);for(const [q,c] of [['schoolId','school_id'],['unitId','school_unit_id'],['meetingId','meeting_id'],['patientId','patient_id']] as any[]){const v=sanitizeString(req.query?.[q],120);if(v)query=query.eq(c,v);}const result=await query.order('created_at',{ascending:false}).limit(200);if(result.error)throw result.error;const patientRows=(result.data||[]).filter((r:any)=>r.patient_id);const allowed=await canAccessPatients(scope,patientRows.map((r:any)=>r.patient_id));const visible=(result.data||[]).filter((r:any)=>{ if(!r.patient_id)return true; if(scope.role==='receptionist')return false; return allowed.has(String(r.patient_id)); });const docIds=uniq(visible.map((r:any)=>r.document_id));const files=docIds.length?await supabase.from('patient_files').select('id,file_name,mime_type,file_size_bytes,created_at,patient_id,uploaded_by,access_scope,patient_portal_visible,metadata').in('id',docIds):{data:[]};if(files.error)throw files.error;const visibleFiles=await filterPatientFilesForActor({supabase,rows:files.data||[],actorId:scope.actorId,actorRole:scope.role,logger:console});const fileMap=new Map(visibleFiles.map((f:any)=>[String(f.id),f]));res.json({success:true,data:visible.filter((link:any)=>fileMap.has(String(link.document_id))).map((link:any)=>({...link,document:fileMap.get(String(link.document_id))||null}))});}catch(error){errorResponse(res,error);} });
  app.post('/api/school-documents', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const body=req.body||{};const schoolId=sanitizeString(body.schoolId,120);if(schoolId)await ensureSchoolVisible(scope,schoolId);const patientId=sanitizeString(body.patientId,120);if(patientId){if(scope.role==='receptionist')throw new Error('ACCESS_DENIED');const allowed=await canAccessPatients(scope,[patientId],true);if(!allowed.has(patientId))throw new Error('PATIENT_ACCESS_DENIED');}const result=await rpc('school_link_document_v2',scope,{p_payload:body},body);if(patientId){const patient=await supabase.from('patients').select('id,email,responsible_user_id').eq('id',patientId).eq('clinic_id',scope.clinicId).maybeSingle();if(patient.data){const notification=await supabase.from('portal_notifications').upsert(withNotificationEnvironment({organization_id:scope.organizationId,clinic_id:scope.clinicId,recipient_user_id:patient.data.responsible_user_id||null,recipient_email:patient.data.email||null,patient_id:patientId,type:'SCHOOL_DOCUMENT_ADDED',title:'Documento escolar adicionado',message:'Um novo documento escolar foi vinculado.',idempotency_key:`school:document:${safeIdempotencyKey(body.idempotencyKey)}`,metadata:{schoolId:body.schoolId||null,meetingId:body.meetingId||null,administrativeOnly:true}}),{onConflict:'deployment_env,idempotency_key',ignoreDuplicates:true});if(notification.error)throw notification.error;}}res.status(201).json(result);}catch(error){errorResponse(res,error);} });
  app.patch('/api/school-documents/:linkId', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.meetings.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const body=req.body||{};const result=await rpc('school_update_document_v2',scope,{p_link_id:sanitizeString(req.params.linkId,120),p_payload:body},body);res.json(result);}catch(error){errorResponse(res,error);} });

  app.get('/api/school-migration-review', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async(req:any,res:any)=>{
    try{
      const scope=await workspace(req);const {page,pageSize,from,to}=pagination(req);
      let query=supabase.from('school_migration_review_queue').select(`${SCHOOL_MIGRATION_REVIEW_COLUMNS},patients(id,name,email)`,{count:'exact'}).eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId);
      const status=sanitizeString(req.query?.status,30).toUpperCase();if(status)query=query.eq('status',status);
      const result=await query.order('created_at').range(from,to);if(result.error)throw result.error;
      const [stats,schools]=await Promise.all([
        supabase.from('school_migration_review_queue').select('status').eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId),
        supabase.from('schools').select('id,display_name,normalized_name,city,state').eq('organization_id',scope.organizationId).eq('is_active',true).is('archived_at',null).limit(2000)
      ] as any);
      if(stats.error)throw stats.error;if(schools.error)throw schools.error;
      const counts=(stats.data||[]).reduce((acc:any,row:any)=>{acc[row.status]=(acc[row.status]||0)+1;return acc;},{});
      const data=(result.data||[]).map((row:any)=>{
        const explicitIds=new Set((row.candidate_school_ids||[]).map(String));
        const normalized=String(row.normalized_value||'');
        const candidates=(schools.data||[]).filter((school:any)=>explicitIds.has(String(school.id))||String(school.normalized_name||'')===normalized||String(school.normalized_name||'').includes(normalized)||normalized.includes(String(school.normalized_name||''))).slice(0,10);
        return{...row,candidates};
      });
      const total=Number(result.count||0);
      res.json({success:true,data,counts,pagination:{page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize)),hasNextPage:page*pageSize<total}});
    }catch(error){errorResponse(res,error);}
  });
  app.post('/api/school-migration-review/resolve', portalActionLimiter, noStoreDynamicResponse, checkAuth, requireClinicCapability('school.manage'), async(req:any,res:any)=>{try{const scope=await workspace(req);const body=req.body||{};const result=await rpc('school_resolve_migration_review_v2',scope,{p_queue_ids:uniq(safeArray(body.queueIds)),p_action:sanitizeString(body.action,30).toUpperCase(),p_school_id:sanitizeString(body.schoolId,120)||null,p_unit_id:sanitizeString(body.schoolUnitId,120)||null,p_reason:sanitizeString(body.reason,1000)||null},body);res.json(result);}catch(error){errorResponse(res,error);} });

  app.get('/api/school-calendar-events', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async(req:any,res:any)=>{
    try{
      const scope=await workspace(req);
      let query=supabase.from('school_meetings').select('id,title,meeting_type,status,scheduled_start,scheduled_end,location_type,location,school_id,school_unit_id,responsible_professional_id,schools(display_name),school_units(name)').eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId).not('scheduled_start','is',null);
      if(req.query?.from)query=query.gte('scheduled_start',sanitizeString(req.query.from,80));if(req.query?.to)query=query.lte('scheduled_start',sanitizeString(req.query.to,80));
      for(const [q,c] of [['schoolId','school_id'],['unitId','school_unit_id'],['meetingType','meeting_type'],['status','status']] as any[]){const values=parseListParam(req.query?.[q]);if(values.length===1)query=query.eq(c,values[0]);else if(values.length>1)query=query.in(c,values);}
      const result=await query.order('scheduled_start').limit(2000);if(result.error)throw result.error;
      const meetingIds=(result.data||[]).map((meeting:any)=>meeting.id);
      const [patientLinks,participants]=await Promise.all([
        meetingIds.length?supabase.from('school_meeting_patients').select('meeting_id,patient_id').in('meeting_id',meetingIds).neq('participation_status','REMOVED'):Promise.resolve({data:[]}),
        meetingIds.length?supabase.from('school_meeting_participants').select('meeting_id,professional_id').in('meeting_id',meetingIds).is('removed_at',null):Promise.resolve({data:[]})
      ] as any);
      if(patientLinks.error)throw patientLinks.error;if(participants.error)throw participants.error;
      const patientIdsByMeeting=new Map<string,string[]>();
      for(const link of patientLinks.data||[]){const key=String(link.meeting_id);const rows=patientIdsByMeeting.get(key)||[];const patientId=String(link.patient_id);if(patientId&&!rows.includes(patientId))rows.push(patientId);patientIdsByMeeting.set(key,rows);}
      const professionalIdsByMeeting=new Map<string,string[]>();
      for(const participant of participants.data||[]){const key=String(participant.meeting_id);const rows=professionalIdsByMeeting.get(key)||[];const professionalId=String(participant.professional_id);if(professionalId&&!rows.includes(professionalId))rows.push(professionalId);professionalIdsByMeeting.set(key,rows);}
      const professionalIds=parseListParam(req.query?.professionalId);
      const requestedPatientIds=parseListParam(req.query?.patientId);
      let rows=result.data||[];
      if(professionalIds.length)rows=rows.filter((meeting:any)=>professionalIds.includes(String(meeting.responsible_professional_id))||(professionalIdsByMeeting.get(String(meeting.id))||[]).some((id)=>professionalIds.includes(id)));
      if(requestedPatientIds.length)rows=rows.filter((meeting:any)=>(patientIdsByMeeting.get(String(meeting.id))||[]).some((id)=>requestedPatientIds.includes(id)));
      if(Array.isArray(scope.scopedPatientIds)){
        const allowed=await canAccessPatients(scope,(patientLinks.data||[]).map((row:any)=>row.patient_id));
        rows=rows.filter((meeting:any)=>meeting.responsible_professional_id===scope.actorId||(professionalIdsByMeeting.get(String(meeting.id))||[]).includes(String(scope.actorId))||(patientIdsByMeeting.get(String(meeting.id))||[]).some((id)=>allowed.has(id)));
      }
      res.json({success:true,data:rows.map((meeting:any)=>{
        const meetingProfessionalIds=uniq([meeting.responsible_professional_id,...(professionalIdsByMeeting.get(String(meeting.id))||[])]);
        const meetingPatientIds=patientIdsByMeeting.get(String(meeting.id))||[];
        return{id:`school-${meeting.id}`,schoolMeetingId:meeting.id,title:meeting.title,start:meeting.scheduled_start,end:meeting.scheduled_end,eventType:meeting.meeting_type,type:meeting.meeting_type,status:meeting.status,locationType:meeting.location_type,location:meeting.location,schoolId:meeting.school_id,schoolUnitId:meeting.school_unit_id,schoolName:meeting.schools?.display_name,schoolUnitName:meeting.school_units?.name,responsibleProfessionalId:meeting.responsible_professional_id,therapist_id:meeting.responsible_professional_id,professionalIds:meetingProfessionalIds,patientIds:meetingPatientIds,patientCount:meetingPatientIds.length,source:'school_meeting'};
      })});
    }catch(error){errorResponse(res,error);}
  });

  app.get('/api/schools/:schoolId/indicators', noStoreDynamicResponse, checkAuth, requireClinicCapability('school.view'), async(req:any,res:any)=>{
    try{
      const scope=await workspace(req);
      const schoolId=sanitizeString(req.params.schoolId,120);
      await ensureSchoolVisible(scope,schoolId);
      let enrollmentQuery:any=supabase.from('patient_school_enrollments').select('patient_id,school_unit_id,grade_level,shift,is_current').eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId).eq('school_id',schoolId);
      if(Array.isArray(scope.scopedPatientIds)){
        const scopedPatientIds=uniq(scope.scopedPatientIds);
        if(!scopedPatientIds.length)return res.json({success:true,data:{activePatients:0,units:0,meetings:0,completedMeetings:0,cancelledMeetings:0,upcomingMeetings:0,pendingConsents:0,contacts:0,pendingTasks:0}});
        enrollmentQuery=enrollmentQuery.in('patient_id',scopedPatientIds);
      }
      const visibleMeetingIds=await schoolMeetingVisibilityIds(scope,[schoolId]);
      let meetingQuery:any=supabase.from('school_meetings').select('id,status,scheduled_start').eq('organization_id',scope.organizationId).eq('clinic_id',scope.clinicId).eq('school_id',schoolId);
      if(Array.isArray(visibleMeetingIds)){
        if(!visibleMeetingIds.length)meetingQuery=null;
        else meetingQuery=meetingQuery.in('id',visibleMeetingIds);
      }
      const [enrollments,meetings,contacts]=await Promise.all([
        enrollmentQuery,
        meetingQuery||Promise.resolve({data:[]}),
        supabase.from('school_contacts').select('id,is_active').eq('organization_id',scope.organizationId).eq('school_id',schoolId)
      ] as any);
      if(enrollments.error)throw enrollments.error;if(meetings.error)throw meetings.error;if(contacts.error)throw contacts.error;
      const meetingIds=new Set((meetings.data||[]).map((m:any)=>String(m.id)));
      const rows=enrollments.data||[];
      const patientIds=uniq(rows.map((r:any)=>r.patient_id));
      const [consents,referrals]=await Promise.all([
        patientIds.length?supabase.from('school_consents').select('patient_id,status,expires_at,revoked_at').eq('organization_id',scope.organizationId).eq('is_current',true).in('patient_id',patientIds):Promise.resolve({data:[]}),
        meetingIds.size?supabase.from('school_meeting_referrals').select('id,status,meeting_id').eq('organization_id',scope.organizationId).in('meeting_id',Array.from(meetingIds)):Promise.resolve({data:[]})
      ] as any);
      if(consents.error)throw consents.error;if(referrals.error)throw referrals.error;
      const now=Date.now();
      res.json({success:true,data:{
        activePatients:new Set(rows.filter((r:any)=>r.is_current).map((r:any)=>r.patient_id)).size,
        units:new Set(rows.map((r:any)=>r.school_unit_id).filter(Boolean)).size,
        meetings:(meetings.data||[]).length,
        completedMeetings:(meetings.data||[]).filter((m:any)=>m.status==='COMPLETED').length,
        cancelledMeetings:(meetings.data||[]).filter((m:any)=>m.status==='CANCELLED').length,
        upcomingMeetings:(meetings.data||[]).filter((m:any)=>m.scheduled_start&&new Date(m.scheduled_start).getTime()>=now&&['SCHEDULED','CONFIRMED','RESCHEDULED'].includes(m.status)).length,
        pendingConsents:(consents.data||[]).filter((c:any)=>c.status!=='AUTHORIZED'||c.revoked_at||(c.expires_at&&new Date(c.expires_at).getTime()<now)).length,
        contacts:(contacts.data||[]).filter((c:any)=>c.is_active).length,
        pendingTasks:(referrals.data||[]).filter((r:any)=>meetingIds.has(String(r.meeting_id))&&r.status!=='TASK_CREATED').length
      }});
    }catch(error){errorResponse(res,error);}
  });
}
