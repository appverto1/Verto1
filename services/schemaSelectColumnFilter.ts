export function filterFlatSelectColumnsForSchema(
  selectColumns: unknown,
  availableColumns: Set<string>,
): string {
  const original = String(selectColumns ?? '*').trim() || '*';
  if (original === '*' || original.includes('(') || original.includes(')')) return original;

  const tokens = original
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return original;

  let removed = 0;
  const filtered = tokens.filter((token) => {
    // Only rewrite plain top-level column names. Aliases, casts, JSON paths and
    // relationship expressions remain untouched so the guard cannot change
    // PostgREST semantics it does not understand.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) return true;
    if (availableColumns.has(token)) return true;
    removed += 1;
    return false;
  });

  return removed > 0 && filtered.length > 0 ? filtered.join(',') : original;
}
