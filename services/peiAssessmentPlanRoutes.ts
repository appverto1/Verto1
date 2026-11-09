// PEI assessment plans are independent from the legacy patient.pei goals and PTS.
// All routes require the existing clinic capability + patient access middlewares.
// Browser-supplied clinic, patient and actor IDs are never used as authorities.
import crypto from 'node:crypto';

type Deps = {
  supabase: any;
  currentClinicId: (user: any) => string | null;
  sanitizeString: (value: any, size?: number) => string;
  isUuid: (value: any) => boolean;
  enforcePayloadLimit: (req: any, res: any, limit: number, label: string) => boolean;
  sendRouteDbError: (res: any, route: string, error: any, options?: any) => any;
};

const PLAN_COLUMNS = 'id,clinic_id,patient_id,specialty,responsible_professional_id,protocol_id,protocol_snapshot,content,title,status,revision,created_at,updated_at';
const LIST_COLUMNS = 'id,specialty,responsible_professional_id,protocol_id,title,status,revision,created_at,updated_at';
const MANAGER_ROLES = new Set(['director', 'coordinator']);
const VALID_EVENTS = new Set(['save', 'activate', 'complete', 'archive']);
const textField = (value: any, max = 180) => typeof value === 'string' ? value.trim().slice(0, max + 1) : '';

function cleanGoalPayload(value: unknown, sourceProtocol: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PEI_CONTENT_INVALID');
  const raw: any = value;
  if (!Array.isArray(raw.goals) || raw.goals.length > 150) throw new Error('PEI_GOALS_INVALID');
  const allowed = new Set<string>();
  for (const domain of Array.isArray(sourceProtocol?.data) ? sourceProtocol.data : []) {
    for (const skill of Array.isArray(domain?.skills) ? domain.skills : []) {
      allowed.add(String(domain.id) + ':' + String(skill.id));
    }
  }
  const seen = new Set<string>();
  let targetsCount = 0;
  const goals = raw.goals.map((goal: any) => {
    if (!goal || typeof goal !== 'object' || Array.isArray(goal)) throw new Error('PEI_GOAL_INVALID');
    const id = textField(goal.id, 120);
    const domainId = textField(String(goal.domainId ?? ''), 180);
    const sourceSkillId = textField(String(goal.sourceSkillId ?? ''), 180);
    const title = textField(goal.title, 180);
    const objective = textField(goal.objective ?? '', 1200);
    const notes = textField(goal.notes ?? '', 2000);
    const criteria = textField(goal.criteria ?? '', 1200);
    const status = textField(goal.status, 40) || 'pending';
    if (!id || seen.has(id) || !allowed.has(domainId + ':' + sourceSkillId) ||
      !title || title.length > 180 || objective.length > 1200 ||
      notes.length > 2000 || criteria.length > 1200 ||
      !['pending','in_progress','evaluated','cancelled'].includes(status) ||
      !Array.isArray(goal.targets) || goal.targets.length > 30) {
      throw new Error('PEI_GOAL_INVALID');
    }
    seen.add(id);
    const targetIds = new Set();
    const targets = goal.targets.map((item: any) => {
      const targetId = textField(item?.id, 120);
      const name = textField(item?.name, 180);
      const instruction = textField(item?.instruction || '', 800);
      const observation = textField(item?.observation || '', 1200);
      const targetStatus = textField(item?.status || 'pending', 40);
      if (!targetId || targetIds.has(targetId) || !name || name.length > 180 ||
        instruction.length > 800 || observation.length > 1200 ||
        !['pending','in_progress','evaluated','cancelled'].includes(targetStatus)) {
        throw new Error('PEI_TARGET_INVALID');
      }
      targetIds.add(targetId);
      targetsCount++;
      return { id: targetId, name, instruction, observation, status: targetStatus };
    });
    return { id, domainId, sourceSkillId, title, objective, criteria, notes, status, targets };
  });
  if (targetsCount > 1500) throw new Error('PEI_TARGETS_LIMIT');
  return { goals };
}

