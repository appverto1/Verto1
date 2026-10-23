// Navigation-only helpers: the list of topics is already projected by the authenticated backend.
export function visibleHelpArticle<T extends { articleId: string }>(
  topics: readonly T[],
  filtered: readonly T[],
  selectedId: string,
  searching: boolean,
): T | undefined {
  const candidates = searching ? filtered : topics;
  return candidates.find(topic => topic.articleId === selectedId) || candidates[0];
}

export function helpThemeIsExpanded(
  theme: string,
  expandedThemes: Readonly<Record<string, boolean>>,
  selectedTheme: string | undefined,
  searching: boolean,
): boolean {
  // All matching themes must be traversable while searching, even if previously collapsed.
  if (searching) return true;
  return expandedThemes[theme] === true ||
    (expandedThemes[theme] === undefined && selectedTheme === theme);
}
