/**
 * The Tiptap extension set for the visual (.tex) editor.
 *
 * Everything here mirrors the JSON contract of `parseTex` /
 * `serializeTex`. Modelled content is real Tiptap nodes; everything
 * else is an atom carrying its exact LaTeX source in a `src` attr,
 * shown as raw text that becomes editable in place (double-click, or
 * selection for math — the Overleaf pattern).
 */

import {
  Extension,
  InputRule,
  Node,
  mergeAttributes,
  textblockTypeInputRule,
  type Editor,
  type NodeViewRendererProps,
} from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Heading } from "@tiptap/extension-heading";
import { ListItem } from "@tiptap/extension-list-item";
import {
  NodeSelection,
  TextSelection,
  Plugin,
  type Transaction,
} from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  Decoration,
  DecorationSet,
  type NodeView,
  type ViewMutationRecord,
} from "@tiptap/pm/view";
import type { PreambleAttrs } from "./doc-types";
import { REF_CMDS, THEOREM_ENVS } from "./parse";
import { assetKind } from "@/lib/assets";
import { includeInSnippet } from "@/lib/doc-structure";
import { openIncludeTarget } from "@/lib/include-nav";
import { parseTable, tableAt, type TableGrid } from "@/lib/table-grid";
import { useDialogsStore } from "@/store/dialogs";
import { showNativeContextMenu, type NativeMenuEntry } from "@/lib/native-menu";
import { runPanelCommand } from "@/lib/panel-commands";
import { readAsset, readProjectFile, type FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { renderMathHtml, splitMathSrc } from "./math-render";

// ---------------------------------------------------------------------------
// Generic editable-raw node view

interface RawViewSpec {
  className: string;
  /** The text offered for editing (full source, or the math body). */
  editText(src: string): string;
  /** Rebuild the source from edited text. */
  buildSrc(oldSrc: string, text: string): string;
  /** Enter editing when the node is (node-)selected, not on dblclick. */
  editOnSelect?: boolean;
  /** Preview element; defaults to the raw-source look. */
  preview?: (src: string) => HTMLElement;
  /** A context menu for the node, or null for the native default. */
  contextMenu?: (src: string) => NativeMenuEntry[] | null;
  /** Cmd/Ctrl+click on the preview, with the clicked offset into the
   *  source when known; true when handled. */
  modClick?: (src: string, offset: number | null) => boolean;
}

/**
 * An atom node view with a raw-source editing mode: a preview that
 * flips into a contenteditable div carrying the exact LaTeX. Commits
 * on blur or Escape as a single node-attr transaction, so undo stays
 * one step.
 */
class EditableRawView implements NodeView {
  dom: HTMLElement;
  protected editor: Editor;
  protected node: PMNode;
  protected getPos: () => number | undefined;
  private spec: RawViewSpec;
  private editing = false;
  private editable: HTMLDivElement | null = null;

  constructor(
    editor: Editor,
    node: PMNode,
    getPos: () => number | undefined,
    spec: RawViewSpec,
  ) {
    this.editor = editor;
    this.node = node;
    this.getPos = getPos;
    this.spec = spec;
    this.dom = document.createElement(node.isInline ? "span" : "div");
    this.dom.className = spec.className;
    // LaTeX, not prose: native spellcheck skips the atom entirely
    // (its raw editor opts out on its own).
    this.dom.setAttribute("spellcheck", "false");
    this.render();
    this.dom.addEventListener("dblclick", (event) => {
      // Double-clicks inside an in-place input (e.g. a meta pill's)
      // are the input's business — word selection, not raw editing.
      if ((event.target as HTMLElement | null)?.tagName === "INPUT") {
        return;
      }
      this.startEditing();
    });
    if (spec.modClick !== undefined) {
      // Ahead of ProseMirror's own mousedown (on an ancestor), which
      // would node-select the atom.
      this.dom.addEventListener("mousedown", (event) => {
        if (this.editing || !(event.metaKey || event.ctrlKey)) return;
        const offset = sourceOffsetAt(this.dom, event.clientX, event.clientY);
        if (spec.modClick?.(this.node.attrs.src, offset)) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
    }
    if (spec.contextMenu !== undefined) {
      this.dom.addEventListener("contextmenu", (event) => {
        const items = spec.contextMenu?.(this.node.attrs.src);
        if (items === null || items === undefined || items.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        void showNativeContextMenu(items);
      });
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const srcChanged = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    if (!this.editing && srcChanged) this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add("vis-selected");
    if (this.spec.editOnSelect) this.startEditing();
  }

  deselectNode() {
    this.dom.classList.remove("vis-selected");
    if (this.spec.editOnSelect) this.stopEditing();
  }

  stopEvent(event: Event): boolean {
    // Escape cancels the raw editor first — its editable is covered
    // by the in-place guard below, but it must keep its shortcut.
    if (this.editing && event instanceof KeyboardEvent && event.key === "Escape") {
      this.stopEditing();
      return true;
    }
    // The in-place editors of meta pills (the preamble card's
    // Title/Author/Date) manage their own events; letting them
    // through makes ProseMirror act on the node selection and eat
    // the whole node.
    const target = event.target as HTMLElement | null;
    if (target !== null && this.dom.contains(target)) {
      if (target.tagName === "INPUT" || target.isContentEditable) {
        return true;
      }
    }
    if (!this.editing) return false;
    return this.dom.contains(event.target as globalThis.Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {}

  /** The preview element for a source (subclass hook). */
  protected preview(src: string): HTMLElement {
    const pre = document.createElement(nodeIsInline(this.node) ? "span" : "pre");
    pre.className = "vis-raw-src";
    pre.textContent = src;
    return pre;
  }

  private render() {
    const src = this.node.attrs.src;
    this.dom.replaceChildren(
      this.spec.preview !== undefined ? this.spec.preview(src) : this.preview(src),
    );
  }

  /** Re-render the preview (subclass state changes, e.g. collapsing). */
  protected refresh() {
    if (!this.editing) this.render();
  }

  private startEditing() {
    if (this.editing) return;
    this.editing = true;
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.className = "vis-raw-edit";
    editable.setAttribute("spellcheck", "false");
    editable.textContent = this.spec.editText(this.node.attrs.src);
    editable.addEventListener("blur", () => this.stopEditing());
    this.dom.replaceChildren(editable);
    this.editable = editable;
    queueMicrotask(() => editable.focus());
  }

  private stopEditing() {
    if (!this.editing) return;
    const text = this.editable?.innerText ?? "";
    this.editable = null;
    this.editing = false;
    const src = this.spec.buildSrc(this.node.attrs.src, text);
    const pos = this.getPos();
    if (src !== this.node.attrs.src && pos !== undefined) {
      this.editor.view.dispatch(
        this.editor.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          src,
        }),
      );
    } else {
      this.render();
    }
  }
}

function nodeIsInline(node: PMNode): boolean {
  return node.isInline;
}

/**
 * The character offset under a point within a raw preview, whose text
 * is the node's source verbatim; null when the browser cannot tell.
 */
function sourceOffsetAt(root: HTMLElement, x: number, y: number): number | null {
  let node: globalThis.Node | null = null;
  let offset = 0;
  const doc = root.ownerDocument as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => {
      offsetNode: globalThis.Node;
      offset: number;
    } | null;
  };
  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y);
    if (position !== null) ({ offsetNode: node, offset } = position);
  } else if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range !== null) ({ startContainer: node, startOffset: offset } = range);
  }
  if (node === null || node.nodeType !== 3 || !root.contains(node)) return null;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let before = 0;
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    if (text === node) return before + offset;
    before += text.textContent?.length ?? 0;
  }
  return null;
}

