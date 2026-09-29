/**
 * Editor font registry. Bundled fonts (imported in index.css) render
 * identically on every machine; "system" defers to the platform default.
 */
export interface EditorFont {
  id: string;
  label: string;
  /** CSS font-family stack applied to the editor. */
  stack: string;
}

export const EDITOR_FONTS: EditorFont[] = [
  {
    id: "system",
    label: "System mono",
    stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    stack: `"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace`,
  },
  {
    id: "fira-code",
    label: "Fira Code",
    stack: `"Fira Code Variable", ui-monospace, SFMono-Regular, Menlo, monospace`,
  },
  {
    id: "source-code-pro",
    label: "Source Code Pro",
    stack: `"Source Code Pro Variable", ui-monospace, SFMono-Regular, Menlo, monospace`,
  },
  {
    id: "ibm-plex-mono",
    label: "IBM Plex Mono",
    stack: `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`,
  },
];

export function editorFontStack(id: string): string {
  return EDITOR_FONTS.find((font) => font.id === id)?.stack ?? EDITOR_FONTS[0].stack;
}
