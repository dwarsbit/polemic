import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { bibSyntax } from "@/lib/bib-syntax";
import { setApplyEditsHandler } from "@/lib/editor-edits";
import { editorHighlightExtension } from "@/lib/editor-themes";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

/**
 * The raw-text side of the .bib editor: a CodeMirror instance with
 * BibTeX highlighting. Content flows through the editor store like
 * any open file; the References side edits it through the same
 * applyEditsInView pipeline (one undo step).
 */
export function BibEditor({ visible = true }: { visible?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const highlightCompartmentRef = useRef<Compartment | null>(null);

  const syntaxTheme = useSettingsStore((s) => s.syntaxTheme);
  const docVersion = useEditorStore((s) => s.docVersion);
  const jumpTarget = useEditorStore((s) => s.jumpTarget);
  const clearJump = useEditorStore((s) => s.clearJump);

  // The syntax theme follows the setting and the app's light/dark mode.
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const highlightCompartment = new Compartment();
    highlightCompartmentRef.current = highlightCompartment;
    const view = new EditorView({
      state: EditorState.create({
        doc: useEditorStore.getState().content,
        extensions: [
          basicSetup,
          bibSyntax,
          highlightCompartment.of(
            editorHighlightExtension(
              useSettingsStore.getState().syntaxTheme,
              document.documentElement.classList.contains("dark"),
            ),
          ),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": {
              fontFamily:
                "var(--editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)",
              fontSize: "var(--editor-font-size, 14px)",
            },
          }),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                void useProjectStore.getState().saveActiveFile();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const content = update.state.doc.toString();
            useEditorStore.getState().setContent(content);
            const { activeFile, lastSavedContent } = useProjectStore.getState();
            if (activeFile !== null && content !== lastSavedContent) {
              useProjectStore.getState().markDirty(activeFile, content);
            }
          }),
        ],
      }),
      parent: container,
    });
    viewRef.current = view;

    // Serve edit requests (the References side) as one undoable
    // transaction.
    setApplyEditsHandler((edits) => {
      if (edits.length === 0) return false;
      const length = view.state.doc.length;
      if (edits.some((edit) => edit.from > edit.to || edit.to > length)) return false;
      view.dispatch({
        changes: [...edits].sort((a, b) => a.from - b.from),
        userEvent: "input.editEntry",
      });
      return true;
    });

    return () => {
      setApplyEditsHandler(null);
      view.destroy();
      viewRef.current = null;
      highlightCompartmentRef.current = null;
    };
  }, []);

  useEffect(() => {
    const compartment = highlightCompartmentRef.current;
    const view = viewRef.current;
    if (!compartment || !view) return;
    view.dispatch({
      effects: compartment.reconfigure(editorHighlightExtension(syntaxTheme, isDark)),
    });
  }, [syntaxTheme, isDark]);

  // Resynchronize when a file is loaded externally (tab switch).
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

  // Re-measure when shown again after being hidden.
  useEffect(() => {
    if (visible) viewRef.current?.requestMeasure();
  }, [visible]);

  // Jump requests (e.g. a click in the Bibliography panel) scroll to
  // the entry's line.
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

  return <div ref={containerRef} className="h-full overflow-hidden" />;
}