/** Cmd/Ctrl+click on a raw node: open the file an include names. */
function openIncludeIn(src: string, offset: number | null): boolean {
  const include = includeInSnippet(src, offset);
  if (include === null) return false;
  void openIncludeTarget(include.spec);
  return true;
}

// ---------------------------------------------------------------------------
// Math views

/** KaTeX preview, falling back to the raw source when it cannot render. */
function mathPreview(src: string, display: boolean): HTMLElement {
  const el = document.createElement(display ? "div" : "span");
  el.className = display ? "vis-math-display" : "vis-math-inline";
  const html = renderMathHtml(src, display);
  if (html !== null) {
    el.innerHTML = html;
    return el;
  }
  const raw = document.createElement("span");
  raw.className = "vis-math-error";
  raw.textContent = src;
  el.replaceChildren(raw);
  return el;
}

/** The math node view factory: KaTeX preview, raw body on selection. */
function mathNodeView(display: boolean) {
  return ({ editor, node, getPos }: NodeViewRendererProps) =>
    new EditableRawView(editor, node, getPos, {
      className: `vis-math${display ? " vis-math-block" : " vis-math-inline-node"}`,
      editText: (src) => splitMathSrc(src).body,
      buildSrc: (oldSrc, text) => {
        const { prefix, suffix } = splitMathSrc(oldSrc);
        return prefix + text + suffix;
      },
      editOnSelect: true,
      preview: (src) => mathPreview(src, display),
    });
}

// ---------------------------------------------------------------------------
// Figure views

/** The path inside the first `\includegraphics` in a float, if any. */
export function graphicsPath(src: string): string | null {
  const m = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(src);
  return m === null ? null : m[1];
}

/** Rough caption text: the first non-nested `{...}` of `\caption`. */
export function captionText(src: string): string | null {
  const m = /\\caption\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/.exec(src);
  return m === null || m[1].trim().length === 0 ? null : m[1].trim();
}

/** Rows a table block previews before "… n more rows". */
const MAX_PREVIEW_ROWS = 12;

/** The first table in a float's source the grid editor understands. */
function tableIn(src: string): { from: number; to: number; grid: TableGrid } | null {
  const at = src.search(/\\begin\{(tabular\*?|tabularx|array)\}/);
  if (at === -1) return null;
  const range = tableAt(src, at);
  if (range === null) return null;
  const grid = parseTable(src, range);
  return grid === null ? null : { ...range, grid };
}

class FigureView extends EditableRawView {
  private objectUrl: string | null = null;

  constructor(editor: Editor, node: PMNode, getPos: () => number | undefined) {
    super(editor, node, getPos, {
      className: "vis-figure",
      editText: (src) => src,
      buildSrc: (_old, text) => text,
    });
  }

  destroy() {
    if (this.objectUrl !== null) URL.revokeObjectURL(this.objectUrl);
  }

  protected preview(src: string): HTMLElement {
    const card = document.createElement("figure");
    card.className = "vis-figure-card";
    const path = graphicsPath(src);
    const caption = captionText(src);
    if (path !== null) {
      const frame = document.createElement("div");
      frame.className = "vis-figure-frame";
      const img = document.createElement("img");
      img.alt = path;
      img.className = "vis-figure-img";
      frame.replaceChildren(img);
      card.append(frame);
      void this.loadThumb(path, img);
    }
    const table = tableIn(src);
    if (path === null && table !== null) card.append(this.tablePreview(src, table));
    const meta = document.createElement("figcaption");
    const badge = document.createElement("span");
    badge.className = "vis-figure-path";
    badge.textContent = path ?? (table !== null ? "table" : "float");
    meta.append(badge);
    if (caption !== null) {
      const cap = document.createElement("span");
      cap.className = "vis-figure-caption";
      cap.textContent = caption;
      meta.append(cap);
    }
    card.append(meta);
    return card;
  }

  /** The table's cells as a read-only grid, with an Edit button that
   *  opens the grid editor; its save replaces the tabular in the
   *  node's source (one transaction, one undo step). */
  private tablePreview(
    src: string,
    table: { from: number; to: number; grid: TableGrid },
  ) {
    const frame = document.createElement("div");
    frame.className = "vis-table-frame";
    const el = document.createElement("table");
    el.className = "vis-table-preview";
    const shown = table.grid.rows.slice(0, MAX_PREVIEW_ROWS);
    shown.forEach((cells, r) => {
      const tr = document.createElement("tr");
      if ((table.grid.rules[r] ?? []).length > 0) tr.classList.add("vis-table-ruled");
      cells.forEach((cell, c) => {
        const td = document.createElement("td");
        td.textContent = cell;
        const align = table.grid.columns[c]?.align;
        if (align === "c") td.style.textAlign = "center";
        else if (align === "r") td.style.textAlign = "right";
        tr.append(td);
      });
      el.append(tr);
    });
    frame.append(el);
    if (table.grid.rows.length > shown.length) {
      const more = document.createElement("p");
      more.className = "vis-table-more";
      more.textContent = `… ${table.grid.rows.length - shown.length} more rows`;
      frame.append(more);
    }
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "vis-table-edit";
    edit.textContent = "Edit table";
    edit.title = "Edit the cells in a grid (double-click the block for its LaTeX)";
    edit.addEventListener("mousedown", (event) => event.preventDefault());
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      useDialogsStore.getState().setTableGrid({
        grid: table.grid,
        onSave: (latex) => {
          const pos = this.getPos();
          // Only while the block still holds the table that was opened.
          if (pos === undefined || this.node.attrs.src !== src) return;
          const next = src.slice(0, table.from) + latex + src.slice(table.to);
          this.editor.view.dispatch(
            this.editor.view.state.tr.setNodeMarkup(pos, undefined, {
              ...this.node.attrs,
              src: next,
            }),
          );
        },
      });
    });
    frame.append(edit);
    return frame;
  }

  private async loadThumb(path: string, img: HTMLImageElement) {
    const { project } = useProjectStore.getState();
    if (project === null || assetKind(path) !== "raster") return;
    try {
      const bytes = await readAsset(project.path, path);
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]));
      if (this.objectUrl !== null) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = url;
      // The view may have moved on while loading.
      if (this.dom.isConnected && graphicsPath(this.node.attrs.src) === path) {
        img.src = url;
      } else {
        URL.revokeObjectURL(url);
        this.objectUrl = null;
      }
    } catch {
      // Missing file: the path badge already says everything.
    }
  }
}

// ---------------------------------------------------------------------------
// Modeled environments (quote family; theorems join with a name line)

/** The `\newtheorem` declarations in the preamble's raw source: env → display name. */
function newtheoremNames(editor: Editor): Map<string, string> {
  const names = new Map<string, string>();
  const preamble = findPreamble(editor);
  if (preamble === null) return names;
  const re = /\\newtheorem\*?\s*\{([^}]*)\}(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(preamble.attrs.src)) !== null) {
    names.set(m[1], m[2]);
  }
  return names;
}

