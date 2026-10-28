import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Check, FileDiff, X } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import {
  acceptAll,
  acceptChange,
  parseAuthors,
  parseChanges,
  rejectAll,
  rejectChange,
  removeSetup,
  type Change,
  type ChangeAuthor,
  type ChangeFilter,
} from "@/lib/changes";
import { authorStyles } from "@/lib/changes-view";
import { currentText, texPaths, writeFileEdits } from "@/lib/project-texts";
import { readProjectFile, type FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

interface Row {
  file: string;
  change: Change;
  /** The suggestion's source, to check it is still there. */
  source: string;
  line: number;
  snippet: string;
}

const KIND_LABEL: Record<Change["kind"], string> = {
  added: "Added",
  deleted: "Deleted",
  replaced: "Replaced",
  highlight: "Highlighted",
};

/** One line of plain-ish text for a row. */
function snippetOf(text: string, change: Change): string {
  const part = (r: { from: number; to: number } | null) =>
    r === null ? "" : text.slice(r.from, r.to).replace(/\s+/g, " ").trim();
  const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);
  if (change.kind === "replaced") {
    return `${clip(part(change.deleted))} → ${clip(part(change.added))}`;
  }
  return clip(part(change.added ?? change.deleted));
}

const lineAt = (text: string, offset: number) =>
  text.slice(0, offset).split("\n").length;

