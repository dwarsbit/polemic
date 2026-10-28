import { useEffect, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  Check,
  FolderOpen,
  Monitor,
  Moon,
  Package,
  Palette,
  PencilLine,
  Search,
  SlidersHorizontal,
  Sparkles,
  SpellCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountSettingsSection } from "@/components/AccountSettingsSection";
import { AiSettingsSection } from "@/components/AiSettingsSection";
import { GrammarSettingsSection } from "@/components/GrammarSettingsSection";
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
import { initialsOf, resolveVersionControl, useSettingsStore } from "@/store/settings";
import { cn } from "cn";

const THEMES: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];
const FONT_SIZES = [12, 14, 16, 18];

const ENGLISH_VARIANTS = [
  { id: "en-US", name: "American" },
  { id: "en-GB", name: "British" },
  { id: "en-AU", name: "Australian" },
  { id: "en-CA", name: "Canadian" },
  { id: "en-IN", name: "Indian" },
];

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
};

/** One settings row: label and description on the left, the control in
 *  a fixed-width column on the right so controls line up down a page. */
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

/** A titled card of rows, or of a custom body (the TeX status list).
 *  Rows of a custom-body card only feed the search. */
interface CardDef {
  title: string;
  rows: RowDef[];
  content?: ReactNode;
}

/** A page in the left menu: its icon, a one-line intro, and cards. */
interface SectionDef {
  id: string;
  label: string;
  intro: string;
  icon: typeof Palette;
  cards: CardDef[];
}

function RowView({ row }: { row: RowDef }) {
  return (
    <div className="py-3 first:pt-1 last:pb-1">
      <div className="flex min-h-8 items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.label}</p>
          {row.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
          )}
        </div>
        {row.control !== null && (
          <div className="flex w-44 shrink-0 justify-end">{row.control}</div>
        )}
      </div>
      {row.after}
    </div>
  );
}

