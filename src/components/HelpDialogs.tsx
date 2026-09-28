import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SHORTCUTS: [string, string][] = [
  ["Cmd/Ctrl + S", "Save and compile"],
  ["Cmd/Ctrl + F", "Find in the current file"],
  ["Cmd/Ctrl + click (editor)", "Jump to this spot in the PDF (SyncTeX)"],
  ["Cmd/Ctrl + click (PDF)", "Jump to the source line (SyncTeX)"],
  ["Cmd/Ctrl + Space", "Autocomplete LaTeX commands, environments, labels, citations"],
  ["Right-click marked word", "Add the word to your dictionary"],
  ["Alt + G", "Go to line (CodeMirror)"],
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <ul className="space-y-1.5 text-sm">
          {SHORTCUTS.map(([keys, description]) => (
            <li key={keys} className="flex items-center justify-between gap-4">
              <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                {keys}
              </span>
              <span className="text-muted-foreground">{description}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Polemic</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          A local-first, open source LaTeX editor. Your documents stay on your machine
          and compile with your own TeX distribution.
        </p>
        <p className="text-sm">
          Version <span className="font-mono">{version ?? "unknown"}</span>
        </p>
        <p className="text-sm text-muted-foreground">Released under the MIT License.</p>
        <button
          type="button"
          className="text-sm text-primary underline-offset-2 hover:underline"
          onClick={() => void openUrl("https://github.com/dwarsbit/polemic")}
        >
          github.com/dwarsbit/polemic
        </button>
      </DialogContent>
    </Dialog>
  );
}
