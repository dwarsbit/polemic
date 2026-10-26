import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { useDocumentOrder } from "@/hooks/useDocumentOrder";
import type { SourceEdit } from "@/lib/label-index";
import { showNativeContextMenu, type NativeMenuEntry } from "@/lib/native-menu";
import { parseOutline, type OutlineEntry } from "@/lib/outline";
import { extractIncludes, resolveIncludePath, texPathsOf } from "@/lib/doc-structure";
import {
  planLevelChange,
  planMove,
  planMoveTo,
  planMoveToFile,
  type CrossFilePlace,
  type StructureOptions,
} from "@/lib/outline-edit";
import {
  applyCrossFileMove,
  applyFileEdits,
  currentText,
  hasCrossFileMove,
  undoCrossFileMove,
} from "@/lib/outline-move";
import { readProjectFile } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

interface FileOutline {
  file: string;
  entries: OutlineEntry[];
}

/** A section with its nested subsections. */
interface SectionNode {
  entry: OutlineEntry;
  children: SectionNode[];
}

/** A structure edit, planned against the file's current text. */
type StructurePlan = (source: string, index: number) => SourceEdit[];

/** The drop indicator while dragging a section. */
interface DropTarget {
  key: string;
  position: "before" | "after";
}

/**
 * Apply a structure edit to the entry (found again by line and title,
 * since the outline may lag the text): in the live editor for the
 * active file (one undo step), else in its buffer or on disk.
 */
async function applyStructureEdit(
  projectPath: string,
  file: string,
  entry: OutlineEntry,
  plan: StructurePlan,
): Promise<void> {
  const source = await currentText(projectPath, file);
  if (source === null) return;
  const index = parseOutline(source).findIndex(
    (e) => e.line === entry.line && e.title === entry.title,
  );
  if (index === -1) return;
  const edits = plan(source, index);
  if (edits.length === 0) return;
  await applyFileEdits(projectPath, file, source, edits);
}

/** The index of an entry in freshly parsed text (by line and title). */
function findEntry(source: string, entry: OutlineEntry): number {
  return parseOutline(source).findIndex(
    (e) => e.line === entry.line && e.title === entry.title,
  );
}

/**
 * Move a section into another file. Returns a status message and
 * whether the move happened, or null when nothing could be planned
 * (the outline lagged the text).
 */
async function moveSectionToFile(
  projectPath: string,
  sourceFile: string,
  entry: OutlineEntry,
  targetFile: string,
  target: { entry: OutlineEntry; position: "before" | "after" } | null,
  options: StructureOptions,
  texPaths: string[],
): Promise<{ text: string; moved: boolean } | null> {
  const source = await currentText(projectPath, sourceFile);
  const targetText = await currentText(projectPath, targetFile);
  if (source === null || targetText === null) return null;
  const index = findEntry(source, entry);
  if (index === -1) return null;
  let place: CrossFilePlace = { position: "end" };
  if (target !== null) {
    const targetIndex = findEntry(targetText, target.entry);
    if (targetIndex === -1) return null;
    place = { index: targetIndex, position: target.position };
  }
  const plan = planMoveToFile(source, index, targetText, place, options);
  if (plan === null) return null;
  // A section that includes the target file cannot move into it.
  if (
    extractIncludes(plan.text).some(
      (spec) => resolveIncludePath(spec, texPaths) === targetFile,
    )
  ) {
    return {
      text: `“${entry.title}” includes ${targetFile}, so it cannot move into it.`,
      moved: false,
    };
  }
  const moved = await applyCrossFileMove(
    projectPath,
    sourceFile,
    source,
    plan.sourceEdits,
    targetFile,
    targetText,
    plan.targetEdits,
  );
  return moved ? { text: `Moved “${entry.title}” to ${targetFile}.`, moved } : null;
}

