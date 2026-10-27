// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { LatexEditor } from "@/components/LatexEditor";
import { applyEditsInView } from "@/lib/editor-edits";
import { useEditorStore } from "@/store/editor";

/**
 * Behind the Visual face the Code view stays mounted but only resyncs
 * on docVersion. Panel edits (outline moves, renames) are planned
 * against the store, so the hidden view must catch up before applying
 * them, and the Visual face must be told to reload afterwards.
 */

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(visible: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <LatexEditor visible={visible} />
      </QueryClientProvider>,
    );
  });
}

describe("applyEditsInView behind the Visual face", () => {
  it("applies edits to the store's text and reloads the Visual face", async () => {
    useEditorStore.getState().loadContent("\\section{A}\n\\section{B}\n");
    await mount(false);
    // The Visual face serializes a change the hidden view never saw.
    useEditorStore.getState().setContent("\\section{A}\nnew\n\\section{B}\n");
    const version = useEditorStore.getState().docVersion;

    let applied = false;
    act(() => {
      applied = applyEditsInView([{ from: 9, to: 10, insert: "Z" }], "input.structure");
    });

    expect(applied).toBe(true);
    expect(useEditorStore.getState().content).toBe("\\section{Z}\nnew\n\\section{B}\n");
    expect(useEditorStore.getState().docVersion).toBe(version + 1);
  });

  it("leaves docVersion alone when the Code face is in front", async () => {
    useEditorStore.getState().loadContent("\\section{A}\n");
    await mount(true);
    const version = useEditorStore.getState().docVersion;

    act(() => {
      applyEditsInView([{ from: 9, to: 10, insert: "Z" }]);
    });

    expect(useEditorStore.getState().content).toBe("\\section{Z}\n");
    expect(useEditorStore.getState().docVersion).toBe(version);
  });
});
