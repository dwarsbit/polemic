export interface OutlineEntry {
  level: number;
  title: string;
  line: number;
}

const SECTION_RE = /^(\\(?:sub){0,2}section\*?)\{(.*)\}/;

export function parseOutline(source: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const lines = source.split("\n");
  lines.forEach((text, index) => {
    const match = SECTION_RE.exec(text.trim());
    if (match) {
      const level = match[1].replace("\\", "").split("sub").length - 1;
      entries.push({ level, title: match[2], line: index + 1 });
    }
  });
  return entries;
}

export function extractLabels(source: string): string[] {
  const labels: string[] = [];
  const re = /\\label\{([^}]+)\}/g;
  let match = re.exec(source);
  while (match !== null) {
    labels.push(match[1]);
    match = re.exec(source);
  }
  return labels;
}
