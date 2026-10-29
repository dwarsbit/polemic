import { describe, expect, it } from "vitest";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";

/** serialize(parse(x)) must reproduce `x` byte-for-byte. */
const rt = (tex: string) => serializeTex(parseTex(tex));

describe("inline roundtrip preserves source", () => {
  it.each([
    ["bare brace group", "A {\\bfseries B} C\n"],
    ["nested bare groups", "A {x {y} z} C\n"],
    ["symbol accent with braced argument", "caf\\'{e}\n"],
    ["accent forms", 'Go \\"{o} \\`{a} \\^{e} \\~{n} \\={o} \\.{z}\n'],
    ["symbol accent without braces", "caf\\'e na\\\"ive\n"],
    ["letter accents", "Go \\c{c} \\v{s} \\u{g} \\H{o}\n"],
    ["\\verb body", "x \\verb|a_b  c| y\n"],
    ["\\verb* body", "x \\verb*+a_b  {c+ y\n"],
    ["\\verb with % inside", "x \\verb!50%! y\n"],
    ["comment before paragraph break", "text % c\n\nmore\n"],
    [
      "comment before paragraph break in quote",
      "\\begin{quote}\n  text % c\n\n  more\n\\end{quote}\n",
    ],
    [
      "comment before paragraph break in theorem",
      "\\begin{theorem}\n  text % c\n\n  more\n\\end{theorem}\n",
    ],
  ])("%s", (_name, tex) => {
    expect(rt(tex)).toBe(tex);
  });

  it("keeps a comment that only ends a line inside the paragraph", () => {
    const tex = "text % c\nmore\n";
    expect(rt(tex)).toBe(tex);
    expect(parseTex(tex).content).toHaveLength(1);
  });

  it("keeps a brace group inside a format mark verbatim", () => {
    // Inline atoms do not carry format marks yet, so the mark splits
    // around the group; the group itself must survive unescaped.
    expect(rt("Go \\textbf{a {\\itshape b} c}\n")).toContain("{\\itshape b}");
  });

  it("keeps a % inside \\verb out of comments", () => {
    const doc = parseTex("x \\verb!50%! y\n");
    expect(doc.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "x " },
        { type: "rawTexInline", attrs: { src: "\\verb!50%!" } },
        { type: "text", text: " y" },
      ],
    });
  });

  it("splits paragraphs at a blank line after a comment", () => {
    expect(parseTex("text % c\n\nmore\n").content).toHaveLength(2);
  });
});
