import type { Express } from 'express';
import {
  ABA_CATALOG_PRESETS,
  abaCatalogNameKey,
  abaCatalogPresetForId,
  abaCatalogStoredPresetId,
  isAbaCatalogMethod,
  mergeAbaBehaviorCatalog,
} from '../src/utils/abaBehaviorCatalog';

const SELECT_COLUMNS = 'id,name,operational_definition,measurement_type,interval_seconds,default_severity,status,is_active,created_at,updated_at';
const MAX_BEHAVIORS = 200;

const plainText = (value: unknown, length: number) =>
  typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, length + 1)
    : '';

const readPatch = (input: any, current?: any) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Dados de comportamento inválidos.' };
  const name = input.name === undefined ? plainText(current?.name, 100) : plainText(input.name, 100);
  const definition = input.operationalDefinition === undefined
    ? plainText(current?.operational_definition, 1200)
    : plainText(input.operationalDefinition, 1200);
  const method = input.defaultMeasurement === undefined
    ? String(current?.measurement_type || 'frequency')
    : input.defaultMeasurement;
  const rawSeconds = input.intervalSeconds === undefined ? (current?.interval_seconds ?? 30) : input.intervalSeconds;
  const rawSeverity = input.defaultSeverity === undefined ? (current?.default_severity ?? 2) : input.defaultSeverity;
  const intervalSeconds = Number(rawSeconds);
  const defaultSeverity = Number(rawSeverity);
  const status = input.status === undefined ? String(current?.status || 'active') : input.status;
  if (!name || name.length > 100 || name.length < 2 || !definition || definition.length > 1200 ||
      !isAbaCatalogMethod(method) || !Number.isInteger(intervalSeconds) || intervalSeconds < 5 ||
      intervalSeconds > 3600 || !Number.isInteger(defaultSeverity) || defaultSeverity < 1 ||
      defaultSeverity > 5 || !['active', 'archived'].includes(status)) {
    return { error: 'Informe nome, definição operacional, método, intervalo (5–3600 s) e severidade (1–5) válidos.' };
  }
  return {
    data: {
      name, operational_definition: definition, measurement_type: method,
      interval_seconds: intervalSeconds, default_severity: defaultSeverity,
      status, is_active: status === 'active', updated_at: new Date().toISOString(),
    },
  };
};

