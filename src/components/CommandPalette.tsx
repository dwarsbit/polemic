import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Camera,
  FileText,
  FolderOpen,
  Image,
  Keyboard,
  MessageSquare,
  Package,
  PanelLeft,
  PanelRight,
  Play,
  Save,
  ScrollText,
  Search,
  Settings,
  Shapes,
  Sparkles,
  TableProperties,
  WandSparkles,
  Zap,
} from "lucide-react";
import { exportPdfAs } from "@/lib/pdf-export";
import { formatDocument } from "@/lib/editor-format";
import { wrapFigure } from "@/lib/editor-figure";
import { insertTikzSnippet, TIKZ_SNIPPETS } from "@/lib/tikz-snippets";
import { addCommentAtCursor, addFileComment } from "@/lib/editor-comments";
import { runPanelCommand } from "@/lib/panel-commands";
import { fuzzyRank, type FuzzyItem } from "@/lib/fuzzy";
import { revealBuildFolder, type FileEntry } from "@/lib/tauri";
import { useDialogsStore } from "@/store/dialogs";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";
import { resolveVersionControl, useSettingsStore } from "@/store/settings";
import { cn } from "cn";

interface Command {
  id: string;
  title: string;
  icon: typeof FileText;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

function collectFilePaths(entries: FileEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDir) {
      paths.push(...collectFilePaths(entry.children));
    } else if (/\.(tex|bib)$/.test(entry.path)) {
      paths.push(entry.path);
    }
  }
  return paths;
}

