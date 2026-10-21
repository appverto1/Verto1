/**
 * Cosmetic unread indicator for the clinical Diary subtab.
 * This is NOT a permission, audit or clinical persistence source.
 * No new Supabase reads: compare the already authorized history snapshot
 * against a per-browser, per-actor watermark.
 */
type FamilyDiaryEntry = {
  id?: unknown;
  type?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  date?: unknown;
};

const normalizeId = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase();

export function familyDiaryReadMarkerKey(params: {
  userId: unknown;
  clinicId: unknown;
  patientId: unknown;
}): string {
  const { userId, clinicId, patientId } = params;
  const scope = [userId, clinicId, patientId].map(normalizeId);
  // No shared/global marker: a missing identity can never affect another
  // patient's badge or leak reading activity across accounts or clinics.
  if (scope.some((value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))) return '';
  return `verto.family-diary-viewed.v1:${scope.join(':')}`;
}

export function familyDiaryEntryTime(entry: FamilyDiaryEntry): number {
  if (!entry || !['family_note', 'photo'].includes(String(entry.type || ''))) return 0;
  const value = entry.created_at ?? entry.createdAt ?? entry.date;
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function readFamilyDiarySeenAt(key: string, store?: Pick<Storage, 'getItem'> | null): number {
  if (!key || !store) return 0;
  try {
    const value = Number(store.getItem(key));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function familyDiaryNewCount(entries: FamilyDiaryEntry[], seenAt: number): number {
  const threshold = Number.isSafeInteger(seenAt) && seenAt > 0 ? seenAt : 0;
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => Boolean(String(entry?.id || '').trim()) && familyDiaryEntryTime(entry) > threshold)
    .length;
}

export function markFamilyDiarySeen(
  key: string,
  entries: FamilyDiaryEntry[],
  store?: Pick<Storage, 'getItem' | 'setItem'> | null,
): boolean {
  if (!key || !store) return false;
  const latest = (Array.isArray(entries) ? entries : []).reduce((max, entry) => Math.max(max, familyDiaryEntryTime(entry)), 0);
  if (!latest) return false;
  try {
    const previous = readFamilyDiarySeenAt(key, store);
    if (latest > previous) store.setItem(key, String(latest));
    return true;
  } catch {
    return false;
  }
}
