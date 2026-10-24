import { describe, expect, it, vi } from "vitest";

// Compiles resolve only when the test says so.
const pending: (() => void)[] = [];
const compileProject = vi.fn(
  () =>
    new Promise<{ success: boolean; issues: never[]; log: string }>((resolve) => {
      pending.push(() => resolve({ success: false, issues: [], log: "" }));
    }),
);

vi.mock("@/lib/tauri", () => ({
  compileProject: () => compileProject(),
  getPdf: () => Promise.resolve(new Uint8Array()),
  setPreviewZoom: () => Promise.resolve(),
  updatePreferences: () => Promise.resolve(),
}));

const { usePreviewStore } = await import("./preview");
const { useProjectStore } = await import("./project");

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("compileNow", () => {
  it("runs one compile at a time and queues a single follow-up", async () => {
    useProjectStore.setState({
      project: { name: "p", path: "/p" },
      mainFile: "main.tex",
    });
    const first = usePreviewStore.getState().compileNow();
    const second = usePreviewStore.getState().compileNow();
    const third = usePreviewStore.getState().compileNow();
    await settle();
    expect(compileProject).toHaveBeenCalledTimes(1);
    expect(second).toBe(third);

    pending.shift()?.();
    await first;
    await settle();
    expect(compileProject).toHaveBeenCalledTimes(2);

    pending.shift()?.();
    await second;
    expect(compileProject).toHaveBeenCalledTimes(2);
  });
});
