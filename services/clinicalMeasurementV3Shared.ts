export type ClinicalMeasurementV3Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  checkPatientAccess: any;
  requireClinicCapability: (capability: any) => any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
  enforcePayloadLimit: (req: any, res: any, maxBytes: number, label?: string) => boolean;
  canEditTherapeuticPlanScope: (plan: any, context: any) => boolean;
  filterTherapeuticPlanScopesForActor: (plans: any[], context: any) => any[];
  filterTherapeuticPlanProgramsForActor: (programs: any[], plans: any[], context: any) => any[];
};

export type SemanticMeasurementResponse = Record<string, any>;

export const SUMMARY_TABLES: Record<string,string> = {
  COUNT:'clinical_measurement_session_count_summaries_v3', RATE:'clinical_measurement_session_rate_summaries_v3',
  PROPORTION:'clinical_measurement_session_proportion_summaries_v3', DURATION:'clinical_measurement_session_temporal_summaries_v3',
  LATENCY:'clinical_measurement_session_temporal_summaries_v3', IRT:'clinical_measurement_session_temporal_summaries_v3',
  CONTINUOUS:'clinical_measurement_session_continuous_summaries_v3', INTERVAL:'clinical_measurement_session_interval_summaries_v3',
  ORDINAL:'clinical_measurement_session_ordinal_summaries_v3', CATEGORICAL:'clinical_measurement_session_categorical_summaries_v3',
  TASK_ANALYSIS:'clinical_measurement_session_task_analysis_summaries_v3'
};

export const isoOr = (value:any,fallback:Date) => {
  const d=new Date(String(value||''));
  return Number.isFinite(d.getTime())?d:fallback;
};
export const maxIso = (values:any[]) => values.filter(Boolean).map(String).sort().at(-1) || null;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const THERAPEUTIC_PLAN_MANAGER_ROLES=new Set(['owner','admin','director','coordinator','supervisor']);
export const isUuid=(value:any)=>UUID_RE.test(String(value||'').trim());
export const directionalityFrom=(value:any)=>{
  const normalized=String(value||'').trim().toLowerCase();
  if(normalized==='higher_is_better') return 'INCREASE_IS_BETTER';
  if(normalized==='lower_is_better') return 'DECREASE_IS_BETTER';
  if(normalized==='target_value'||normalized==='target_range') return 'TARGET_RANGE_IS_BETTER';
  return 'NO_DIRECTIONAL_JUDGMENT';
};
