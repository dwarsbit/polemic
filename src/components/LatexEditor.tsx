import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorState, Compartment, StateEffect, StateField } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { linter, lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorView, basicSetup } from "codemirror";
import { keymap, Decoration } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { latexAutocompletion } from "@/lib/completion";
import { lineAnchor } from "@/lib/comment-anchor";
import { commentGutter, refreshComments } from "@/lib/comment-gutter";
import {
  addCommentAtCursor,
  openCommentDialog,
  setAddCommentAtCursorHandler,
} from "@/lib/editor-comments";
import { showNativeContextMenu } from "@/lib/native-menu";
import { labelLine, refAt } from "@/lib/label-refs";
import { refLabelLint } from "@/lib/ref-label-lint";
import { setFormatDocumentHandler, formatDocument } from "@/lib/editor-format";
import { editorFontStack } from "@/lib/editor-fonts";
import { editorHighlightExtension } from "@/lib/editor-themes";
import { formatLatex } from "@/lib/latex-format";
import { lineWidthGutter } from "@/lib/line-width-gutter";
import {
  headingLines,
  lineForAnchor,
  lineText,
  setFaceAnchor,
  takeFaceAnchor,
} from "@/lib/visual/face-anchor";
import { mathHover, mathHoverEnabled } from "@/lib/math-hover";
import { envPairing } from "@/lib/env-pairing";
import { gitLineGutter, setGitLines } from "@/lib/git-gutter";
import { lineStatus } from "@/lib/git-line-status";
import { lineOps } from "@/lib/line-ops";
import { tabIndent } from "@/lib/tab-indent";
import { mathPairing } from "@/lib/math-pairing";
import { setInsertHandler } from "@/lib/editor-insert";
import {
  ensurePackages,
  figureScaffold,
  findIncludeGraphics,
  insertPackages,
  setEnsurePackagesHandler,
  setWrapFigureHandler,
  wrapFigure,
  wrapIncludeFigure,
} from "@/lib/editor-figure";
import { insertTikzSnippet } from "@/lib/tikz-snippets";
import { setEditorDropHandler, setEditorDropIndicator } from "@/lib/editor-drag";
import {
  findGraphicsSpanAt,
  parseOptionEntries,
  serializeOptionEntries,
  type GraphicsSpan,
  type OptionEntry,
} from "@/lib/graphics-options";
import { GraphicsOptionsCard } from "@/components/GraphicsOptionsCard";
import { cogHoverField, setCogHover, setCogOpenHandler } from "@/lib/graphics-cog";
import { setRemoveUsepackageHandler } from "@/lib/editor-preamble";
import { setApplyEditsHandler } from "@/lib/editor-edits";
import { planUsepackageRemoval } from "@/lib/packages";
import {
  assetDropText,
  assetKind,
  collectAssetPaths,
  isInsertableGraphics,
  resolveAssetRef,
} from "@/lib/assets";
import { AssetThumb } from "@/components/AssetThumb";
import {
  TEXT_WRAPPERS,
  applyTextWrapper,
  setTextWrapperHandler,
  wrapOrUnwrap,
} from "@/lib/editor-wrappers";
import { useDialogsStore } from "@/store/dialogs";
import {
  clearSpellcheckCache,
  misspelledWordAt,
  runSpellcheck,
  setMisspells,
  spellcheckExtension,
} from "@/lib/spellcheck";
import { resolveVersionControl, useSettingsStore } from "@/store/settings";
import {
  addSpellcheckWord,
  gitShowHead,
  isTauri,
  readProjectFile,
  synctexForward,
} from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { usePreviewStore } from "@/store/preview";
import { useCommentsStore } from "@/store/comments";
import { useProjectStore } from "@/store/project";

interface SpellPopover {
  word: string;
  x: number;
  y: number;
}

/** A mark-decoration field for a temporary span highlight. The range
 *  maps through edits, so it always tracks the current text. */