/** Is an environment theorem-like: amsthm standard or `\newtheorem`-declared? */
function isTheoremEnv(editor: Editor, env: string): boolean {
  return THEOREM_ENVS.has(env) || newtheoremNames(editor).has(env);
}

/** The display name of a theorem environment ("Theorem", "Lemma", ...). */
function theoremDisplayName(editor: Editor, env: string): string {
  const declared = newtheoremNames(editor).get(env);
  if (declared !== undefined && declared.length > 0) return declared;
  return env.charAt(0).toUpperCase() + env.slice(1);
}

/** The chrome class of an environment block. */
function envBlockClass(editor: Editor, node: PMNode): string {
  const theorem = isTheoremEnv(editor, node.attrs.env) ? " vis-theorem" : "";
  return `vis-env vis-env-${node.attrs.env}${theorem}`;
}

/** A modeled environment: styled chrome around real content; theorem
 *  envs get a name line whose title (the `[...]` after `\begin{env}`)
 *  edits in place. */
class EnvBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private editor: Editor;
  private node: PMNode;
  private getPos: () => number | undefined;
  private editingOpt = false;

  constructor(editor: Editor, node: PMNode, getPos: () => number | undefined) {
    this.editor = editor;
    this.node = node;
    this.getPos = getPos;
    this.dom = document.createElement("div");
    this.dom.className = envBlockClass(editor, node);
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "vis-env-content";
    this.dom.append(this.header(), this.contentDOM);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const envChanged = node.attrs.env !== this.node.attrs.env;
    const optChanged = node.attrs.opt !== this.node.attrs.opt;
    const theoremChanged =
      isTheoremEnv(this.editor, this.node.attrs.env) !==
      isTheoremEnv(this.editor, node.attrs.env);
    this.node = node;
    this.dom.className = envBlockClass(this.editor, node);
    if ((envChanged || optChanged || theoremChanged) && !this.editingOpt) {
      this.dom.replaceChildren(this.header(), this.contentDOM);
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    // Keys typed into the title input are the input's business.
    const target = event.target as HTMLElement | null;
    return target !== null && target.tagName === "INPUT" && this.dom.contains(target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Content mutations are ProseMirror's; chrome mutations are ours.
    return !this.contentDOM.contains(mutation.target) && mutation.type !== "selection";
  }

  /** The theorem name line, or an empty span for non-theorem envs. */
  private header(): HTMLElement {
    const head = document.createElement("div");
    if (!isTheoremEnv(this.editor, this.node.attrs.env)) {
      head.hidden = true;
      return head;
    }
    head.className = "vis-env-theorem-name";
    const name = document.createElement("span");
    name.textContent = theoremDisplayName(this.editor, this.node.attrs.env);
    head.append(name, this.optPill());
    const dot = document.createElement("span");
    dot.textContent = ".";
    head.append(dot);
    return head;
  }

  /** The editable theorem title: the env's `[opt]`, or a "+" to add one. */
  private optPill(): HTMLElement {
    const value = this.node.attrs.opt;
    const pill = document.createElement("button");
    pill.type = "button";
    const empty = value === null || value === undefined || value.length === 0;
    pill.className = `vis-env-theorem-opt${empty ? " vis-env-theorem-add" : ""}`;
    pill.textContent = empty ? "+" : `(${value})`;
    pill.title = empty
      ? "Add a title (the [..] after \\begin{env})"
      : "Title — click to edit (the [..] after \\begin{env})";
    pill.addEventListener("click", () => {
      if (this.editingOpt) return;
      this.editingOpt = true;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "vis-env-theorem-input";
      input.setAttribute("spellcheck", "false");
      input.value = value ?? "";
      pill.replaceChildren(input);
      queueMicrotask(() => input.focus());
      const commit = () => {
        if (!this.editingOpt) return;
        this.editingOpt = false;
        const pos = this.getPos();
        if (pos === undefined) {
          this.dom.replaceChildren(this.header(), this.contentDOM);
          return;
        }
        const next = input.value.trim().length > 0 ? input.value : null;
        if (next === this.node.attrs.opt) {
          this.dom.replaceChildren(this.header(), this.contentDOM);
          return;
        }
        this.editor.view.dispatch(
          this.editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            opt: next,
          }),
        );
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          input.value = value ?? "";
          commit();
        }
      });
    });
    return pill;
  }
}

// ---------------------------------------------------------------------------
// Preamble view: the title card — title, author, and date, edited in
// place. The rest of the preamble stays out of sight (Code face,
// Document settings, Packages); double-clicking the card's padding
// still opens it as raw source.

/** The inner `{…}` content of a single command like `\author{A}`. */
export function commandContent(src: string | null): string | null {
  if (src === null) return null;
  const m = /^\\[a-zA-Z]+\*?\s*(?:\[[^\]]*\])?\s*\{([\s\S]*)\}$/.exec(src);
  if (m === null) return null;
  const inner = m[1].trim();
  return inner.length > 0 ? inner : null;
}

class PreambleView extends EditableRawView {
  /** A pill pressed while another was being edited: committing that
   *  edit re-renders the card and swallows the click, so the new
   *  card opens this one itself. */
  private pendingEdit: MetaKey | null = null;

  stopEvent(event: Event): boolean {
    // The card's own buttons (the summary bar, the metadata pills)
    // handle their clicks: letting a mousedown through node-selects
    // the preamble atom, and the next stray keypress would delete
    // the whole node.
    if (
      event.type === "mousedown" &&
      (event.target as HTMLElement | null)?.closest("button") !== null
    ) {
      return true;
    }
    return super.stopEvent(event);
  }

  constructor(editor: Editor, node: PMNode, getPos: () => number | undefined) {
    super(editor, node, getPos, {
      className: "vis-preamble",
      editText: (src) => src,
      buildSrc: (_old, text) => text,
    });
  }

  protected preview(): HTMLElement {
    const card = document.createElement("div");
    card.className = "vis-preamble-card";
    // The title sits centered on its own line, author and date below.
    const meta = document.createElement("div");
    meta.className = "vis-preamble-meta";
    // Double-clicks among the pills (their padding included) select
    // text in the inputs; they must not open the raw source editor.
    meta.addEventListener("dblclick", (event) => event.stopPropagation());
    const refresh = () => this.refresh();
    const pill = (
      key: MetaKey,
      label: string,
      iconPaths: string | null,
    ): HTMLElement => {
      const element = metaPill(
        this.editor,
        key,
        label,
        iconPaths,
        this.node.attrs[key],
        true,
        refresh,
      );
      element.addEventListener("mousedown", () => {
        const other = card.querySelector('[data-editing="true"]');
        if (other !== null && other !== element) this.pendingEdit = key;
      });
      if (this.pendingEdit === key) {
        this.pendingEdit = null;
        // After the focus change that triggered this render settles.
        setTimeout(() => element.click(), 0);
      }
      return element;
    };
    const titleRow = document.createElement("div");
    titleRow.className = "vis-preamble-meta-title";
    titleRow.append(pill("titleSrc", "Title", null));
    const pillsRow = document.createElement("div");
    pillsRow.className = "vis-preamble-meta-row";
    pillsRow.append(
      pill("authorSrc", "Author", USER_ICON),
      pill("dateSrc", "Date", CALENDAR_ICON),
    );
    meta.append(titleRow, pillsRow);
    card.append(meta);
    return card;
  }
}