export function CommandPalette() {
  const onClose = () => useDialogsStore.getState().setPaletteOpen(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const versionControl = useSettingsStore((s) => resolveVersionControl(s));

  const commands = useMemo<Command[]>(() => {
    const app: Command[] = [
      {
        id: "mode-sources",
        title: "Sources…",
        icon: BookOpen,
        shortcut: "Cmd/Ctrl + Alt + 2",
        keywords: "workspace bibliography sources zotero settings",
        run: () => useSettingsStore.getState().openSettings("bibliography"),
      },
      {
        id: "settings",
        title: "Open settings",
        icon: Settings,
        keywords: "preferences theme language spellcheck",
        run: () => useSettingsStore.getState().setSettingsDialogOpen(true),
      },
      {
        id: "shortcuts",
        title: "Show keyboard shortcuts",
        icon: Keyboard,
        run: () => useDialogsStore.getState().setShortcutsOpen(true),
      },
      {
        id: "about",
        title: "About Polemic",
        icon: Sparkles,
        run: () => useDialogsStore.getState().setAboutOpen(true),
      },
    ];

    if (!project) return app;

    const store = useProjectStore.getState();
    return [
      {
        id: "save",
        title: "Save file",
        icon: Save,
        shortcut: "Cmd/Ctrl + S",
        run: () => void store.saveActiveFile(),
      },
      {
        id: "format",
        title: "Format document",
        icon: WandSparkles,
        shortcut: "Shift + Alt + F",
        run: () => formatDocument(),
      },
      {
        id: "compile",
        title: "Compile project",
        icon: Play,
        run: () => void usePreviewStore.getState().compileNow(),
      },
      {
        id: "export-pdf",
        title: "Export PDF as…",
        icon: FileText,
        shortcut: "Cmd/Ctrl + E",
        run: () => void exportPdfAs(),
      },
      {
        id: "new-project",
        title: "New project (back to the projects view)",
        icon: FolderOpen,
        run: () => {
          void store
            .flushBuffers()
            .finally(() => useProjectStore.getState().closeProject());
        },
      },
      {
        id: "reveal-build",
        title: "Reveal build folder",
        icon: FolderOpen,
        run: () => void revealBuildFolder(project.path),
      },
      {
        id: "add-comment",
        title: "Add comment",
        icon: MessageSquare,
        shortcut: "Cmd/Ctrl + Alt + C",
        keywords: "note annotation review",
        run: () => addCommentAtCursor(),
      },
      {
        id: "add-file-comment",
        title: "Add comment on file",
        icon: MessageSquare,
        keywords: "note annotation file",
        run: () => addFileComment(),
      },
      {
        id: "toggle-sidebar",
        title: "Toggle sidebar",
        icon: PanelLeft,
        keywords: "files outline symbols hide show",
        run: () => runPanelCommand("toggle-sidebar"),
      },
      {
        id: "toggle-preview",
        title: "Toggle PDF preview",
        icon: PanelRight,
        keywords: "pdf hide show",
        run: () => runPanelCommand("toggle-preview"),
      },
      {
        id: "toggle-right",
        title: "Toggle right panel",
        icon: PanelRight,
        keywords: "git snapshots history properties hide show",
        run: () => runPanelCommand("toggle-right"),
      },
      {
        id: "toggle-search",
        title: "Search in project",
        icon: Search,
        shortcut: "Cmd/Ctrl + Shift + F",
        keywords: "find grep across files",
        run: () => runPanelCommand("toggle-search"),
      },
      {
        id: "toggle-issues",
        title: "Show issues",
        icon: AlertTriangle,
        keywords: "errors warnings problems hide show",
        run: () => runPanelCommand("toggle-issues"),
      },
      {
        id: "toggle-log",
        title: "Show compile log",
        icon: ScrollText,
        keywords: "latexmk output hide show",
        run: () => runPanelCommand("toggle-log"),
      },
      {
        id: "insert-table",
        title: "Insert table…",
        icon: TableProperties,
        shortcut: "Cmd/Ctrl + Shift + T",
        keywords: "tabular booktabs rows columns skeleton",
        run: () => useDialogsStore.getState().setTableDialogOpen(true),
      },
      {
        id: "packages",
        title: "Manage packages…",
        icon: Package,
        shortcut: "Cmd/Ctrl + Alt + P",
        keywords: "ctan usepackage libraries install latex",
        run: () => useDialogsStore.getState().setPackagesDialogOpen(true),
      },
      {
        id: "wrap-figure",
        title: "Wrap in figure",
        icon: Image,
        shortcut: "Cmd/Ctrl + Alt + G",
        keywords: "includegraphics caption float graphic",
        run: () => wrapFigure(),
      },
      ...TIKZ_SNIPPETS.map((snippet) => ({
        id: `tikz-${snippet.id}`,
        title: snippet.title,
        icon: Shapes,
        keywords: snippet.keywords,
        run: () => insertTikzSnippet(snippet.id),
      })),
      ...(versionControl === "snapshots"
        ? [
            {
              id: "snapshot",
              title: "Take snapshot",
              icon: Camera,
              keywords: "backup version save",
              run: () => void useProjectStore.getState().takeSnapshot(),
            },
          ]
        : []),
      {
        id: "toggle-autocompile",
        title: `Auto-compile: turn ${usePreviewStore.getState().autoCompile ? "off" : "on"}`,
        icon: Zap,
        run: () => usePreviewStore.getState().toggleAutoCompile(),
      },
      ...app,
    ];
  }, [project, versionControl]);

  const fileCommands = useMemo<Command[]>(() => {
    if (!project) return [];
    return collectFilePaths(files).map((path) => ({
      id: `open:${path}`,
      title: `Open: ${path}`,
      icon: FileText,
      keywords: "go to switch tab",
      run: () => void useProjectStore.getState().openFile(path),
    }));
  }, [files, project]);

  const results = useMemo(() => {
    const all = [...commands, ...fileCommands];
    if (!query.trim()) return all.map((item) => ({ item, score: 0, indices: [] }));
    return fuzzyRank(
      query,
      all,
      (command) => [command.title, command.keywords ?? ""],
      20,
    );
  }, [commands, fileCommands, query]);

  useEffect(() => {
    if (selected >= results.length) {
      // Keep the selection in range as the result list shrinks.
      const timeout = setTimeout(() => setSelected(Math.max(0, results.length - 1)));
      return () => clearTimeout(timeout);
    }
  }, [results.length, selected]);

  function accept(result: FuzzyItem<Command> | undefined) {
    if (!result) return;
    onClose();
    result.item.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      accept(results[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  // Keep the selected item visible while navigating with the keyboard.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[data-selected="true"]');
    item?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/30 pt-[15vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="h-fit w-[min(560px,calc(100%-2rem))] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Type a command or file name…"
          className="w-full border-b bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching commands.
            </p>
          )}
          {results.map((result, index) => {
            const command = result.item;
            const Icon = command.icon;
            const isSelected = index === selected;
            return (
              <button
                key={command.id}
                type="button"
                data-selected={isSelected}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm",
                  isSelected ? "bg-primary/10" : "hover:bg-muted",
                )}
                onMouseMove={() => setSelected(index)}
                onClick={() => accept(result)}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{command.title}</span>
                {command.shortcut && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {command.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