function spanHighlightField(className: string) {
  const setEffect = StateEffect.define<{ from: number; to: number } | null>();
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      value = value.map(tr.changes);
      for (const effect of tr.effects) {
        if (effect.is(setEffect)) {
          value =
            effect.value === null
              ? Decoration.none
              : Decoration.set([
                  Decoration.mark({ class: className }).range(
                    effect.value.from,
                    effect.value.to,
                  ),
                ]);
        }
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return { setEffect, field };
}

// The solid highlight while the options card is open.
const graphicsCard = spanHighlightField("cm-graphics-assist");
// The underline hint while Cmd/Ctrl-hovering a command.
const graphicsHover = spanHighlightField("cm-graphics-hover");
// The subtle background while hovering a path argument.
const graphicsPath = spanHighlightField("cm-graphics-path");


export function LatexEditor({ visible = true }: { visible?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const highlightCompartmentRef = useRef<Compartment | null>(null);
  const mathHoverCompartmentRef = useRef<Compartment | null>(null);
  const jumpTarget = useEditorStore((s) => s.jumpTarget);
  const clearJump = useEditorStore((s) => s.clearJump);
  const docVersion = useEditorStore((s) => s.docVersion);
  const content = useEditorStore((s) => s.content);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const editorFont = useSettingsStore((s) => s.editorFont);
  const syntaxTheme = useSettingsStore((s) => s.syntaxTheme);
  const mathPreviewEngine = useSettingsStore((s) => s.mathPreviewEngine);
  const spellcheckEnabled = useSettingsStore((s) => s.spellcheckEnabled);
  const spellcheckLanguage = useSettingsStore((s) => s.spellcheckLanguage);
  const issues = usePreviewStore((s) => s.issues);
  const activeFile = useProjectStore((s) => s.activeFile);
  const projectPath = useProjectStore((s) => s.project?.path);
  const files = useProjectStore((s) => s.files);
  // Candidates for resolving an \includegraphics reference to a real
  // previewable file (the reference is often extension-less).
  const imageAssets = useMemo(
    () => collectAssetPaths(files).filter(isInsertableGraphics),
    [files],
  );
  const comments = useCommentsStore((s) => s.comments);
  const versionControl = useSettingsStore((s) => resolveVersionControl(s));
  const [popover, setPopover] = useState<SpellPopover | null>(null);
  const popoverRef = useRef<((p: SpellPopover) => void) | null>(null);
  // The image options card, opened via Cmd/Ctrl+click on the command
  // or its hover cog — never automatically while typing.
  const [graphicsAssist, setGraphicsAssist] = useState<{
    span: GraphicsSpan;
    x: number;
    top: number;
    bottom: number;
  } | null>(null);
  // The command currently underlined by the Cmd/Ctrl hover hint.
  const hoverHighlightRef = useRef<number | null>(null);
  // Guards so the cog/path hover effects only dispatch on change.
  const cogHoverRef = useRef<number | null>(null);
  const pathHoverRef = useRef<number | null>(null);
  // The file-path hover preview (the image/PDF behind an
  // \includegraphics path), shown after the pointer rests on it.
  const [pathPreview, setPathPreview] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
  const pathPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPathPreview = useCallback(() => {
    if (pathPreviewTimerRef.current !== null) {
      clearTimeout(pathPreviewTimerRef.current);
      pathPreviewTimerRef.current = null;
    }
  }, []);
  const hidePathPreview = useCallback(() => {
    cancelPathPreview();
    setPathPreview(null);
  }, [cancelPathPreview]);
  const schedulePathPreview = useCallback(
    (path: string, x: number, y: number) => {
      cancelPathPreview();
      pathPreviewTimerRef.current = setTimeout(() => {
        pathPreviewTimerRef.current = null;
        setPathPreview({ path, x, y });
      }, 550);
    },
    [cancelPathPreview],
  );
  const imageAssetsRef = useRef<string[]>([]);
  useEffect(() => {
    imageAssetsRef.current = imageAssets;
  }, [imageAssets]);

  const showGraphicsAssist = useCallback((span: GraphicsSpan) => {
    const view = viewRef.current;
    if (view === null) return;
    const coords = view.coordsAtPos(span.from);
    if (coords === null) return;
    setGraphicsAssist({
      span,
      x: coords.left,
      top: coords.top,
      bottom: coords.bottom,
    });
    view.dispatch({
      effects: graphicsCard.setEffect.of({ from: span.from, to: span.to }),
    });
  }, []);

  const closeGraphicsAssist = useCallback(() => {
    setGraphicsAssist(null);
    viewRef.current?.dispatch({ effects: graphicsCard.setEffect.of(null) });
  }, []);

  /** Re-anchor the card from the highlight range, which maps through
   *  every change — the single source of truth for the position. */
  const refreshGraphicsAssist = useCallback(() => {
    const view = viewRef.current;
    if (view === null) return;
    const cursor = view.state.field(graphicsCard.field).iter();
    if (cursor.value === null) return;
    const span = findGraphicsSpanAt(
      view.state.doc.toString(),
      Math.floor((cursor.from + cursor.to) / 2),
    );
    const coords = view.coordsAtPos(cursor.from);
    if (span === null || coords === null) {
      closeGraphicsAssist();
      return;
    }
    setGraphicsAssist((prev) =>
      prev === null
        ? prev
        : { span, x: coords.left, top: coords.top, bottom: coords.bottom },
    );
  }, [closeGraphicsAssist]);

  /** Live write-back from the options card: rewrite the [options]
   *  block (inserting or removing it as needed), then re-anchor. The
   *  span is derived from the mapped highlight range — never from
   *  possibly stale render state. */
  const applyGraphicsOptions = useCallback(
    (entries: OptionEntry[]) => {
      const view = viewRef.current;
      if (view === null) return;
      const cursor = view.state.field(graphicsCard.field).iter();
      if (cursor.value === null) return;
      const span = findGraphicsSpanAt(
        view.state.doc.toString(),
        Math.floor((cursor.from + cursor.to) / 2),
      );
      if (span === null) return;
      const serialized = serializeOptionEntries(entries);
      if (span.options !== null) {
        if (serialized.length === 0) {
          // Remove the whole bracket block: "[" sits at options.from - 1,
          // "]" at options.to.
          view.dispatch({
            changes: {
              from: span.options.from - 1,
              to: span.options.to + 1,
              insert: "",
            },
          });
        } else {
          view.dispatch({
            changes: {
              from: span.options.from,
              to: span.options.to,
              insert: serialized,
            },
          });
        }
      } else if (serialized.length > 0) {
        view.dispatch({
          changes: {
            from: span.optionsAt,
            to: span.optionsAt,
            insert: `[${serialized}]`,
          },
        });
      } else {
        return;
      }
      refreshGraphicsAssist();
    },
    [refreshGraphicsAssist],
  );

  useEffect(() => {
    popoverRef.current = (p) => setPopover(p);
  }, []);

  // The syntax theme follows the setting and the app's light/dark mode
  // (the "dark" class applyTheme toggles on the root element).
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
    const compartment = highlightCompartmentRef.current;
    const view = viewRef.current;
    if (!compartment || !view) return;
    view.dispatch({
      effects: compartment.reconfigure(editorHighlightExtension(syntaxTheme, isDark)),
    });
  }, [syntaxTheme, isDark]);

  // Cursor settings: applied to the CodeMirror caret through a CSS
  // variable and root class (see the caret rules in index.css). The
  // line style is a fixed 2px.
  const caretStyle = useSettingsStore((s) => s.caretStyle);
  const caretColor = useSettingsStore((s) => s.caretColor);
  const caretCustomColor = useSettingsStore((s) => s.caretCustomColor);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--caret-color",
      caretColor === "custom" ? caretCustomColor : "var(--primary)",
    );
    root.classList.toggle("caret-style-block", caretStyle === "block");
  }, [caretStyle, caretColor, caretCustomColor]);

  // Comment bars follow the comments and the open file.
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: refreshComments.of(null) });
  }, [comments, activeFile]);

  // Math hover previews follow the engine setting.
  useEffect(() => {
    const compartment = mathHoverCompartmentRef.current;
    const view = viewRef.current;
    if (!compartment || !view) return;
    view.dispatch({
      effects: compartment.reconfigure(
        mathHoverEnabled.of(mathPreviewEngine === "katex"),
      ),
    });
  }, [mathPreviewEngine]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const setContent = useEditorStore.getState().setContent;
    let docMetaTimer: ReturnType<typeof setTimeout> | undefined;
    const highlightCompartment = new Compartment();
    highlightCompartmentRef.current = highlightCompartment;
    const mathHoverCompartment = new Compartment();
    mathHoverCompartmentRef.current = mathHoverCompartment;
    const view = new EditorView({
      state: EditorState.create({
        doc: useEditorStore.getState().content,
        extensions: [
          basicSetup,
          StreamLanguage.define(stex),
          highlightCompartment.of(
            editorHighlightExtension(
              useSettingsStore.getState().syntaxTheme,
              document.documentElement.classList.contains("dark"),
            ),
          ),
          latexAutocompletion,
          envPairing(),
          graphicsCard.field,
          graphicsHover.field,
          graphicsPath.field,
          cogHoverField,
          mathPairing,
          lineOps,
          tabIndent,
          gitLineGutter,
          linter(() => []),
          refLabelLint,
          lintGutter(),
          spellcheckExtension,
          mathHoverCompartment.of(
            mathHoverEnabled.of(
              useSettingsStore.getState().mathPreviewEngine === "katex",
            ),
          ),
          mathHover,
          EditorView.lineWrapping,
          lineWidthGutter,
          commentGutter,
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": {
              fontFamily: "var(--editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)",
              fontSize: "var(--editor-font-size, 14px)",
            },
          }),
          keymap.of([
            {
              key: "Mod-Alt-c",
              run: () => {
                addCommentAtCursor();
                return true;
              },
            },
            {
              key: "Mod-Shift-f",
              run: () => formatDocument(),
            },
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
            {
              key: "Mod-b",
              run: () => {
                applyTextWrapper("bold");
                return true;
              },
            },
            {
              key: "Mod-i",
              run: () => {
                applyTextWrapper("emph");
                return true;
              },
            },
            {
              key: "Mod-u",
              run: () => {
                applyTextWrapper("underline");
                return true;
              },
            },
          ]),
          // Cmd/Ctrl+click in the source: jump to a \ref's \label, or
          // scroll the preview (SyncTeX forward) when not on a ref.
          EditorView.domEventHandlers({
            mousedown(event, view) {
              if (!(event.metaKey || event.ctrlKey)) {
                // A plain click closes the options card.
                if (view.state.field(graphicsCard.field).size > 0) {
                  closeGraphicsAssist();
                }
                return false;
              }
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;

              // An \includegraphics under the cursor opens its
              // options card (the image itself, not the page spot).
              const graphics = findGraphicsSpanAt(
                view.state.doc.toString(),
                pos,
              );
              if (graphics !== null) {
                showGraphicsAssist(graphics);
                return true;
              }

              // A ref under the cursor wins: jump to its label.
              const source = view.state.doc.toString();
              const ref = refAt(source, pos);
              if (ref !== null) {
                void (async () => {
                  const { project, activeFile, labelsByFile, buffers } =
                    useProjectStore.getState();
                  if (!project) return;
                  const file = Object.keys(labelsByFile).find((path) =>
                    labelsByFile[path].includes(ref.name),
                  );
                  if (file === undefined) return; // the lint hint reports it
                  const content =
                    file === activeFile
                      ? source
                      : (buffers[file] ??
                        (await readProjectFile(project.path, file).catch(() => null)));
                  if (content === null || content === undefined) return;
                  const line = labelLine(content, ref.name);
                  if (line === null) return;
                  if (file !== activeFile) {
                    await useProjectStore.getState().openFile(file);
                  }
                  useEditorStore.getState().jumpTo(line);
                })();
                return true;
              }

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
            // Right-click on a misspelled word: offer adding it to the
            // dictionary; otherwise offer adding a comment.
            // A cog hinting at the options card while hovering an
            // \includegraphics command, and a dotted underline while
            // Cmd/Ctrl-hovering one.
            mousemove(event, view) {
              const mod = event.metaKey || event.ctrlKey;
              // Affordance: the modifier makes the editor clickable.
              view.contentDOM.style.cursor = mod ? "pointer" : "";
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              const hit =
                pos === null
                  ? null
                  : findGraphicsSpanAt(view.state.doc.toString(), pos);
              // The inline cog shows while a command is hovered; it
              // sits right after the command, inside the editor, so
              // it is always reachable. The path gets a subtle
              // background while it is hovered.
              const cogWant =
                hit !== null ? { from: hit.from, to: hit.to } : null;
              const pathWant =
                hit !== null &&
                pos !== null &&
                pos >= hit.pathRange.from &&
                pos <= hit.pathRange.to
                  ? { from: hit.pathRange.from, to: hit.pathRange.to }
                  : null;
              if ((cogWant === null) !== (cogHoverRef.current === null)) {
                cogHoverRef.current = cogWant === null ? null : cogWant.from;
                view.dispatch({ effects: setCogHover.of(cogWant) });
              }
              if ((pathWant === null) !== (pathHoverRef.current === null)) {
                pathHoverRef.current =
                  pathWant === null ? null : pathWant.from;
                view.dispatch({ effects: graphicsPath.setEffect.of(pathWant) });
              }
              // Underline hint while the modifier is held.
              const want =
                mod && hit !== null
                  ? { from: hit.from, to: hit.to }
                  : null;
              if (
                (want === null) !== (hoverHighlightRef.current === null) ||
                (want !== null && hoverHighlightRef.current !== want.from)
              ) {
                hoverHighlightRef.current =
                  want === null ? null : want.from;
                view.dispatch({ effects: graphicsHover.setEffect.of(want) });
              }
              // The file-path hover preview: after the pointer rests
              // on a previewable \includegraphics path.
              if (
                hit !== null &&
                pos !== null &&
                pos >= hit.pathRange.from &&
                pos <= hit.pathRange.to
              ) {
                const resolved = resolveAssetRef(
                  hit.path,
                  imageAssetsRef.current,
                );
                if (resolved !== null) {
                  schedulePathPreview(resolved, event.clientX, event.clientY);
                } else {
                  hidePathPreview();
                }
              } else {
                hidePathPreview();
              }
              return false;
            },
            mouseleave() {
              const view = viewRef.current;
              if (view !== null) view.contentDOM.style.cursor = "";
              hidePathPreview();
              if (hoverHighlightRef.current !== null) {
                hoverHighlightRef.current = null;
                viewRef.current?.dispatch({
                  effects: graphicsHover.setEffect.of(null),
                });
              }
              if (cogHoverRef.current !== null) {
                cogHoverRef.current = null;
                viewRef.current?.dispatch({ effects: setCogHover.of(null) });
              }
              if (pathHoverRef.current !== null) {
                pathHoverRef.current = null;
                viewRef.current?.dispatch({
                  effects: graphicsPath.setEffect.of(null),
                });
              }
              return false;
            },
            contextmenu(event, view) {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              const hit = misspelledWordAt(view, pos);
              if (!hit) {
                if (!isTauri()) return false;
                event.preventDefault();
                void showNativeContextMenu([
                  {
                    id: "add-comment",
                    text: "Add Comment",
                    action: addCommentAtCursor,
                  },
                  {
                    id: "add-file-comment",
                    text: "Comment on File",
                    action: () => {
                      const file = useProjectStore.getState().activeFile;
                      if (file !== null) {
                        openCommentDialog({ kind: "new", file, anchor: null });
                      }
                    },
                  },
                  "separator",
                  {
                    id: "insert-table",
                    text: "Insert Table…",
                    action: () =>
                      useDialogsStore.getState().setTableDialogOpen(true),
                  },
                  {
                    id: "wrap-figure",
                    text: "Wrap in Figure",
                    action: () => wrapFigure(),
                  },
                  {
                    id: "insert-tikz",
                    text: "Insert TikZ Picture",
                    action: () => insertTikzSnippet("scaffold"),
                  },
                  {
                    id: "packages",
                    text: "Packages…",
                    action: () =>
                      useDialogsStore.getState().setPackagesDialogOpen(true),
                  },
                ]);
                return true;
              }
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
              // Keep label/ref/cite metadata live (completions and
              // cross-file hints read it), debounced per burst of
              // typing. The file and content are captured, so the
              // refresh stays correct after a tab switch.
              if (docMetaTimer !== undefined) clearTimeout(docMetaTimer);
              docMetaTimer = setTimeout(() => {
                docMetaTimer = undefined;
                if (activeFile !== null) {
                  useProjectStore.getState().refreshDocMeta(activeFile, content);
                }
              }, 300);
              // Keep the options card anchored while its text moves.
              if (update.state.field(graphicsCard.field).size > 0) {
                refreshGraphicsAssist();
              }
              // Text edits move the hover-preview anchor; hide it.
              hidePathPreview();
            }
          }),
        ],
      }),
      parent: container,
    });
    viewRef.current = view;
    // Keep the options card anchored while the editor scrolls.
    view.scrollDOM.addEventListener("scroll", refreshGraphicsAssist);
    // Serve the keymap, command palette, menu item, and format-on-save:
    // apply the formatter to the live document (single undoable change).
    setFormatDocumentHandler(() => {
      const activeFile = useProjectStore.getState().activeFile;
      if (!activeFile?.endsWith(".tex")) return false;
      const current = view.state.doc.toString();
      const formatted = formatLatex(current);
      if (formatted === current) return false;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: formatted },
      });
      return true;
    });
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
    // Serve "Wrap in Figure": wrap the \includegraphics at the cursor
    // (a scaffold when none is found) in a figure environment.
    setWrapFigureHandler(() => {
      const doc = view.state.doc.toString();
      const pos = view.state.selection.main.head;
      const hit = findIncludeGraphics(doc, pos);
      const insert = hit
        ? wrapIncludeFigure(doc.slice(hit.from, hit.to), hit.path)
        : figureScaffold();
      view.dispatch({
        changes: { from: hit ? hit.from : pos, to: hit ? hit.to : pos, insert },
        selection: { anchor: (hit ? hit.from : pos) + insert.length },
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      return true;
    });
    // Serve preamble management: add missing \usepackage lines.
    setEnsurePackagesHandler((packages) => {
      const doc = view.state.doc.toString();
      const next = insertPackages(doc, packages);
      if (next === doc) return;
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: next },
        userEvent: "input.paste",
      });
    });
    // Serve the toolbar and B/I/U shortcuts: toggle the wrapper
    // around the selection, caret inside when nothing is selected.
    setTextWrapperHandler((wrapper) => {
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      const result = wrapOrUnwrap(selected, TEXT_WRAPPERS[wrapper]);
      view.dispatch({
        changes: { from, to, insert: result.text },
        selection: { anchor: from + (result.cursor ?? result.text.length) },
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      view.focus();
    });
    // Serve comment creation: anchor to the selection or the line.
    setAddCommentAtCursorHandler(() => {
      const file = useProjectStore.getState().activeFile;
      if (file === null) return;
      const selection = view.state.selection.main;
      const line = view.state.doc.lineAt(selection.head).number;
      const anchor = !selection.empty
        ? {
            text: view.state.sliceDoc(selection.from, selection.to),
            line,
          }
        : lineAnchor(view.state.doc.toString(), line);
      openCommentDialog({ kind: "new", file, anchor });
    });
    // Serve asset drops (pointer drags and OS drag-in): insert a
    // figure/input at the drop position, on its own line.
    const insertDropped = (x: number, y: number, paths: string[]) => {
      const siblings = collectAssetPaths(useProjectStore.getState().files)
        .filter(isInsertableGraphics);
      const drops = paths.map((path) => assetDropText(path, siblings));
      ensurePackages([...new Set(drops.flatMap((drop) => drop.packages))]);
      const pos = view.posAtCoords({ x, y });
      if (pos === null) return;
      const line = view.state.doc.lineAt(pos);
      const insert = `\n${drops.map((drop) => drop.text).join("\n")}`;
      view.dispatch({
        changes: { from: line.to, to: line.to, insert },
        selection: { anchor: line.to + insert.length },
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      view.focus();
    };
    setEditorDropHandler((x, y, paths) => insertDropped(x, y, paths));
    // Drop indicator: a thin line at the insertion boundary while a
    // drag hovers the editor (the ghost chip alone is not enough).
    const indicator = document.createElement("div");
    indicator.style.cssText =
      "position:fixed;pointer-events:none;z-index:40;height:2px;" +
      "border-radius:9999px;background:var(--muted-foreground);opacity:0.7;";
    indicator.style.display = "none";
    document.body.appendChild(indicator);
    const showIndicator = (x: number | null, y: number) => {
      if (x === null) {
        indicator.style.display = "none";
        return;
      }
      const pos = view.posAtCoords({ x, y });
      if (pos === null) {
        indicator.style.display = "none";
        return;
      }
      // The insertion lands at the end of the line under the pointer;
      // a gray rounded line marks the boundary.
      const line = view.state.doc.lineAt(pos);
      const end = view.coordsAtPos(line.to);
      const start = view.coordsAtPos(line.from);
      if (end === null || start === null) {
        indicator.style.display = "none";
        return;
      }
      const right = view.dom.getBoundingClientRect().right;
      indicator.style.display = "block";
      indicator.style.top = `${end.bottom - 1}px`;
      indicator.style.left = `${start.left}px`;
      indicator.style.width = `${Math.max(40, right - start.left)}px`;
    };
    setEditorDropIndicator(showIndicator);
    // Serve the package manager: remove a \usepackage from the doc.
    setRemoveUsepackageHandler((name) => {
      const doc = view.state.doc.toString();
      const plan = planUsepackageRemoval(doc, name);
      if (plan === null) return false;
      view.dispatch({
        changes: { from: plan.from, to: plan.to, insert: plan.insert },
        userEvent: "delete",
      });
      return true;
    });
    // Serve the label manager: apply a rename plan's edits for the
    // active document in one undoable transaction.
    setApplyEditsHandler((edits) => {
      if (edits.length === 0) return false;
      const length = view.state.doc.length;
      if (edits.some((edit) => edit.from > edit.to || edit.to > length)) return false;
      view.dispatch({
        changes: [...edits].sort((a, b) => a.from - b.from),
        userEvent: "input.renameLabel",
      });
      return true;
    });
    // Serve the inline image-options cog: open the card for the
    // command the cog is attached to.
    setCogOpenHandler(() => {
      const view = viewRef.current;
      if (view === null) return;
      const cursor = view.state.field(cogHoverField).iter();
      if (cursor.value === null) return;
      const span = findGraphicsSpanAt(
        view.state.doc.toString(),
        Math.floor((cursor.from + cursor.to) / 2),
      );
      if (span !== null) showGraphicsAssist(span);
    });
    // OS drag-in (Finder → editor): files outside the project are
    // copied into assets/ first (import_assets passes in-project files
    // through); drops outside the editor are ignored. The drag-over
    // events drive the same drop indicator.
    let unlistenDrag: (() => void) | undefined;
    if (isTauri()) {
      void (async () => {
        try {
          const [{ getCurrentWebview }, { importAssets }] = await Promise.all([
            import("@tauri-apps/api/webview"),
            import("@/lib/tauri"),
          ]);
          unlistenDrag = await getCurrentWebview().onDragDropEvent((event) => {
            const scale = window.devicePixelRatio || 1;
            if (event.payload.type === "leave") {
              showIndicator(null, 0);
              return;
            }
            if (event.payload.type === "over" || event.payload.type === "enter") {
              const { position } = event.payload;
              const x = position.x / scale;
              const y = position.y / scale;
              const target = document.elementFromPoint(x, y);
              const over =
                target !== null && target.closest(".cm-editor") !== null;
              showIndicator(over ? x : null, y);
              return;
            }
            if (event.payload.type !== "drop") return;
            showIndicator(null, 0);
            const { paths, position } = event.payload;
            const x = position.x / scale;
            const y = position.y / scale;
            const target = document.elementFromPoint(x, y);
            if (target === null || target.closest(".cm-editor") === null) return;
            const { project } = useProjectStore.getState();
            if (project === null || paths.length === 0) return;
            void importAssets(project.path, paths)
              .then((rel) => {
                insertDropped(x, y, rel);
                void useProjectStore.getState().refreshFiles();
              })
              .catch(() => undefined);
          });
        } catch {
          // Drag-in unavailable in this environment.
        }
      })();
    }
    return () => {
      setInsertHandler(null);
      setWrapFigureHandler(null);
      setEnsurePackagesHandler(null);
      setTextWrapperHandler(null);
      setFormatDocumentHandler(null);
      setAddCommentAtCursorHandler(null);
      setEditorDropHandler(null);
      setEditorDropIndicator(null);
      setCogOpenHandler(null);
      setRemoveUsepackageHandler(null);
      setApplyEditsHandler(null);
      if (docMetaTimer !== undefined) clearTimeout(docMetaTimer);
      indicator.remove();
      unlistenDrag?.();
      view.scrollDOM.removeEventListener("scroll", refreshGraphicsAssist);
      setGraphicsAssist(null);
      view.destroy();
      viewRef.current = null;
      cancelPathPreview();
    };
    // Stable via useCallback; the effect runs once.
  }, [
    showGraphicsAssist,
    closeGraphicsAssist,
    refreshGraphicsAssist,
    schedulePathPreview,
    hidePathPreview,
    cancelPathPreview,
  ]);

  // Resynchronize the document when a file is loaded externally.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const content = useEditorStore.getState().content;
    if (content !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
      // Restore the cursor's place after a Visual-face round trip.
      const anchor = takeFaceAnchor();
      if (anchor !== null) {
        const line = lineForAnchor(view.state.doc.toString(), anchor);
        if (line !== null) {
          const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
          view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
        }
      }
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

  // Re-measure when shown again after being hidden behind the
  // Visual face (the view stays mounted so undo history survives);
  // hand the visual face the cursor's place when leaving.
  useEffect(() => {
    if (visible) {
      viewRef.current?.requestMeasure();
      return;
    }
    const view = viewRef.current;
    if (view === null) return;
    const content = view.state.doc.toString();
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    const headings = headingLines(content);
    setFaceAnchor({
      headingIndex: Math.max(headings.filter((l) => l <= line).length - 1, 0),
      text: lineText(content, line),
    });
  }, [visible]);

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
      style={
        {
          "--editor-font-size": `${fontSize}px`,
          "--editor-font-family": editorFontStack(editorFont),
        } as React.CSSProperties
      }
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
      {pathPreview && (
        <div
          className="fixed z-40 w-fit rounded-xl border bg-card p-1.5 shadow-md"
          style={{
            left: Math.min(pathPreview.x + 14, window.innerWidth - 296),
            top: Math.min(pathPreview.y + 18, window.innerHeight - 216),
          }}
        >
          <AssetThumb
            path={pathPreview.path}
            kind={assetKind(pathPreview.path)}
            fit="shrink"
          />
        </div>
      )}
      {graphicsAssist && (
        <GraphicsOptionsCard
          x={Math.min(graphicsAssist.x, window.innerWidth - 300)}
          anchorTop={graphicsAssist.top}
          anchorBottom={graphicsAssist.bottom}
          path={graphicsAssist.span.path}
          previewPath={resolveAssetRef(graphicsAssist.span.path, imageAssets)}
          entries={
            graphicsAssist.span.options !== null
              ? parseOptionEntries(
                  content.slice(
                    graphicsAssist.span.options.from,
                    graphicsAssist.span.options.to,
                  ),
                )
              : []
          }
          onChange={applyGraphicsOptions}
          onClose={closeGraphicsAssist}
        />
      )}
    </div>
  );
}
