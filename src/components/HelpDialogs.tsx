import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatShortcut, isMac } from "@/lib/platform";

/** Shortcut groups; keys are platform-neutral specs ("Mod" is ⌘ on
 *  macOS and Ctrl elsewhere) or a plain description of a gesture. */
const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: "General",
    items: [
      ["Mod+P", "Command palette"],
      ["Mod+,", "Settings"],
      ["Mod+Alt+/", "Keyboard shortcuts"],
      ["Mod+O", "Open project"],
      ["Mod+Shift+W", "Close project"],
    ],
  },
  {
    group: "Files and output",
    items: [
      ["Mod+S", "Save and compile"],
      ["Mod+Shift+R", "Compile"],
      ["Mod+E", "Export PDF"],
      ["Mod+Shift+E", "Reveal build folder"],
    ],
  },
  {
    group: "Editing",
    items: [
      ["Mod+F", "Find in file"],
      ["Mod+Shift+F", "Find in project"],
      ["Shift+Alt+F", "Format document"],
      ["Mod+/", "Comment out the line (%)"],
      ["Mod+Alt+C", "Add comment"],
      ["Mod+C", "Copy the line (nothing selected)"],
      ["Mod+X", "Cut the line (nothing selected)"],
      ["Mod+D", "Delete the line"],
      ["Alt+G", "Go to line"],
      ["Mod+Space", "Complete commands, labels and citations"],
      ["Mod+B", "Bold (\\textbf)"],
      ["Mod+I", "Emphasis (\\emph)"],
      ["Mod+U", "Underline (\\underline)"],
    ],
  },
  {
    group: "Insert",
    items: [
      ["Mod+Shift+T", "Table"],
      ["Mod+Alt+G", "Figure from image"],
      ["Mod+Alt+T", "TikZ picture"],
      ["Mod+Shift+C", "Citation"],
    ],
  },
  {
    group: "View",
    items: [
      ["Mod+Alt+1", "Code"],
      ["Mod+Alt+2", "Visual"],
      ["Mod+Alt+B", "Navigator"],
      ["Mod+Shift+P", "PDF preview"],
      ["Mod+J", "Properties"],
      ["Mod+Shift+M", "Issues"],
      ["Mod+=", "Zoom the PDF in"],
      ["Mod+-", "Zoom the PDF out"],
      ["Mod+0", "PDF at actual size"],
    ],
  },
  {
    group: "Project",
    items: [
      ["Mod+Alt+P", "Packages"],
      ["Mod+K", "Commit"],
    ],
  },
  {
    group: "Mouse",
    items: [
      [`${isMac ? "⌘" : "Ctrl+"}click in the editor`, "Show this spot in the PDF"],
      [`${isMac ? "⌘" : "Ctrl+"}click in the PDF`, "Show the source line"],
      ["Right-click a marked word", "Corrections and dictionary"],
    ],
  },
];

/** A spec ("Mod+Shift+P") formatted for this platform; gestures pass through. */
function keysLabel(keys: string): string {
  return /^(Mod|Shift|Alt|Ctrl)(\+|$)/.test(keys) ? formatShortcut(keys) : keys;
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="-mx-2 min-h-0 space-y-4 overflow-y-auto px-2">
          {SHORTCUTS.map(({ group, items }) => (
            <section key={group}>
              <p className="mb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                {group}
              </p>
              <ul className="divide-y divide-border rounded-lg border">
                {items.map(([keys, description]) => (
                  <li
                    key={keys}
                    className="flex items-center justify-between gap-4 px-3 py-1.5 text-sm"
                  >
                    <span>{description}</span>
                    <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
                      {keysLabel(keys)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
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
