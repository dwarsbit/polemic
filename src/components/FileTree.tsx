import { BookMarked, FileText, Folder, Pencil, Star, Trash2 } from "lucide-react";
import type { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/store/project";

export type FileStatus = "added" | "changed" | "ignored";

const STATUS_CLASS: Record<FileStatus, string> = {
  added: "text-emerald-600 dark:text-emerald-400",
  changed: "text-sky-600 dark:text-sky-400",
  ignored: "text-orange-500 dark:text-orange-400",
};

interface FileTreeProps {
  entries: FileEntry[];
  depth?: number;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onSetMain: (entry: FileEntry) => void;
  statusOf?: (path: string) => FileStatus | undefined;
}

export function FileTree({
  entries,
  depth = 0,
  onRename,
  onDelete,
  onSetMain,
  statusOf,
}: FileTreeProps) {
  const activeFile = useProjectStore((s) => s.activeFile);
  const mainFile = useProjectStore((s) => s.mainFile);
  const openFile = useProjectStore((s) => s.openFile);

  return (
    <ul className="text-sm">
      {entries.map((entry) =>
        entry.isDir ? (
          <li key={entry.path}>
            <details open>
              <summary
                className="group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 hover:bg-accent"
                style={{ paddingLeft: 8 + depth * 12 }}
              >
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.name}</span>
                <span className="ml-auto hidden items-center gap-0.5 group-hover:flex">
                  <ActionButton title="Rename" onClick={() => onRename(entry)}>
                    <Pencil className="size-3" />
                  </ActionButton>
                  <ActionButton title="Delete" onClick={() => onDelete(entry)}>
                    <Trash2 className="size-3" />
                  </ActionButton>
                </span>
              </summary>
              <FileTree
                entries={entry.children}
                depth={depth + 1}
                onRename={onRename}
                onDelete={onDelete}
                onSetMain={onSetMain}
                statusOf={statusOf}
              />
            </details>
          </li>
        ) : (
          <li key={entry.path}>
            <div
              className={cn(
                "group flex w-full items-center gap-1.5 rounded px-2 py-1",
                activeFile === entry.path ? "bg-accent" : "hover:bg-accent",
              )}
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => void openFile(entry.path)}
              >
                {entry.path.endsWith(".bib") ? (
                  <BookMarked className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "truncate",
                    statusOf &&
                      statusOf(entry.path) &&
                      STATUS_CLASS[statusOf(entry.path)!],
                  )}
                >
                  {entry.name}
                </span>
              </button>
              {mainFile === entry.path && (
                <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
              )}
              <span className="hidden items-center gap-0.5 group-hover:flex">
                {entry.path.endsWith(".tex") && mainFile !== entry.path && (
                  <ActionButton
                    title="Set as main file"
                    onClick={() => onSetMain(entry)}
                  >
                    <Star className="size-3" />
                  </ActionButton>
                )}
                <ActionButton title="Rename" onClick={() => onRename(entry)}>
                  <Pencil className="size-3" />
                </ActionButton>
                <ActionButton title="Delete" onClick={() => onDelete(entry)}>
                  <Trash2 className="size-3" />
                </ActionButton>
              </span>
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

function ActionButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