export function createPeiAssessmentPlanHandlers(getDeps: () => Deps) {
  const context = async (req: any, res: any) => {
    const { supabase, currentClinicId, sanitizeString, isUuid } = getDeps();
    const actorId = sanitizeString(req.session?.user?.id, 120);
    const clinicId = sanitizeString(currentClinicId(req.session?.user), 120);
    const patientId = sanitizeString(req.resolvedPatientId || req.params?.patientId, 120);
    if (!isUuid(actorId) || !isUuid(clinicId) || !isUuid(patientId)) {
      res.status(404).json({ success: false, error: 'PEI_SCOPE_INVALID' });
      return null;
    }
    // Defense in depth: check the actual patient clinic (not the session or UI claim).
    const [patient, membership, links] = await Promise.all([
      supabase.from('patients').select('id').eq('id', patientId).eq('clinic_id', clinicId).is('deleted_at', null).maybeSingle(),
      supabase.from('clinic_memberships').select('role,specialty,can_supervise').eq('clinic_id', clinicId).eq('user_id', actorId).eq('status', 'active').maybeSingle(),
      supabase.from('patient_professional_links').select('specialty,case_role,permissions').eq('clinic_id', clinicId).eq('patient_id', patientId).eq('professional_id', actorId).eq('status', 'active').limit(10)
    ]);
    if (patient.error || membership.error || links.error) throw patient.error || membership.error || links.error;
    if (!patient.data || !membership.data) {
      res.status(403).json({ success: false, error: 'PEI_SCOPE_DENIED' });
      return null;
    }
    const manager = MANAGER_ROLES.has(String(membership.data.role || ''));
    const actorLinks: any[] = Array.isArray(links.data) ? links.data : [];
    const supervisorRead = actorLinks.some(link => ['supervisor','case_supervisor'].includes(String(link.case_role)) &&
      link.permissions?.read !== false);
    const supervisorWrite = supervisorRead && actorLinks.some(link => ['supervisor','case_supervisor'].includes(String(link.case_role)) &&
      link.permissions?.write !== false);
    return { actorId, clinicId, patientId, manager, supervisorRead, supervisorWrite, actorLinks,
      membershipRole: String(membership.data.role || ''), membershipSpecialty: String(membership.data.specialty || '') };
  };

  const canRead = (ctx: any, plan: any) =>
    ctx.manager || ctx.supervisorRead ||
    (ctx.membershipRole === 'therapist' && String(plan?.specialty || '').toLocaleLowerCase('pt-BR') === ctx.membershipSpecialty.toLocaleLowerCase('pt-BR') &&
      String(plan?.responsible_professional_id) === ctx.actorId &&
      ctx.actorLinks.some((link: any) => String(link.specialty).toLocaleLowerCase('pt-BR') === String(plan.specialty).toLocaleLowerCase('pt-BR') && link.permissions?.read !== false));

  const canWrite = (ctx: any, plan: any) =>
    ctx.manager || ctx.supervisorWrite ||
    (ctx.membershipRole === 'therapist' && String(plan?.specialty || '').toLocaleLowerCase('pt-BR') === ctx.membershipSpecialty.toLocaleLowerCase('pt-BR') &&
      String(plan?.responsible_professional_id) === ctx.actorId &&
      ctx.actorLinks.some((link: any) => String(link.specialty).toLocaleLowerCase('pt-BR') === String(plan.specialty).toLocaleLowerCase('pt-BR') && link.permissions?.write !== false));

  const sendError = (res: any, error: any, route: string) => {
    const message = String(error?.message || '');
    if (message.includes('PEI_REVISION_CONFLICT') || message.includes('PEI_IDEMPOTENCY_CONFLICT')) {
      return res.status(409).json({ success: false, error: message.includes('REVISION') ? 'PEI_REVISION_CONFLICT' : 'PEI_IDEMPOTENCY_CONFLICT', message: 'O plano foi alterado em outra sessão. Atualize antes de salvar.' });
    }
    if (/PEI_.*(DENIED|SCOPE)/.test(message)) return res.status(403).json({ success: false, error: 'PEI_SCOPE_DENIED' });
    if (message.includes('PEI_PLAN_CLOSED') || message.includes('PEI_STATUS_INVALID')) return res.status(409).json({ success: false, error: 'PEI_STATUS_INVALID' });
    if (message.startsWith('PEI_')) return res.status(422).json({ success: false, error: message.split(/[\s:]/)[0] });
    return getDeps().sendRouteDbError(res, route, error, { fallbackMessage: 'Não foi possível salvar o plano de avaliação.' });
  };

  const fetchPlan = async (ctx: any, planId: string) => {
    const { supabase } = getDeps();
    return supabase.from('patient_pei_assessment_plans_v1').select(PLAN_COLUMNS)
      .eq('id', planId).eq('clinic_id', ctx.clinicId).eq('patient_id', ctx.patientId).maybeSingle();
  };

  return {
    list: async (req: any, res: any) => {
      try {
        const ctx = await context(req, res); if (!ctx) return;
        const { data, error } = await getDeps().supabase.from('patient_pei_assessment_plans_v1')
          .select(LIST_COLUMNS).eq('clinic_id', ctx.clinicId).eq('patient_id', ctx.patientId)
          .order('updated_at', { ascending: false }).limit(60);
        if (error) throw error;
        return res.json({ success: true, data: (data || []).filter((plan: any) => canRead(ctx, plan)) });
      } catch (error) { return sendError(res, error, 'pei/list'); }
    },
    detail: async (req: any, res: any) => {
      try {
        const ctx = await context(req, res); if (!ctx) return;
        const planId = String(req.params.planId || '');
        if (!getDeps().isUuid(planId)) return res.status(400).json({ success: false, error: 'PEI_PLAN_ID_INVALID' });
        const { data, error } = await fetchPlan(ctx, planId);
        if (error) throw error;
        if (!data || !canRead(ctx, data)) return res.status(404).json({ success: false, error: 'PEI_PLAN_NOT_FOUND' });
        const versions = await getDeps().supabase.from('patient_pei_assessment_plan_versions_v1')
          .select('revision,event_kind,created_by,created_at')
          .eq('plan_id', planId).order('revision', { ascending: false }).limit(100);
        if (versions.error) throw versions.error;
        return res.json({ success: true, data, history: versions.data || [], canEdit: canWrite(ctx, data) });
      } catch (error) { return sendError(res, error, 'pei/detail'); }
    },
    create: async (req: any, res: any) => {
      try {
        const { supabase, enforcePayloadLimit, isUuid } = getDeps();
        if (!enforcePayloadLimit(req, res, 128 * 1024, 'PEI de avaliação')) return;
        const ctx = await context(req, res); if (!ctx) return;
        const specialty = textField(req.body?.specialty, 100);
        const responsibleId = textField(req.body?.responsibleProfessionalId, 120);
        const protocolId = textField(String(req.body?.protocolId ?? ''), 180);
        const title = textField(req.body?.title, 180);
        const key = textField(req.body?.idempotencyKey, 120);
        if (!specialty || specialty.length > 100 || !isUuid(responsibleId) || !protocolId ||
          protocolId.length > 180 || title.length < 2 || title.length > 180 || key.length < 8) {
          return res.status(422).json({ success: false, error: 'PEI_CREATE_INVALID' });
        }
        if (!ctx.manager && !ctx.supervisorWrite && responsibleId !== ctx.actorId) {
          return res.status(403).json({ success: false, error: 'PEI_RESPONSIBLE_DENIED' });
        }
        // Only a protocol from this clinic's evaluation catalog is eligible.
        // The official source is a separate immutable snapshot; editing goals cannot overwrite it.
        const source = await supabase.rpc('get_clinic_pei_evaluation_protocol_v1', {
          p_clinic_id: ctx.clinicId, p_protocol_id: protocolId
        });
        if (source.error) throw source.error;
        const protocol = source.data;
        if (!protocol || !Array.isArray(protocol.data)) {
          return res.status(422).json({ success: false, error: 'PEI_EVALUATION_PROTOCOL_NOT_FOUND', message: 'Selecione um protocolo de avaliação cadastrado nesta clínica.' });
        }
        const content = { goals: [] };
        const saved = await supabase.rpc('write_patient_pei_assessment_plan_v1', {
          p_operation: 'create', p_clinic_id: ctx.clinicId, p_patient_id: ctx.patientId,
          p_actor_id: ctx.actorId, p_plan_id: null, p_specialty: specialty,
          p_responsible_professional_id: responsibleId, p_protocol_id: protocolId,
          p_protocol_snapshot: protocol, p_content: content, p_title: title,
          p_expected_revision: null, p_idempotency_key: key
        });
        if (saved.error) throw saved.error;
        return res.status(201).json({ success: true, data: saved.data });
      } catch (error) { return sendError(res, error, 'pei/create'); }
    },
    write: async (req: any, res: any) => {
      try {
        const { supabase, enforcePayloadLimit, isUuid } = getDeps();
        if (!enforcePayloadLimit(req, res, 128 * 1024, 'Edição de PEI de avaliação')) return;
        const ctx = await context(req, res); if (!ctx) return;
        const planId = String(req.params.planId || '');
        if (!isUuid(planId)) return res.status(400).json({ success: false, error: 'PEI_PLAN_ID_INVALID' });
        const { data: plan, error } = await fetchPlan(ctx, planId);
        if (error) throw error;
        if (!plan || !canWrite(ctx, plan)) return res.status(404).json({ success: false, error: 'PEI_PLAN_NOT_FOUND' });
        const revision = Number(req.body?.expectedRevision);
        const operation = textField(req.body?.action || 'save', 20);
        const title = textField(req.body?.title, 180);
        if (!VALID_EVENTS.has(operation) || !Number.isSafeInteger(revision) || revision < 1 ||
          title.length < 2 || title.length > 180) {
          return res.status(422).json({ success: false, error: 'PEI_UPDATE_INVALID' });
        }
        const content = cleanGoalPayload(req.body?.content, plan.protocol_snapshot);
        if (operation === 'activate' && content.goals.length === 0) {
          return res.status(422).json({ success: false, error: 'PEI_ACTIVATION_GOALS_REQUIRED' });
        }
        const saved = await supabase.rpc('write_patient_pei_assessment_plan_v1', {
          p_operation: operation, p_clinic_id: ctx.clinicId, p_patient_id: ctx.patientId,
          p_actor_id: ctx.actorId, p_plan_id: planId, p_specialty: null,
          p_responsible_professional_id: null, p_protocol_id: null,
          p_protocol_snapshot: null, p_content: content, p_title: title,
          p_expected_revision: revision, p_idempotency_key: null
        });
        if (saved.error) throw saved.error;
        return res.json({ success: true, data: saved.data });
      } catch (error) { return sendError(res, error, 'pei/write'); }
    }
  };
}
