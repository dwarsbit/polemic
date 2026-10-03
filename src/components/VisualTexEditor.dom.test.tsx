// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VisualTexEditor } from "@/components/VisualTexEditor";
import { useEditorStore } from "@/store/editor";

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
    // The title card renders \\maketitle with meta pills.
    const card = host.querySelector(".vis-title-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Demo");
    expect(card!.textContent).toContain("J.~Smith");
    expect(card!.textContent).toContain("2026-10-02");
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

    // Inserting it adds the title block and clears the hint.
    await act(async () => {
      banner?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useEditorStore.getState().content).toContain("\\maketitle");
    expect(host.querySelector(".vis-title-card")).not.toBeNull();

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
});
