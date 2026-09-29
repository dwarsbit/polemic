import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

/**
 * Syntax highlighting themes for the stex mode. Each theme has a light
 * and a dark variant; the active one follows the app theme. Light
 * variants of traditionally dark-only themes (Dracula, Monokai, Nord,
 * One Dark) are adaptations of the palette to a light background.
 *
 * stex token names map to tags via StreamLanguage's default table:
 * keyword, comment, string, atom, number, bracket, error (invalid),
 * tag (tagName), builtin (standard variableName).
 */
export interface SyntaxTheme {
  id: string;
  label: string;
  light: HighlightStyle;
  dark: HighlightStyle;
}

interface Palette {
  keyword: string;
  comment: string;
  string: string;
  atom: string;
  number: string;
  bracket: string;
  invalid: string;
}

function paletteStyle(colors: Palette): HighlightStyle {
  return HighlightStyle.define([
    { tag: [t.keyword, t.tagName], color: colors.keyword },
    { tag: [t.atom, t.standard(t.variableName)], color: colors.atom },
    { tag: t.string, color: colors.string },
    { tag: t.number, color: colors.number },
    { tag: t.bracket, color: colors.bracket },
    { tag: t.comment, color: colors.comment, fontStyle: "italic" },
    { tag: t.invalid, color: colors.invalid },
  ]);
}

export const SYNTAX_THEMES: SyntaxTheme[] = [
  {
    id: "default",
    label: "Polemic",
    // The app's mauve palette with standard accent colors.
    light: paletteStyle({
      keyword: "oklch(43.5% 0.029 321.78)", // mauve-600
      comment: "oklch(54.2% 0.034 322.5)", // mauve-500
      string: "oklch(50.8% 0.118 165.612)", // emerald-700
      atom: "oklch(50% 0.134 242.749)", // sky-700
      number: "oklch(55.5% 0.163 48.998)", // amber-700
      bracket: "oklch(54.2% 0.034 322.5)", // mauve-500
      invalid: "oklch(58.6% 0.253 17.585)", // rose-600
    }),
    dark: paletteStyle({
      keyword: "oklch(86.5% 0.012 325.68)", // mauve-300
      comment: "oklch(71.1% 0.019 323.02)", // mauve-400
      string: "oklch(84.5% 0.143 164.978)", // emerald-300
      atom: "oklch(82.8% 0.111 230.318)", // sky-300
      number: "oklch(87.9% 0.169 91.605)", // amber-300
      bracket: "oklch(71.1% 0.019 323.02)", // mauve-400
      invalid: "oklch(71.2% 0.194 13.428)", // rose-400
    }),
  },
  {
    id: "github",
    label: "GitHub",
    light: paletteStyle({
      keyword: "#cf222e",
      comment: "#6e7781",
      string: "#0a3069",
      atom: "#8250df",
      number: "#0550ae",
      bracket: "#57606a",
      invalid: "#82071e",
    }),
    dark: paletteStyle({
      keyword: "#ff7b72",
      comment: "#8b949e",
      string: "#a5d6ff",
      atom: "#d2a8ff",
      number: "#79c0ff",
      bracket: "#8b949e",
      invalid: "#f85149",
    }),
  },
  {
    id: "solarized",
    label: "Solarized",
    light: paletteStyle({
      keyword: "#859900", // green
      comment: "#93a1a1",
      string: "#2aa198", // cyan
      atom: "#268bd2", // blue
      number: "#d33682", // magenta
      bracket: "#657b83",
      invalid: "#dc322f",
    }),
    dark: paletteStyle({
      keyword: "#859900",
      comment: "#586e75",
      string: "#2aa198",
      atom: "#268bd2",
      number: "#d33682",
      bracket: "#93a1a4",
      invalid: "#dc322f",
    }),
  },
  {
    id: "dracula",
    label: "Dracula",
    light: paletteStyle({
      keyword: "#c2185b",
      comment: "#64748b",
      string: "#854d0e",
      atom: "#0e7490",
      number: "#6d28d9",
      bracket: "#52525b",
      invalid: "#b91c1c",
    }),
    dark: paletteStyle({
      keyword: "#ff79c6", // pink
      comment: "#6272a4",
      string: "#f1fa8c", // yellow
      atom: "#8be9fd", // cyan
      number: "#bd93f9", // purple
      bracket: "#6272a4",
      invalid: "#ff5555",
    }),
  },
  {
    id: "monokai",
    label: "Monokai",
    light: paletteStyle({
      keyword: "#ad1457",
      comment: "#78715e",
      string: "#9a7b00",
      atom: "#0e7490",
      number: "#6d28d9",
      bracket: "#78715e",
      invalid: "#b91c1c",
    }),
    dark: paletteStyle({
      keyword: "#f92672", // pink
      comment: "#75715e",
      string: "#e6db74", // yellow
      atom: "#66d9ef", // cyan
      number: "#ae81ff", // purple
      bracket: "#75715e",
      invalid: "#f92672",
    }),
  },
  {
    id: "nord",
    label: "Nord",
    light: paletteStyle({
      keyword: "#5e81ab", // nord10
      comment: "#616e88",
      string: "#5c7a56",
      atom: "#2f8f83",
      number: "#8f5d96",
      bracket: "#616e88",
      invalid: "#b25660",
    }),
    dark: paletteStyle({
      keyword: "#81a1c1", // nord9
      comment: "#616e88",
      string: "#a3be8c", // nord14
      atom: "#8fbcbb", // nord7
      number: "#b48ead", // nord15
      bracket: "#81a1c1",
      invalid: "#bf616a", // nord11
    }),
  },
  {
    id: "one-dark",
    label: "One Dark",
    light: paletteStyle({
      // One Light
      keyword: "#e45649",
      comment: "#a0a1a7",
      string: "#50a14f",
      atom: "#a626a4",
      number: "#986801",
      bracket: "#383a42",
      invalid: "#e45649",
    }),
    dark: paletteStyle({
      keyword: "#e06c75", // red
      comment: "#5c6370",
      string: "#98c379", // green
      atom: "#c678dd", // purple
      number: "#d19a66", // orange
      bracket: "#abb2bf",
      invalid: "#e06c75",
    }),
  },
];

/** The highlight style for a theme id and app-mode, falling back to Polemic. */
export function highlightStyleFor(themeId: string, dark: boolean): HighlightStyle {
  const theme = SYNTAX_THEMES.find((entry) => entry.id === themeId) ?? SYNTAX_THEMES[0];
  return dark ? theme.dark : theme.light;
}

/** The editor extension coloring stex tokens for a theme id and app-mode. */
export function editorHighlightExtension(themeId: string, dark: boolean): Extension {
  return syntaxHighlighting(highlightStyleFor(themeId, dark));
}
