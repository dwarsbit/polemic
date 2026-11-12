import { afterEach, describe, expect, it, vi } from "vitest";
import { placeInWords, watchCompileFailures } from "@/lib/show-issue";
import type { CompileIssue } from "@/lib/tauri";
import { usePreviewStore } from "@/store/preview";

const error: CompileIssue = {
  severity: "error",
  file: "main.tex",
  line: 3,
  message: "Undefined control sequence.",
  detail: [],
};
const warning: CompileIssue = { ...error, severity: "warning" };

const compile = (issues: CompileIssue[], ok: boolean) => {
  usePreviewStore.setState({ status: "compiling" });
  usePreviewStore.setState({ status: ok ? "ok" : "error", issues });
};

describe("watchCompileFailures", () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    usePreviewStore.setState({ status: "idle", issues: [] });
  });

  it("tells of the first failure, then waits for a compile that works", () => {
    const onFailure = vi.fn();
    stop = watchCompileFailures(onFailure);
    compile([error], false);
    expect(onFailure).toHaveBeenCalledTimes(1);
    // Still failing: the reader has seen it, and may have closed Issues.
    compile([error], false);
    compile([error, error], false);
    expect(onFailure).toHaveBeenCalledTimes(1);
    compile([warning], true);
    compile([error], false);
    expect(onFailure).toHaveBeenCalledTimes(2);
  });

  it("says nothing of a failure with no errors to show", () => {
    const onFailure = vi.fn();
    stop = watchCompileFailures(onFailure);
    // The compile could not run at all: the preview says why.
    compile([], false);
    expect(onFailure).not.toHaveBeenCalled();
    compile([error], false);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("stops watching", () => {
    const onFailure = vi.fn();
    watchCompileFailures(onFailure)();
    compile([error], false);
    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe("placeInWords", () => {
  it("names the file and the line", () => {
    expect(placeInWords(error)).toBe("main.tex, line 3");
    expect(placeInWords({ ...error, line: null })).toBe("main.tex");
    expect(placeInWords({ ...error, file: null })).toBe("line 3");
    expect(placeInWords({ ...error, file: null, line: null })).toBeNull();
  });
});
