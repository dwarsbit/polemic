const IGNORED_TYPES = new Set(["string", "comment", "preamble"]);

/** Extract BibTeX entry keys (e.g. `knuth1984` in `@article{knuth1984, ...}`). */
export function extractCiteKeys(source: string): string[] {
  const keys: string[] = [];
  const re = /@(\w+)\s*\{\s*([^,}]+)/g;
  let match = re.exec(source);
  while (match !== null) {
    const type = match[1].toLowerCase();
    const key = match[2].trim();
    if (!IGNORED_TYPES.has(type) && key.length > 0) {
      keys.push(key);
    }
    match = re.exec(source);
  }
  return keys;
}
