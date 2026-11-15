/**
 * Turn free text from the search box into a safe FTS5 MATCH expression.
 *
 * Every word is quoted so FTS5 treats it as literal text rather than query
 * syntax (apostrophes, '-', ':', AND/OR/NEAR would otherwise be syntax
 * errors). The last word gets prefix matching for search-as-you-type.
 * Returns null when there is nothing to search for.
 */
export function buildFtsQuery(query: string): string | null {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .map((w, i) => `"${w.replace(/"/g, '""')}"${i === words.length - 1 ? '*' : ''}`)
    .join(' ');
}
