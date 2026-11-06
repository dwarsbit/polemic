// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { open } from "@/web/dialog";
import { pickedFile } from "@/web/uploads";

/** Answers the next file input with these files (none: cancelled). */
function pickNext(files: File[]) {
  const click = vi
    .spyOn(HTMLInputElement.prototype, "click")
    .mockImplementation(function (this: HTMLInputElement) {
      if (files.length === 0) {
        this.dispatchEvent(new Event("cancel"));
        return;
      }
      Object.defineProperty(this, "files", { value: files });
      this.dispatchEvent(new Event("change"));
    });
  return click;
}

afterEach(() => vi.restoreAllMocks());

describe("picking files in the browser", () => {
  it("answers names that stand for the picked files", async () => {
    const a = new File(["a"], "a.png");
    const b = new File(["b"], "b.csv");
    pickNext([a, b]);
    const names = (await open({ multiple: true })) as string[];
    expect(names).toHaveLength(2);
    expect(names[0].endsWith("/a.png")).toBe(true);
    expect(pickedFile(names[0])).toBe(a);
    expect(pickedFile(names[1])).toBe(b);
  });

  it("answers one name without multiple, and passes the filters on", async () => {
    const click = pickNext([new File(["x"], "data.csv")]);
    const name = await open({
      filters: [{ name: "Data", extensions: ["csv", "tsv"] }],
    });
    expect(typeof name).toBe("string");
    expect((click.mock.contexts[0] as HTMLInputElement).accept).toBe(".csv,.tsv");
  });

  it("answers null when cancelled", async () => {
    pickNext([]);
    expect(await open()).toBeNull();
    expect(pickedFile("upload:999/x.png")).toBeNull();
  });
});