// ---------------------------------------------------------------------------
// Title block: \maketitle has no visible marker; the preamble card is
// the title. When it is missing, the editor shows a warning banner.

/** Small inline SVG icon (lucide-style stroke icons). */
function svgIcon(paths: string, className = "vis-title-icon"): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = className;
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return wrap;
}

/** Lucide "pilcrow" for the heading chip, which opens the heading-level menu. */
const PILCROW_ICON =
  '<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>';

const USER_ICON =
  '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>';
const CALENDAR_ICON =
  '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>';

/** The preamble node of an editor, with its position, or null. */
function findPreamble(editor: Editor): { pos: number; attrs: PreambleAttrs } | null {
  let found: { pos: number; attrs: PreambleAttrs } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "preamble") {
      found = { pos, attrs: node.attrs as PreambleAttrs };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Set one of the title metadata commands in the preamble: `value`
 * becomes `\cmd{value}`; an empty value removes the command.
 */
export function setPreambleMeta(
  editor: Editor,
  key: "titleSrc" | "authorSrc" | "dateSrc",
  value: string,
): boolean {
  const preamble = findPreamble(editor);
  if (preamble === null) return false;
  const cmdName =
    key === "titleSrc" ? "title" : key === "authorSrc" ? "author" : "date";
  const next = value.trim().length > 0 ? `\\${cmdName}{${value}}` : null;
  if (next === preamble.attrs[key]) return true;
  editor.view.dispatch(
    editor.view.state.tr.setNodeMarkup(preamble.pos, undefined, {
      ...preamble.attrs,
      [key]: next,
    }),
  );
  return true;
}

/** Insert a `\maketitle` block right after the preamble. */
export function insertMaketitle(editor: Editor): boolean {
  const preamble = findPreamble(editor);
  if (preamble === null) return false;
  const node = editor.state.schema.nodes.titleBlock.create({ src: "\\maketitle" });
  const tr = editor.view.state.tr.insert(preamble.pos + 1, node);
  editor.view.dispatch(tr);
  return true;
}

// ---------------------------------------------------------------------------
// The Insert menu: environments, packages, \newtheorem declarations

/** The quote family the Insert menu offers. */
export const INSERT_QUOTE_ENVS: { env: string; label: string }[] = [
  { env: "quote", label: "Quote" },
  { env: "quotation", label: "Quotation" },
  { env: "center", label: "Center" },
  { env: "abstract", label: "Abstract" },
];

/** The theorem family the Insert menu offers: the standard names plus
 *  whatever `\\newtheorem` declared in this document's preamble. */
export function insertTheoremEnvEntries(
  editor: Editor,
): { env: string; label: string; declared: boolean }[] {
  const standard = [...THEOREM_ENVS].map((env) => ({
    env,
    label: env.charAt(0).toUpperCase() + env.slice(1),
    declared: false,
  }));
  const declared = [...newtheoremNames(editor)]
    .filter(([env]) => !THEOREM_ENVS.has(env))
    .map(([env, name]) => ({
      env,
      label: name.length > 0 ? name : env,
      declared: true,
    }));
  return [...standard, ...declared];
}

/**
 * Insert an environment at the caret, context-dependent: an empty
 * paragraph is replaced by it, any other block is wrapped — the quote
 * button's semantics. A doc-level selection (a fresh mount
 * node-selects the preamble atom) appends at the document's end
 * instead of wrapping the preamble.
 */
export function insertEnvBlock(editor: Editor, env: string): void {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
    const block = editor.state.schema.nodes.envBlock.create({ env, opt: null }, [
      editor.state.schema.nodes.paragraph.create(),
    ]);
    const tr = editor.view.state.tr;
    tr.replaceWith($from.before(), $from.after(), block);
    tr.setSelection(TextSelection.near(tr.doc.resolve($from.before() + 2)));
    editor.view.dispatch(tr.scrollIntoView());
    return;
  }
  if ($from.parent.type.name === "doc") {
    const block = editor.state.schema.nodes.envBlock.create({ env, opt: null }, [
      editor.state.schema.nodes.paragraph.create(),
    ]);
    const tr = editor.view.state.tr;
    const at = tr.doc.content.size;
    tr.insert(at, block);
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2)));
    editor.view.dispatch(tr.scrollIntoView());
    return;
  }
  editor.chain().focus().wrapIn("envBlock", { env, opt: null }).run();
}

/** Is a package loaded, judging by the preamble's `\\usepackage` block? */
function hasPackage(packagesSrc: string | null, pkg: string): boolean {
  if (packagesSrc === null) return false;
  const re = new RegExp(String.raw`\\usepackage(?:\[[^\]]*\])?\{[^}]*\b${pkg}\b`);
  return re.test(packagesSrc);
}

/**
 * Load `\\usepackage{pkg}` when it is not there yet. One undo step;
 * false when there is no preamble or it is already loaded.
 */
export function ensurePackage(editor: Editor, pkg: string): boolean {
  const preamble = findPreamble(editor);
  if (preamble === null || hasPackage(preamble.attrs.packagesSrc, pkg)) return false;
  const line = `\\usepackage{${pkg}}`;
  const next =
    preamble.attrs.packagesSrc === null
      ? line
      : `${preamble.attrs.packagesSrc}\n${line}`;
  editor.view.dispatch(
    editor.view.state.tr.setNodeMarkup(preamble.pos, undefined, {
      ...preamble.attrs,
      packagesSrc: next,
    }),
  );
  return true;
}

/**
 * Declare a theorem environment: `\\newtheorem{env}{Name}` joins the
 * preamble's raw source, with amsthm loaded first — one undo step.
 * `name` may be empty (the capitalized env name is used). Returns
 * false when the env name is not plain letters or the file has no
 * preamble to hold the declaration.
 */
export function addNewtheorem(editor: Editor, env: string, name: string): boolean {
  if (!/^[a-zA-Z]+$/.test(env)) return false;
  const preamble = findPreamble(editor);
  if (preamble === null) return false;
  const display =
    name.trim().length > 0 ? name.trim() : env.charAt(0).toUpperCase() + env.slice(1);
  const attrs = { ...preamble.attrs };
  if (!hasPackage(attrs.packagesSrc, "amsthm")) {
    attrs.packagesSrc =
      attrs.packagesSrc === null
        ? "\\usepackage{amsthm}"
        : `${attrs.packagesSrc}\n\\usepackage{amsthm}`;
  }
  const rest = attrs.src.replace(/\s+$/, "");
  attrs.src = `${rest.length > 0 ? rest + "\n" : ""}\\newtheorem{${env}}{${display}}`;
  editor.view.dispatch(
    editor.view.state.tr.setNodeMarkup(preamble.pos, undefined, attrs),
  );
  return true;
}

type MetaKey = "titleSrc" | "authorSrc" | "dateSrc";

/** One metadata pill (author or date): a value chip that edits in place. */
const META_CMDS: Record<MetaKey, string> = {
  titleSrc: "title",
  authorSrc: "author",
  dateSrc: "date",
};

