type ProtocolTaskLike = {
  id?: string | number;
  name?: string;
  title?: string;
  maxScore?: number;
  max_score?: number;
  meta_sucessos?: number;
  metaSucessos?: number;
  criterionMode?: 'total_independent' | 'consecutive_independent';
  masteryCriterionMode?: 'total_independent' | 'consecutive_independent';
};

type ClinicalTaskLike = {
  title?: string;
  taskTitle?: string;
  score?: number | string | null;
  pro_score?: number | string | null;
  professionalScore?: number | string | null;
  max_score?: number | string | null;
  maxScore?: number | string | null;
  consecutive_successes?: number | string | null;
  protocol_id?: string | number | null;
  protocolId?: string | number | null;
  protocol_title?: string | null;
  protocolTitle?: string | null;
  eventDate?: Date | string | null;
  eventDateRaw?: string | null;
  created_at?: string | null;
  date?: string | null;
};

const normalizeText = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const isSameSkill = (a: string, b: string) => {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
};

const toNumber = (value: any): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveTimestamp = (row: ClinicalTaskLike) => {
  const raw = row?.eventDateRaw || row?.eventDate || row?.created_at || row?.date || '';
  const ts = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

type CalculateDomainMasteryOptions = {
  mode?: 'latest' | 'baseline';
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  protocolKind?: 'vbmapp' | 'other';
  vbmappMasteryCriterion?: number;
};

export function calculateDomainMastery(
  tasks: ClinicalTaskLike[],
  allProtocolTasks: ProtocolTaskLike[],
  options?: CalculateDomainMasteryOptions
): number {
  const mode = options?.mode || 'latest';
  const protocolKind = options?.protocolKind || 'other';
  const criterion = Math.max(1, Math.floor(toNumber(options?.vbmappMasteryCriterion) ?? 5));
  const periodStartTs = options?.periodStart ? new Date(options.periodStart).getTime() : Number.NEGATIVE_INFINITY;
  const periodEndTs = options?.periodEnd ? new Date(options.periodEnd).getTime() : Number.POSITIVE_INFINITY;

  const protocolUniverse = (Array.isArray(allProtocolTasks) ? allProtocolTasks : [])
    .map((task) => {
      const label = String(task?.name || task?.title || '').trim();
      const key = normalizeText(label);
      const maxFromTask = toNumber(task?.maxScore ?? task?.max_score);
      const metaSucessos = toNumber(task?.meta_sucessos ?? task?.metaSucessos);
      return {
        label,
        key,
        maxScore: Math.max(1, Number(maxFromTask ?? 1)),
        metaSucessos: Math.max(1, Math.floor(Number(metaSucessos ?? criterion))),
        explicitCriterion: metaSucessos !== null && metaSucessos > 0,
        criterionMode: String(task?.criterionMode || task?.masteryCriterionMode || '') === 'consecutive_independent'
          ? 'consecutive_independent' as const : 'total_independent' as const,
      };
    })
    .filter((task) => task.key);

  if (!protocolUniverse.length) return 0;

  const maxByKey = new Map<string, number>();
  protocolUniverse.forEach((task) => maxByKey.set(task.key, task.maxScore));

  const selectedByKey = new Map<string, { ts: number; score: number; maxScore: number }>();
  const timelineByKey = new Map<
    string,
    Array<{ ts: number; score: number; maxScore: number; consecutive: number | null }>
  >();

  (Array.isArray(tasks) ? tasks : []).forEach((row) => {
    const title = String(row?.taskTitle || row?.title || '').trim();
    if (!title) return;
    const ts = resolveTimestamp(row);
    if (ts < periodStartTs || ts > periodEndTs) return;

    const scoreRaw =
      toNumber(row?.professionalScore) ??
      toNumber(row?.pro_score) ??
      toNumber(row?.score);
    if (scoreRaw === null) return;

    const matched = protocolUniverse.find((task) => isSameSkill(task.label, title));
    if (!matched) return;

    const rowMax = toNumber(row?.maxScore ?? row?.max_score);
    const maxScore = Math.max(1, Number(rowMax ?? maxByKey.get(matched.key) ?? 1));
    const score = Math.max(0, Math.min(maxScore, Number(scoreRaw)));
    const explicitConsecutive = toNumber(row?.consecutive_successes);
    const prev = selectedByKey.get(matched.key);
    const timeline = timelineByKey.get(matched.key) || [];
    timeline.push({ ts, score, maxScore, consecutive: explicitConsecutive });
    timelineByKey.set(matched.key, timeline);

    if (!prev) {
      selectedByKey.set(matched.key, { ts, score, maxScore });
      return;
    }

    const shouldReplace = mode === 'baseline' ? ts < prev.ts : ts >= prev.ts;
    if (shouldReplace) selectedByKey.set(matched.key, { ts, score, maxScore });
  });

  let obtained = 0;
  let possible = 0;
  protocolUniverse.forEach((task) => {
    const selected = selectedByKey.get(task.key);
    const maxScore = maxByKey.get(task.key) ?? 1;
    possible += maxScore;
    if (!selected) return;

    if (protocolKind !== 'vbmapp') {
      obtained += Math.max(0, Math.min(maxScore, selected.score));
      return;
    }

    const timeline = (timelineByKey.get(task.key) || []).sort((a, b) => a.ts - b.ts);
    const selectedIdx = mode === 'baseline'
      ? timeline.findIndex((r) => r.ts === selected.ts && r.score === selected.score)
      : timeline.findLastIndex((r) => r.ts === selected.ts && r.score === selected.score);
    const upto = selectedIdx >= 0 ? timeline.slice(0, selectedIdx + 1) : timeline;

    let streak = 0;
    for (const row of upto) {
      if (row.score >= 1) {
        streak += 1;
      } else {
        streak = 0;
      }
    }
    const last = upto[upto.length - 1];
    if (!last) return;

    // If backend persisted consecutive_successes, trust it only for an
    // explicit consecutive criterion. An independent TOTAL criterion must
    // never be replaced by a streak or a global 5/10 guess.
    if (last.consecutive !== null && Number.isFinite(last.consecutive)) {
      streak = Math.max(0, Math.floor(last.consecutive));
    }

    if (task.explicitCriterion) {
      const independentCorrectCount = task.criterionMode === 'consecutive_independent'
        ? streak
        : upto.filter((row) => row.score >= 1).length;
      const criterionMet = independentCorrectCount >= task.metaSucessos;
      // Intermediate credit is 0.5 only while an explicit configured
      // criterion is pending; never turn partial trials into full mastery.
      const hasPartialEvidence = independentCorrectCount > 0 || last.score >= 0.5;
      obtained += (criterionMet ? 1 : hasPartialEvidence ? 0.5 : 0) * maxScore;
      return;
    }

    const basePercent = last.score >= 0.5 ? 50 : 0;
    const increment = (100 - basePercent) / task.metaSucessos;
    const progressPercent = last.score >= 1
      ? Math.min(100, basePercent + streak * increment)
      : basePercent;

    obtained += (Math.max(0, Math.min(100, progressPercent)) / 100) * maxScore;
  });

  if (possible <= 0) return 0;
  return Number(((obtained / possible) * 100).toFixed(2));
}

export function normalizeScoreToPercent(score: number | null | undefined, maxScore: number | null | undefined): number {
  const safeScore = toNumber(score) ?? 0;
  const safeMax = Math.max(1, toNumber(maxScore) ?? 1);
  const normalized = (safeScore / safeMax) * 100;
  return Math.max(0, Math.min(100, Number(normalized.toFixed(2))));
}
