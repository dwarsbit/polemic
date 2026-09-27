import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { synctexForward } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

export function LatexEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const jumpTarget = useEditorStore((s) => s.jumpTarget);
  const clearJump = useEditorStore((s) => s.clearJump);
  const docVersion = useEditorStore((s) => s.docVersion);

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
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": {
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setContent(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: container,
    });
    viewRef.current = view;
    return () => {
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