function metaPill(
  editor: Editor,
  key: MetaKey,
  label: string,
  iconPaths: string | null,
  src: string | null,
  enabled: boolean,
  onCommit: () => void,
): HTMLElement {
  const isTitle = key === "titleSrc";
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = `vis-title-pill${isTitle ? " vis-title-edit" : ""}`;
  pill.title = `${label} — click to edit (stored as \\${META_CMDS[key]})`;
  if (!enabled) {
    pill.disabled = true;
    pill.title = "The file has no preamble to store this in";
  }
  if (iconPaths !== null) pill.append(svgIcon(iconPaths));
  const text = document.createElement("span");
  const value = commandContent(src);
  text.textContent = value ?? `Add ${label.toLowerCase()}`;
  if (value === null) text.classList.add("vis-title-pill-empty");
  pill.append(text);

  pill.addEventListener("click", () => {
    if (!enabled || pill.dataset.editing === "true") return;
    pill.dataset.editing = "true";
    // A node selection on the preamble (e.g. from clicking the card's
    // padding) must not outlive this edit: the next stray keypress
    // would delete the whole node. Park the caret in the text after
    // the preamble instead.
    const preamble = findPreamble(editor);
    const selection = editor.state.selection;
    if (
      preamble !== null &&
      selection instanceof NodeSelection &&
      selection.from === preamble.pos
    ) {
      const $after = editor.state.doc.resolve(
        Math.min(selection.from + 1, editor.state.doc.content.size),
      );
      editor.view.dispatch(
        editor.view.state.tr.setSelection(TextSelection.near($after)),
      );
    }
    // The text span itself becomes editable: the exact same element
    // in the exact same box, so focusing cannot shift anything — the
    // inline-edit feel, with no input metrics to fight.
    text.contentEditable = "true";
    text.spellcheck = false;
    if (value === null) text.textContent = "";
    text.focus();
    // The caret lands after the text, like clicking into any prose.
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const domSelection = window.getSelection();
    domSelection?.removeAllRanges();
    domSelection?.addRange(range);
    const commit = () => {
      const next = text.textContent ?? "";
      text.contentEditable = "false";
      setPreambleMeta(editor, key, next);
      // The attr transaction may not touch this node, so refresh here.
      onCommit();
    };
    text.addEventListener("blur", commit);
    text.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        text.blur();
      }
      if (event.key === "Escape") {
        text.textContent = value ?? "";
        text.blur();
      }
    });
    // Paste stays plain text, never markup.
    text.addEventListener("paste", (event) => {
      event.preventDefault();
      const paste = event.clipboardData?.getData("text/plain") ?? "";
      document.execCommand("insertText", false, paste);
    });
  });
  return pill;
}

/** \maketitle draws nothing: Title, Author, and Date show once, in
 *  the preamble card. The empty element keeps the node in the doc. */
class TitleCardView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;

  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className = "vis-title-card";
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {}
}

// ---------------------------------------------------------------------------
// Pill views (cite / ref / label)

/** An input rule turning a typed `\cmd{keys}` into a pill node, selected
 *  so its raw editor opens right away. The matched text becomes the
 *  node's verbatim src, spacing and optional argument included. */
function pillInputRule(find: RegExp, typeName: string) {
  return new InputRule({
    find,
    handler: ({ state, range }) => {
      const src = state.doc.textBetween(range.from, range.to);
      const node = state.schema.nodes[typeName]?.create({ src });
      if (node === undefined || node === null) return null;
      const tr = state.tr;
      tr.delete(range.from, range.to);
      tr.replaceWith(range.from, range.from, node);
      selectNodeAt(tr, range.from, typeName);
    },
  });
}

/** The keys argument of a command like \cite[p.3]{a,b}. */
function commandKeys(src: string): string {
  const m = /^\\([a-zA-Z]+)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(src);
  if (m === null) return src;
  return m[2]
    .split(",")
    .map((k) => k.trim())
    .join(", ");
}

/** The pill preview: an @-icon chip with the command's keys. The pill
 *  chrome lives on the wrapper (EditableRawView's dom), so the
 *  content span carries no pill classes of its own. */
function pillPreview(src: string): HTMLElement {
  const dom = document.createElement("span");
  const icon = document.createElement("span");
  icon.className = "vis-pill-icon";
  icon.textContent = "@";
  const text = document.createElement("span");
  text.textContent = commandKeys(src);
  dom.replaceChildren(icon, text);
  return dom;
}

// --- Hygiene statuses, from the project's cross-file indexes ---

/** A pill's hygiene status: a class and a tooltip. */
interface PillStatus {
  cls: string;
  title: string;
}

