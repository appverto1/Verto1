export function normalizeExternalTimelineMonthKey(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) return '';
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';
  return `${match[1]}-${match[2]}`;
}

export function normalizeExternalTimelineClinicalDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) return '';
  const dayKey = raw.slice(0, 10);
  const date = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dayKey) return '';
  return dayKey;
}

function timestamp(value) {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemOrderTimestamp(item) {
  const clinical = normalizeExternalTimelineClinicalDate(item?.clinicalDate);
  if (clinical) return timestamp(`${clinical}T12:00:00Z`);
  const slot = Number(item?.slot);
  if (Number.isFinite(slot) && slot > 0) return slot * 1_000_000_000_000;
  // Technical timestamps are only a deterministic fallback for ordering. They are never rendered as clinical dates.
  return timestamp(item?.createdAt || item?.updatedAt || item?.sharedAt);
}

export function externalTimelineClinicalDateLabel(value, locale = 'pt-BR') {
  const dayKey = normalizeExternalTimelineClinicalDate(value);
  if (!dayKey) return '';
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date).replace('.', '').toUpperCase();
  return `${String(day).padStart(2, '0')} ${monthLabel}`;
}

export function groupExternalTimelineItemsByMonth(items) {
  const grouped = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeExternalTimelineMonthKey(item?.monthKey);
    if (!key) continue;
    const list = grouped.get(key) || [];
    list.push(item);
    grouped.set(key, list);
  }
  return Array.from(grouped.entries())
    .map(([key, monthItems]) => ({
      key,
      year: key.slice(0, 4),
      month: key.slice(5, 7),
      items: [...monthItems].sort((a, b) => itemOrderTimestamp(b) - itemOrderTimestamp(a)),
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function externalTimelineYears(groups) {
  return Array.from(new Set((Array.isArray(groups) ? groups : []).map((group) => String(group?.year || '')).filter(Boolean)))
    .sort((a, b) => b.localeCompare(a));
}

export function externalTimelineNavigationMonths(groups, year) {
  return (Array.isArray(groups) ? groups : [])
    .filter((group) => !year || String(group?.year || '') === String(year))
    .slice()
    .sort((a, b) => String(a?.key || '').localeCompare(String(b?.key || '')));
}

export function externalTimelineLatestMonth(groups, year) {
  return (Array.isArray(groups) ? groups : []).find((group) => !year || String(group?.year || '') === String(year))?.key || '';
}

export function externalTimelineComparisonGroups(groups, selectedKeys) {
  const byKey = new Map((Array.isArray(groups) ? groups : []).map((group) => [String(group?.key || ''), group]));
  return (Array.isArray(selectedKeys) ? selectedKeys : []).slice(0, 2).map((key) => byKey.get(String(key || ''))).filter(Boolean);
}


export function updateExternalTimelineComparisonSelection(currentSelection, key) {
  const current = Array.isArray(currentSelection) ? currentSelection.map((value) => String(value || '')).filter(Boolean).slice(0, 2) : [];
  const normalizedKey = normalizeExternalTimelineMonthKey(key);
  if (!normalizedKey) return current;
  if (current.includes(normalizedKey)) return current.filter((value) => value !== normalizedKey);
  if (current.length < 2) return [...current, normalizedKey];
  return [current[0], normalizedKey];
}


export function externalTimelineUnreadCount(items) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => total + (item?.firstViewedAt ? 0 : 1), 0);
}

export function externalTimelineMostRecentUnreadMonth(groups) {
  let bestKey = '';
  let bestTimestamp = -1;
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const item of Array.isArray(group?.items) ? group.items : []) {
      if (item?.firstViewedAt) continue;
      const shared = timestamp(item?.sharedAt || item?.updatedAt || item?.createdAt);
      if (shared > bestTimestamp) {
        bestTimestamp = shared;
        bestKey = normalizeExternalTimelineMonthKey(group?.key);
      }
    }
  }
  return bestKey;
}

export function externalTimelineInitialMonth(groups, preferredMonth = '') {
  const available = new Set((Array.isArray(groups) ? groups : []).map((group) => normalizeExternalTimelineMonthKey(group?.key)).filter(Boolean));
  const unreadMonth = externalTimelineMostRecentUnreadMonth(groups);
  if (unreadMonth) return unreadMonth;
  const preferred = normalizeExternalTimelineMonthKey(preferredMonth);
  if (preferred && available.has(preferred)) return preferred;
  return externalTimelineLatestMonth(groups);
}

export function externalTimelineVisibleGroup(groups, key) {
  const normalized = normalizeExternalTimelineMonthKey(key);
  return (Array.isArray(groups) ? groups : []).find((group) => normalizeExternalTimelineMonthKey(group?.key) === normalized) || null;
}
