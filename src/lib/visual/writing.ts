import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { checkBlocks, grammarEnabled, type PlacedIssue } from "@/lib/grammar-check";
import type { ProseBlock } from "@/lib/prose";
import { blockWordRanges, findMisspelled } from "@/lib/spellcheck";
import { useSettingsStore } from "@/store/settings";
import type { WritingIssue } from "@/components/WritingPopover";

/**
 * Spelling and grammar in the Visual editor: the same checks as the
 * Code face, read straight from the document's text blocks (no TeX
 * mapping needed). Inline atoms stand in as the Code face's
 * placeholders: math and raw TeX read as "X", citations as "[1]",
 * references as "1"; labels and footnotes are left out.
 */

/** Placeholder text for inline atoms; atoms not listed are skipped. */
const ATOM_PLACEHOLDERS: Record<string, string> = {
  mathInline: "X",
  rawTexInline: "X",
  cite: "[1]",
  ref: "1",
};

/** The prose blocks of a document, mapped to ProseMirror positions. */
export function proseBlocksOfDoc(doc: PMNode): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const block: ProseBlock = { text: "", starts: [], ends: [], placeholders: [] };
    const push = (text: string, from: number, to: number) => {
      block.text += text;
      for (let k = 0; k < text.length; k++) {
        block.starts.push(from);
        block.ends.push(to);
      }
    };
    node.forEach((child, offset) => {
      const at = pos + 1 + offset;
      // Suggested deletions are not part of the final text.
      if (child.marks.some((m) => m.type.name === "deletion")) return;
      if (child.isText) {
        const text = child.text ?? "";
        for (let k = 0; k < text.length; k++) push(text[k], at + k, at + k + 1);
      } else if (child.type.name === "hardBreak") {
        push(" ", at, at + child.nodeSize);
      } else if (ATOM_PLACEHOLDERS[child.type.name] !== undefined) {
        const start = block.text.length;
        push(ATOM_PLACEHOLDERS[child.type.name], at, at + child.nodeSize);
        block.placeholders.push({ from: start, to: block.text.length });
      }
    });
    if (/\p{L}/u.test(block.text)) blocks.push(block);
    return false;
  });
  return blocks;
}

const writingKey = new PluginKey<DecorationSet>("writingChecks");

/** Opens the fixes popover (set by the Visual editor component). */
let issueHandler: ((issue: WritingIssue, x: number, y: number) => void) | null = null;

export function setVisualIssueHandler(
  handler: ((issue: WritingIssue, x: number, y: number) => void) | null,
) {
  issueHandler = handler;
}

/** Check the document and show the issues as decorations. */
export async function runVisualChecks(view: EditorView): Promise<void> {
  const doc = view.state.doc;
  const blocks = proseBlocksOfDoc(doc);
  const decorations: Decoration[] = [];
  if (useSettingsStore.getState().spellcheckEnabled) {
    const misspelled = await findMisspelled(blocks.flatMap(blockWordRanges));
    for (const range of misspelled ?? []) {
      decorations.push(
        Decoration.inline(
          range.from,
          range.to,
          { class: "writing-misspelled" },
          { issue: { kind: "spelling", word: range.word } },
        ),
      );
    }
  }
  if (grammarEnabled()) {
    const results = await checkBlocks(blocks);
    blocks.forEach((block, i) => {
      for (const issue of results?.[i] ?? []) {
        const from = block.starts[issue.from];
        const to = block.ends[Math.max(issue.from, issue.to - 1)];
        if (from === undefined || to === undefined || to <= from) continue;
        const text = block.text.slice(issue.from, issue.to);
        const placed: PlacedIssue = {
          ...issue,
          from,
          to,
          text,
          replaceable: doc.textBetween(from, to) === text,
        };
        decorations.push(
          Decoration.inline(
            from,
            to,
            {
              class: "writing-grammar",
              title: `${issue.message} (right-click for fixes)`,
            },
            { issue: { kind: "grammar", issue: placed } },
          ),
        );
      }
    });
  }
  // Stale: the document changed while checking; the next run catches up.
  if (view.isDestroyed || view.state.doc !== doc) return;
  view.dispatch(
    view.state.tr.setMeta(writingKey, DecorationSet.create(doc, decorations)),
  );
}

/** The issue under a document position: spelling first. */
function issueAt(view: EditorView, pos: number): WritingIssue | null {
  const set = writingKey.getState(view.state);
  const found = (set?.find(pos, pos) ?? []).filter((d) => d.from <= pos && pos < d.to);
  found.sort(
    (a, b) =>
      Number(a.spec.issue.kind !== "spelling") -
      Number(b.spec.issue.kind !== "spelling"),
  );
  const hit = found[0];
  if (hit === undefined) return null;
  const spec = hit.spec.issue as
    { kind: "spelling"; word: string } | { kind: "grammar"; issue: PlacedIssue };
  return spec.kind === "spelling"
    ? { kind: "spelling", word: spec.word, from: hit.from, to: hit.to }
    : {
        kind: "grammar",
        issue: { ...spec.issue, from: hit.from, to: hit.to },
        from: hit.from,
        to: hit.to,
      };
}

export const WritingChecks = Extension.create({
  name: "writingChecks",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: writingKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(writingKey) as DecorationSet | undefined;
            return next ?? set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return writingKey.getState(state);
          },
          handleDOMEvents: {
            contextmenu(view, event) {
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (at === null || issueHandler === null) return false;
              const issue = issueAt(view, at.pos);
              if (issue === null) return false;
              event.preventDefault();
              issueHandler(issue, event.clientX, event.clientY);
              return true;
            },
          },
        },
      }),
    ];
  },
});
