export function normalizeExternalTimelineMonthKey(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) return '';
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';
  return `${match[1]}-${match[2]}`;
}

function timestampOf(item) {
  const value = new Date(item?.createdAt || item?.updatedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
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
      items: [...monthItems].sort((a, b) => timestampOf(b) - timestampOf(a)),
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function externalTimelineYears(groups) {
  return Array.from(new Set((Array.isArray(groups) ? groups : []).map((group) => String(group?.year || '')).filter(Boolean)))
    .sort((a, b) => b.localeCompare(a));
}
