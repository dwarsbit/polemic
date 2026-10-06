import { useEffect, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  FolderOpen,
  Package,
  Palette,
  PencilLine,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiSettingsSection } from "@/components/AiSettingsSection";
import { SourcesSettingsCard } from "@/components/SourcesSettings";
import { TexStatusSection } from "@/components/TexStatus";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleButton } from "@/components/ui/toggle-button";
import { ToggleButtonGroup } from "@/components/ui/toggle-button-group";
import {
  DOWNLOADABLE_LANGUAGES,
  installSpellcheckLanguage,
  listSpellcheckLanguages,
  setProjectsRoot,
  spellcheckLanguageUrl,
} from "@/lib/tauri";
import type { ThemePreference } from "@/lib/theme";
import { EDITOR_FONTS } from "@/lib/editor-fonts";
import { SYNTAX_THEMES } from "@/lib/editor-themes";
import { fuzzyMatch } from "@/lib/fuzzy";
import { resolveVersionControl, useSettingsStore } from "@/store/settings";
import { cn } from "cn";

const THEMES: ThemePreference[] = ["light", "dark", "system"];
const THEME_LABELS: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};
const FONT_SIZES = [12, 14, 16, 18];

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
};

/** One settings row: label/description on the left, the control right. */
interface RowDef {
  id: string;
  label: string;
  description?: string;
  /** Extra words for the settings search. */
  keywords?: string;
  control: ReactNode;
  /** Optional content under the row (e.g. the chosen folder path). */
  after?: ReactNode;
}

/** Settings grouped on one card; the first card of a section is the
 *  untitled one, later cards carry a title ("Font settings"). */
interface CardDef {
  title?: string;
  /** Row settings; empty when the card uses a custom body. */
  rows: RowDef[];
  /** A custom card body instead of rows (e.g. the TeX status list). */
  content?: ReactNode;
}

/** A left-menu item: a group (GENERAL, EDITOR, …), an icon, and cards. */
interface SectionDef {
  id: string;
  group: string;
  label: string;
  icon: typeof Palette;
  cards: CardDef[];
}

function RowView({ row }: { row: RowDef }) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.label}</p>
          {row.description && (
            <p className="text-xs text-muted-foreground">{row.description}</p>
          )}
        </div>
        {row.control}
      </div>
      {row.after}
    </div>
  );
}