function CardView({ card }: { card: CardDef }) {
  return (
    <section className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <p className="mb-2 text-sm font-medium">{card.title}</p>
      {card.content !== undefined ? (
        card.content
      ) : (
        <div className="divide-y divide-border">
          {card.rows.map((row) => (
            <RowView key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A theme choice drawn as a small window preview. */
function ThemeTile({
  id,
  label,
  icon: Icon,
  active,
  onSelect,
}: {
  id: ThemePreference;
  label: string;
  icon: typeof Sun;
  active: boolean;
  onSelect: () => void;
}) {
  const dark = id === "dark";
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex w-28 flex-col gap-1.5 rounded-lg p-1 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        active ? "ring-2 ring-tint" : "hover:bg-accent",
      )}
      onClick={onSelect}
    >
      <div
        className={cn(
          "relative h-16 w-full overflow-hidden rounded-md border",
          id === "light" && "bg-white",
          dark && "bg-neutral-900",
          id === "system" && "bg-[linear-gradient(135deg,white_50%,#171717_50%)]",
        )}
      >
        <div
          className={cn(
            "absolute top-2 left-2 h-2 w-10 rounded-sm",
            dark ? "bg-neutral-600" : "bg-neutral-300",
          )}
        />
        <div
          className={cn(
            "absolute top-6 left-2 h-1.5 w-16 rounded-sm",
            dark ? "bg-neutral-700" : "bg-neutral-200",
          )}
        />
        <div
          className={cn(
            "absolute top-9 left-2 h-1.5 w-12 rounded-sm",
            dark ? "bg-neutral-700" : "bg-neutral-200",
          )}
        />
        {active && (
          <span className="absolute right-1.5 bottom-1.5 flex size-4 items-center justify-center rounded-full bg-tint text-white">
            <Check className="size-2.5" />
          </span>
        )}
      </div>
      <span className="flex items-center gap-1 px-1 text-xs font-medium">
        <Icon className="size-3 text-muted-foreground" />
        {label}
      </span>
    </button>
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
  const setConvertDoubleDollar = useSettingsStore((s) => s.setConvertDoubleDollar);
  const formatOnSave = useSettingsStore((s) => s.formatOnSave);
  const mathPreviewEngine = useSettingsStore((s) => s.mathPreviewEngine);
  const caretStyle = useSettingsStore((s) => s.caretStyle);
  const setCaretStyle = useSettingsStore((s) => s.setCaretStyle);
  const caretColor = useSettingsStore((s) => s.caretColor);
  const setCaretColor = useSettingsStore((s) => s.setCaretColor);
  const caretCustomColor = useSettingsStore((s) => s.caretCustomColor);
  const setCaretCustomColor = useSettingsStore((s) => s.setCaretCustomColor);
  const setFormatOnSave = useSettingsStore((s) => s.setFormatOnSave);
  const setMathPreviewEngine = useSettingsStore((s) => s.setMathPreviewEngine);
  const reopenLastProject = useSettingsStore((s) => s.reopenLastProject);
  const setReopenLastProject = useSettingsStore((s) => s.setReopenLastProject);
  const autoIncludeNewFiles = useSettingsStore((s) => s.autoIncludeNewFiles);
  const grammar = useSettingsStore((s) => s.grammar);
  const setGrammar = useSettingsStore((s) => s.setGrammar);
  const onlineLookup = useSettingsStore((s) => s.onlineLookup);
  const setOnlineLookup = useSettingsStore((s) => s.setOnlineLookup);
  const setAutoIncludeNewFiles = useSettingsStore((s) => s.setAutoIncludeNewFiles);
  const authorName = useSettingsStore((s) => s.authorName);
  const authorInitials = useSettingsStore((s) => s.authorInitials);
  const setAuthor = useSettingsStore((s) => s.setAuthor);
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
      label: "General",
      icon: SlidersHorizontal,
      intro:
        "Startup, where projects live, your name on suggestions, and version control.",
      cards: [
        {
          title: "Projects",
          rows: [
            {
              id: "reopen",
              label: "Reopen the last project",
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
              id: "projects-root",
              label: "Projects folder",
              description:
                "New projects are created here. Existing projects stay where they are.",
              keywords: "directory location storage disk",
              control: (
                <Button variant="outline" size="sm" onClick={() => void pickRoot()}>
                  <FolderOpen />
                  Choose…
                </Button>
              ),
              after: (
                <>
                  <p className="mt-2 truncate rounded-md border bg-muted px-2 py-1 font-mono text-2xs text-muted-foreground">
                    {projectsRoot ?? "Default location"}
                  </p>
                  {rootError && (
                    <p className="mt-1 text-xs text-destructive">{rootError}</p>
                  )}
                </>
              ),
            },
            {
              id: "auto-include",
              label: "Add new files to the main document",
              description:
                "A .tex file created in the Files panel is included with \\input{} right away.",
              keywords: "input import document order include automatically",
              control: (
                <Switch
                  checked={autoIncludeNewFiles}
                  onCheckedChange={(v) => void setAutoIncludeNewFiles(v)}
                />
              ),
            },
          ],
        },
        {
          title: "Track changes",
          rows: [
            {
              id: "author-name",
              label: "Your name",
              description: "Shown on your suggestions in Suggest mode.",
              keywords: "author track changes suggestions review name",
              control: (
                <Input
                  key={`name:${authorName}`}
                  className="h-8 w-44 text-xs"
                  placeholder="Name"
                  aria-label="Your name"
                  defaultValue={authorName}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== authorName) {
                      void setAuthor({ name: e.target.value });
                    }
                  }}
                />
              ),
            },
            {
              id: "author-initials",
              label: "Your initials",
              description:
                "The id on your suggestions in the source. Empty uses the initials of your name.",
              keywords: "author track changes suggestions initials id",
              control: (
                <Input
                  key={`initials:${authorInitials}`}
                  className="h-8 w-20 text-xs"
                  placeholder={initialsOf(authorName) || "LG"}
                  aria-label="Your initials"
                  defaultValue={authorInitials}
                  onBlur={(e) => {
                    if (e.target.value !== authorInitials) {
                      void setAuthor({ initials: e.target.value });
                    }
                  }}
                />
              ),
            },
          ],
        },
        {
          title: "Version control",
          rows: [
            {
              id: "version-control",
              label: "Track changes with",
              description: gitAvailable
                ? "Git when it is installed, snapshots otherwise."
                : "Git is not installed, so snapshots are used.",
              keywords: "git snapshots backup history version control",
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
                    title={gitAvailable ? undefined : "Git is not installed"}
                  >
                    Git
                  </ToggleButton>
                  <ToggleButton value="snapshots" size="sm">
                    Snapshots
                  </ToggleButton>
                </ToggleButtonGroup>
              ),
            },
          ],
        },
      ],
    },
    {
      id: "account",
      label: "Account",
      icon: UserRound,
      intro: "Sign in to a Polemic server. Local features never need an account.",
      cards: [
        {
          title: "Polemic account",
          rows: [
            {
              id: "account",
              label: "Polemic account",
              description:
                "Sign in for Polemic Professional services. Local features never need an account.",
              keywords:
                "sign in sign out login logout account professional server self-hosted",
              control: null,
            },
          ],
          content: <AccountSettingsSection />,
        },
      ],
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: Palette,
      intro: "Theme, editor font, and the text cursor.",
      cards: [
        {
          title: "Theme",
          rows: [
            {
              id: "theme",
              label: "Mode",
              description: "System follows the light or dark setting of your computer.",
              keywords: "light dark mode appearance theme",
              control: null,
              after: (
                <div className="mt-2 flex gap-2">
                  {THEMES.map((option) => (
                    <ThemeTile
                      key={option.id}
                      id={option.id}
                      label={option.label}
                      icon={option.icon}
                      active={theme === option.id}
                      onSelect={() => void setTheme(option.id)}
                    />
                  ))}
                </div>
              ),
            },
          ],
        },
        {
          title: "Editor font",
          rows: [
            {
              id: "editor-font",
              label: "Font",
              description:
                "Bundled with the app, so the editor looks the same everywhere.",
              keywords: "mono monospace typeface code editor font",
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
              label: "Size",
              keywords: "text size scale editor font size",
              control: (
                <Select
                  value={String(fontSize)}
                  onValueChange={(value) => {
                    if (value) void setFontSize(Number(value));
                  }}
                >
                  <SelectTrigger className="w-24">
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
              label: "Syntax colors",
              description: "Each scheme has a light and a dark variant.",
              keywords: "highlighting colors code syntax theme",
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
        {
          title: "Text cursor",
          rows: [
            {
              id: "cursor-style",
              label: "Shape",
              description: "A thin line, or a translucent block over the character.",
              keywords: "caret text cursor block line style",
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
              label: "Color",
              description: "Theme follows light and dark; custom keeps one color.",
              keywords: "caret text cursor colour color",
              control: (
                <div className="flex items-center gap-1.5">
                  {caretColor === "custom" && (
                    <input
                      type="color"
                      title="Custom cursor color"
                      className="h-7 w-8 cursor-pointer rounded-md border bg-transparent p-0.5"
                      value={caretCustomColor}
                      onChange={(e) => void setCaretCustomColor(e.target.value)}
                    />
                  )}
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
                </div>
              ),
            },
          ],
        },
      ],
    },
    {
      id: "editor",
      label: "Editor",
      icon: PencilLine,
      intro: "How the code editor behaves while you type and save.",
      cards: [
        {
          title: "Typing",
          rows: [
            {
              id: "supsub",
              label: "Braces after ^ and _",
              description: "Typing ^ or _ inserts {} with the cursor inside.",
              keywords: "superscript subscript exponent auto braces math input",
              control: (
                <Switch
                  checked={supsubBraces}
                  onCheckedChange={(v) => void setSupsubBraces(v)}
                />
              ),
            },
            {
              id: "double-dollar",
              label: "Turn $$ into \\[ \\]",
              description: "The second $ of a pair becomes display-math brackets.",
              keywords: "display math delimiters brackets convert dollar",
              control: (
                <Switch
                  checked={convertDoubleDollar}
                  onCheckedChange={(v) => void setConvertDoubleDollar(v)}
                />
              ),
            },
            {
              id: "math-preview",
              label: "Math preview on hover",
              description: "A card above a formula shows how it renders.",
              keywords: "hover math render preview katex",
              control: (
                <Switch
                  checked={mathPreviewEngine === "katex"}
                  onCheckedChange={(v) =>
                    void setMathPreviewEngine(v ? "katex" : "off")
                  }
                />
              ),
            },
          ],
        },
        {
          title: "Saving",
          rows: [
            {
              id: "format-on-save",
              label: "Format on save",
              description:
                "Indent environments and tidy whitespace in .tex files. Shift+Alt+F formats now.",
              keywords: "indent whitespace pretty print format",
              control: (
                <Switch
                  checked={formatOnSave}
                  onCheckedChange={(v) => void setFormatOnSave(v)}
                />
              ),
            },
          ],
        },
      ],
    },
    {
      id: "writing",
      label: "Writing",
      icon: SpellCheck,
      intro: "Spelling and grammar checks, in both the code and the visual editor.",
      cards: [
        {
          title: "Spelling",
          rows: [
            {
              id: "spellcheck",
              label: "Check spelling",
              description:
                "Right-click a marked word for corrections, or to add it to your dictionary.",
              keywords: "dictionary words typo underline spellcheck",
              control: (
                <Switch
                  checked={spellcheckEnabled}
                  onCheckedChange={(v) => void setSpellcheck(v)}
                />
              ),
            },
            {
              id: "spellcheck-language",
              label: "Language",
              description:
                "A language that is not installed yet is downloaded (10–20 MB).",
              keywords:
                "dictionary wordlist download german french spanish spellcheck language",
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
                    title={downloading !== null ? "Downloading…" : undefined}
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
          ],
        },
        {
          title: "Grammar and style",
          rows: [
            {
              id: "grammar",
              label: "Check grammar and style",
              description:
                "Marks issues in blue; right-click for the fix or to turn a rule off.",
              keywords: "grammar style languagetool harper check sentence",
              control: (
                <Switch
                  checked={grammar.enabled !== false}
                  onCheckedChange={(v) => void setGrammar({ ...grammar, enabled: v })}
                />
              ),
            },
            {
              id: "english-variant",
              label: "English variant",
              description: "The spelling conventions the grammar check expects.",
              keywords: "british american australian canadian indian dialect",
              control: (
                <Select
                  value={grammar.englishVariant ?? "en-US"}
                  onValueChange={(v) =>
                    void setGrammar({ ...grammar, englishVariant: v })
                  }
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENGLISH_VARIANTS.map((variant) => (
                      <SelectItem key={variant.id} value={variant.id}>
                        {variant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
          ],
        },
        {
          title: "Checker and rules",
          rows: [
            {
              id: "grammar-checker",
              label: "Checker and rules",
              description:
                "Built in, offline and English only. A LanguageTool server adds other languages.",
              keywords: "languagetool server rules disable passive voice checker",
              control: null,
            },
          ],
          content: <GrammarSettingsSection />,
        },
      ],
    },
    {
      id: "tex",
      label: "Compile",
      icon: Package,
      intro: "Your TeX distribution and the tools Polemic found on this computer.",
      cards: [
        {
          title: "TeX distribution",
          rows: [
            {
              id: "tex-status",
              label: "TeX distribution",
              description: "pdflatex, xelatex, lualatex and latexmk on this computer.",
              keywords: "tex live miktex latexmk pdflatex xelatex lualatex compile",
              control: null,
            },
          ],
          content: <TexStatusSection />,
        },
      ],
    },
    {
      id: "bibliography",
      label: "Bibliography",
      icon: BookOpen,
      intro: "Where citations come from when you add one.",
      cards: [
        {
          title: "Sources",
          rows: [
            {
              id: "sources",
              label: "Sources",
              description:
                "The .bib files and Zotero libraries that “Add from Sources…” searches.",
              keywords: "zotero bibtex bib references citations sources",
              control: null,
            },
          ],
          content: <SourcesSettingsCard />,
        },
        {
          title: "Online lookup",
          rows: [
            {
              id: "online-lookup",
              label: "Look up DOI and arXiv IDs online",
              description:
                "Fetches the entry from doi.org. Only the identifier you paste is sent. Off by default.",
              keywords:
                "doi arxiv import online lookup network bibtex crossref datacite",
              control: (
                <Switch
                  checked={onlineLookup}
                  onCheckedChange={(v) => void setOnlineLookup(v)}
                />
              ),
            },
          ],
        },
      ],
    },
    {
      id: "ai",
      label: "Assistant",
      icon: Sparkles,
      intro:
        "An optional AI provider for compile errors the built-in fixes cannot handle.",
      cards: [
        {
          title: "Provider",
          rows: [
            {
              id: "ai-provider",
              label: "AI provider",
              description:
                "Any OpenAI-compatible endpoint, used by Ask AI in the issues list.",
              keywords: "ai fix error llm openai mistral api key model assistant",
              control: null,
            },
          ],
          content: <AiSettingsSection />,
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
                return match ? { section: s, card, row, score: match.score } : null;
              }),
            ),
          )
          .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
          .sort((a, b) => b.score - a.score);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[600px] max-h-[90vh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-5 pt-4 pb-3">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[184px_1fr]">
          <nav className="flex min-h-0 flex-col border-r bg-muted/30 p-2">
            <div className="relative mb-2">
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
            <ScrollArea className="min-h-0 flex-1">
              {sections.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs transition-colors",
                    activeSection.id === id && trimmed.length === 0
                      ? "bg-accent font-medium text-foreground"
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
                  <div className="space-y-3">
                    {sections
                      .map((s) => ({
                        section: s,
                        hits: results.filter((hit) => hit.section.id === s.id),
                      }))
                      .filter(({ hits }) => hits.length > 0)
                      .map(({ section: s, hits }) => (
                        <CardView
                          key={s.id}
                          card={{ title: s.label, rows: hits.map((hit) => hit.row) }}
                        />
                      ))}
                  </div>
                )
              ) : (
                <>
                  <h2 className="text-base font-semibold">{activeSection.label}</h2>
                  <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
                    {activeSection.intro}
                  </p>
                  <div className="space-y-3">
                    {activeSection.cards.map((card) => (
                      <CardView key={card.title} card={card} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