const pluralize = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Every suggestion in the project, grouped by file: author, kind and a
 * snippet per row, click to jump, Accept and Reject per row, per file
 * and for all shown (optionally one author's).
 */
export function SuggestionsPanel() {
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const activeFile = useProjectStore((s) => s.activeFile);
  const mainFile = useProjectStore((s) => s.mainFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);

  const [texts, setTexts] = useState<Map<string, string> | null>(null);
  // Bumped after files were written on disk, to read them again.
  const [diskTick, setDiskTick] = useState(0);
  // undefined: every author; null: suggestions without an author id.
  const [authorFilter, setAuthorFilter] = useState<string | null | undefined>(
    undefined,
  );
  const [message, setMessage] = useState<string | null>(null);

  // Disk reads are cached per file tree; the active file and open
  // buffers always come from memory.
  const diskCache = useRef<{
    files: FileEntry[];
    tick: number;
    texts: Map<string, string>;
  }>({ files: [], tick: 0, texts: new Map() });

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const cache = diskCache.current;
        if (cache.files !== files || cache.tick !== diskTick) {
          cache.files = files;
          cache.tick = diskTick;
          cache.texts.clear();
        }
        const found = new Map<string, string>();
        for (const path of texPaths(files)) {
          let text: string | undefined;
          if (path === activeFile) text = content;
          else if (buffers[path] !== undefined) text = buffers[path];
          else {
            text = cache.texts.get(path);
            if (text === undefined) {
              text =
                (await readProjectFile(project.path, path).catch(() => null)) ?? "";
              cache.texts.set(path, text);
            }
          }
          found.set(path, text);
        }
        if (!cancelled) setTexts(found);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, files, activeFile, content, buffers, diskTick]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const [file, text] of texts ?? []) {
      for (const change of parseChanges(text)) {
        if (change.kind === "highlight") continue;
        out.push({
          file,
          change,
          source: text.slice(change.range.from, change.range.to),
          line: lineAt(text, change.range.from),
          snippet: snippetOf(text, change),
        });
      }
    }
    return out;
  }, [texts]);

  const styles = useMemo(() => {
    const declared: ChangeAuthor[] = [];
    const main = mainFile === null ? undefined : texts?.get(mainFile);
    if (main !== undefined) declared.push(...parseAuthors(main));
    for (const [file, text] of texts ?? []) {
      if (file !== mainFile) declared.push(...parseAuthors(text));
    }
    return authorStyles(
      declared,
      rows.map((row) => row.change.author),
    );
  }, [texts, rows, mainFile]);

  const filter: ChangeFilter =
    authorFilter === undefined ? {} : { author: authorFilter };
  const shown = rows.filter(
    (row) => authorFilter === undefined || row.change.author === authorFilter,
  );
  const authorIds = [...new Set(rows.map((row) => row.change.author))];

  // Active file first, then the rest by path.
  const byFile = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const row of shown) {
      const list = groups.get(row.file) ?? [];
      list.push(row);
      groups.set(row.file, list);
    }
    return [...groups.keys()]
      .sort((a, b) =>
        a === activeFile ? -1 : b === activeFile ? 1 : a.localeCompare(b),
      )
      .map((file) => ({ file, items: groups.get(file)! }));
  }, [shown, activeFile]);

  const setupEdits = useMemo(() => {
    const main = mainFile === null ? undefined : texts?.get(mainFile);
    if (main === undefined || mainFile === null) return null;
    // Highlights need the package too.
    for (const text of texts?.values() ?? []) {
      if (parseChanges(text).length > 0) return null;
    }
    return removeSetup(main).length > 0 ? mainFile : null;
  }, [texts, mainFile]);

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 4000);
  }

  async function write(
    file: string,
    text: string,
    edits: ReturnType<typeof acceptAll>,
    userEvent: string,
  ) {
    const changed = await writeFileEdits(file, text, edits, userEvent, {
      isolate: true,
    });
    if (changed && file !== useProjectStore.getState().activeFile) {
      setDiskTick((tick) => tick + 1);
    }
    return changed;
  }

  async function resolveRow(row: Row, how: "accept" | "reject") {
    const text = await currentText(row.file);
    // Planned against an older text: wait for the list to catch up.
    if (
      text === null ||
      text.slice(row.change.range.from, row.change.range.to) !== row.source
    ) {
      return;
    }
    const edits = (how === "accept" ? acceptChange : rejectChange)(
      text,
      row.change.range,
    );
    await write(
      row.file,
      text,
      edits,
      how === "accept" ? "input.acceptChange" : "input.rejectChange",
    );
  }

  async function resolveFiles(targets: string[], how: "accept" | "reject") {
    const store = useProjectStore.getState();
    const closed = targets.filter(
      (file) => file !== store.activeFile && store.buffers[file] === undefined,
    );
    const count = shown.filter((row) => targets.includes(row.file)).length;
    if (targets.length > 1) {
      const ok = await ask(
        `${how === "accept" ? "Accept" : "Reject"} ${pluralize(count, "suggestion")} in ` +
          `${targets.length} files?` +
          (closed.length > 0 ? " Files that are not open are saved right away." : ""),
        { title: how === "accept" ? "Accept all" : "Reject all", kind: "warning" },
      ).catch(() => false);
      if (!ok) return;
    }
    let done = 0;
    for (const file of targets) {
      const text = await currentText(file);
      if (text === null) continue;
      const edits = (how === "accept" ? acceptAll : rejectAll)(text, filter);
      const userEvent = how === "accept" ? "input.acceptChange" : "input.rejectChange";
      if (await write(file, text, edits, userEvent)) done++;
    }
    if (done > 1) {
      flash(
        `${how === "accept" ? "Accepted" : "Rejected"} in ${pluralize(done, "file")}.`,
      );
    }
  }

  async function removeTrackChangesSetup(file: string) {
    const text = await currentText(file);
    if (text === null) return;
    if (await write(file, text, removeSetup(text), "input.removeChangesSetup")) {
      flash("Track changes setup removed.");
    }
  }

  async function jumpTo(row: Row) {
    if (row.file !== useProjectStore.getState().activeFile) {
      await useProjectStore.getState().openFile(row.file);
    }
    const text = useEditorStore.getState().content;
    const at = text.indexOf(row.source);
    useEditorStore.getState().jumpTo(at === -1 ? row.line : lineAt(text, at));
  }

  const resolveButtons = (
    onResolve: (how: "accept" | "reject") => void,
    what: string,
  ) => (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        title={`Accept ${what}`}
        onClick={() => onResolve("accept")}
      >
        <Check className="text-success" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        title={`Reject ${what}`}
        onClick={() => onResolve("reject")}
      >
        <X className="text-red-600 dark:text-red-400" />
      </Button>
    </>
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <SectionHeader label="Suggestions" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <FileDiff className="size-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {texts === null ? "Looking for suggestions…" : "No suggestions."}
          </p>
          {setupEdits !== null && (
            <Button
              variant="outline"
              size="xs"
              title={`Remove \\usepackage{changes} and the author definitions from ${setupEdits}`}
              onClick={() => void removeTrackChangesSetup(setupEdits)}
            >
              Remove track changes setup
            </Button>
          )}
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-card">
        <SectionHeader
          label="Suggestions"
          count={rows.length}
          actions={resolveButtons(
            (how) =>
              void resolveFiles(
                byFile.map((group) => group.file),
                how,
              ),
            authorFilter === undefined
              ? "all suggestions"
              : `all of ${styles.get(authorFilter)?.name ?? "this author"}'s suggestions`,
          )}
        />
      </div>
      {authorIds.length > 1 && (
        <div className="flex flex-wrap gap-1 px-2 py-1.5">
          <button
            type="button"
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs",
              authorFilter === undefined
                ? "bg-muted"
                : "text-muted-foreground hover:bg-muted/50",
            )}
            onClick={() => setAuthorFilter(undefined)}
          >
            All
          </button>
          {authorIds.map((id) => {
            const style = styles.get(id);
            const active = authorFilter === id;
            return (
              <button
                key={id ?? ""}
                type="button"
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                  active ? "bg-muted" : "text-muted-foreground hover:bg-muted/50",
                )}
                onClick={() => setAuthorFilter(active ? undefined : id)}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: style?.color }}
                />
                {style?.name ?? id}
              </button>
            );
          })}
        </div>
      )}
      {message && <p className="px-3 py-1 text-xs text-muted-foreground">{message}</p>}
      <div className="flex flex-col gap-3 p-2">
        {byFile.map(({ file, items }) => (
          <div key={file}>
            <div className="mb-1 flex items-center gap-1 px-1">
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                {file}
              </p>
              {resolveButtons(
                (how) => void resolveFiles([file], how),
                `all in ${file}`,
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {items.map((row) => {
                const style = styles.get(row.change.author);
                return (
                  <div
                    key={`${row.change.range.from}:${row.source.length}`}
                    className="group rounded-lg border bg-card/60 p-2"
                    data-suggestion-row
                  >
                    <div className="flex items-start gap-1.5 text-xs">
                      <span
                        className="mt-1 size-2 shrink-0 rounded-full"
                        style={{ background: style?.color }}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        title={`Jump to line ${row.line}`}
                        onClick={() => void jumpTo(row)}
                      >
                        <span className="line-clamp-3 break-words text-foreground">
                          {row.snippet || "(empty)"}
                        </span>
                        {row.change.note !== null && (
                          <span className="mt-0.5 block break-words text-muted-foreground italic">
                            {row.change.note}
                          </span>
                        )}
                      </button>
                    </div>
                    <div className="mt-0.5 flex items-center pl-3.5 text-2xs text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">
                        {style?.name ?? row.change.author} ·{" "}
                        {KIND_LABEL[row.change.kind]}
                        {" · "}line {row.line}
                      </span>
                      <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                        {resolveButtons(
                          (how) => void resolveRow(row, how),
                          "this suggestion",
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
