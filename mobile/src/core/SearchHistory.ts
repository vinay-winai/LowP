export const SEARCH_HISTORY_KEY = 'lowp_search_history_v1';
const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
const key = (value: string) => clean(value).toLowerCase();

// Newest first; case and repeated whitespace do not create duplicate entries.
export function normalizeSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !clean(entry) || seen.has(key(entry))) continue;
    seen.add(key(entry));
    result.push(clean(entry));
    if (result.length === 1000) break;
  }
  return result;
}

export function historyMatches(history: string[], query: string): string[] {
  const term = key(query);
  if (!term) return history.slice(0, 10);
  const matches = history.filter(entry => key(entry).includes(term));
  // Exact/prefix matches first, then other matches, newest first within each group.
  const rank = (entry: string) => key(entry) === term ? 0 : key(entry).startsWith(term) ? 1 : 2;
  return matches.sort((a, b) => rank(a) - rank(b)).slice(0, 10);
}
