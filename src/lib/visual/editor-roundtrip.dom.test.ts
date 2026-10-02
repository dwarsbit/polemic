// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";
import { visualTexExtensions } from "./extensions";
import type { DocNode } from "./doc-types";

/**
 * The full visual-mode loop without the app shell: source → parsed
 * JSON → a real Tiptap editor (schema validation, node views) →
 * edited JSON → serialized source. If the schema rejected or silently
 * normalized any part of the parsed document, these fail.
 */

function makeEditor(tex: string): Editor {
  const parsed = parseTex(tex) as DocNode & { content: unknown[] };
  const content =
    parsed.content.length > 0 ? parsed : { ...parsed, content: [{ type: "paragraph" }] };
  return new Editor({
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
    content,
  });
}

function throughEditor(tex: string): string {
  const editor = makeEditor(tex);
  const out = serializeTex(editor.getJSON() as unknown as DocNode);
  editor.destroy();
  return out;
}

const ARTICLE = `\\documentclass{article}
\\usepackage{amsmath}
\\title{Round Trip}
\\author{Tester}

\\begin{document}
\\maketitle
\\section{Results}

We measured $x^2$ values \\cite{smith2020} and reference \\ref{fig:plot}.

\\begin{itemize}
  \\item One
  \\item Two with \\emph{emphasis}
\\end{itemize}

\\begin{figure}[t]
  \\includegraphics{assets/plot.png}
  \\caption{A plot.}
\\end{figure}

\\begin{tikzpicture}
  \\draw (0,0) -- (1,1);
\\end{tikzpicture}

% a comment
\\end{document}
`;

describe("editor round-trip", () => {
  it("serializes an untouched editor identically to the direct path", () => {
    expect(throughEditor(ARTICLE)).toBe(serializeTex(parseTex(ARTICLE)));
  });

  it("is idempotent through the editor", () => {
    const once = throughEditor(ARTICLE);
    expect(throughEditor(once)).toBe(once);
  });

  it("turns an in-editor text edit into LaTeX", () => {
    const editor = makeEditor(ARTICLE);
    const paras: { pos: number }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph") paras.push({ pos });
      return true;
    });
    expect(paras.length).toBeGreaterThan(0);
    expect(editor.chain().focus().insertContentAt(paras[0]!.pos + 1, "Note: ").run()).toBe(true);
    const out = serializeTex(editor.getJSON() as unknown as DocNode);
    expect(out).toContain("Note: We measured");
    editor.destroy();
  });

  it("applies an edit made through a node-attr transaction (raw fallback edit)", () => {
    const editor = makeEditor(ARTICLE);
    const raws: { pos: number; node: PMNode }[] = [];
    editor.state.doc.descendants((node: PMNode, pos: number, parent: PMNode | null) => {
      if (node.type.name === "rawTexBlock" && parent !== null && parent.type.name === "doc") {
        raws.push({ pos, node });
      }
      return true;
    });
    expect(raws.length).toBeGreaterThan(0);
    editor.view.dispatch(
      editor.view.state.tr.setNodeMarkup(raws[0]!.pos, undefined, {
        ...raws[0]!.node.attrs,
        src: "\\begin{tikzpicture}\n  \\draw (9,9);\n\\end{tikzpicture}",
      }),
    );
    const out = serializeTex(editor.getJSON() as unknown as DocNode);
    expect(out).toContain("\\draw (9,9);");
    expect(out).not.toContain("\\draw (0,0)");
    editor.destroy();
  });
});
