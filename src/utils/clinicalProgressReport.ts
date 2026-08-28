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

export type ClinicalProgressReportProgram = {
  key: string;
  id: string | null;
  name: string;
  metrics: ClinicalProgressReportMetric[];
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

export const buildClinicalProgressReportSections = (payload: any): ClinicalProgressReportSection[] => {
  const plans = Array.isArray(payload?.plans) ? payload.plans : [];
  const programs = Array.isArray(payload?.programs) ? payload.programs : [];
  const observations = Array.isArray(payload?.observations) ? payload.observations : [];
  const planById = new Map(plans.map((plan: any) => [clean(plan?.id), plan]).filter(([id]) => Boolean(id)));
  const programById = new Map(programs.map((program: any) => [clean(program?.id), program]).filter(([id]) => Boolean(id)));
  const observationsByPlan = new Map<string, any[]>();

  for (const observation of observations) {
    const planId = clean(observation?.planId || observation?.plan_id);
    if (!planId || !planById.has(planId)) continue;
    const current = observationsByPlan.get(planId) || [];
    current.push(observation);
    observationsByPlan.set(planId, current);
  }

  const sections: ClinicalProgressReportSection[] = [];
  for (const [planId, planObservations] of observationsByPlan.entries()) {
    const plan: any = planById.get(planId);
    const mode = clean(plan?.mode).toLowerCase();
    if (mode !== 'interdisciplinary' && mode !== 'specialty') continue;

    const domainMap = new Map<string, { name: string; programMap: Map<string, { id: string | null; name: string; rows: any[] }> }>();
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
      const domainKey = domainName.toLocaleLowerCase('pt-BR');
      const programKey = programId || `${domainKey}::${programName.toLocaleLowerCase('pt-BR')}`;
      let domain = domainMap.get(domainKey);
      if (!domain) {
        domain = { name: domainName, programMap: new Map() };
        domainMap.set(domainKey, domain);
      }
      let programEntry = domain.programMap.get(programKey);
      if (!programEntry) {
        programEntry = { id: programId || null, name: programName, rows: [] };
        domain.programMap.set(programKey, programEntry);
      }
      programEntry.rows.push(observation);
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

        return {
          key: `${planId}::${programKey}`,
          id: program.id,
          name: program.name,
          metrics,
        };
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
    });
  }

  return sections.sort((left, right) => {
    if (left.planKind !== right.planKind) return left.planKind === 'PTS' ? -1 : 1;
    return left.planLabel.localeCompare(right.planLabel, 'pt-BR');
  });
};
