import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorState } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { linter, lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorView, basicSetup } from "codemirror";
import { keymap, Decoration } from "@codemirror/view";
import { latexAutocompletion } from "@/lib/completion";
import { gitLineGutter, setGitLines } from "@/lib/git-gutter";
import { lineStatus } from "@/lib/git-line-status";
import { lineOps } from "@/lib/line-ops";
import { mathPairing } from "@/lib/math-pairing";
import { setInsertHandler } from "@/lib/editor-insert";
import {
  clearSpellcheckCache,
  misspelledWordAt,
  runSpellcheck,
  setMisspells,
  spellcheckExtension,
} from "@/lib/spellcheck";
import { resolveVersionControl, useSettingsStore } from "@/store/settings";
import { addSpellcheckWord, gitShowHead, synctexForward } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

interface SpellPopover {
  word: string;
  x: number;
  y: number;
}

export function LatexEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const jumpTarget = useEditorStore((s) => s.jumpTarget);
  const clearJump = useEditorStore((s) => s.clearJump);
  const docVersion = useEditorStore((s) => s.docVersion);
  const content = useEditorStore((s) => s.content);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const spellcheckEnabled = useSettingsStore((s) => s.spellcheckEnabled);
  const spellcheckLanguage = useSettingsStore((s) => s.spellcheckLanguage);
  const issues = usePreviewStore((s) => s.issues);
  const activeFile = useProjectStore((s) => s.activeFile);
  const projectPath = useProjectStore((s) => s.project?.path);
  const versionControl = useSettingsStore((s) => resolveVersionControl(s));
  const [popover, setPopover] = useState<SpellPopover | null>(null);
  const popoverRef = useRef<((p: SpellPopover) => void) | null>(null);

  useEffect(() => {
    popoverRef.current = (p) => setPopover(p);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const setContent = useEditorStore.getState().setContent;
    const view = new EditorView({
      state: EditorState.create({
        doc: useEditorStore.getState().content,
        extensions: [
          basicSetup,
          StreamLanguage.define(stex),
          latexAutocompletion,
          mathPairing,
          lineOps,
          gitLineGutter,
          linter(() => []),
          lintGutter(),
          spellcheckExtension,
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": {
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "var(--editor-font-size, 14px)",
            },
          }),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                void (async () => {
                  await useProjectStore.getState().saveActiveFile();
                  void usePreviewStore.getState().compileNow();
                })();
                return true;
              },
            },
          ]),
          // Cmd/Ctrl+click in the source: scroll the preview (SyncTeX forward).
          EditorView.domEventHandlers({
            mousedown(event, view) {
              if (!(event.metaKey || event.ctrlKey)) return false;
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              const line = view.state.doc.lineAt(pos);
              void (async () => {
                const { project, activeFile } = useProjectStore.getState();
                if (!project || !activeFile) return;
                try {
                  const target = await synctexForward(
                    project.path,
                    activeFile,
                    line.number,
                    pos - line.from + 1,
                  );
                  usePreviewStore.getState().requestScroll(target);
                } catch (e) {
                  usePreviewStore.setState({ status: "error", error: String(e) });
                }
              })();
              return true;
            },
            // Right-click on a misspelled word: offer adding it to the dictionary.
            contextmenu(event, view) {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              const hit = misspelledWordAt(view, pos);
              if (!hit) return false;
              event.preventDefault();
              popoverRef.current?.({
                word: hit.word,
                x: event.clientX,
                y: event.clientY,
              });
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const content = update.state.doc.toString();
              setContent(content);
              const { activeFile, lastSavedContent } = useProjectStore.getState();
              if (activeFile !== null && content !== lastSavedContent) {
                useProjectStore.getState().markDirty(activeFile, content);
              }
            }
          }),
        ],
      }),
      parent: container,
    });
    viewRef.current = view;
    // Serve the math symbols panel: insert text at the cursor.
    setInsertHandler((text, cursorOffset) => {
      const range = view.state.selection.main;
      const anchor = range.from + (cursorOffset ?? text.length);
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: { anchor },
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      view.focus();
    });
    return () => {
      setInsertHandler(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Resynchronize the document when a file is loaded externally.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const content = useEditorStore.getState().content;
    if (content !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
  }, [docVersion]);

  // Git change bars: the HEAD version comes through react-query (so
  // git actions can invalidate it); the diff against the live content
  // is recomputed debounced while typing.
  const gitEnabled = versionControl === "git" && projectPath !== null;
  const { data: head } = useQuery({
    queryKey: ["git-head", projectPath, activeFile],
    queryFn: () => gitShowHead(projectPath!, activeFile!),
    enabled: gitEnabled && activeFile !== null,
    staleTime: Infinity,
  });

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!gitEnabled || activeFile === null || head === undefined) {
      view.dispatch({ effects: setGitLines.of(new Map()) });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const current = viewRef.current;
      if (cancelled || !current) return;
      current.dispatch({
        effects: setGitLines.of(lineStatus(head, useEditorStore.getState().content)),
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [gitEnabled, activeFile, head, content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || jumpTarget === null) return;
    const clamped = Math.min(jumpTarget, view.state.doc.lines);
    const pos = view.state.doc.line(clamped).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
    clearJump();
  }, [jumpTarget, clearJump]);

  // Show compile issues for the active file as squiggles and gutter marks.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const diagnostics: Diagnostic[] = [];
    if (activeFile !== null) {
      for (const issue of issues) {
        if (issue.file !== activeFile || issue.line === null) continue;
        const lineNo = Math.min(issue.line, view.state.doc.lines);
        const line = view.state.doc.line(lineNo);
        diagnostics.push({
          from: line.from,
          to: line.to,
          severity: issue.severity === "error" ? "error" : "warning",
          message: issue.message,
        });
      }
    }
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [issues, activeFile, docVersion]);

  // Debounced spellcheck over the current document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!spellcheckEnabled) {
      view.dispatch({ effects: setMisspells.of(Decoration.none) });
      return;
    }
    const timer = setTimeout(() => void runSpellcheck(view), 500);
    return () => clearTimeout(timer);
  }, [content, docVersion, spellcheckEnabled]);

  // Re-check with a fresh cache when the spellcheck language changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    clearSpellcheckCache();
    if (spellcheckEnabled) {
      void runSpellcheck(view);
    }
    // spellcheckLanguage intentionally drives re-runs; content handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spellcheckLanguage]);

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden"
      style={{ "--editor-font-size": `${fontSize}px` } as React.CSSProperties}
      onMouseDown={() => setPopover(null)}
    >
      {popover && (
        <div
          className="fixed z-50 rounded-md border bg-popover p-1 text-xs shadow-md"
          style={{ left: popover.x, top: popover.y + 8 }}
        >
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
            onClick={() => {
              const view = viewRef.current;
              void (async () => {
                try {
                  await addSpellcheckWord(popover.word);
                  if (view) await runSpellcheck(view);
                } finally {
                  setPopover(null);
                }
              })();
            }}
          >
            Add “{popover.word}” to dictionary
          </button>
        </div>
      )}
    </div>
  );
}
