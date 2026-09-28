import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DOWNLOADABLE_LANGUAGES,
  installSpellcheckLanguage,
  listSpellcheckLanguages,
  setProjectsRoot,
  spellcheckLanguageUrl,
} from "@/lib/tauri";
import type { ThemePreference } from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";

const THEMES: ThemePreference[] = ["light", "dark", "system"];
const FONT_SIZES = [12, 14, 16, 18];

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English (built-in)",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
};

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const spellcheckEnabled = useSettingsStore((s) => s.spellcheckEnabled);
  const setSpellcheck = useSettingsStore((s) => s.setSpellcheck);
  const spellcheckLanguage = useSettingsStore((s) => s.spellcheckLanguage);
  const setSpellcheckLanguage = useSettingsStore((s) => s.setSpellcheckLanguage);
  const [downloaded, setDownloaded] = useState<string[]>(["en"]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [langError, setLangError] = useState<string | null>(null);
  const projectsRoot = useSettingsStore((s) => s.projectsRoot);
  const setRoot = useSettingsStore((s) => s.setProjectsRoot);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string" && dir) {
      try {
        await setProjectsRoot(dir);
        setRoot(dir);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <p className="mb-1.5 font-medium">Theme</p>
            <div className="flex gap-1">
              {THEMES.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={theme === option ? "default" : "outline"}
                  onClick={() => void setTheme(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 font-medium">Editor font size</p>
            <div className="flex gap-1">
              {FONT_SIZES.map((size) => (
                <Button
                  key={size}
                  size="sm"
                  variant={fontSize === size ? "default" : "outline"}
                  onClick={() => void setFontSize(size)}
                >
                  {size}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 font-medium">Spellcheck</p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={spellcheckEnabled ? "default" : "outline"}
                onClick={() => void setSpellcheck(!spellcheckEnabled)}
              >
                {spellcheckEnabled ? "On" : "Off"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Right-click a marked word to add it to your dictionary.
              </span>
            </div>
            <p className="mt-3 mb-1.5 text-xs text-muted-foreground">LANGUAGE</p>
            <div className="flex flex-wrap gap-1.5">
              {(["en", ...DOWNLOADABLE_LANGUAGES.map((l) => l.id)] as string[]).map(
                (lang) => {
                  const isDownloaded = downloaded.includes(lang);
                  const isActive = spellcheckLanguage === lang;
                  return (
                    <Button
                      key={lang}
                      size="sm"
                      variant={isActive ? "default" : "outline"}
                      disabled={downloading !== null}
                      title={
                        isDownloaded
                          ? "Use this language"
                          : "Download the wordlist (about 10-20 MB) and use this language"
                      }
                      onClick={() => {
                        if (isActive) return;
                        if (isDownloaded) {
                          void setSpellcheckLanguage(lang);
                        } else {
                          void downloadLanguage(lang);
                        }
                      }}
                    >
                      {downloading === lang
                        ? "Downloading…"
                        : !isDownloaded && <Download className="size-3" />}
                      {LANGUAGE_NAMES[lang] ?? lang}
                    </Button>
                  );
                },
              )}
            </div>
            {langError && <p className="mt-1 text-xs text-destructive">{langError}</p>}
          </div>

          <div>
            <p className="mb-1.5 font-medium">Projects folder</p>
            <p className="mb-1.5 truncate rounded border bg-muted px-2 py-1 font-mono text-xs">
              {projectsRoot ?? "(default)"}
            </p>
            <Button variant="outline" size="sm" onClick={() => void pickRoot()}>
              <FolderOpen />
              Choose folder
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              New projects are created here. Existing projects stay where they are.
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
