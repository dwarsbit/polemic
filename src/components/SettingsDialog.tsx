import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setProjectsRoot } from "@/lib/tauri";
import type { ThemePreference } from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";

const THEMES: ThemePreference[] = ["light", "dark", "system"];
const FONT_SIZES = [12, 14, 16, 18];

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
  const projectsRoot = useSettingsStore((s) => s.projectsRoot);
  const setRoot = useSettingsStore((s) => s.setProjectsRoot);
  const [error, setError] = useState<string | null>(null);

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
