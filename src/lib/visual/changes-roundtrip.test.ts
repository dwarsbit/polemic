import { describe, expect, it } from "vitest";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";
import type { Inline } from "./doc-types";

const roundTrip = (tex: string) => serializeTex(parseTex(tex));

/** The paragraph's inline nodes as "text[marks]" strings. */
function inline(tex: string): string[] {
  const block = parseTex(tex).content?.[0];
  if (block?.type !== "paragraph") throw new Error("not a paragraph");
  return (block.content ?? []).map((node: Inline) => {
    const label = node.type === "text" ? node.text : node.type;
    const marks = (node.marks ?? []).map(
      (m) => `${m.type}${m.attrs?.author ? `:${m.attrs.author}` : ""}`,
    );
    return marks.length ? `${label}[${marks.join(",")}]` : label;
  });
}

describe("track changes in the visual round trip", () => {
  it("reads suggestions as marks with their author", () => {
    expect(inline("A \\added[id=LG]{new} and \\deleted[id=AN]{old} word.")).toEqual([
      "A ",
      "new[insertion:LG]",
      " and ",
      "old[deletion:AN]",
      " word.",
    ]);
  });

  it("puts the old text of a replacement first", () => {
    expect(inline("\\replaced[id=LG]{confirm}{suggest}")).toEqual([
      "suggest[deletion:LG]",
      "confirm[insertion:LG]",
    ]);
  });

  it("writes every form back byte for byte", () => {
    for (const tex of [
      "The results \\replaced[id=LG, comment={Too strong?}]{confirm}{suggest} our model.\n",
      "We \\added[id=AN]{carefully} measured \\deleted{all of} the samples.\n",
      "Some \\added[id=LG]{text with \\textbf{bold} and $x^2$ inside} here.\n",
      "\\deleted[id=LG]{struck \\added[id=AN]{their} words}\n",
      "A \\highlight[id=LG]{marked} word and \\added{plain id-less}.\n",
      "Cite \\added[id=LG]{\\cite{knuth} and \\ref{fig:a}} here.\n",
    ]) {
      expect(roundTrip(tex)).toBe(tex);
      expect(roundTrip(roundTrip(tex))).toBe(tex);
    }
  });

  it("keeps a malformed suggestion as raw text", () => {
    const tex = "Broken \\added[id=LG]{open\n\nnext\n";
    expect(roundTrip(tex)).toContain("\\added[id=LG]");
  });
});
