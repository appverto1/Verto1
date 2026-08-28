export type ClinicalProgressReportTrend = 'favorable' | 'attention' | 'stable' | 'descriptive';

export type ClinicalProgressReportMetric = {
  key: string;
  label: string;
  itemLabel: string;
  unit: string;
  direction: 'higher_is_better' | 'lower_is_better' | 'neutral';
  firstDisplay: string;
  latestDisplay: string;
  evolutionDisplay: string;
  firstObservedAt: string | null;
  latestObservedAt: string | null;
  pointCount: number;
  trend: ClinicalProgressReportTrend;
  trendLabel: string;
};

export type ClinicalProgressReportActivityEvidence = {
  key: string;
  assignedTaskId: string | null;
  title: string;
  targetLabel: string | null;
  patientEffortDisplay: string | null;
  patientComment: string | null;
  professionalReviewDisplay: string | null;
  professionalReviewNote: string | null;
  completedAt: string | null;
  reviewedAt: string | null;
  evidenceKind: 'contextual_task_review';
};

export type ClinicalProgressReportProgram = {
  key: string;
  id: string | null;
  name: string;
  metrics: ClinicalProgressReportMetric[];
  activities: ClinicalProgressReportActivityEvidence[];
};

export type ClinicalProgressReportDomain = {
  key: string;
  name: string;
  programs: ClinicalProgressReportProgram[];
};

export type ClinicalProgressReportSection = {
  planId: string;
  planKind: 'PTS' | 'SPECIALTY';
  planLabel: string;
  specialty: string | null;
  status: string | null;
  domains: ClinicalProgressReportDomain[];
  observationCount: number;
  activityEvidenceCount: number;
};

