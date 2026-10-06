import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import {
  Bold,
  ChevronDown,
  Italic,
  List,
  ListOrdered,
  Pi,
  Plus,
  Redo2,
  Sigma,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { insertAtCursor, setInsertHandler } from "@/lib/editor-insert";
import {
  HEADING_KINDS,
  INSERT_QUOTE_ENVS,
  addNewtheorem,
  ensurePackage,
  insertEnvBlock,
  insertMaketitle,
  insertTheoremEnvEntries,
  setHeadingKind,
  visualTexExtensions,
} from "@/lib/visual/extensions";
import {
  posForAnchor,
  anchorForLine,
  setFaceAnchor,
  takeFaceAnchor,
  type FaceAnchor,
} from "@/lib/visual/face-anchor";
import { fragmentToContent, looksLikeLatex } from "@/lib/visual/insert";
import { setPendingSerializeFlush } from "@/lib/visual/pending-serialize";
import { parseTex } from "@/lib/visual/parse";
import { serializeTex } from "@/lib/visual/serialize";
import type { DocNode } from "@/lib/visual/doc-types";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

/** The cursor's place in the document, for face switches. */
function anchorFromDoc(editor: NonNullable<ReturnType<typeof useEditor>>): FaceAnchor {
  const pos = editor.state.selection.from;
  let headingIndex = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (node.type.name === "heading" && nodePos < pos) headingIndex++;
    return true;
  });
  const parent = editor.state.doc.resolve(pos).parent;
  const text =
    parent.type.name === "paragraph" || parent.type.name === "heading"
      ? parent.textContent.slice(0, 60)
      : "";
  return { headingIndex: Math.max(headingIndex, 0), text };
}

/** The visual document for a source; never empty (ProseMirror needs a block). */
function docFromTex(src: string): JSONContent {
  const doc = parseTex(src) as unknown as JSONContent;
  if ((doc.content ?? []).length === 0) {
    return { ...doc, content: [{ type: "paragraph" }] };
  }
  return doc;
}

/** Select a just-inserted atom so its raw editor opens right away. */
function selectInserted(editor: Editor, type: string) {
  editor
    .chain()
    .command(({ tr }) => {
      const pos = tr.selection.from - 1;
      const node = tr.doc.nodeAt(pos);
      if (node !== null && node.type.name === type) {
        tr.setSelection(NodeSelection.create(tr.doc, pos));
        return true;
      }
      return false;
    })
    .run();
}

/** Float scaffolds the Insert menu offers; they go through the panel
 *  insert path, so they parse into figure/table blocks. */
const FIGURE_SCAFFOLD = [
  "\\begin{figure}",
  "  \\centering",
  "  \\includegraphics[width=0.6\\textwidth]{}",
  "  \\caption{}",
  "\\end{figure}",
].join("\n");
const TABLE_SCAFFOLD = [
  "\\begin{table}",
  "  \\centering",
  "  \\begin{tabular}{ll}",
  "    a & b \\\\",
  "  \\end{tabular}",
  "  \\caption{}",
  "\\end{table}",
].join("\n");

/** A menu entry for an environment: inside that env it lifts (the old
 *  quote button's toggle), otherwise it inserts context-dependently. */
function insertEnvMenuEntry(editor: Editor, env: string) {
  if (editor.isActive("envBlock", { env })) {
    editor.chain().focus().lift("envBlock").run();
    return;
  }
  insertEnvBlock(editor, env);
}

function VisualToolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      headingCmd: (editor.getAttributes("heading").cmd as string | undefined) ?? null,
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      code: editor.isActive("code"),
      underline: editor.isActive("underline"),
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  });

  // The theorem section covers \newtheorem-declared envs live.
  const theoremEnvs = useEditorState({
    editor,
    selector: ({ editor }) => insertTheoremEnvEntries(editor),
  });

  // The New theorem environment dialog.
  const [theoremOpen, setTheoremOpen] = useState(false);
  const [theoremEnv, setTheoremEnv] = useState("");
  const [theoremName, setTheoremName] = useState("");
  const [theoremInstance, setTheoremInstance] = useState(true);
  const [theoremError, setTheoremError] = useState<string | null>(null);

  const toggle = (fn: () => void) => () => {
    fn();
    editor.commands.focus();
  };

  const headingLabel =
    HEADING_KINDS.find((k) => k.cmd === active?.headingCmd)?.label ?? "Body text";

  const insertFootnote = () => {
    editor
      .chain()
      .focus()
      .insertContent({ type: "footnote", attrs: { src: "\\footnote{}" } })
      .run();
    selectInserted(editor, "footnote");
  };

  const insertDisplayMath = () => {
    editor
      .chain()
      .focus()
      .insertContent({ type: "mathBlock", attrs: { src: "\\[\\]" } })
      .run();
    selectInserted(editor, "mathBlock");
  };

  function commitNewtheorem() {
    const env = theoremEnv.trim();
    if (!/^[a-zA-Z]+$/.test(env)) {
      setTheoremError("The environment name may only use letters.");
      return;
    }
    if ((theoremEnvs ?? []).some((entry) => entry.env === env)) {
      setTheoremError(`"${env}" is already declared.`);
      return;
    }
    if (!addNewtheorem(editor, env, theoremName)) {
      setTheoremError("This file has no preamble to hold the declaration.");
      return;
    }
    if (theoremInstance) insertEnvBlock(editor, env);
    setTheoremOpen(false);
    setTheoremEnv("");
    setTheoremName("");
    setTheoremError(null);
    editor.commands.focus();
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
            <Plus className="size-3.5" />
            Insert
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[28rem] overflow-y-auto">
          <DropdownMenuLabel>Environments</DropdownMenuLabel>
          {INSERT_QUOTE_ENVS.map((entry) => (
            <DropdownMenuItem
              key={entry.env}
              onSelect={toggle(() => insertEnvMenuEntry(editor, entry.env))}
            >
              {entry.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Theorem environments</DropdownMenuLabel>
          {(theoremEnvs ?? []).map((entry) => (
            <DropdownMenuItem
              key={entry.env}
              onSelect={toggle(() => {
                ensurePackage(editor, "amsthm");
                insertEnvMenuEntry(editor, entry.env);
              })}
            >
              {entry.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Inline &amp; floats</DropdownMenuLabel>
          <DropdownMenuItem onSelect={toggle(insertFootnote)}>
            Footnote — \footnote
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggle(insertDisplayMath)}>
            Display math — \[…\]
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggle(() => insertAtCursor(FIGURE_SCAFFOLD))}>
            Figure
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggle(() => insertAtCursor(TABLE_SCAFFOLD))}>
            Table
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTheoremOpen(true)}>
            New theorem environment…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={theoremOpen} onOpenChange={setTheoremOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New theorem environment</DialogTitle>
            <DialogDescription>
              Declares \newtheorem in the preamble; amsthm loads when missing.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="theorem-env" className="text-xs text-muted-foreground">
                Environment name
              </label>
              <Input
                id="theorem-env"
                autoFocus
                value={theoremEnv}
                placeholder="exercise"
                onChange={(e) => {
                  setTheoremEnv(e.target.value);
                  setTheoremError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitNewtheorem();
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="theorem-name" className="text-xs text-muted-foreground">
                Display name
              </label>
              <Input
                id="theorem-name"
                value={theoremName}
                placeholder="Exercise (default: capitalized name)"
                onChange={(e) => {
                  setTheoremName(e.target.value);
                  setTheoremError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitNewtheorem();
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="theorem-instance"
                checked={theoremInstance}
                onCheckedChange={setTheoremInstance}
              />
              <label htmlFor="theorem-instance" className="text-xs text-muted-foreground">
                Insert an instance right away
              </label>
            </div>
            {theoremError !== null && (
              <p className="text-xs text-destructive">{theoremError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTheoremOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={commitNewtheorem}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Separator orientation="vertical" className="h-5" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
            {headingLabel}
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={active?.headingCmd ?? ""}>
            {HEADING_KINDS.map((kind) => (
              <DropdownMenuRadioItem
                key={kind.cmd}
                value={kind.cmd}
                onSelect={() => setHeadingKind(editor, kind)}
              >
                {kind.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setHeadingKind(editor, null)}>
            Body text
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="h-5" />
      <ButtonGroup>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Undo (Cmd/Ctrl + Z)"
          disabled={!active?.canUndo}
          onClick={toggle(() => editor.chain().undo().run())}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Redo (Cmd/Ctrl + Shift + Z)"
          disabled={!active?.canRedo}
          onClick={toggle(() => editor.chain().redo().run())}
        >
          <Redo2 className="size-4" />
        </Button>
      </ButtonGroup>
      <Separator orientation="vertical" className="h-5" />
      <ButtonGroup>
        <Button
          variant={active?.bold ? "secondary" : "ghost"}
          size="icon-sm"
          title="Bold — \\textbf (Cmd/Ctrl + B)"
          onClick={toggle(() => editor.chain().toggleBold().run())}
        >
          <Bold className="size-4" />
        </Button>
        <Button
          variant={active?.italic ? "secondary" : "ghost"}
          size="icon-sm"
          title="Emphasis — \\emph (Cmd/Ctrl + I)"
          onClick={toggle(() => editor.chain().toggleItalic().run())}
        >
          <Italic className="size-4" />
        </Button>
        <Button
          variant={active?.underline ? "secondary" : "ghost"}
          size="icon-sm"
          title="Underline — \\underline (Cmd/Ctrl + U)"
          onClick={toggle(() => editor.chain().toggleUnderline().run())}
        >
          <Underline className="size-4" />
        </Button>
        <Button
          variant={active?.code ? "secondary" : "ghost"}
          size="icon-sm"
          title="Monospace — \\texttt"
          onClick={toggle(() => editor.chain().toggleCode().run())}
        >
          <Type className="size-4" />
        </Button>
      </ButtonGroup>
      <Separator orientation="vertical" className="h-5" />
      <ButtonGroup>
        <Button
          variant={active?.bullet ? "secondary" : "ghost"}
          size="icon-sm"
          title="Bulleted list (itemize)"
          onClick={toggle(() => editor.chain().toggleBulletList().run())}
        >
          <List className="size-4" />
        </Button>
        <Button
          variant={active?.ordered ? "secondary" : "ghost"}
          size="icon-sm"
          title="Numbered list (enumerate)"
          onClick={toggle(() => editor.chain().toggleOrderedList().run())}
        >
          <ListOrdered className="size-4" />
        </Button>
      </ButtonGroup>
      <Separator orientation="vertical" className="h-5" />
      <ButtonGroup>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Inline math — $…$ (or just type it)"
          onClick={() => {
            editor
              .chain()
              .focus()
              .insertContent({ type: "mathInline", attrs: { src: "$x$" } })
              .run();
            selectInserted(editor, "mathInline");
          }}
        >
          <Sigma className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Display math"
          onClick={() => {
            editor
              .chain()
              .focus()
              .insertContent({ type: "mathBlock", attrs: { src: "\\[\\]" } })
              .run();
            selectInserted(editor, "mathBlock");
          }}
        >
          <Pi className="size-4" />
        </Button>
      </ButtonGroup>
    </div>
  );
}

/**
 * The Visual face of a .tex file: the document rendered as rich text,
 * with the TeX regenerated from it on every edit (Overleaf's rich-text
 * model). Content flows through the shared editor store, so dirty
 * state, saving, and the Code face stay exactly as they are.
 */
export function VisualTexEditor() {
  const docVersion = useEditorStore((s) => s.docVersion);
  // Content at entry: if visual edits changed it, the Code face
  // resyncs on the way back (its docVersion effect replaces the doc).
  const [entryContent] = useState(() => useEditorStore.getState().content);
  const anchorRef = useRef<FaceAnchor>({ headingIndex: 0, text: "" });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        document: false,
        heading: false,
        listItem: false,
        hardBreak: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        strike: false,
      }),
      ...visualTexExtensions,
    ],
    content: docFromTex(entryContent),
    editorProps: {
      // Pasted LaTeX becomes nodes, not literal text.
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (text.length === 0 || !looksLikeLatex(text)) return false;
        const content = fragmentToContent(text);
        if (content.length === 0) return false;
        editor?.commands.insertContent(content);
        return true;
      },
    },
    onSelectionUpdate: ({ editor }) => {
      anchorRef.current = anchorFromDoc(editor);
    },
    onUpdate: ({ editor }) => {
      anchorRef.current = anchorFromDoc(editor);
    },
  });

  // Serializing the document to TeX is whole-document work; the store
  // copy lags at most the delay behind the editor. The anchor stays
  // immediate (onUpdate above), and this effect's cleanup flushes on
  // unmount — before the leaving-face resync reads the store. Saves
  // and buffer flushes call the flush through the registry first.
  useEffect(() => {
    if (editor === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const tex = serializeTex(editor.getJSON() as unknown as DocNode);
      useEditorStore.getState().setContent(tex);
      const { activeFile, lastSavedContent } = useProjectStore.getState();
      if (activeFile !== null && tex !== lastSavedContent) {
        useProjectStore.getState().markDirty(activeFile, tex);
      }
    };
    const previous = setPendingSerializeFlush(flush);
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, 300);
    };
    editor.on("update", schedule);
    return () => {
      editor.off("update", schedule);
      flush();
      setPendingSerializeFlush(previous);
    };
  }, [editor]);

  // External reloads (file open, tab switch) reparse into the editor.
  // setContent emits an update by default in v3 — that would mark the
  // file dirty just for looking at it, so the resync stays silent.
  // A reload of the same file keeps the cursor's place (the anchor
  // re-resolves in the reparsed document); a different file starts
  // at the top.
  const lastFileRef = useRef<string | null>(null);
  useEffect(() => {
    if (editor === null || editor.isDestroyed) return;
    const store = useEditorStore.getState();
    const activeFile = useProjectStore.getState().activeFile;
    const sameFile = activeFile !== null && activeFile === lastFileRef.current;
    const anchor = sameFile ? anchorRef.current : null;
    editor.commands.setContent(docFromTex(store.content), { emitUpdate: false });
    lastFileRef.current = activeFile;
    if (anchor !== null) {
      const pos = posForAnchor(editor.state.doc, anchor);
      if (pos !== null) editor.commands.setTextSelection(pos);
    }
  }, [docVersion, editor]);

  // Panel jumps (labels, search, issues, outline) land in this face
  // when it is the active one; the source line maps onto the document
  // through the face anchor, approximately.
  const jumpTarget = useEditorStore((s) => s.jumpTarget);
  useEffect(() => {
    if (editor === null || editor.isDestroyed) return;
    const line = useEditorStore.getState().jumpTarget;
    if (line === null) return;
    const { content, clearJump } = useEditorStore.getState();
    const anchor = anchorForLine(content, line);
    const pos = posForAnchor(editor.state.doc, anchor);
    if (pos !== null) {
      editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
    }
    clearJump();
  }, [jumpTarget, editor]);

  // Serve panel/dialog inserts: LaTeX fragments parse into nodes
  // (figures, pills, lists), math symbols become inline math.
  useEffect(() => {
    if (editor === null) return;
    const previous = setInsertHandler((text, _cursorOffset, opts) => {
      if (opts?.asMath === true) {
        editor
          .chain()
          .focus()
          .insertContent({ type: "mathInline", attrs: { src: `$${text}$` } })
          .run();
        return;
      }
      if (!looksLikeLatex(text)) {
        editor.chain().focus().insertContent(text).run();
        return;
      }
      editor.chain().focus().insertContent(fragmentToContent(text)).run();
    });
    return () => {
      setInsertHandler(previous);
    };
  }, [editor]);

  // Entering the visual face: land where the code cursor was.
  useEffect(() => {
    if (editor === null || editor.isDestroyed) return;
    const anchor = takeFaceAnchor();
    if (anchor === null) return;
    const pos = posForAnchor(editor.state.doc, anchor);
    if (pos !== null) editor.commands.setTextSelection(pos);
  }, [editor]);

  // Leaving the visual face: hand the regenerated TeX to CodeMirror,
  // with the cursor's place for the resync to restore.
  useEffect(() => {
    return () => {
      const store = useEditorStore.getState();
      if (store.content !== entryContent) {
        setFaceAnchor(anchorRef.current);
        store.loadContent(store.content);
      }
    };
  }, [entryContent]);

  const rawCount = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (editor === null) return 0;
      let count = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "rawTexBlock" || node.type.name === "rawTexInline") count++;
        return true;
      });
      return count;
    },
  });

  // Title metadata without a \maketitle to render it: offer to add one.
  const missingMaketitle = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (editor === null) return false;
      let hasMeta = false;
      let hasTitleBlock = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "titleBlock") hasTitleBlock = true;
        if (
          node.type.name === "preamble" &&
          (node.attrs.titleSrc !== null ||
            node.attrs.authorSrc !== null ||
            node.attrs.dateSrc !== null)
        ) {
          hasMeta = true;
        }
        return true;
      });
      return hasMeta && !hasTitleBlock;
    },
  });

  const fontSize = useSettingsStore((s) => s.fontSize);
  const spellcheckEnabled = useSettingsStore((s) => s.spellcheckEnabled);
  const spellcheckLanguage = useSettingsStore((s) => s.spellcheckLanguage);

  if (editor === null) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <VisualToolbar editor={editor} />
      {(rawCount ?? 0) > 0 && (
        <p className="shrink-0 border-b bg-accent/40 px-3 py-1 text-xs text-muted-foreground">
          Some constructs are shown as raw LaTeX — edit them in place
          with a double-click, or switch to Code.
        </p>
      )}
      {missingMaketitle === true && (
        <p className="flex shrink-0 items-center gap-2 border-b bg-accent/40 px-3 py-1 text-xs text-muted-foreground">
          Title metadata is defined but nothing renders it.
          <Button
            variant="outline"
            size="sm"
            className="h-5 px-1.5 text-xs"
            onClick={() => insertMaketitle(editor)}
          >
            Insert \maketitle
          </Button>
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The settings' font size drives the reading column (like the
            Code face); native spellcheck covers prose — atom node views
            (pills, math, raw) opt out in their own DOM. */}
        <div
          className="visual-editor mx-auto max-w-3xl px-8 py-6"
          style={{ "--editor-font-size": `${fontSize}px` } as React.CSSProperties}
          spellCheck={spellcheckEnabled}
          lang={spellcheckLanguage.length > 0 ? spellcheckLanguage : undefined}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
