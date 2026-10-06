// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorToolbar } from "@/components/EditorToolbar";
import { NewTheoremDialog } from "@/components/NewTheoremDialog";
import { setInsertHandler } from "@/lib/editor-insert";
import { setEnsurePackagesHandler } from "@/lib/editor-figure";
import { setApplyEditsHandler } from "@/lib/editor-edits";
import { useEditorStore } from "@/store/editor";

/**
 * The Code face's Insert menu: entries insert LaTeX snippets through
 * the insert handler (fresh-line framed), theorem entries load
 * amsthm first, and the shared new-theorem dialog validates before
 * committing.
 */

const TEX = [
  "\\documentclass{article}",
  "\\newtheorem{exercise}{Exercise}",
  "\\begin{document}",
  "Body.",
  "\\end{document}",
  "",
].join("\n");

async function mount(children: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(children);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return { host, root };
}

/** Open the Insert dropdown and click an item, as a user would. */
async function pickInsertItem(host: HTMLElement, itemText: string) {
  const trigger = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Insert"),
  );
  if (trigger === undefined) throw new Error("Insert trigger not found");
  await act(async () => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, bubbles: true, pointerId: 1 }),
    );
  });
  const menu = document.querySelector('[role="menu"]');
  if (menu === null) throw new Error("menu did not open");
  const item = [...menu.querySelectorAll('[role="menuitem"]')].find((b) =>
    b.textContent?.includes(itemText),
  );
  if (item === undefined) throw new Error(`item ${itemText} not found`);
  // Radix's select runs through ReactDOM.flushSync: out of act's band.
  item.dispatchEvent(new PointerEvent("click", { button: 0, bubbles: true, pointerId: 1 }));
  await act(async () => {});
}

describe("Code-face Insert menu", () => {
  it("inserts an environment skeleton through the insert handler", async () => {
    useEditorStore.getState().loadContent(TEX);
    const inserted: { text: string; offset?: number }[] = [];
    setInsertHandler((text, offset) => inserted.push({ text, offset }));
    const { host, root } = await mount(<EditorToolbar />);
    await pickInsertItem(host, "Quotation");
    expect(inserted).toEqual([
      { text: "\\begin{quotation}\n  \n\\end{quotation}", offset: 20 },
    ]);
    setInsertHandler(null);
    root.unmount();
  });

  it("loads amsthm before inserting a theorem environment", async () => {
    useEditorStore.getState().loadContent(TEX);
    const inserted: { text: string; offset?: number }[] = [];
    const packages: string[][] = [];
    setInsertHandler((text, offset) => inserted.push({ text, offset }));
    setEnsurePackagesHandler((pkgs) => packages.push(pkgs));
    const { host, root } = await mount(<EditorToolbar />);
    await pickInsertItem(host, "Theorem");
    expect(packages).toEqual([["amsthm"]]);
    expect(inserted[0]?.text).toContain("\\begin{theorem}");
    // Declared envs join the menu live.
    await pickInsertItem(host, "Exercise");
    expect(inserted[1]?.text).toContain("\\begin{exercise}");
    setInsertHandler(null);
    setEnsurePackagesHandler(null);
    root.unmount();
  });

  it("inserts footnote, display math, and float scaffolds", async () => {
    useEditorStore.getState().loadContent(TEX);
    const inserted: { text: string; offset?: number }[] = [];
    setInsertHandler((text, offset) => inserted.push({ text, offset }));
    const { host, root } = await mount(<EditorToolbar />);
    await pickInsertItem(host, "Footnote");
    await pickInsertItem(host, "Display math");
    await pickInsertItem(host, "Figure");
    expect(inserted[0]?.text).toBe("\\footnote{}");
    expect(inserted[1]?.text).toContain("\\[");
    expect(inserted[2]?.text).toContain("\\includegraphics");
    setInsertHandler(null);
    root.unmount();
  });
});

describe("NewTheoremDialog", () => {
  async function mountDialog(
    onCommit: (env: string, display: string, instance: boolean) => string | null,
    existingEnvs: string[] = [],
  ) {
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(
        <NewTheoremDialog open onOpenChange={() => {}} existingEnvs={existingEnvs} onCommit={onCommit} />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    return { host, root };
  }

  async function fillAndAdd(env: string, display: string) {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const inputs = [...dialog.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => {
      setNativeValue(inputs[0]!, env);
      setNativeValue(inputs[1]!, display);
    });
    const add = [...dialog.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add"),
    )!;
    add.dispatchEvent(new PointerEvent("click", { button: 0, bubbles: true, pointerId: 1 }));
    await act(async () => {});
  }

  /** React's value tracking ignores plain .value assignment. */
  function setNativeValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("commits the declaration values", async () => {
    const calls: [string, string, boolean][] = [];
    const { root } = await mountDialog((env, display, instance) => {
      calls.push([env, display, instance]);
      return null;
    });
    await fillAndAdd("conjecture", "Conjecture");
    expect(calls).toEqual([["conjecture", "Conjecture", true]]);
    root.unmount();
  });

  it("rejects invalid and duplicate names without committing", async () => {
    const calls: [string, string, boolean][] = [];
    const { root } = await mountDialog(
      (env, display, instance) => {
        calls.push([env, display, instance]);
        return null;
      },
      ["exercise"],
    );
    await fillAndAdd("not a name", "X");
    await fillAndAdd("exercise", "X");
    expect(calls).toEqual([]);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("already declared");
    root.unmount();
  });

  it("shows the face's failure when the commit returns one", async () => {
    const { root } = await mountDialog(() => "No preamble to hold it.");
    await fillAndAdd("ghost", "");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("No preamble to hold it.");
    root.unmount();
  });

  it("EditorToolbar's commit declares before \\begin{document}", async () => {
    useEditorStore.getState().loadContent(TEX);
    const edits: { from: number; to: number; insert: string }[] = [];
    const packages: string[][] = [];
    setApplyEditsHandler((list) => {
      edits.push(...list);
      return true;
    });
    setEnsurePackagesHandler((pkgs) => packages.push(pkgs));
    const { host, root } = await mount(
      <EditorToolbar />,
    );
    // The dialog sits inside the toolbar; open it via the menu.
    await pickInsertItem(host, "New theorem environment");
    const dialog = document.querySelector("[role='dialog']") as HTMLElement | null;
    expect(dialog).not.toBeNull();
    const inputs = [...dialog!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => {
      setNativeValue(inputs[0]!, "conjecture");
    });
    const add = [...dialog!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add"),
    )!;
    add.dispatchEvent(new PointerEvent("click", { button: 0, bubbles: true, pointerId: 1 }));
    await act(async () => {});
    expect(packages).toEqual([["amsthm"]]);
    expect(edits[0]?.insert).toBe("\\newtheorem{conjecture}{Conjecture}\n");
    // The declaration lands at the start of the \begin{document} line.
    expect(edits[0]?.from).toBe(TEX.indexOf("\\begin{document}"));
    setApplyEditsHandler(null);
    setEnsurePackagesHandler(null);
    root.unmount();
  });
});
