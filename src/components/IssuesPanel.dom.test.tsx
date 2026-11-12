// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IssuesPanel } from "@/components/IssuesPanel";
import type { CompileIssue } from "@/lib/tauri";
import { usePreviewStore } from "@/store/preview";
import { useSettingsStore } from "@/store/settings";

const error = (message: string, extra: Partial<CompileIssue> = {}): CompileIssue => ({
  severity: "error",
  file: "main.tex",
  line: 4,
  message,
  detail: [],
  ...extra,
});

let root: Root | null = null;

async function mount(issues: CompileIssue[]) {
  usePreviewStore.setState({ issues, status: "error" });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<IssuesPanel tool="issues" onToggle={() => {}} />);
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  usePreviewStore.setState({ issues: [], status: "idle" });
  useSettingsStore.setState({ compileProvider: "local" });
});

describe("IssuesPanel", () => {
  it("shows an issue in plain words and keeps TeX's message on hover", async () => {
    const host = await mount([
      error("Undefined control sequence.", { detail: ["l.4 \\frrac"] }),
    ]);
    const row = host.querySelector("li")!;
    expect(row.textContent).toContain("Unknown command \\frrac");
    expect(row.querySelector("[title='Undefined control sequence.']")).not.toBeNull();
    expect(row.textContent).toContain("Check the spelling.");
  });

  it("keeps TeX's message for an issue outside the catalog", async () => {
    const host = await mount([
      error("Package caption Error: Undefined justification."),
    ]);
    expect(host.querySelector("li")!.textContent).toContain(
      "Package caption Error: Undefined justification.",
    );
  });

  it("gives the same advice once", async () => {
    const host = await mount([
      error("Undefined control sequence.", { detail: ["l.4 \\frrac"] }),
      error("Undefined control sequence.", { line: 9, detail: ["l.9 \\alhpa"] }),
    ]);
    const rows = [...host.querySelectorAll("li")];
    expect(rows[1].textContent).toContain("Unknown command \\alhpa");
    expect(rows[0].querySelectorAll("p")).toHaveLength(1);
    expect(rows[1].querySelectorAll("p")).toHaveLength(0);
  });

  it("prefers an issue's own hint, and fits advice to the server", async () => {
    useSettingsStore.setState({ compileProvider: "polemic" });
    const host = await mount([
      error("LaTeX Error: File `siunitx.sty' not found."),
      error("BibTeX failed: Repeated entry", { hint: "Rename one of them." }),
    ]);
    const rows = [...host.querySelectorAll("li")];
    expect(rows[0].textContent).toContain("Package siunitx not found");
    expect(rows[0].textContent).toContain("TeX Live");
    expect(rows[1].textContent).toContain("Rename one of them.");
  });
});
