// Spaced hyphens separate descriptions; word hyphens (sugar-free, cold-pressed)
// remain part of the product name. Typography dashes also separate descriptions.
export function titleParts(title: string): {name: string; description: string} {
  const match = /\s+-\s+|\s*[–—]\s*/.exec(title || '');
  if (!match) return {name: title || '', description: ''};
  return {name: title.slice(0, match.index), description: title.slice(match.index + match[0].length)};
}
export const DESCRIPTION_WEIGHT = 0.25;