/** The keys inside a pill command's braces, split on commas. */
function pillKeys(src: string): string[] {
  const m = /^\\[a-zA-Z]+\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(src);
  if (m === null) return [];
  return m[1]
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

/** Does the current document carry a pill of `type` naming `key`? */
function docDefines(editor: Editor, type: string, key: string): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === type && pillKeys(node.attrs.src).includes(key)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/** Cited keys that no .bib file defines (only when a bibliography exists). */
function citeStatus(_editor: Editor, src: string): PillStatus | null {
  const defined = Object.values(useProjectStore.getState().citeKeysByFile).flat();
  if (defined.length === 0) return null;
  const known = new Set(defined);
  const missing = pillKeys(src).filter((key) => !known.has(key));
  if (missing.length === 0) return null;
  return {
    cls: "vis-pill-warn",
    title: `No BibTeX entry with key ${missing.map((key) => `"${key}"`).join(", ")}`,
  };
}

/** A reference to a label no file defines. */
function refStatus(editor: Editor, src: string): PillStatus | null {
  const name = pillKeys(src)[0];
  if (name === undefined) return null;
  const known = new Set(Object.values(useProjectStore.getState().labelsByFile).flat());
  if (known.has(name) || docDefines(editor, "label", name)) return null;
  return { cls: "vis-pill-warn", title: `Undefined label "${name}"` };
}

/** A label no file references. */
function labelStatus(editor: Editor, src: string): PillStatus | null {
  const name = pillKeys(src)[0];
  if (name === undefined) return null;
  const known = new Set(Object.values(useProjectStore.getState().refsByFile).flat());
  if (known.has(name) || docDefines(editor, "ref", name)) return null;
  return { cls: "vis-pill-unused", title: `Label "${name}" is not referenced` };
}

/** A pill that recomputes its hygiene status when the project's
 *  cross-file indexes change (saves and file reads elsewhere). The
 *  status classes and tooltip land on the wrapper, the pill itself. */
class PillView extends EditableRawView {
  private statusFn: (editor: Editor, src: string) => PillStatus | null;
  private unsubscribe: () => void;

  constructor(
    editor: Editor,
    node: PMNode,
    getPos: () => number | undefined,
    className: string,
    contextMenu: ((src: string) => NativeMenuEntry[] | null) | undefined,
    status: (editor: Editor, src: string) => PillStatus | null,
  ) {
    super(editor, node, getPos, {
      className: `vis-pill ${className}`,
      editText: (src) => src,
      buildSrc: (_old, text) => text,
      editOnSelect: true,
      preview: (src) => pillPreview(src),
      contextMenu,
    });
    this.statusFn = status;
    this.applyStatus();
    this.unsubscribe = useProjectStore.subscribe(() => {
      this.applyStatus();
      this.refresh();
    });
  }

  update(node: PMNode): boolean {
    const ok = super.update(node);
    if (ok) this.applyStatus();
    return ok;
  }

  destroy() {
    this.unsubscribe();
  }

  private applyStatus(): void {
    const status = this.statusFn(this.editor, this.node.attrs.src);
    this.dom.classList.toggle("vis-pill-warn", status?.cls === "vis-pill-warn");
    this.dom.classList.toggle("vis-pill-unused", status?.cls === "vis-pill-unused");
    if (status !== null) {
      this.dom.title = status.title;
    } else {
      this.dom.removeAttribute("title");
    }
  }
}

/**
 * The cite/ref/label pill: keys as a chip, the full command editable
 * in place on selection (the math pattern), a context menu for
 * navigation, and a hygiene status badge.
 */
function pillNodeView(
  className: string,
  contextMenu: ((src: string) => NativeMenuEntry[] | null) | undefined,
  status: (editor: Editor, src: string) => PillStatus | null,
): (props: NodeViewRendererProps) => NodeView {
  return ({ editor, node, getPos }: NodeViewRendererProps) =>
    new PillView(editor, node, getPos, className, contextMenu, status);
}

/** Project .tex paths, depth first. */
function texFilePaths(entries: FileEntry[]): string[] {
  const paths: string[] = [];
  const walk = (list: FileEntry[]) => {
    for (const entry of list) {
      if (entry.isDir) walk(entry.children);
      else if (entry.path.toLowerCase().endsWith(".tex")) paths.push(entry.path);
    }
  };
  walk(entries);
  return paths;
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Jump to a \label definition: the active file's live buffer first,
 * then every .tex in the project (unsaved buffers over disk).
 */
async function jumpToLabel(name: string): Promise<void> {
  if (name.length === 0) return;
  const labelRe = new RegExp(`\\\\label\\s*\\{${escapeForRegExp(name)}\\}`);
  const lineOfLabel = (text: string): number | null => {
    const at = text.search(labelRe);
    return at === -1 ? null : text.slice(0, at).split("\n").length;
  };
  const jump = (file: string, line: number) => {
    const { activeFile } = useProjectStore.getState();
    const goTo = () => useEditorStore.getState().jumpTo(line);
    if (file === activeFile) {
      goTo();
      return;
    }
    void useProjectStore.getState().openFile(file).then(goTo);
  };

  const { project, files, buffers, activeFile } = useProjectStore.getState();
  const activeContent =
    activeFile !== null
      ? (buffers[activeFile] ?? useEditorStore.getState().content)
      : null;
  if (activeContent !== null) {
    const line = lineOfLabel(activeContent);
    if (line !== null && activeFile !== null) {
      jump(activeFile, line);
      return;
    }
  }
  if (project === null) return;
  for (const path of texFilePaths(files)) {
    if (path === activeFile) continue;
    const content =
      buffers[path] ?? (await readProjectFile(project.path, path).catch(() => null));
    if (content === null) continue;
    const line = lineOfLabel(content);
    if (line !== null) {
      jump(path, line);
      return;
    }
  }
}

/** A citation's context menu: reveal it in the Bibliography panel. */
function citeMenu(src: string): NativeMenuEntry[] | null {
  return [
    {
      id: "show-in-bibliography",
      text: "Show in Bibliography",
      action: () => {
        const key = commandKeys(src).split(",")[0]?.trim() ?? "";
        useUiStore.getState().setBibliographySearch(key);
        runPanelCommand("show-bibliography");
      },
    },
  ];
}

/** A reference's context menu: jump to the \label it points at. */
function refMenu(src: string): NativeMenuEntry[] | null {
  return [
    {
      id: "jump-to-definition",
      text: "Jump to definition",
      action: () => void jumpToLabel(commandKeys(src)),
    },
  ];
}

// ---------------------------------------------------------------------------
// Extensions

const TexDocument = Document.extend({
  addAttributes() {
    return {
      wrapped: { default: false },
      postamble: { default: "" },
    };
  },
});

// ---------------------------------------------------------------------------
// Headings: kind pairs, markdown rules, and the level chip

/** A sectioning kind: the command, its display level, and its menu label. */
export interface HeadingKind {
  cmd: string;
  level: number;
  label: string;
}

/** All sectioning commands in document order. */
export const HEADING_KINDS: HeadingKind[] = [
  { cmd: "part", level: 1, label: "Part" },
  { cmd: "chapter", level: 2, label: "Chapter" },
  { cmd: "section", level: 3, label: "Section" },
  { cmd: "subsection", level: 4, label: "Subsection" },
  { cmd: "subsubsection", level: 5, label: "Subsubsection" },
  { cmd: "paragraph", level: 6, label: "Paragraph" },
  { cmd: "subparagraph", level: 6, label: "Subparagraph" },
];

/** The friendly name of a sectioning command, starred included. */
function headingLabel(cmd: string): string {
  const star = cmd.endsWith("*");
  const base = cmd.replace(/\*$/, "");
  const kind = HEADING_KINDS.find((k) => k.cmd === base);
  const name = kind?.label ?? base.charAt(0).toUpperCase() + base.slice(1);
  return `${name}${star ? "*" : ""}`;
}

/** Apply a sectioning kind at the cursor; null means body text. */
export function setHeadingKind(editor: Editor, kind: HeadingKind | null): void {
  if (kind === null) {
    if (editor.isActive("heading")) editor.chain().focus().setParagraph().run();
    return;
  }
  const attrs = { cmd: kind.cmd, level: kind.level };
  if (editor.isActive("heading")) {
    editor.chain().focus().updateAttributes("heading", attrs).run();
  } else {
    editor.chain().focus().setNode("heading", attrs).run();
  }
}

/** A heading with its level chip: `[section]` in the reserved left
 *  gutter, visible on hover and while the caret is in the heading;
 *  clicking it opens the level menu. */
class HeadingView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private editor: Editor;
  private node: PMNode;
  private chip: HTMLButtonElement;

  constructor(editor: Editor, node: PMNode) {
    this.editor = editor;
    this.node = node;
    this.dom = document.createElement(`h${node.attrs.level}`);
    this.dom.className = "vis-heading";
    this.chip = this.makeChip();
    this.dom.append(this.chip);
    this.contentDOM = document.createElement("span");
    this.dom.append(this.contentDOM);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    if (node.attrs.level !== this.node.attrs.level) return false; // recreate as h{level}
    if (node.attrs.cmd !== this.node.attrs.cmd) {
      this.node = node;
      this.chip.title = `${headingLabel(node.attrs.cmd)} — click to change the heading level`;
      return true;
    }
    this.node = node;
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    return target !== null && target.closest(".vis-heading-chip") === this.chip;
  }

  private makeChip(): HTMLButtonElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "vis-heading-chip";
    const label = headingLabel(this.node.attrs.cmd);
    chip.title = `${label} — click to change the heading level`;
    chip.append(svgIcon(PILCROW_ICON, "vis-heading-chip-icon"));
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = this.node.attrs.cmd;
      const items: NativeMenuEntry[] = [
        ...HEADING_KINDS.map((kind) => ({
          id: kind.cmd,
          text: `${kind.label}${kind.cmd === current ? " — current" : ""}`,
          action: () => setHeadingKind(this.editor, kind),
        })),
        "separator" as const,
        {
          id: "body-text",
          text: "Body text",
          action: () => setHeadingKind(this.editor, null),
        },
      ];
      void showNativeContextMenu(items);
    });
    return chip;
  }
}