/** Nest the flat parsed entries by their section level. */
function buildTree(entries: OutlineEntry[]): SectionNode[] {
  const roots: SectionNode[] = [];
  const stack: SectionNode[] = [];
  for (const entry of entries) {
    const node: SectionNode = { entry, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].entry.level >= entry.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

export function OutlinePanel() {
  const project = useProjectStore((s) => s.project);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const order = useDocumentOrder();
  const [docOutline, setDocOutline] = useState<FileOutline[] | null>(null);
  const [dragging, setDragging] = useState<{
    file: string;
    entry: OutlineEntry;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // After a move into another file: what happened, and whether Undo applies.
  const [moveStatus, setMoveStatus] = useState<{
    text: string;
    undoable: boolean;
  } | null>(null);
  // Bumped after a structure edit to files other than the active one,
  // which the content-driven refresh would not notice.
  const [editTick, setEditTick] = useState(0);
  // The section to refocus once the outline reflects a keyboard edit.
  const refocus = useRef<{ file: string; title: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Per-session expansion state: nodes start expanded, so only the
  // collapsed keys are tracked.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Parse sections per ordered file (debounced): the active file from
  // the live editor content, other files from buffers or disk.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!project || order === null) {
          setDocOutline(null);
          return;
        }
        const groups: FileOutline[] = [];
        for (const path of order) {
          let text: string | null;
          if (path === activeFile) {
            text = content;
          } else if (buffers[path] !== undefined) {
            text = buffers[path];
          } else {
            try {
              text = await readProjectFile(project.path, path);
            } catch {
              text = null;
            }
          }
          groups.push({ file: path, entries: text === null ? [] : parseOutline(text) });
        }
        if (!cancelled) setDocOutline(groups);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, order, activeFile, buffers, content, editTick]);

  useEffect(() => {
    const target = refocus.current;
    if (target === null || docOutline === null) return;
    const entry = docOutline
      .find((group) => group.file === target.file)
      ?.entries.find((e) => e.title === target.title);
    if (entry === undefined) return;
    refocus.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(
        `[data-outline-key="${CSS.escape(`${target.file}:${entry.line}`)}"]`,
      )
      ?.focus();
  }, [docOutline]);

  // The shallowest level the document uses: promotion stops there, so
  // an article never grows a \chapter.
  const minLevel = useMemo(() => {
    const levels = (docOutline ?? []).flatMap((group) =>
      group.entries.map((e) => e.level),
    );
    return levels.length > 0 ? Math.min(...levels) : 0;
  }, [docOutline]);

  // Includes of files with sections of their own stay put when a
  // section around them moves.
  const files = useProjectStore((s) => s.files);
  const structureOptions = useMemo<StructureOptions>(() => {
    const texPaths = texPathsOf(files);
    const sectioned = new Set(
      (docOutline ?? [])
        .filter((group) => group.entries.length > 0)
        .map((group) => group.file),
    );
    return {
      isStructuralInclude: (spec) => {
        const path = resolveIncludePath(spec, texPaths);
        return path !== null && sectioned.has(path);
      },
    };
  }, [files, docOutline]);

  function runStructureEdit(file: string, entry: OutlineEntry, plan: StructurePlan) {
    if (!project) return;
    void applyStructureEdit(project.path, file, entry, plan).then(() =>
      setEditTick((tick) => tick + 1),
    );
  }

  function runCrossFileMove(
    sourceFile: string,
    entry: OutlineEntry,
    targetFile: string,
    target: { entry: OutlineEntry; position: "before" | "after" } | null,
  ) {
    if (!project) return;
    void moveSectionToFile(
      project.path,
      sourceFile,
      entry,
      targetFile,
      target,
      structureOptions,
      texPathsOf(files),
    ).then((result) => {
      setEditTick((tick) => tick + 1);
      if (result !== null) setMoveStatus({ text: result.text, undoable: result.moved });
    });
  }

  function undoMove() {
    // Already undone (Ctrl+Z in the editor): nothing left to do.
    if (!hasCrossFileMove()) {
      setMoveStatus(null);
      return;
    }
    void undoCrossFileMove().then((undone) => {
      setEditTick((tick) => tick + 1);
      setMoveStatus(
        undone
          ? null
          : { text: "Cannot undo: one of the files changed since.", undoable: false },
      );
    });
  }

  function structureActions(file: string, entry: OutlineEntry) {
    return {
      up: () =>
        runStructureEdit(file, entry, (src, i) =>
          planMove(src, i, -1, structureOptions),
        ),
      down: () =>
        runStructureEdit(file, entry, (src, i) =>
          planMove(src, i, 1, structureOptions),
        ),
      promote: () =>
        runStructureEdit(file, entry, (src, i) =>
          planLevelChange(src, i, -1, minLevel),
        ),
      demote: () =>
        runStructureEdit(file, entry, (src, i) => planLevelChange(src, i, 1, minLevel)),
    };
  }

  function showStructureMenu(file: string, entry: OutlineEntry) {
    const actions = structureActions(file, entry);
    const items: NativeMenuEntry[] = [
      { id: "up", text: "Move Up", action: actions.up },
      { id: "down", text: "Move Down", action: actions.down },
      "separator",
      { id: "promote", text: "Promote", action: actions.promote },
      { id: "demote", text: "Demote", action: actions.demote },
    ];
    void showNativeContextMenu(items);
  }

  function goTo(file: string, line: number) {
    if (file === activeFile) {
      jumpTo(line);
      return;
    }
    void useProjectStore
      .getState()
      .openFile(file)
      .then(() => jumpTo(line));
  }

  function renderNode(node: SectionNode, file: string, depth: number): ReactNode {
    const key = `${file}:${node.entry.line}`;
    const isCollapsed = collapsed.has(key);
    const drop = dropTarget?.key === key ? dropTarget.position : null;
    return (
      <div key={key}>
        <div
          className={cn(
            "relative flex items-center rounded hover:bg-accent",
            dragging?.file === file &&
              dragging.entry.line === node.entry.line &&
              "opacity-50",
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", node.entry.title);
            setDragging({ file, entry: node.entry });
          }}
          onDragEnd={() => {
            setDragging(null);
            setDropTarget(null);
          }}
          onDragOver={(event) => {
            if (dragging === null) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const position =
              event.clientY < rect.top + rect.height / 2 ? "before" : "after";
            if (dropTarget?.key !== key || dropTarget.position !== position) {
              setDropTarget({ key, position });
            }
          }}
          onDragLeave={() => {
            if (dropTarget?.key === key) setDropTarget(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const source = dragging;
            setDragging(null);
            setDropTarget(null);
            if (source === null || drop === null) return;
            const target = node.entry;
            if (source.file !== file) {
              runCrossFileMove(source.file, source.entry, file, {
                entry: target,
                position: drop,
              });
              return;
            }
            runStructureEdit(file, source.entry, (src, i) => {
              const t = parseOutline(src).findIndex(
                (e) => e.line === target.line && e.title === target.title,
              );
              return t === -1 ? [] : planMoveTo(src, i, t, drop, structureOptions);
            });
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            showStructureMenu(file, node.entry);
          }}
        >
          {drop !== null && (
            <span
              className={cn(
                "pointer-events-none absolute right-0 h-0.5 rounded bg-primary",
                drop === "before" ? "top-0" : "bottom-0",
              )}
              style={{ left: 8 + depth * 12 }}
            />
          )}
          {node.children.length > 0 ? (
            <Caret expanded={!isCollapsed} onClick={() => toggle(key)} />
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <button
            type="button"
            className="min-w-0 flex-1 truncate py-1 text-left text-sm"
            data-outline-key={key}
            title={`${node.entry.title}\nDrag to move (also into another file) · Alt+↑/↓ move · Alt+←/→ promote/demote`}
            onClick={() => goTo(file, node.entry.line)}
            onKeyDown={(event) => {
              if (!event.altKey) return;
              const actions = structureActions(file, node.entry);
              const action = {
                ArrowUp: actions.up,
                ArrowDown: actions.down,
                ArrowLeft: actions.promote,
                ArrowRight: actions.demote,
              }[event.key];
              if (action === undefined) return;
              event.preventDefault();
              refocus.current = { file, title: node.entry.title };
              action();
            }}
            onDoubleClick={() => {
              if (node.children.length > 0) toggle(key);
            }}
          >
            {node.entry.title}
          </button>
        </div>
        {!isCollapsed &&
          node.children.map((child) => renderNode(child, file, depth + 1))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader label="OUTLINE" collapsed={false} />
      {moveStatus !== null && (
        <div className="mx-2 mb-1 flex items-start gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{moveStatus.text}</span>
          {moveStatus.undoable && (
            <button
              type="button"
              className="shrink-0 font-medium text-foreground hover:underline"
              onClick={undoMove}
            >
              Undo
            </button>
          )}
          <button
            type="button"
            title="Dismiss"
            className="flex size-4 shrink-0 items-center justify-center hover:text-foreground"
            onClick={() => setMoveStatus(null)}
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      <div ref={listRef} className="flex-1 overflow-y-auto px-2 pb-2">
        {docOutline === null && order !== null ? null : docOutline === null ||
          docOutline.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {activeFile ? "No sections in this document." : "No file open."}
          </p>
        ) : (
          docOutline.map((group) => {
            const fileKey = `file:${group.file}`;
            const isCollapsed = collapsed.has(fileKey);
            const roots = buildTree(group.entries);
            return (
              <div key={group.file} className="mb-1">
                <div
                  className={cn(
                    "flex items-center rounded hover:bg-accent",
                    dropTarget?.key === fileKey && "bg-accent ring-1 ring-primary",
                  )}
                  // Dropping a section on another file's name appends it there.
                  onDragOver={(event) => {
                    if (dragging === null || dragging.file === group.file) return;
                    event.preventDefault();
                    if (dropTarget?.key !== fileKey) {
                      setDropTarget({ key: fileKey, position: "after" });
                    }
                  }}
                  onDragLeave={() => {
                    if (dropTarget?.key === fileKey) setDropTarget(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = dragging;
                    setDragging(null);
                    setDropTarget(null);
                    if (source === null || source.file === group.file) return;
                    runCrossFileMove(source.file, source.entry, group.file, null);
                  }}
                >
                  {roots.length > 0 ? (
                    <Caret expanded={!isCollapsed} onClick={() => toggle(fileKey)} />
                  ) : (
                    <span className="size-5 shrink-0" />
                  )}
                  <button
                    type="button"
                    title={`Open ${group.file}`}
                    className="min-w-0 flex-1 truncate py-1 pl-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => goTo(group.file, 1)}
                    onDoubleClick={() => {
                      if (roots.length > 0) toggle(fileKey);
                    }}
                  >
                    {group.file}
                  </button>
                </div>
                {!isCollapsed && roots.map((root) => renderNode(root, group.file, 1))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** The disclosure triangle; rotated when its node is expanded. */
function Caret({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={expanded ? "Collapse" : "Expand"}
      className="flex size-5 shrink-0 items-center justify-center"
      onClick={onClick}
    >
      <ChevronRight
        className={cn("size-3 transition-transform", expanded && "rotate-90")}
      />
    </button>
  );
}
