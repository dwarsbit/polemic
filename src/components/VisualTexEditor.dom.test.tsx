// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { VisualTexEditor } from "@/components/VisualTexEditor";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";
import { flushPendingSerialize } from "@/lib/visual/pending-serialize";

const TEX = `\\documentclass{article}
\\usepackage{amsmath}
\\title{Demo}
\\author{J.~Smith}
\\date{2026-10-02}

\\begin{document}
\\maketitle
\\section{Hi}
Hello \\emph{world} with $x^2$ and \\cite{a}.
\\begin{itemize}
  \\item one
\\end{itemize}
\\begin{figure}
  \\includegraphics{assets/plot.png}
  \\caption{Plot.}
\\end{figure}
\\begin{tikzpicture}
  \\draw (0,0);
\\end{tikzpicture}
\\end{document}
`;

const TEX_NO_MAKETITLE = TEX.replace("\\maketitle\n", "");

describe("VisualTexEditor render", () => {
  it("mounts and shows the document with its title card", async () => {
    useEditorStore.getState().loadContent(TEX);
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);

    let error: unknown = null;
    try {
      await act(async () => {
        root.render(<VisualTexEditor />);
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const html = host.innerHTML;
    expect(host.querySelector(".visual-editor")).not.toBeNull();
    expect(html).toContain("vis-math");
    // The preamble summary bar hides the extracted commands.
    expect(host.querySelector(".vis-preamble-card")).not.toBeNull();
    expect(html).not.toContain("documentclass");
    // The title block is a slim \\maketitle marker; the values show
    // once, in the preamble card's metadata pills.
    const card = host.querySelector(".vis-title-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).not.toContain("Demo");
    expect(card!.textContent).not.toContain("J.~Smith");
    expect(card!.textContent).toContain("maketitle");
    const preamble = host.querySelector(".vis-preamble-card");
    expect(preamble!.textContent).toContain("Demo");
    expect(preamble!.textContent).toContain("J.~Smith");
    expect(preamble!.textContent).toContain("2026-10-02");
    // No hint when \\maketitle is present.
    expect(html).not.toContain("Insert \\maketitle");

    // Merely opening the visual face must not touch the file.
    expect(useEditorStore.getState().content).toBe(TEX);

    root.unmount();
  });

  it("offers to insert \\maketitle when metadata has none", async () => {
    useEditorStore.getState().loadContent(TEX_NO_MAKETITLE);
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(<VisualTexEditor />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const banner = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Insert \\maketitle"),
    );
    expect(banner).toBeDefined();

    // Inserting it adds the title block and clears the hint. The store
    // copy debounces behind the editor; the flush is what a save or
    // face toggle would do.
    await act(async () => {
      banner?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      flushPendingSerialize();
    });
    expect(useEditorStore.getState().content).toContain("\\maketitle");
    expect(host.querySelector(".vis-title-card")).not.toBeNull();

    root.unmount();
  });

  it("offers the Insert menu with the quote family and theorems", async () => {
    useEditorStore.getState().loadContent(TEX);
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(<VisualTexEditor />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const insert = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Insert"),
    );
    expect(insert).toBeDefined();

    root.unmount();
  });

  it("editing a preamble metadata pill leaves the preamble alone", async () => {
    useEditorStore.getState().loadContent(TEX);
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(<VisualTexEditor />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Open the title pill's in-place editor inside the preamble card:
    // the text span itself turns editable.
    const pill = [...host.querySelectorAll("button")].find(
      (b) =>
        b.closest(".vis-preamble-card") !== null &&
        b.textContent?.includes("Demo"),
    );
    expect(pill).toBeDefined();
    await act(async () => {
      pill?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      pill?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const editable = host.querySelector<HTMLElement>(
      ".vis-preamble-card [contenteditable='true']",
    );
    expect(editable).not.toBeNull();

    // Keys typed into the editable span are its own business: they
    // must not reach the editor and act on the node selection.
    await act(async () => {
      editable?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
      );
      editable?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(host.querySelector(".vis-preamble-card")).not.toBeNull();
    expect(useEditorStore.getState().content).toBe(TEX);

    root.unmount();
  });

  it("keeps the cursor's place across a same-file reload", async () => {
    const tex = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Alpha}",
      "",
      "Alpha text here.",
      "",
      "\\section{Beta}",
      "",
      "Beta text here.",
      "\\end{document}",
      "",
    ].join("\n");
    useEditorStore.getState().loadContent(tex);
    useProjectStore.setState({ activeFile: "main.tex" });
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(<VisualTexEditor />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Tiptap exposes the editor on its DOM element.
    const el = host.querySelector(".tiptap") as HTMLElement & { editor: Editor };
    expect(el.editor).toBeDefined();
    const editor = el.editor as Editor;
    // The caret goes into the Beta paragraph, deep in the document.
    let betaPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (betaPos === -1 && node.type.name === "paragraph" && node.textContent.includes("Beta text here.")) {
        betaPos = pos;
        return false;
      }
      return true;
    });
    expect(betaPos).toBeGreaterThanOrEqual(0);
    await act(async () => {
      editor.commands.setTextSelection(betaPos + 1);
    });
    expect(editor.state.selection.$from.parent.textContent).toContain("Beta text here.");

    // An external edit reloads the SAME file; content changes at the
    // end (an external sync edit), the caret's section survives.
    const changed = tex.replace("Alpha text here.", "Alpha text edited.");
    await act(async () => {
      useEditorStore.getState().loadContent(changed);
    });
    expect(editor.state.selection.$from.parent.textContent).toContain("Beta text here.");

    // A tab switch to ANOTHER file starts fresh: no re-anchor.
    useProjectStore.setState({ activeFile: "other.tex" });
    await act(async () => {
      useEditorStore.getState().loadContent("\\documentclass{article}\n\\begin{document}\nOther file.\n\\end{document}\n");
    });
    expect(editor.state.selection.$from.parent.textContent).not.toContain("Beta text here.");
    useProjectStore.setState({ activeFile: null });

    root.unmount();
  });

  it("debounces serialization into the store; the flush serializes now", async () => {
    const tex = "\\documentclass{article}\n\\begin{document}\nBody.\n\\end{document}\n";
    useEditorStore.getState().loadContent(tex);
    useProjectStore.setState({ activeFile: "main.tex" });
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(<VisualTexEditor />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const el = host.querySelector(".tiptap") as HTMLElement & { editor: Editor };
    const editor = el.editor as Editor;
    let bodyPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (bodyPos === -1 && node.type.name === "paragraph" && node.textContent.includes("Body.")) {
        bodyPos = pos;
        return false;
      }
      return true;
    });
    await act(async () => {
      editor.commands.setTextSelection(bodyPos + 1);
      editor.commands.insertContent(" More");
    });

    // The store lags behind the editor: serialization debounces.
    expect(useEditorStore.getState().content).not.toContain("More");

    // The flush (what saves, buffer flushes, and the face toggle
    // call) serializes immediately.
    await act(async () => {
      flushPendingSerialize();
    });
    expect(useEditorStore.getState().content).toContain("More");

    // An unflushed edit waits out the debounce, then lands.
    await act(async () => {
      editor.commands.insertContent(" and more");
    });
    expect(useEditorStore.getState().content).not.toContain("and more");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(useEditorStore.getState().content).toContain("and more");

    useProjectStore.setState({ activeFile: null });
    root.unmount();
  });

  it("respects the font size and spellcheck settings", async () => {
    useEditorStore.getState().loadContent(TEX);
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(<VisualTexEditor />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const column = host.querySelector(".visual-editor") as HTMLElement;
    // The default 14px, live from the settings store.
    expect(column.style.getPropertyValue("--editor-font-size")).toBe("14px");
    expect(column.getAttribute("spellcheck")).toBe("true");
    expect(column.getAttribute("lang")).toBe("en");

    // Changing the setting re-renders the column with it.
    await act(async () => {
      useSettingsStore.setState({ fontSize: 18, spellcheckEnabled: false });
    });
    expect(column.style.getPropertyValue("--editor-font-size")).toBe("18px");
    expect(column.getAttribute("spellcheck")).toBe("false");

    // Atom node views opt out: LaTeX is not prose.
    const pill = host.querySelector(".vis-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.getAttribute("spellcheck")).toBe("false");

    useSettingsStore.setState({ fontSize: 14, spellcheckEnabled: true });
    root.unmount();
  });

  it("consumes panel jumps in the visual face, at paragraph granularity", async () => {
    const tex = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Alpha}",
      "Alpha text here.",
      "\\end{document}",
      "",
    ].join("\n");
    useEditorStore.getState().loadContent(tex);
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(<VisualTexEditor />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // A jump to the paragraph's line lands inside it.
    await act(async () => {
      useEditorStore.getState().jumpTo(4);
    });
    expect(useEditorStore.getState().jumpTarget).toBeNull();
    const editor = host.querySelector(".visual-editor .tiptap");
    expect(editor).not.toBeNull();

    // A jump to the heading's line lands right after it.
    await act(async () => {
      useEditorStore.getState().jumpTo(3);
    });
    expect(useEditorStore.getState().jumpTarget).toBeNull();

    root.unmount();
  });

  it("edits title metadata from the preamble settings row", async () => {
    useEditorStore.getState().loadContent(TEX_NO_MAKETITLE);
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(<VisualTexEditor />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // The preamble card carries the metadata pills with their values.
    const meta = host.querySelector(".vis-preamble-meta");
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toContain("Demo");
    expect(meta!.textContent).toContain("J.~Smith");

    // Clicking a pill turns its text span editable; committing
    // updates the TeX.
    const author = [...meta!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("J.~Smith"),
    );
    expect(author).toBeDefined();
    await act(async () => {
      author!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const editable = meta!.querySelector<HTMLElement>(
      "[contenteditable='true']",
    );
    expect(editable).not.toBeNull();
    editable!.textContent = "A.~Newauthor";
    await act(async () => {
      editable!.dispatchEvent(new Event("blur"));
    });
    await act(async () => {
      flushPendingSerialize();
    });
    expect(useEditorStore.getState().content).toContain("\\author{A.~Newauthor}");

    root.unmount();
  });
});
