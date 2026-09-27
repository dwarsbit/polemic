import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/store/editor";

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.getState().clearJump();
    useEditorStore.getState().setContent("");
  });

  it("setContent updates content without bumping docVersion", () => {
    const before = useEditorStore.getState().docVersion;
    useEditorStore.getState().setContent("\\section{Test}");
    const state = useEditorStore.getState();
    expect(state.content).toBe("\\section{Test}");
    expect(state.docVersion).toBe(before);
  });

  it("loadContent bumps docVersion for external loads", () => {
    const before = useEditorStore.getState().docVersion;
    useEditorStore.getState().loadContent("new document");
    const state = useEditorStore.getState();
    expect(state.content).toBe("new document");
    expect(state.docVersion).toBe(before + 1);
  });

  it("jumpTo sets a jump target and clearJump resets it", () => {
    useEditorStore.getState().jumpTo(12);
    expect(useEditorStore.getState().jumpTarget).toBe(12);
    useEditorStore.getState().clearJump();
    expect(useEditorStore.getState().jumpTarget).toBeNull();
  });
});
