import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Palette, Package, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TexStatusSection } from "@/components/TexStatus";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { resolveVersionControl, useSettingsStore } from "@/store/settings";

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

const SECTIONS = [
  { id: "general", label: "General", icon: FolderOpen },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Editor", icon: PencilLine },
  { id: "tex", label: "TeX Distribution", icon: Package },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<SectionId>("general");

  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const spellcheckEnabled = useSettingsStore((s) => s.spellcheckEnabled);
  const setSpellcheck = useSettingsStore((s) => s.setSpellcheck);
  const spellcheckLanguage = useSettingsStore((s) => s.spellcheckLanguage);
  const setSpellcheckLanguage = useSettingsStore((s) => s.setSpellcheckLanguage);
  const supsubBraces = useSettingsStore((s) => s.supsubBraces);
  const setSupsubBraces = useSettingsStore((s) => s.setSupsubBraces);
  const convertDoubleDollar = useSettingsStore((s) => s.convertDoubleDollar);
  const setConvertDoubleDollar = useSettingsStore((s) => s.setConvertDoubleDollar);
  const reopenLastProject = useSettingsStore((s) => s.reopenLastProject);
  const setReopenLastProject = useSettingsStore((s) => s.setReopenLastProject);
  const autoIncludeNewFiles = useSettingsStore((s) => s.autoIncludeNewFiles);
  const setAutoIncludeNewFiles = useSettingsStore((s) => s.setAutoIncludeNewFiles);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[540px] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid flex-1 min-h-0 grid-cols-[200px_1fr] px-6 pb-6">
          <nav className="flex flex-col gap-1 border-r pr-4">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant="ghost"
                size="sm"
                className={
                  section === id
                    ? "justify-start bg-muted text-foreground"
                    : "justify-start text-muted-foreground"
                }
                onClick={() => setSection(id)}
              >
                <Icon />
                {label}
              </Button>
            ))}
          </nav>
          <ScrollArea className="min-h-0 pl-6">
            {section === "general" && (
              <div className="text-sm">
                <SettingRow
                  label="Reopen last project"
                  description="On launch, open the project you worked on last."
                >
                  <Switch
                    checked={reopenLastProject}
                    onCheckedChange={(v) => void setReopenLastProject(v)}
                  />
                </SettingRow>
                <SettingRow
                  label="Include new files automatically"
                  description="Files created in the Files panel are added to the main document with \input{}."
                >
                  <Switch
                    checked={autoIncludeNewFiles}
                    onCheckedChange={(v) => void setAutoIncludeNewFiles(v)}
                  />
                </SettingRow>
                <SettingRow
                  label="Version control"
                  description={
                    gitAvailable
                      ? "By default Polemic uses git when it is installed and snapshots otherwise."
                      : "git was not found on your PATH; snapshots are used."
                  }
                >
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
                        gitAvailable ? "Use git" : "git is not installed on this system"
                      }
                    >
                      Git
                    </ToggleButton>
                    <ToggleButton value="snapshots" size="sm">
                      Snapshots
                    </ToggleButton>
                  </ToggleButtonGroup>
                </SettingRow>
                <SettingRow
                  label="Projects folder"
                  description="New projects are created here. Existing projects stay where they are."
                >
                  <Button variant="outline" size="sm" onClick={() => void pickRoot()}>
                    <FolderOpen />
                    Choose folder
                  </Button>
                </SettingRow>
                <p className="mt-1 truncate rounded border bg-muted px-2 py-1 font-mono text-xs">
                  {projectsRoot ?? "(default)"}
                </p>
                {rootError && (
                  <p className="mt-1 text-xs text-destructive">{rootError}</p>
                )}
              </div>
            )}

            {section === "appearance" && (
              <div className="text-sm">
                <SettingRow label="Theme">
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
                </SettingRow>
                <SettingRow label="Editor font size">
                  <ToggleButtonGroup
                    type="single"
                    value={String(fontSize)}
                    onValueChange={(value) => {
                      if (value) void setFontSize(Number(value));
                    }}
                  >
                    {FONT_SIZES.map((size) => (
                      <ToggleButton key={size} value={String(size)} size="sm">
                        {size}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </SettingRow>
              </div>
            )}

            {section === "editor" && (
              <div className="text-sm">
                <SettingRow
                  label="Spellcheck"
                  description="Right-click a marked word to add it to your dictionary."
                >
                  <Switch
                    checked={spellcheckEnabled}
                    onCheckedChange={(v) => void setSpellcheck(v)}
                  />
                </SettingRow>
                <SettingRow
                  label="Spellcheck language"
                  description="Languages without a check mark are downloaded on demand."
                >
                  <ToggleButtonGroup
                    type="single"
                    className="flex-wrap"
                    value={spellcheckLanguage}
                    onValueChange={(lang) => {
                      if (!lang) return;
                      if (downloaded.includes(lang)) {
                        void setSpellcheckLanguage(lang);
                      } else {
                        void downloadLanguage(lang);
                      }
                    }}
                  >
                    {(
                      ["en", ...DOWNLOADABLE_LANGUAGES.map((l) => l.id)] as string[]
                    ).map((lang) => (
                      <ToggleButton
                        key={lang}
                        value={lang}
                        size="sm"
                        disabled={downloading !== null}
                        title={
                          downloaded.includes(lang)
                            ? "Use this language"
                            : "Download the wordlist (about 10-20 MB) and use this language"
                        }
                      >
                        {downloading === lang
                          ? "Downloading…"
                          : !downloaded.includes(lang) && <Download />}
                        {LANGUAGE_NAMES[lang] ?? lang}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </SettingRow>
                {langError && (
                  <p className="mb-2 text-xs text-destructive">{langError}</p>
                )}

                <p className="mt-4 mb-1 text-xs font-medium text-muted-foreground">
                  MATH INPUT
                </p>
                <SettingRow
                  label="Auto-braces for ^ and _"
                  description="Typing ^ or _ inserts braces with the cursor inside (^{})."
                >
                  <Switch
                    checked={supsubBraces}
                    onCheckedChange={(v) => void setSupsubBraces(v)}
                  />
                </SettingRow>
                <SettingRow
                  label="Convert $$ to \[ \]"
                  description="Typing the second $ of a pair creates display-math brackets instead of $$."
                >
                  <Switch
                    checked={convertDoubleDollar}
                    onCheckedChange={(v) => void setConvertDoubleDollar(v)}
                  />
                </SettingRow>
              </div>
            )}

            {section === "tex" && (
              <div className="text-sm">
                <TexStatusSection />
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
