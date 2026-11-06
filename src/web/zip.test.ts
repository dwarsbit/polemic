import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { unzipProject } from "@/web/projects";

const paths = (zip: Uint8Array) => unzipProject(zip).map((file) => file.path);

describe("unzipProject", () => {
  it("takes the files of a flat zip as they are", () => {
    const zip = zipSync({
      "main.tex": strToU8("x"),
      "figures/a.png": new Uint8Array([1]),
    });
    expect(paths(zip).sort()).toEqual(["figures/a.png", "main.tex"]);
    expect(unzipProject(zip).find((f) => f.path === "main.tex")!.bytes).toEqual(
      strToU8("x"),
    );
  });

  it("drops the one folder that holds everything", () => {
    const zip = zipSync({
      "paper-main/": {},
      "paper-main/main.tex": strToU8("x"),
      "paper-main/fig/a.pdf": new Uint8Array([1]),
    });
    expect(paths(zip).sort()).toEqual(["fig/a.pdf", "main.tex"]);
  });

  it("leaves out folder entries and macOS extras", () => {
    const zip = zipSync({
      "main.tex": strToU8("x"),
      "__MACOSX/._main.tex": strToU8("junk"),
      "empty/": {},
    });
    expect(paths(zip)).toEqual(["main.tex"]);
  });

  it("says when a file isn't a zip", () => {
    expect(() => unzipProject(strToU8("not a zip"))).toThrow();
    try {
      unzipProject(strToU8("not a zip"));
    } catch (e) {
      expect(e).toBe("This file isn't a zip file, or it is damaged.");
    }
  });
});
