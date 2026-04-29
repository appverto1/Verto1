type ProtocolTaskLike = {
  id?: string | number;
  name?: string;
  title?: string;
  maxScore?: number;
  max_score?: number;
};

type ClinicalTaskLike = {
  title?: string;
  taskTitle?: string;
  score?: number | string | null;
  pro_score?: number | string | null;
  professionalScore?: number | string | null;
  max_score?: number | string | null;
  maxScore?: number | string | null;
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
};

export function calculateDomainMastery(
  tasks: ClinicalTaskLike[],
  allProtocolTasks: ProtocolTaskLike[],
  options?: CalculateDomainMasteryOptions
): number {
  const mode = options?.mode || 'latest';
  const periodStartTs = options?.periodStart ? new Date(options.periodStart).getTime() : Number.NEGATIVE_INFINITY;
  const periodEndTs = options?.periodEnd ? new Date(options.periodEnd).getTime() : Number.POSITIVE_INFINITY;

  const protocolUniverse = (Array.isArray(allProtocolTasks) ? allProtocolTasks : [])
    .map((task) => {
      const label = String(task?.name || task?.title || '').trim();
      const key = normalizeText(label);
      const maxFromTask = toNumber(task?.maxScore ?? task?.max_score);
      return {
        label,
        key,
        maxScore: Math.max(1, Number(maxFromTask ?? 1))
      };
    })
    .filter((task) => task.key);

  if (!protocolUniverse.length) return 0;

  const maxByKey = new Map<string, number>();
  protocolUniverse.forEach((task) => maxByKey.set(task.key, task.maxScore));

  const selectedByKey = new Map<string, { ts: number; score: number; maxScore: number }>();

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
    const prev = selectedByKey.get(matched.key);

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
    obtained += selected ? Math.max(0, Math.min(maxScore, selected.score)) : 0;
  });

  if (possible <= 0) return 0;
  return Number(((obtained / possible) * 100).toFixed(2));
}