/** The `#`-shortcut pairs: article-document mapping, section first. */
const MARKDOWN_HEADINGS: { hashes: number; kind: HeadingKind }[] = [
  { hashes: 1, kind: HEADING_KINDS[2]! }, // # → section
  { hashes: 2, kind: HEADING_KINDS[3]! }, // ## → subsection
  { hashes: 3, kind: HEADING_KINDS[4]! }, // ### → subsubsection
  { hashes: 4, kind: HEADING_KINDS[5]! }, // #### → paragraph
  { hashes: 5, kind: HEADING_KINDS[6]! }, // ##### → subparagraph
];

const TexHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      cmd: { default: "section" },
      opt: { default: null },
    };
  },
  addNodeView() {
    return ({ editor, node }: NodeViewRendererProps) => new HeadingView(editor, node);
  },
  // Replace the built-in `#` rules: they create level-1..6 headings
  // with a mismatched cmd. Ours write consistent cmd/level pairs.
  addInputRules() {
    return MARKDOWN_HEADINGS.map(({ hashes, kind }) =>
      textblockTypeInputRule({
        find: new RegExp(`^#{${hashes}}\\s$`),
        type: this.type,
        getAttributes: () => ({ cmd: kind.cmd, level: kind.level }),
      }),
    );
  },
});

/** Marks the heading that holds the caret, so its chip stays visible. */
const HeadingCaret = Extension.create({
  name: "headingCaret",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { $from } = state.selection;
            if ($from.parent.type.name !== "heading") return DecorationSet.empty;
            const start = $from.before();
            return DecorationSet.create(state.doc, [
              Decoration.node(start, start + $from.parent.nodeSize, {
                class: "vis-has-caret",
              }),
            ]);
          },
        },
      }),
    ];
  },
});

/**
 * A list item's `\item[label]`: a chip that reads as the item's
 * marker (LaTeX replaces the bullet with it), edited in place with
 * the meta-pill input pattern. Items without a label carry a "+" in
 * the left gutter, revealed on hover.
 */
class ListItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private editor: Editor;
  private node: PMNode;
  private getPos: () => number | undefined;
  private editing = false;
  private chip: HTMLElement | null = null;

  constructor(editor: Editor, node: PMNode, getPos: () => number | undefined) {
    this.editor = editor;
    this.node = node;
    this.getPos = getPos;
    this.dom = document.createElement("li");
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "vis-item-content";
    this.applyClass();
    this.rebuildChip();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const labelChanged = node.attrs.label !== this.node.attrs.label;
    this.node = node;
    if (labelChanged && !this.editing) {
      this.applyClass();
      this.rebuildChip();
    }
    return true;
  }

  /** The label replaces the bullet marker when one exists. */
  private applyClass(): void {
    const value = this.node.attrs.label;
    const has = value !== null && value !== undefined && value.length > 0;
    this.dom.className = `vis-item${has ? " has-label" : ""}`;
  }

  stopEvent(event: Event): boolean {
    // The chip and its input are ours; everything else is content.
    const target = event.target as HTMLElement | null;
    if (target === null) return false;
    if (target.tagName === "INPUT" && this.dom.contains(target)) return true;
    return this.chip !== null && target.closest(".vis-item-label") === this.chip;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Content mutations are ProseMirror's; chip mutations are ours.
    return !this.contentDOM.contains(mutation.target) && mutation.type !== "selection";
  }

  /** The label chip replaces itself and stays referenced for stopEvent. */
  private rebuildChip(): void {
    this.chip = this.makeChip();
    this.dom.replaceChildren(this.chip, this.contentDOM);
  }

  /** The label chip: the current `[label]`, or a "+" to add one. */
  private makeChip(): HTMLElement {
    const value = this.node.attrs.label;
    const empty = value === null || value === undefined || value.length === 0;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `vis-item-label${empty ? " vis-item-label-add" : ""}`;
    chip.textContent = empty ? "+" : `(${value})`;
    chip.title = empty
      ? "Add a label (the [..] after \\item)"
      : "Label — click to edit (the [..] after \\item)";
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", () => {
      if (this.editing) return;
      this.editing = true;
      chip.classList.add("vis-item-editing");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "vis-item-input";
      input.setAttribute("spellcheck", "false");
      input.value = value ?? "";
      chip.replaceChildren(input);
      queueMicrotask(() => input.focus());
      const commit = () => {
        if (!this.editing) return;
        this.editing = false;
        const next = input.value.trim().length > 0 ? input.value : null;
        const pos = this.getPos();
        if (pos === undefined || next === this.node.attrs.label) {
          this.rebuildChip(); // no change: drop the stale input
          return;
        }
        this.editor.view.dispatch(
          this.editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            label: next,
          }),
        );
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          input.value = value ?? "";
          commit();
        }
      });
    });
    return chip;
  }
}

const TexListItem = ListItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      label: { default: null },
    };
  },
  addNodeView() {
    return ({ editor, node, getPos }: NodeViewRendererProps) =>
      new ListItemView(editor, node, getPos);
  },
});

const TexHardBreak = HardBreak.extend({
  addAttributes() {
    return {
      src: { default: "\\\\" },
    };
  },
});

/** The comment body as the preview shows it: the text after the `%`. */
function commentText(src: string): string {
  return src.replace(/^%+\s?/, "");
}

/** The comment preview: a muted `%` line; empty comments read "%". */
function commentPreview(src: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "vis-comment-line";
  const sigil = document.createElement("span");
  sigil.className = "vis-comment-sigil";
  sigil.textContent = "%";
  const text = document.createElement("span");
  text.textContent = commentText(src);
  el.replaceChildren(sigil, text);
  return el;
}

/**
 * A `%` comment: an atom, not editable text, so typing or Enter can
 * never turn commented-out text into live LaTeX, and two comment
 * lines never merge. Selecting it opens the raw line for editing.
 */
const TexComment = Node.create({
  name: "texComment",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return { src: { default: "%" } };
  },
  parseHTML() {
    return [{ tag: "vis-comment" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-comment", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ({ editor, node, getPos }: NodeViewRendererProps) =>
      new EditableRawView(editor, node, getPos, {
        className: "vis-comment",
        editText: (src) => src,
        // One line, still a comment: a newline would end it and a
        // missing % would make the rest live LaTeX.
        buildSrc: (_old, text) => {
          const line = text.replace(/\s*\n\s*/g, " ").trimEnd();
          return line.startsWith("%") ? line : `% ${line}`.trimEnd();
        },
        editOnSelect: true,
        preview: commentPreview,
      });
  },
});

const Preamble = Node.create({
  name: "preamble",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      documentclassSrc: { default: null },
      packagesSrc: { default: null },
      titleSrc: { default: null },
      authorSrc: { default: null },
      dateSrc: { default: null },
      src: { default: "" },
      layout: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "vis-preamble" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-preamble", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ({ editor, node, getPos }: NodeViewRendererProps) =>
      new PreambleView(editor, node, getPos);
  },
});

/** Select a freshly inserted atom node so its raw editor opens. */
function selectNodeAt(tr: Transaction, pos: number, type: string): boolean {
  const node = tr.doc.nodeAt(pos);
  if (node === null || node.type.name !== type) return false;
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  return true;
}