function CardView({ card }: { card: CardDef }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {card.title && (
        <p className="border-b px-4 py-2.5 text-xs font-medium text-muted-foreground">
          {card.title}
        </p>
      )}
      {card.content !== undefined ? (
        <div className="px-4 py-2">{card.content}</div>
      ) : (
        <div className="divide-y divide-border px-4">
          {card.rows.map((row) => (
            <RowView key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<string>("general");
  const [query, setQuery] = useState("");
  const requestedSection = useSettingsStore((s) => s.settingsSection);
  const clearSettingsSection = useSettingsStore((s) => s.clearSettingsSection);

  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const editorFont = useSettingsStore((s) => s.editorFont);
  const setEditorFont = useSettingsStore((s) => s.setEditorFont);
  const syntaxTheme = useSettingsStore((s) => s.syntaxTheme);
  const setSyntaxTheme = useSettingsStore((s) => s.setSyntaxTheme);
  const spellcheckEnabled = useSettingsStore((s) => s.spellcheckEnabled);
  const setSpellcheck = useSettingsStore((s) => s.setSpellcheck);
  const spellcheckLanguage = useSettingsStore((s) => s.spellcheckLanguage);
  const setSpellcheckLanguage = useSettingsStore((s) => s.setSpellcheckLanguage);
  const supsubBraces = useSettingsStore((s) => s.supsubBraces);
  const setSupsubBraces = useSettingsStore((s) => s.setSupsubBraces);
  const convertDoubleDollar = useSettingsStore((s) => s.convertDoubleDollar);
  const setConvertDoubleDollar = useSettingsStore(
    (s) => s.setConvertDoubleDollar,
  );
  const formatOnSave = useSettingsStore((s) => s.formatOnSave);
  const mathPreviewEngine = useSettingsStore((s) => s.mathPreviewEngine);
  const caretStyle = useSettingsStore((s) => s.caretStyle);
  const setCaretStyle = useSettingsStore((s) => s.setCaretStyle);
  const caretColor = useSettingsStore((s) => s.caretColor);
  const setCaretColor = useSettingsStore((s) => s.setCaretColor);
  const caretCustomColor = useSettingsStore((s) => s.caretCustomColor);
  const setCaretCustomColor = useSettingsStore(
    (s) => s.setCaretCustomColor,
  );
  const setFormatOnSave = useSettingsStore((s) => s.setFormatOnSave);
  const setMathPreviewEngine = useSettingsStore(
    (s) => s.setMathPreviewEngine,
  );
  const reopenLastProject = useSettingsStore((s) => s.reopenLastProject);
  const setReopenLastProject = useSettingsStore(
    (s) => s.setReopenLastProject,
  );
  const autoIncludeNewFiles = useSettingsStore((s) => s.autoIncludeNewFiles);
  const setAutoIncludeNewFiles = useSettingsStore(
    (s) => s.setAutoIncludeNewFiles,
  );
  const versionControl = useSettingsStore((s) => resolveVersionControl(s));
  const setVersionControl = useSettingsStore((s) => s.setVersionControl);
  const gitAvailable = useSettingsStore((s) => s.gitAvailable);
  const projectsRoot = useSettingsStore((s) => s.projectsRoot);
  const setRoot = useSettingsStore((s) => s.setProjectsRoot);

  const [downloaded, setDownloaded] = useState<string[]>(["en"]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [langError, setLangError] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void listSpellcheckLanguages()
      .then(setDownloaded)
      .catch(() => setDownloaded(["en"]));
  }, [open]);

  async function downloadLanguage(lang: string) {
    setLangError(null);
    setDownloading(lang);
    try {
      const response = await fetch(spellcheckLanguageUrl(lang));
      if (!response.ok) {
        throw new Error(`download failed: ${response.status}`);
      }
      const content = await response.text();
      await installSpellcheckLanguage(lang, content);
      setDownloaded((prev) => (prev.includes(lang) ? prev : [...prev, lang]));
    } catch (e) {
      setLangError(String(e));
    } finally {
      setDownloading(null);
    }
  }

  async function pickRoot() {
    setRootError(null);
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string" && dir) {
      try {
        await setProjectsRoot(dir);
        setRoot(dir);
      } catch (e) {
        setRootError(String(e));
      }
    }
  }

  const sections: SectionDef[] = [
    {
      id: "general",
      group: "GENERAL",
      label: "General",
      icon: FolderOpen,
      cards: [
        {
          rows: [
            {
              id: "reopen",
              label: "Reopen last project",
              description: "On launch, open the project you worked on last.",
              keywords: "startup launch restore",
              control: (
                <Switch
                  checked={reopenLastProject}
                  onCheckedChange={(v) => void setReopenLastProject(v)}
                />
              ),
            },
            {
              id: "auto-include",
              label: "Include new files automatically",
              description:
                "Files created in the Files panel are added to the main document with \\input{}.",
              keywords: "input import document order",
              control: (
                <Switch
                  checked={autoIncludeNewFiles}
                  onCheckedChange={(v) => void setAutoIncludeNewFiles(v)}
                />
              ),
            },
            {
              id: "version-control",
              label: "Version control",
              description: gitAvailable
                ? "By default Polemic uses git when it is installed and snapshots otherwise."
                : "git was not found on your PATH; snapshots are used.",
              keywords: "git snapshots backup history",
              control: (
                <ToggleButtonGroup
                  type="single"
                  value={versionControl}
                  onValueChange={(value) => {
                    if (value === "git" || value === "snapshots") {
                      void setVersionControl(value);
                    }
                  }}
                >
                  <ToggleButton
                    value="git"
                    size="sm"
                    disabled={!gitAvailable}
                    title={
                      gitAvailable
                        ? "Use git"
                        : "git is not installed on this system"
                    }
                  >
                    Git
                  </ToggleButton>
                  <ToggleButton value="snapshots" size="sm">
                    Snapshots
                  </ToggleButton>
                </ToggleButtonGroup>
              ),
            },
            {
              id: "projects-root",
              label: "Projects folder",
              description:
                "New projects are created here. Existing projects stay where they are.",
              keywords: "directory location storage disk",
              control: (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void pickRoot()}
                >
                  <FolderOpen />
                  Choose folder
                </Button>
              ),
              after: (
                <>
                  <p className="mt-2 truncate rounded border bg-muted px-2 py-1 font-mono text-xs">
                    {projectsRoot ?? "(default)"}
                  </p>
                  {rootError && (
                    <p className="mt-1 text-xs text-destructive">{rootError}</p>
                  )}
                </>
              ),
            },
          ],
        },
      ],
    },
    {
      id: "editor",
      group: "EDITOR",
      label: "Editor",
      icon: PencilLine,
      cards: [
        {
          rows: [
            {
              id: "spellcheck",
              label: "Spellcheck",
              description:
                "Right-click a marked word to add it to your dictionary.",
              keywords: "dictionary words typo underline",
              control: (
                <Switch
                  checked={spellcheckEnabled}
                  onCheckedChange={(v) => void setSpellcheck(v)}
                />
              ),
            },
            {
              id: "spellcheck-language",
              label: "Spellcheck language",
              description:
                "Picking a language that is not installed yet downloads its wordlist (about 10-20 MB).",
              keywords: "dictionary wordlist download german french spanish",
              control: (
                <Select
                  value={spellcheckLanguage}
                  onValueChange={(lang) => {
                    if (downloaded.includes(lang)) {
                      void setSpellcheckLanguage(lang);
                    } else {
                      void downloadLanguage(lang);
                    }
                  }}
                >
                  <SelectTrigger
                    className="w-36"
                    disabled={downloading !== null}
                    title={
                      downloading !== null
                        ? "Downloading wordlist…"
                        : undefined
                    }
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      ["en", ...DOWNLOADABLE_LANGUAGES.map((l) => l.id)] as string[]
                    ).map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        {LANGUAGE_NAMES[lang] ?? lang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
              after: langError && (
                <p className="mt-1 text-xs text-destructive">{langError}</p>
              ),
            },
            {
              id: "format-on-save",
              label: "Format on save",
              description:
                "Indent environments and normalize whitespace when saving .tex files (Shift+Alt+F formats on demand).",
              keywords: "indent whitespace pretty print",
              control: (
                <Switch
                  checked={formatOnSave}
                  onCheckedChange={(v) => void setFormatOnSave(v)}
                />
              ),
            },
            {
              id: "math-preview",
              label: "Math preview",
              description:
                "A hover card above math blocks shows how they render. More engines can be added.",
              keywords: "hover katex render",
              control: (
                <ToggleButtonGroup
                  type="single"
                  value={mathPreviewEngine}
                  onValueChange={(value) => {
                    if (value === "katex" || value === "off") {
                      void setMathPreviewEngine(value);
                    }
                  }}
                >
                  <ToggleButton value="katex" size="sm">
                    KaTeX
                  </ToggleButton>
                  <ToggleButton value="off" size="sm">
                    Off
                  </ToggleButton>
                </ToggleButtonGroup>
              ),
            },
          ],
        },
        {
          title: "Math input",
          rows: [
            {
              id: "supsub",
              label: "Auto-braces for ^ and _",
              description:
                "Typing ^ or _ inserts braces with the cursor inside (^{}).",
              keywords: "superscript subscript exponent",
              control: (
                <Switch
                  checked={supsubBraces}
                  onCheckedChange={(v) => void setSupsubBraces(v)}
                />
              ),
            },
            {
              id: "double-dollar",
              label: "Convert $$ to \\[ \\]",
              description:
                "Typing the second $ of a pair creates display-math brackets instead of $$.",
              keywords: "display math delimiters brackets",
              control: (
                <Switch
                  checked={convertDoubleDollar}
                  onCheckedChange={(v) => void setConvertDoubleDollar(v)}
                />
              ),
            },
          ],
        },
      ],
    },
    {
      id: "tex",
      group: "PROJECT",
      label: "TeX & Compile",
      icon: Package,
      cards: [
        {
          rows: [],
          content: <TexStatusSection />,
        },
      ],
    },
    {
      id: "bibliography",
      group: "BIBLIOGRAPHY",
      label: "Bibliography",
      icon: BookOpen,
      cards: [
        {
          rows: [
            {
              id: "sources",
              label: "Sources",
              description:
                "Where \"Add from Sources…\" searches: .bib files and Zotero connections.",
              keywords: "zotero bibtex bib references citations sources",
              control: null,
            },
          ],
          content: <SourcesSettingsCard />,
        },
      ],
    },
    {
      id: "ai",
      group: "ASSISTANT",
      label: "AI",
      icon: Sparkles,
      cards: [
        {
          rows: [
            {
              id: "ai-provider",
              label: "AI quickfix provider",
              description:
                "An OpenAI-compatible endpoint the \"Fix with AI\" action uses for errors the built-in rules cannot fix.",
              keywords: "ai fix error llm openai mistral api key model",
              control: null,
            },
          ],
          content: <AiSettingsSection />,
        },
      ],
    },
    {
      id: "appearance",
      group: "APPEARANCE",
      label: "Appearance",
      icon: Palette,
      cards: [
        {
          rows: [
            {
              id: "theme",
              label: "Theme",
              description: undefined,
              keywords: "light dark mode appearance",
              control: (
                <ToggleButtonGroup
                  type="single"
                  value={theme}
                  onValueChange={(value) => {
                    if (value) void setTheme(value as ThemePreference);
                  }}
                >
                  {THEMES.map((option) => (
                    <ToggleButton key={option} value={option} size="sm">
                      {THEME_LABELS[option]}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              ),
            },
            {
              id: "cursor-style",
              label: "Cursor style",
              description:
                "A 2px line, or a translucent block over the character.",
              keywords: "caret text cursor block line",
              control: (
                <ToggleButtonGroup
                  type="single"
                  value={caretStyle}
                  onValueChange={(value) => {
                    if (value === "line" || value === "block") {
                      void setCaretStyle(value);
                    }
                  }}
                >
                  <ToggleButton value="line" size="sm">
                    Line
                  </ToggleButton>
                  <ToggleButton value="block" size="sm">
                    Block
                  </ToggleButton>
                </ToggleButtonGroup>
              ),
            },
            {
              id: "cursor-color",
              label: "Cursor color",
              description:
                "Theme follows light and dark appearance; custom uses a fixed color.",
              keywords: "caret text cursor colour",
              control: (
                <div className="flex items-center gap-1.5">
                  <ToggleButtonGroup
                    type="single"
                    value={caretColor}
                    onValueChange={(value) => {
                      if (value === "primary" || value === "custom") {
                        void setCaretColor(value);
                      }
                    }}
                  >
                    <ToggleButton value="primary" size="sm">
                      Theme
                    </ToggleButton>
                    <ToggleButton value="custom" size="sm">
                      Custom
                    </ToggleButton>
                  </ToggleButtonGroup>
                  {caretColor === "custom" && (
                    <input
                      type="color"
                      title="Custom cursor color"
                      className="h-7 w-8 cursor-pointer rounded-md border bg-transparent p-0.5"
                      value={caretCustomColor}
                      onChange={(e) =>
                        void setCaretCustomColor(e.target.value)
                      }
                    />
                  )}
                </div>
              ),
            },
          ],
        },
        {
          title: "Font settings",
          rows: [
            {
              id: "editor-font",
              label: "Editor font",
              description: "Fonts are bundled with the app.",
              keywords: "mono monospace typeface code",
              control: (
                <Select
                  value={editorFont}
                  onValueChange={(value) => {
                    if (value) void setEditorFont(value);
                  }}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITOR_FONTS.map((font) => (
                      <SelectItem key={font.id} value={font.id}>
                        {font.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
            {
              id: "font-size",
              label: "Editor font size",
              description: "Font and syntax theme apply to the source editor.",
              keywords: "text size scale",
              control: (
                <Select
                  value={String(fontSize)}
                  onValueChange={(value) => {
                    if (value) void setFontSize(Number(value));
                  }}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size} px
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
            {
              id: "syntax-theme",
              label: "Syntax theme",
              description:
                "Each theme follows the app's light or dark mode.",
              keywords: "highlighting colors code",
              control: (
                <Select
                  value={syntaxTheme}
                  onValueChange={(value) => {
                    if (value) void setSyntaxTheme(value);
                  }}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SYNTAX_THEMES.map((syntax) => (
                      <SelectItem key={syntax.id} value={syntax.id}>
                        {syntax.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
          ],
        },
      ],
    },
  ];

  // A targeted open (e.g. the Sources… menu item) lands on its section
  // until the user navigates.
  const activeSection =
    sections.find((s) => s.id === requestedSection) ??
    sections.find((s) => s.id === section) ??
    sections[0];

  // The search matches rows across every section (label, description,
  // and keywords) and groups the hits by section.
  const trimmed = query.trim();
  const results =
    trimmed.length === 0
      ? []
      : sections
          .flatMap((s) =>
            s.cards.flatMap((card) =>
              card.rows.map((row) => {
                const match = fuzzyMatch(
                  trimmed,
                  `${s.label} ${row.label} ${row.description ?? ""} ${row.keywords ?? ""}`,
                );
                return match
                  ? { section: s, card, row, score: match.score }
                  : null;
              }),
            ),
          )
          .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
          .sort((a, b) => b.score - a.score);

  const groups = sections
    .map((s) => s.group)
    .filter((group, index, all) => all.indexOf(group) === index);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[600px] max-h-[90vh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr]">
          <nav className="flex min-h-0 flex-col border-r bg-muted/30">
            <div className="p-3 pb-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 rounded-lg pl-8 text-xs"
                  placeholder="Search settings"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setQuery("");
                  }}
                />
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
              {groups.map((group) => (
                <div key={group} className="mt-3 first:mt-0">
                  <p className="px-2 pb-1 text-[10px] font-medium text-muted-foreground">
                    {group}
                  </p>
                  {sections
                    .filter((s) => s.group === group)
                    .map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                          activeSection.id === id
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                        onClick={() => {
                          setQuery("");
                          setSection(id);
                          if (requestedSection !== null) clearSettingsSection();
                        }}
                      >
                        <Icon className="size-4" />
                        {label}
                      </button>
                    ))}
                </div>
              ))}
            </ScrollArea>
          </nav>
          <ScrollArea className="min-h-0 flex-1 bg-muted/20">
            <div className="p-5">
              {trimmed.length > 0 ? (
                results.length === 0 ? (
                  <p className="px-1 py-2 text-sm text-muted-foreground">
                    No settings match &ldquo;{trimmed}&rdquo;.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {sections
                      .map((s) => ({
                        section: s,
                        hits: results.filter((hit) => hit.section.id === s.id),
                      }))
                      .filter(({ hits }) => hits.length > 0)
                      .map(({ section: s, hits }) => (
                        <div key={s.id}>
                          <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
                            {s.label}
                          </p>
                          <CardView card={{ rows: hits.map((hit) => hit.row) }} />
                        </div>
                      ))}
                  </div>
                )
              ) : (
                <div className="space-y-4">
                  {activeSection.cards.map((card, index) => (
                    <CardView key={index} card={card} />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
