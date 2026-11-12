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

async function mount(issues: CompileIssue[], status: "ok" | "error" = "error") {
  usePreviewStore.setState({ issues, status });
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

const click = (target: Element | null | undefined) =>
  act(async () => {
    (target as HTMLElement).click();
  });

const rowNamed = (host: Element, text: string) =>
  [...host.querySelectorAll("li")].find(
    (li) =>
      li.querySelector(":scope > [role=button]")?.textContent?.includes(text) ?? false,
  );

describe("IssuesPanel", () => {
  it("opens the first error: plain words, what to do, the place and TeX's message", async () => {
    const host = await mount([
      error("Undefined control sequence.", {
        detail: ["l.4 The value \\frrac", "                {a}{b}"],
      }),
    ]);
    const row = host.querySelector("li")!;
    expect(row.querySelector("[role=button]")!.textContent).toContain(
      "Unknown command \\frrac",
    );
    expect(row.textContent).toContain("Check the spelling.");
    expect(row.querySelector("pre")!.textContent).toBe("4The value \\frrac{a}{b}");
    expect(row.textContent).toContain("TeX's message: Undefined control sequence.");
  });

  it("keeps TeX's message for an issue outside the catalog", async () => {
    const host = await mount([
      error("Package caption Error: Undefined justification."),
    ]);
    const row = host.querySelector("li")!;
    expect(row.textContent).toContain(
      "Package caption Error: Undefined justification.",
    );
    expect(row.textContent).not.toContain("TeX's message");
  });

  it("folds the errors after the first", async () => {
    const host = await mount([
      error("Undefined control sequence.", { detail: ["l.4 \\frrac"] }),
      error("Missing $ inserted.", { line: 5 }),
      error("Missing $ inserted.", { line: 6 }),
      error("Undefined control sequence.", { line: 9, detail: ["l.9 \\alhpa"] }),
    ]);
    expect(host.textContent).not.toContain("Unknown command \\alhpa");
    const fold = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("3 more errors, most likely caused by the first"),
    );
    expect(fold?.getAttribute("aria-expanded")).toBe("false");
    await click(fold);
    expect(fold?.getAttribute("aria-expanded")).toBe("true");
    expect(rowNamed(host, "Unknown command \\alhpa")).toBeDefined();
    // Repeats are one row that says how often, with each place inside.
    const repeated = rowNamed(host, "Math used outside math mode")!;
    expect(repeated.textContent).toContain("2 times");
    expect(repeated.textContent).not.toContain("main.tex:6");
    await click(repeated.querySelector("button[aria-expanded]"));
    expect(repeated.textContent).toContain("main.tex:6");
  });

  it("says one more error in the singular", async () => {
    const host = await mount([
      error("Undefined control sequence.", { detail: ["l.4 \\frrac"] }),
      error("Missing $ inserted.", { line: 5 }),
    ]);
    expect(host.textContent).toContain("1 more error, most likely caused by the first");
  });

  it("lists warnings of one kind as one row that opens", async () => {
    usePreviewStore.setState({ status: "ok" });
    const warning = (message: string, line: number): CompileIssue => ({
      ...error(message, { line }),
      severity: "warning",
    });
    const host = await mount(
      [
        warning("LaTeX Warning: Citation `a' on page 1 undefined on input line 4", 4),
        warning("LaTeX Warning: Citation `b' on page 1 undefined on input line 9", 9),
      ],
      "ok",
    );
    const rows = host.querySelectorAll("li");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("2 citations without a bibliography entry");
    // Warnings start closed.
    expect(rows[0].textContent).not.toContain("Check the key");
    await click(rows[0].querySelector("button[aria-expanded]"));
    expect(rows[0].textContent).toContain("Check the key");
    expect(rows[0].textContent).toContain("No bibliography entry b for this citation");
    expect(rows[0].textContent).toContain("main.tex:9");
  });

  it("closes a row and keeps it closed on the next compile", async () => {
    const issues = () => [
      error("Undefined control sequence.", { detail: ["l.4 \\frrac"] }),
    ];
    const host = await mount(issues());
    await click(host.querySelector("li button[aria-expanded]"));
    expect(host.textContent).not.toContain("Check the spelling.");
    await act(async () => {
      usePreviewStore.setState({ issues: issues() });
    });
    expect(host.textContent).not.toContain("Check the spelling.");
  });

  it("prefers an issue's own hint, and fits advice to the server", async () => {
    useSettingsStore.setState({ compileProvider: "polemic" });
    const host = await mount([error("LaTeX Error: File `siunitx.sty' not found.")]);
    const row = host.querySelector("li")!;
    expect(row.textContent).toContain("Package siunitx not found");
    expect(row.textContent).toContain("TeX Live");
    const own = await mount([
      error("BibTeX failed: Repeated entry", { hint: "Rename one of them." }),
    ]);
    expect(own.querySelector("li")!.textContent).toContain("Rename one of them.");
  });
});
