// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VisualTexEditor } from "@/components/VisualTexEditor";
import { useEditorStore } from "@/store/editor";
import { flushPendingSerialize } from "@/lib/visual/pending-serialize";

/** Open the Insert dropdown and pick an item, as a user would. */
async function pickMenuItem(host: HTMLElement, triggerText: string, itemText: string) {
  const trigger = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(triggerText),
  );
  if (trigger === undefined) throw new Error("trigger not found");
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
  // Radix's item select runs through ReactDOM.flushSync; inside an
  // act batch that breaks, so the click goes out-of-band. (Only the
  // click: pointerup + click would make radix select twice.)
  item.dispatchEvent(new PointerEvent("click", { button: 0, bubbles: true, pointerId: 1 }));
  await act(async () => {});
}

describe("Insert menu interaction", () => {
  it("inserts an environment through the real dropdown", async () => {
    const tex = "\\documentclass{article}\n\\begin{document}\nBody.\n\\end{document}\n";
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

    await pickMenuItem(host, "Insert", "Quote");

    flushPendingSerialize();
    const out = useEditorStore.getState().content;
    expect(out).toContain("\\begin{quote}");
    root.unmount();
  });
});