const clean = (value: unknown) => String(value ?? '').trim();
const finite = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const timestamp = (value: unknown) => {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDirection = (value: unknown): ClinicalProgressReportMetric['direction'] => {
  const normalized = clean(value).toLowerCase();
  if (['lower_is_better', 'lower-is-better', 'lower', 'decrease'].includes(normalized)) return 'lower_is_better';
  if (['higher_is_better', 'higher-is-better', 'higher', 'increase'].includes(normalized)) return 'higher_is_better';
  return 'neutral';
};

const formatNumber = (value: number) => Number.isInteger(value)
  ? String(value)
  : value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const formatMetricValue = (row: any) => {
  const valueText = clean(row?.valueText || row?.value_text);
  if (valueText) return valueText;
  const numerator = finite(row?.numerator);
  const denominator = finite(row?.denominator);
  const unit = clean(row?.unit);
  const value = finite(row?.value);
  if (numerator !== null && denominator !== null && denominator > 0 && !unit) {
    return `${formatNumber(numerator)}/${formatNumber(denominator)}`;
  }
  if (value === null) {
    const missingReason = clean(row?.missingReason || row?.missing_reason);
    return missingReason ? `Sem medida (${missingReason})` : 'Sem medida';
  }
  if (!unit) return formatNumber(value);
  if (['%', 'percent', 'percentage', 'percentual'].includes(unit.toLowerCase())) return `${formatNumber(value)}%`;
  return `${formatNumber(value)} ${unit}`;
};

const metadataText = (row: any, ...keys: string[]) => {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const valueDetails = metadata?.valueDetails && typeof metadata.valueDetails === 'object'
    ? metadata.valueDetails
    : metadata?.value_details && typeof metadata.value_details === 'object'
      ? metadata.value_details
      : {};
  for (const key of keys) {
    const direct = clean(metadata?.[key]);
    if (direct) return direct;
    const nested = clean(valueDetails?.[key]);
    if (nested) return nested;
  }
  return '';
};

const planLabel = (plan: any) => {
  const mode = clean(plan?.mode).toLowerCase();
  const specialty = clean(plan?.specialty);
  return mode === 'interdisciplinary'
    ? 'PTS interdisciplinar'
    : specialty
      ? `Plano individual · ${specialty}`
      : 'Plano individual de especialidade';
};

const trendFor = (
  firstValue: number | null,
  latestValue: number | null,
  direction: ClinicalProgressReportMetric['direction'],
  firstDisplay: string,
  latestDisplay: string,
): { trend: ClinicalProgressReportTrend; label: string } => {
  if (firstValue === null || latestValue === null || direction === 'neutral') {
    if (firstDisplay === latestDisplay) return { trend: 'stable', label: 'Sem mudança registrada' };
    return { trend: 'descriptive', label: 'Evolução descritiva' };
  }
  const delta = latestValue - firstValue;
  const scale = Math.max(1, Math.abs(firstValue), Math.abs(latestValue));
  if (Math.abs(delta) <= scale * 0.001) return { trend: 'stable', label: 'Estável no período' };
  const favorable = direction === 'lower_is_better' ? delta < 0 : delta > 0;
  return favorable
    ? { trend: 'favorable', label: 'Evolução favorável' }
    : { trend: 'attention', label: 'Necessita atenção' };
};

const activitySnapshot = (row: any) => row?.clinicalLinkSnapshot && typeof row.clinicalLinkSnapshot === 'object'
  ? row.clinicalLinkSnapshot
  : row?.clinical_link_snapshot && typeof row.clinical_link_snapshot === 'object'
    ? row.clinical_link_snapshot
    : {};

const formatActivityEffort = (row: any) => {
  const effort = finite(row?.patientEffort ?? row?.patient_effort);
  if (effort === null) return null;
  const label = clean(row?.patientEffortLabel || row?.patient_effort_label);
  return label ? `${formatNumber(effort)}% · ${label}` : `${formatNumber(effort)}%`;
};

const formatActivityReview = (row: any) => {
  const score = finite(row?.professionalScore ?? row?.pro_score);
  const maxScore = finite(row?.maxScore ?? row?.max_score);
  if (score === null || maxScore === null || maxScore <= 0) return null;
  return `${formatNumber(score)}/${formatNumber(maxScore)}`;
};

export const buildClinicalProgressReportSections = (payload: any): ClinicalProgressReportSection[] => {
  const plans = Array.isArray(payload?.plans) ? payload.plans : [];
  const programs = Array.isArray(payload?.programs) ? payload.programs : [];
  const observations = Array.isArray(payload?.observations) ? payload.observations : [];
  const activityEvidence = Array.isArray(payload?.activityEvidence) ? payload.activityEvidence : [];
  const planById = new Map(plans.map((plan: any) => [clean(plan?.id), plan]).filter(([id]) => Boolean(id)));
  const programById = new Map(programs.map((program: any) => [clean(program?.id), program]).filter(([id]) => Boolean(id)));
  const observationsByPlan = new Map<string, any[]>();
  const activitiesByPlan = new Map<string, any[]>();

  for (const observation of observations) {
    const planId = clean(observation?.planId || observation?.plan_id);
    if (!planId || !planById.has(planId)) continue;
    const current = observationsByPlan.get(planId) || [];
    current.push(observation);
    observationsByPlan.set(planId, current);
  }
  for (const activity of activityEvidence) {
    const planId = clean(activity?.planId || activity?.plan_id || activity?.therapeutic_plan_id);
    if (!planId || !planById.has(planId)) continue;
    const current = activitiesByPlan.get(planId) || [];
    current.push(activity);
    activitiesByPlan.set(planId, current);
  }

  const planIds = Array.from(new Set([...observationsByPlan.keys(), ...activitiesByPlan.keys()]));
  const sections: ClinicalProgressReportSection[] = [];
  for (const planId of planIds) {
    const planObservations = observationsByPlan.get(planId) || [];
    const planActivities = activitiesByPlan.get(planId) || [];
    const plan: any = planById.get(planId);
    const mode = clean(plan?.mode).toLowerCase();
    if (mode !== 'interdisciplinary' && mode !== 'specialty') continue;

    type ProgramBucket = { id: string | null; name: string; rows: any[]; activities: any[] };
    const domainMap = new Map<string, { name: string; programMap: Map<string, ProgramBucket> }>();
    const ensureProgram = (domainNameRaw: string, programIdRaw: string, programNameRaw: string) => {
      const domainName = clean(domainNameRaw) || 'Domínio não informado';
      const programName = clean(programNameRaw) || 'Programa / objetivo do plano';
      const domainKey = domainName.toLocaleLowerCase('pt-BR');
      const programKey = clean(programIdRaw) || `${domainKey}::${programName.toLocaleLowerCase('pt-BR')}`;
      let domain = domainMap.get(domainKey);
      if (!domain) {
        domain = { name: domainName, programMap: new Map() };
        domainMap.set(domainKey, domain);
      }
      let programEntry = domain.programMap.get(programKey);
      if (!programEntry) {
        programEntry = { id: clean(programIdRaw) || null, name: programName, rows: [], activities: [] };
        domain.programMap.set(programKey, programEntry);
      }
      return { programKey, programEntry };
    };

    for (const observation of planObservations) {
      const programId = clean(observation?.programId || observation?.program_id);
      const program: any = programId ? programById.get(programId) : null;
      const domainName = clean(program?.domainName || program?.domain_name)
        || metadataText(observation, 'domainName', 'domain_name', 'domain', 'sourceDomain', 'source_domain')
        || 'Domínio não informado';
      const programName = clean(program?.name)
        || metadataText(observation, 'programName', 'program_name')
        || clean(observation?.itemLabel || observation?.item_label)
        || (clean(observation?.goalId || observation?.goal_id) ? 'Objetivo do plano' : 'Métrica do plano');
      ensureProgram(domainName, programId, programName).programEntry.rows.push(observation);
    }

    for (const activity of planActivities) {
      const snapshot = activitySnapshot(activity);
      const programId = clean(activity?.programId || activity?.program_id || activity?.therapeutic_program_id || snapshot?.programId);
      const program: any = programId ? programById.get(programId) : null;
      const domainName = clean(program?.domainName || program?.domain_name || snapshot?.domainName) || 'Domínio não informado';
      const programName = clean(program?.name || snapshot?.programName) || 'Programa / objetivo do plano';
      ensureProgram(domainName, programId, programName).programEntry.activities.push(activity);
    }

    const domains: ClinicalProgressReportDomain[] = Array.from(domainMap.entries()).map(([domainKey, domain]) => ({
      key: `${planId}::${domainKey}`,
      name: domain.name,
      programs: Array.from(domain.programMap.entries()).map(([programKey, program]) => {
        const seriesMap = new Map<string, any[]>();
        for (const row of program.rows) {
          const itemId = clean(row?.itemId || row?.item_id || row?.goalId || row?.goal_id);
          const itemLabel = clean(row?.itemLabel || row?.item_label) || program.name;
          const metricKey = clean(row?.metricKey || row?.metric_key || row?.metricLabel || row?.metric_label) || 'metric';
          const unit = clean(row?.unit);
          const direction = normalizeDirection(row?.direction);
          const seriesKey = `${itemId || itemLabel}::${metricKey}::${unit}::${direction}`;
          const current = seriesMap.get(seriesKey) || [];
          current.push(row);
          seriesMap.set(seriesKey, current);
        }

        const metrics: ClinicalProgressReportMetric[] = Array.from(seriesMap.entries()).map(([seriesKey, rows]) => {
          rows.sort((left, right) => timestamp(left?.observedAt || left?.observed_at) - timestamp(right?.observedAt || right?.observed_at));
          const first = rows[0] || {};
          const latest = rows[rows.length - 1] || first;
          const firstDisplay = formatMetricValue(first);
          const latestDisplay = formatMetricValue(latest);
          const direction = normalizeDirection(latest?.direction || first?.direction);
          const trend = trendFor(finite(first?.value), finite(latest?.value), direction, firstDisplay, latestDisplay);
          return {
            key: `${planId}::${programKey}::${seriesKey}`,
            label: clean(latest?.metricLabel || latest?.metric_label || first?.metricLabel || first?.metric_label || latest?.metricKey || latest?.metric_key) || 'Métrica clínica',
            itemLabel: clean(latest?.itemLabel || latest?.item_label || first?.itemLabel || first?.item_label) || program.name,
            unit: clean(latest?.unit || first?.unit),
            direction,
            firstDisplay,
            latestDisplay,
            evolutionDisplay: `${firstDisplay} → ${latestDisplay}`,
            firstObservedAt: clean(first?.observedAt || first?.observed_at) || null,
            latestObservedAt: clean(latest?.observedAt || latest?.observed_at) || null,
            pointCount: rows.length,
            trend: trend.trend,
            trendLabel: trend.label,
          };
        }).sort((left, right) => right.pointCount - left.pointCount || left.label.localeCompare(right.label, 'pt-BR'));

        const activities: ClinicalProgressReportActivityEvidence[] = program.activities
          .slice()
          .sort((left, right) => timestamp(right?.reviewedAt || right?.reviewed_at || right?.completedAt || right?.completed_at) - timestamp(left?.reviewedAt || left?.reviewed_at || left?.completedAt || left?.completed_at))
          .map((row: any, index: number) => {
            const snapshot = activitySnapshot(row);
            return {
              key: clean(row?.assignedTaskId || row?.assigned_task_id) || `${planId}::${programKey}::activity-${index}`,
              assignedTaskId: clean(row?.assignedTaskId || row?.assigned_task_id) || null,
              title: clean(row?.taskTitle || row?.task_title) || 'Atividade vinculada',
              targetLabel: clean(snapshot?.targetName || row?.targetName || row?.target_name) || null,
              patientEffortDisplay: formatActivityEffort(row),
              patientComment: clean(row?.patientComment || row?.patient_comment) || null,
              professionalReviewDisplay: formatActivityReview(row),
              professionalReviewNote: clean(row?.professionalReviewNote || row?.pro_review_note) || null,
              completedAt: clean(row?.completedAt || row?.completed_at) || null,
              reviewedAt: clean(row?.reviewedAt || row?.reviewed_at) || null,
              evidenceKind: 'contextual_task_review',
            };
          });

        return { key: `${planId}::${programKey}`, id: program.id, name: program.name, metrics, activities };
      }).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    })).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

    sections.push({
      planId,
      planKind: mode === 'interdisciplinary' ? 'PTS' : 'SPECIALTY',
      planLabel: planLabel(plan),
      specialty: clean(plan?.specialty) || null,
      status: clean(plan?.status) || null,
      domains,
      observationCount: planObservations.length,
      activityEvidenceCount: planActivities.length,
    });
  }

  return sections.sort((left, right) => {
    if (left.planKind !== right.planKind) return left.planKind === 'PTS' ? -1 : 1;
    return left.planLabel.localeCompare(right.planLabel, 'pt-BR');
  });
};
