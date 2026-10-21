type FamilyRecord = {
  id?: unknown; sourceRef?: unknown; type?: unknown; visibility?: unknown;
  subject?: unknown; text?: unknown; note?: unknown; score?: unknown;
};
type MilestoneAward = { awarded: boolean };

/**
 * An original family record is the authority for its own reward.
 * Legacy milestone events are used only when the source record is unavailable,
 * never to resurrect a star that its author has explicitly revoked.
 */
export function countCanonicalFamilyStars(
  history: FamilyRecord[],
  sharedNotes: FamilyRecord[],
  milestoneBySource: ReadonlyMap<string, MilestoneAward>
): number {
  const bySource = new Map<string, boolean>();
  const awarded = (item: FamilyRecord) =>
    Number(item?.score ?? 0) >= 1
    || /\[STAR\]/i.test(String(item?.note ?? item?.text ?? ''))
    || /\u2b50|⭐/.test(String(item?.subject || ''));

  for (const row of Array.isArray(history) ? history : []) {
    if (!['family_note', 'patient_note', 'photo'].includes(String(row?.type || '').toLowerCase())) continue;
    const source = String(row?.sourceRef || row?.id || '').trim();
    if (source) bySource.set(source, awarded(row));
  }
  for (const row of Array.isArray(sharedNotes) ? sharedNotes : []) {
    const subject = String(row?.subject || '').trim().toLowerCase();
    const text = String(row?.text ?? row?.note ?? '');
    if (subject === 'milestone_event' || text.startsWith('MILESTONE_EVENT|')) continue;
    const familyNote = ['family_note', 'photo'].includes(String(row?.type || '').toLowerCase())
      || String(row?.visibility || '').toLowerCase() === 'family';
    if (!familyNote) continue;
    const source = String(row?.sourceRef || (row?.id ? `note-family-${row.id}` : '')).trim();
    if (source) bySource.set(source, awarded(row));
  }
  for (const [source, event] of milestoneBySource) {
    if (source && !bySource.has(source)) bySource.set(source, Boolean(event?.awarded));
  }
  return Array.from(bySource.values()).filter(Boolean).length;
}