export function registerAbaBehaviorCatalogRoutes(app: Express, deps: {
  supabase: any;
  checkAuth: any;
  checkPatientAccess: any;
  requireClinicCapability: any;
  currentClinicId: (user: any) => string;
  isUuid: (value: string) => boolean;
  requireAbaCollectionFeature: any;
}) {
  const {
    supabase, checkAuth, checkPatientAccess, requireClinicCapability,
    currentClinicId, isUuid, requireAbaCollectionFeature,
  } = deps;

  const guards = [
    requireAbaCollectionFeature,
    checkAuth,
    requireClinicCapability('aba.behavior.record'),
    checkPatientAccess,
  ];

  const scope = (req: any) => {
    const patientId = String(req.resolvedPatientId || req.params.patientId || '').trim();
    const clinicId = String(currentClinicId(req.session?.user || {}) || '').trim();
    const patientClinicId = String(req.resolvedPatientClinicId || '').trim();
    const actorId = String(req.session?.user?.id || '').trim();
    if (!isUuid(patientId) || !isUuid(clinicId) || !isUuid(actorId) ||
        !patientClinicId || patientClinicId !== clinicId) return null;
    return { patientId, clinicId, actorId };
  };

  const list = async (patientId: string, clinicId: string) =>
    supabase.from('aba_behavior_definitions')
      .select(SELECT_COLUMNS)
      .eq('patient_id', patientId).eq('clinic_id', clinicId)
      .order('created_at', { ascending: true }).limit(MAX_BEHAVIORS + 1);

  const responseError = (res: any, error: any) => {
    if (String(error?.code || '') === '23505') {
      return res.status(409).json({ success: false, code: 'ABA_BEHAVIOR_DUPLICATE', error: 'Já existe um comportamento com esse nome para este paciente.' });
    }
    return res.status(503).json({ success: false, code: 'ABA_BEHAVIOR_CATALOG_UNAVAILABLE', error: 'Não foi possível confirmar a alteração do catálogo.' });
  };

  const getCurrent = (rows: any[], patientId: string, id: string) => {
    const preset = abaCatalogPresetForId(id);
    if (preset) {
      return {
        preset,
        row: rows.find((row: any) =>
          String(row.id) === abaCatalogStoredPresetId(patientId, preset.key) ||
          abaCatalogNameKey(row.name) === abaCatalogNameKey(preset.name)
        ) || null,
      };
    }
    const row = rows.find((item: any) => String(item.id) === id);
    return row ? { row, preset: null } : null;
  };

  const validateMutationScope = (req: any, res: any) => {
    const resolved = scope(req);
    if (!resolved) {
      res.status(404).json({ success: false, code: 'ABA_BEHAVIOR_PATIENT_NOT_FOUND', error: 'Paciente fora do escopo autorizado.' });
      return null;
    }
    const bytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
    if (bytes > 8192) {
      res.status(413).json({ success: false, error: 'Dados do comportamento excedem o tamanho permitido.' });
      return null;
    }
    return resolved;
  };

  app.get('/api/aba/patients/:patientId/behavior-catalog', ...guards, async (req: any, res: any) => {
    const resolved = scope(req);
    if (!resolved) return res.status(404).json({ success: false, error: 'Paciente fora do escopo autorizado.' });
    try {
      const result = await list(resolved.patientId, resolved.clinicId);
      if (result.error) return responseError(res, result.error);
      if ((result.data || []).length > MAX_BEHAVIORS) return res.status(409).json({ success: false, error: 'Catálogo excede o limite de registros.' });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json({ success: true, data: mergeAbaBehaviorCatalog(resolved.patientId, result.data || [], true) });
    } catch {
      return res.status(503).json({ success: false, error: 'Não foi possível carregar o catálogo.' });
    }
  });

  app.post('/api/aba/patients/:patientId/behavior-catalog', ...guards, async (req: any, res: any) => {
    const resolved = validateMutationScope(req, res);
    if (!resolved) return;
    try {
      const checked = readPatch(req.body);
      if (checked.error) return res.status(422).json({ success: false, error: checked.error });
      const previous = await list(resolved.patientId, resolved.clinicId);
      if (previous.error) return responseError(res, previous.error);
      if ((previous.data || []).length >= MAX_BEHAVIORS) return res.status(409).json({ success: false, error: 'Limite do catálogo atingido.' });
      const duplicate = (previous.data || []).find((row: any) =>
        abaCatalogNameKey(row.name) === abaCatalogNameKey(checked.data!.name)
        && row.status === 'active');
      if (duplicate || ABA_CATALOG_PRESETS.some((preset) => abaCatalogNameKey(preset.name) === abaCatalogNameKey(checked.data!.name))) {
        return res.status(409).json({ success: false, code: 'ABA_BEHAVIOR_DUPLICATE', error: 'Este comportamento já existe. Edite o item padrão ou reative o arquivado.' });
      }
      const saved = await supabase.from('aba_behavior_definitions')
        .insert({
          ...checked.data,
          clinic_id: resolved.clinicId, organization_id: resolved.clinicId,
          patient_id: resolved.patientId, created_by: resolved.actorId,
        }).select(SELECT_COLUMNS).single();
      if (saved.error || !saved.data) return responseError(res, saved.error);
      return res.status(201).json({ success: true, data: saved.data });
    } catch {
      return res.status(503).json({ success: false, error: 'Não foi possível salvar o comportamento.' });
    }
  });

  app.patch('/api/aba/patients/:patientId/behavior-catalog/:behaviorId', ...guards, async (req: any, res: any) => {
    const resolved = validateMutationScope(req, res);
    if (!resolved) return;
    const id = String(req.params.behaviorId || '').trim();
    if (!id || id.length > 180) return res.status(400).json({ success: false, error: 'Comportamento inválido.' });
    try {
      const currentResult = await list(resolved.patientId, resolved.clinicId);
      if (currentResult.error) return responseError(res, currentResult.error);
      const rows = currentResult.data || [];
      const current = getCurrent(rows, resolved.patientId, id);
      if (!current) return res.status(404).json({ success: false, error: 'Comportamento não encontrado neste paciente.' });
      const base = current.row || {
        name: current.preset?.name, operational_definition: current.preset?.operationalDefinition,
        measurement_type: current.preset?.defaultMeasurement,
        interval_seconds: current.preset?.intervalSeconds,
        default_severity: current.preset?.defaultSeverity, status: 'active',
      };
      const checked = readPatch(req.body, base);
      if (checked.error) return res.status(422).json({ success: false, error: checked.error });
      const duplicate = rows.find((row: any) =>
        String(row.id) !== String(current.row?.id || '') &&
        row.status === 'active' &&
        abaCatalogNameKey(row.name) === abaCatalogNameKey(checked.data!.name));
      if (duplicate) return res.status(409).json({ success: false, code: 'ABA_BEHAVIOR_DUPLICATE', error: 'Já existe outro comportamento com esse nome.' });
      const saved = current.row
        ? await supabase.from('aba_behavior_definitions').update(checked.data)
          .eq('id', current.row.id).eq('patient_id', resolved.patientId).eq('clinic_id', resolved.clinicId)
          .select(SELECT_COLUMNS).single()
        : await supabase.from('aba_behavior_definitions').insert({
            ...checked.data, id: abaCatalogStoredPresetId(resolved.patientId, current.preset!.key),
            clinic_id: resolved.clinicId, organization_id: resolved.clinicId,
            patient_id: resolved.patientId, created_by: resolved.actorId,
          }).select(SELECT_COLUMNS).single();
      if (saved.error || !saved.data) return responseError(res, saved.error);
      return res.json({ success: true, data: saved.data });
    } catch {
      return res.status(503).json({ success: false, error: 'Não foi possível atualizar o comportamento.' });
    }
  });

  // Soft delete is mandatory: previous sessions/events and V3 bindings remain intact.
  app.delete('/api/aba/patients/:patientId/behavior-catalog/:behaviorId', ...guards, async (req: any, res: any) => {
    const resolved = validateMutationScope(req, res);
    if (!resolved) return;
    const id = String(req.params.behaviorId || '').trim();
    if (!id || id.length > 180) return res.status(400).json({ success: false, error: 'Comportamento inválido.' });
    try {
      const currentResult = await list(resolved.patientId, resolved.clinicId);
      if (currentResult.error) return responseError(res, currentResult.error);
      const current = getCurrent(currentResult.data || [], resolved.patientId, id);
      if (!current) return res.status(404).json({ success: false, error: 'Comportamento não encontrado neste paciente.' });
      if (current.row?.status === 'archived') return res.json({ success: true, archived: true, idempotent: true });
      const timestamp = new Date().toISOString();
      const saved = current.row
        ? await supabase.from('aba_behavior_definitions').update({ status: 'archived', is_active: false, updated_at: timestamp })
          .eq('id', current.row.id).eq('patient_id', resolved.patientId).eq('clinic_id', resolved.clinicId)
          .select('id,status').single()
        : await supabase.from('aba_behavior_definitions').insert({
            id: abaCatalogStoredPresetId(resolved.patientId, current.preset!.key),
            name: current.preset!.name, operational_definition: current.preset!.operationalDefinition,
            measurement_type: current.preset!.defaultMeasurement,
            interval_seconds: current.preset!.intervalSeconds,
            default_severity: current.preset!.defaultSeverity,
            status: 'archived', is_active: false, clinic_id: resolved.clinicId,
            organization_id: resolved.clinicId, patient_id: resolved.patientId, created_by: resolved.actorId,
          }).select('id,status').single();
      if (saved.error) return responseError(res, saved.error);
      return res.json({ success: true, archived: true });
    } catch {
      return res.status(503).json({ success: false, error: 'Não foi possível arquivar o comportamento.' });
    }
  });
}
