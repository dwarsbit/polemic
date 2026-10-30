import { describe, expect, it, vi } from "vitest";

// Compiles resolve only when the test says so.
const pending: (() => void)[] = [];
const compileProject = vi.fn(
  () =>
    new Promise<{ success: boolean; issues: never[]; log: string }>((resolve) => {
      pending.push(() => resolve({ success: false, issues: [], log: "" }));
    }),
);

const cancelCompile = vi.fn(() => Promise.resolve());

vi.mock("@/lib/tauri", () => ({
  compileProject: () => compileProject(),
  getPdf: () => Promise.resolve(new Uint8Array()),
  cancelCompile: () => cancelCompile(),
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
    cancelCompile.mockClear();
    const first = usePreviewStore.getState().compileNow();
    expect(cancelCompile).not.toHaveBeenCalled();
    const second = usePreviewStore.getState().compileNow();
    // A compile with Polemic still running stops for the follow-up.
    expect(cancelCompile).toHaveBeenCalled();
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

  it("keeps the kind of an error, and ignores a compile stopped for a newer one", async () => {
    useProjectStore.setState({
      project: { name: "p", path: "/p" },
      mainFile: "main.tex",
    });
    compileProject.mockImplementationOnce(() =>
      Promise.reject({ kind: "noTex", message: "failed to run latexmk", retryAfter: null }),
    );
    await usePreviewStore.getState().compileNow();
    expect(usePreviewStore.getState()).toMatchObject({
      status: "error",
      error: "failed to run latexmk",
      errorKind: "noTex",
    });

    usePreviewStore.setState({ status: "compiling", error: null, errorKind: null });
    compileProject.mockImplementationOnce(() =>
      Promise.reject({ kind: "cancelled", message: "A newer compile took over.", retryAfter: null }),
    );
    await usePreviewStore.getState().compileNow();
    expect(usePreviewStore.getState()).toMatchObject({ status: "compiling", error: null });

    compileProject.mockImplementationOnce(() => Promise.reject("plain failure"));
    await usePreviewStore.getState().compileNow();
    expect(usePreviewStore.getState()).toMatchObject({
      error: "plain failure",
      errorKind: "failed",
    });
  });
});