/** A `\maketitle` in the body: the document's rendered title card. */
const TitleBlock = Node.create({
  name: "titleBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { src: { default: "\\maketitle" } };
  },
  parseHTML() {
    return [{ tag: "vis-title-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-title-block", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ({ node }: NodeViewRendererProps) => new TitleCardView(node);
  },
});

const MathInline = Node.create({
  name: "mathInline",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return { src: { default: "$$" } };
  },
  parseHTML() {
    return [{ tag: "vis-math-inline" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-math-inline", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return mathNodeView(false);
  },
  // Typing $x$ turns into math. The input-rule engine hands the
  // handler a transaction whose document already contains the typed
  // text, at `range`; the handler only mutates that transaction.
  addInputRules() {
    return [
      new InputRule({
        find: /\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const src = `$${match[1]}$`;
          const node = state.schema.nodes.mathInline.create({ src });
          const tr = state.tr;
          tr.delete(range.from, range.to);
          tr.replaceWith(range.from, range.from, node);
          selectNodeAt(tr, range.from, this.name);
        },
      }),
    ];
  },
});

const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { src: { default: "\\[\\]" } };
  },
  parseHTML() {
    return [{ tag: "vis-math-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-math-block", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return mathNodeView(true);
  },
  // Typing $$ in a paragraph that holds nothing else opens display
  // math; text after the $$ stays (the case is ambiguous).
  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$$/,
        handler: ({ state, range }) => {
          const $after = state.doc.resolve(range.to);
          if ($after.parent.type.name !== "paragraph") return null;
          const trailing = $after.parent.textBetween(
            $after.parentOffset,
            $after.parent.content.size,
          );
          if (trailing.length > 0) return null;
          const node = state.schema.nodes.mathBlock.create({ src: "\\[\\]" });
          const $from = state.doc.resolve(range.from);
          const start = $from.before();
          const tr = state.tr;
          tr.replaceWith(start, $from.after(), node);
          selectNodeAt(tr, start, this.name);
        },
      }),
    ];
  },
});

const FigureBlock = Node.create({
  name: "figureBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "vis-figure-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-figure-block", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ({ editor, node, getPos }: NodeViewRendererProps) =>
      new FigureView(editor, node, getPos);
  },
});

const EnvBlock = Node.create({
  name: "envBlock",
  group: "block",
  content: "block+",
  addAttributes() {
    return {
      env: { default: "quote" },
      opt: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "vis-env-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-env-block", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ({ editor, node, getPos }: NodeViewRendererProps) =>
      new EnvBlockView(editor, node, getPos);
  },
  // Typing "> " in a paragraph that holds nothing else opens a quote.
  addInputRules() {
    return [
      new InputRule({
        find: /^>\s$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== "paragraph") return null;
          const $after = state.doc.resolve(range.to);
          const trailing = $after.parent.textBetween(
            $after.parentOffset,
            $after.parent.content.size,
          );
          if (trailing.length > 0) return null;
          const env = state.schema.nodes.envBlock.create({ env: "quote", opt: null }, [
            state.schema.nodes.paragraph.create(),
          ]);
          const tr = state.tr;
          tr.replaceWith($from.before(), $from.after(), env);
          tr.setSelection(TextSelection.near(tr.doc.resolve($from.before() + 2)));
        },
      }),
    ];
  },
});

const RawTexBlock = Node.create({
  name: "rawTexBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "vis-raw-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-raw-block", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ({ editor, node, getPos }: NodeViewRendererProps) =>
      new EditableRawView(editor, node, getPos, {
        className: "vis-raw-block",
        editText: (src) => src,
        buildSrc: (_old, text) => text,
        // A block can hold several lines: the include under the click.
        modClick: openIncludeIn,
      });
  },
});

const RawTexInline = Node.create({
  name: "rawTexInline",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "vis-raw-inline" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-raw-inline", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ({ editor, node, getPos }: NodeViewRendererProps) =>
      new EditableRawView(editor, node, getPos, {
        className: "vis-raw-inline",
        editText: (src) => src,
        buildSrc: (_old, text) => text,
        // The whole pill is the command: any spot on it opens the file.
        modClick: (src) => openIncludeIn(src, null),
      });
  },
});

const Cite = Node.create({
  name: "cite",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "vis-cite" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-cite", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return pillNodeView("vis-cite", citeMenu, citeStatus);
  },
  // Typing \cite{...} — the bibtex, natbib, and biblatex families —
  // turns into a cite pill on the closing brace.
  addInputRules() {
    return [
      pillInputRule(
        /\\(?:cite[a-zA-Z]*|[a-zA-Z]+cite)\*?\s*(?:\[[^\]\n]*\])?\s*\{([^{}\n]*)\}$/,
        this.name,
      ),
    ];
  },
});

const Ref = Node.create({
  name: "ref",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "vis-ref" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-ref", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return pillNodeView("vis-ref", refMenu, refStatus);
  },
  // Typing \ref{...} (and the reference family) turns into a pill.
  addInputRules() {
    const cmds = [...REF_CMDS].join("|");
    return [
      pillInputRule(
        new RegExp(String.raw`\\(?:${cmds})\*?\s*(?:\[[^\]\n]*\])?\s*\{([^{}\n]*)\}$`),
        this.name,
      ),
    ];
  },
});

const Label = Node.create({
  name: "label",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "vis-label" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-label", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return pillNodeView("vis-label", undefined, labelStatus);
  },
  // Typing \label{...} turns into a pill.
  addInputRules() {
    return [pillInputRule(/\\label\*?\s*\{([^{}\n]*)\}$/, this.name)];
  },
});

/** The note body of a `\footnote{...}` source, nested braces kept. */
function footnoteText(src: string): string {
  const m = /^\\footnote\*?\s*\{([\s\S]*)\}$/.exec(src);
  return m === null ? src : m[1]!;
}

/** The footnote preview: a superscript chip carrying the note, the
 *  hover title showing it in full. */
function footnotePreview(src: string): HTMLElement {
  const sup = document.createElement("sup");
  sup.className = "vis-footnote-note";
  const text = footnoteText(src);
  sup.textContent = text;
  sup.title = text;
  return sup;
}

const Footnote = Node.create({
  name: "footnote",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "vis-footnote" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["vis-footnote", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ({ editor, node, getPos }: NodeViewRendererProps) =>
      new EditableRawView(editor, node, getPos, {
        className: "vis-footnote",
        editText: (src) => src,
        buildSrc: (_old, text) => text,
        editOnSelect: true,
        preview: footnotePreview,
      });
  },
  // Typing \footnote{...} turns into the chip on the closing brace,
  // node-selected so its raw editor opens right away.
  addInputRules() {
    return [pillInputRule(/\\footnote\*?\s*\{([^{}\n]*)\}$/, this.name)];
  },
});

export const visualTexExtensions = [
  TexDocument,
  TexHeading,
  HeadingCaret,
  TexListItem,
  TexHardBreak,
  TexComment,
  Preamble,
  TitleBlock,
  MathInline,
  MathBlock,
  FigureBlock,
  EnvBlock,
  RawTexBlock,
  RawTexInline,
  Cite,
  Ref,
  Label,
  Footnote,
];
