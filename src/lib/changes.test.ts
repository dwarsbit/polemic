import { describe, expect, it } from "vitest";
import {
  acceptAll,
  acceptChange,
  applyEdits,
  ensurePreamble,
  finalText,
  originalText,
  parseAuthors,
  parseChanges,
  rejectAll,
  rejectChange,
  removeSetup,
  optionsWithNote,
  setNote,
  showSuggestionsInPdf,
  suggestionsShownInPdf,
  type Change,
} from "@/lib/changes";

const slice = (source: string, r: { from: number; to: number } | null) =>
  r === null ? null : source.slice(r.from, r.to);

/** Kind, author, note and the new/old text of every suggestion. */
const summary = (source: string) =>
  parseChanges(source).map((c) => ({
    kind: c.kind,
    author: c.author,
    note: c.note,
    added: slice(source, c.added),
    deleted: slice(source, c.deleted),
  }));

const accept = (source: string, ref: Parameters<typeof acceptChange>[1]) =>
  applyEdits(source, acceptChange(source, ref));
const reject = (source: string, ref: Parameters<typeof rejectChange>[1]) =>
  applyEdits(source, rejectChange(source, ref));

/** A document like one compiled against the changes package (v4.2.1). */
const DOC = [
  "\\documentclass{article}",
  "\\usepackage{changes}",
  "\\definechangesauthor[name={Leon van der Grient}, color=orange]{LG}",
  "\\definechangesauthor[color=blue, name={Ann \\& Bo}]{LG2}",
  "\\begin{document}",
  "The results \\replaced[id=LG]{confirm}{suggest} our model.",
  "We \\added[id=LG2]{really} like \\deleted[id=LG]{very} braces \\{ and \\} and 100\\%.",
  "\\added[comment={Too strong?}, id=LG]{An \\emph{emphasised} {nested {group}} note.}",
  "\\replaced[id=LG, comment={Is 50\\% right?}]{new \\textbf{bold}}{old}",
  "\\deleted{no author} and \\added{anon}.",
  "\\added [id=LG] {spaced}",
  "\\highlight[id=LG]{marked}",
  "\\added[id=LG]{Unicode: Grüße, café}",
  "\\end{document}",
  "",
].join("\n");

describe("parseChanges", () => {
  it("reads every command with author, note and ranges", () => {
    expect(summary(DOC)).toEqual([
      {
        kind: "replaced",
        author: "LG",
        note: null,
        added: "confirm",
        deleted: "suggest",
      },
      { kind: "added", author: "LG2", note: null, added: "really", deleted: null },
      { kind: "deleted", author: "LG", note: null, added: null, deleted: "very" },
      {
        kind: "added",
        author: "LG",
        note: "Too strong?",
        added: "An \\emph{emphasised} {nested {group}} note.",
        deleted: null,
      },
      {
        kind: "replaced",
        author: "LG",
        note: "Is 50% right?",
        added: "new \\textbf{bold}",
        deleted: "old",
      },
      { kind: "deleted", author: null, note: null, added: null, deleted: "no author" },
      { kind: "added", author: null, note: null, added: "anon", deleted: null },
      { kind: "added", author: "LG", note: null, added: "spaced", deleted: null },
      { kind: "highlight", author: "LG", note: null, added: "marked", deleted: null },
      {
        kind: "added",
        author: "LG",
        note: null,
        added: "Unicode: Grüße, café",
        deleted: null,
      },
    ]);
  });

  it("gives the whole command and the options as ranges", () => {
    const source = "a \\replaced[id=LG]{x}{y} b";
    const [c] = parseChanges(source);
    expect(slice(source, c.range)).toBe("\\replaced[id=LG]{x}{y}");
    expect(slice(source, c.options)).toBe("[id=LG]");
  });

  it("returns nothing for documents without suggestions", () => {
    expect(parseChanges("")).toEqual([]);
    expect(
      parseChanges("Plain \\emph{text} with \\addedvalue and \\deletedness."),
    ).toEqual([]);
  });

  it("matches braces past escapes and comments", () => {
    const source = "\\added{a \\} b \\{ c % } not closing\nd}";
    expect(summary(source)[0].added).toBe("a \\} b \\{ c % } not closing\nd");
    expect(summary("\\added{100\\%} done")[0].added).toBe("100\\%");
  });

  it("ignores markup in comments, \\verb and verbatim", () => {
    const source = [
      "% \\added{in a comment}",
      "50\\% \\added{real}",
      "\\verb|\\added{verb}| and \\verb*+\\deleted{x}+",
      "\\begin{verbatim}",
      "\\added{verbatim}",
      "\\end{verbatim}",
      "\\\\% \\added{comment after a line break}",
    ].join("\n");
    expect(summary(source).map((c) => c.added)).toEqual(["real"]);
  });

  it("skips malformed commands without throwing", () => {
    for (const source of [
      "\\added",
      "\\added{",
      "\\added[id=LG{x}",
      "\\added[id=LG]",
      "\\replaced{only one}",
      "\\replaced{a} b {c}",
      "\\added{runs\n\nacross a paragraph}",
      "\\deleted}{",
      "}}}\\added{{{",
    ]) {
      expect(() => parseChanges(source)).not.toThrow();
      expect(parseChanges(source)).toEqual([]);
    }
  });

  it("finds valid suggestions after a malformed one", () => {
    const source = "\\replaced{only one} then \\deleted[id=LG]{y}";
    expect(summary(source).map((c) => [c.kind, c.deleted])).toEqual([["deleted", "y"]]);
    expect(summary("\\added{open \\deleted{inner}")).toMatchObject([
      { kind: "deleted", deleted: "inner" },
    ]);
  });

  it("reads options in any order, braced values, blanks and unknown keys", () => {
    const source =
      "\\added[ comment = {a, b=c} , id = {LG} , foo ]{x} \\added[]{y} \\added[id=]{z}";
    expect(summary(source).map((c) => [c.author, c.note])).toEqual([
      ["LG", "a, b=c"],
      [null, null],
      [null, null],
    ]);
  });

  it("lists nested suggestions in document order with their parent", () => {
    const source = "\\added[id=A]{x \\deleted[id=B]{y} z}";
    const changes = parseChanges(source);
    expect(changes.map((c) => c.kind)).toEqual(["added", "deleted"]);
    expect(changes[0].children).toEqual([changes[1]]);
  });

  it("keeps UTF-16 offsets for Unicode text", () => {
    const source = "😀 é \\added[id=LG]{日本 😀}!";
    const [c] = parseChanges(source);
    expect(slice(source, c.added)).toBe("日本 😀");
    expect(source.slice(c.range.to)).toBe("!");
  });

  it("handles CRLF line endings", () => {
    const source = "a \\added[id=LG]{b\r\nc} % \\deleted{x}\r\n\\deleted{d}\r\n";
    expect(summary(source).map((c) => c.added ?? c.deleted)).toEqual(["b\r\nc", "d"]);
    expect(parseChanges("\\added{a\r\n\r\nb}")).toEqual([]);
  });
});

describe("parseAuthors", () => {
  it("reads id, name and color", () => {
    expect(
      parseAuthors(DOC).map(({ id, name, color }) => ({ id, name, color })),
    ).toEqual([
      { id: "LG", name: "Leon van der Grient", color: "orange" },
      { id: "LG2", name: "Ann & Bo", color: "blue" },
    ]);
  });

  it("allows missing options and skips comments", () => {
    const source =
      "\\definechangesauthor{X}\n% \\definechangesauthor{Y}\n\\definechangesauthor[";
    expect(
      parseAuthors(source).map(({ id, name, color }) => ({ id, name, color })),
    ).toEqual([{ id: "X", name: null, color: null }]);
    expect(parseAuthors("no authors")).toEqual([]);
  });
});

describe("acceptChange / rejectChange", () => {
  it("keeps the new or the old text and drops the markup", () => {
    const source = "The results \\replaced[id=LG]{confirm}{suggest} our model.";
    expect(accept(source, 20)).toBe("The results confirm our model.");
    expect(reject(source, 20)).toBe("The results suggest our model.");
  });

  it("resolves additions and deletions", () => {
    expect(accept("a \\added{b} c", 3)).toBe("a b c");
    expect(reject("a \\added{b} c", 3)).toBe("a c");
    expect(accept("a \\deleted{b} c", 3)).toBe("a c");
    expect(reject("a \\deleted{b} c", 3)).toBe("a b c");
  });

  it("keeps markup inside the kept argument verbatim", () => {
    const source = "\\replaced{new \\emph{x} {y}}{old \\textbf{z}}";
    expect(accept(source, 0)).toBe("new \\emph{x} {y}");
    expect(reject(source, 0)).toBe("old \\textbf{z}");
  });

  it("returns one edit, with the note removed with the markup", () => {
    const source = "x \\added[id=LG, comment={Why?}]{y} z";
    const edits = acceptChange(source, 5);
    expect(edits).toHaveLength(1);
    expect(applyEdits(source, edits)).toBe("x y z");
  });

  it("takes the change itself, its range, or an offset inside it", () => {
    const source = "\\added{a} \\deleted{b}";
    const [, second] = parseChanges(source);
    expect(accept(source, second)).toBe("\\added{a}");
    expect(accept(source, second.range)).toBe("\\added{a}");
    expect(accept(source, second.range.from)).toBe("\\added{a}");
    expect(accept(source, { from: 0, to: 1 })).toBe("a \\deleted{b}");
  });

  it("returns no edits when nothing is there", () => {
    expect(acceptChange("\\added{a} b", 10)).toEqual([]);
    expect(rejectChange("plain", 0)).toEqual([]);
  });

  it("resolves the innermost suggestion at an offset, keeping the outer one", () => {
    const source = "\\added[id=A]{x \\deleted[id=B]{y} z}";
    expect(accept(source, source.indexOf("y"))).toBe("\\added[id=A]{x z}");
    expect(accept(source, 0)).toBe("x \\deleted[id=B]{y} z");
  });

  it("leaves no doubled or stray spaces when text goes", () => {
    expect(accept("a \\deleted{b} c", 3)).toBe("a c");
    expect(accept("word \\deleted{x}.", 6)).toBe("word.");
    expect(accept("\\deleted{x} start", 1)).toBe("start");
    expect(accept("a\n\\deleted{x} b", 3)).toBe("a\nb");
    expect(accept("end \\deleted{x}", 5)).toBe("end");
    expect(accept("a \\deleted{x}b", 3)).toBe("a b");
    expect(reject("a \\added{x} c", 3)).toBe("a c");
  });

  it("unwraps a highlight either way", () => {
    expect(accept("a \\highlight{b} c", 3)).toBe("a b c");
    expect(reject("a \\highlight{b} c", 3)).toBe("a b c");
  });

  it("works with Unicode and CRLF", () => {
    expect(accept("Grüße \\replaced{😀}{é}\r\nend", 7)).toBe("Grüße 😀\r\nend");
    expect(accept("a \\deleted{x}\r\nb", 3)).toBe("a\r\nb");
  });
});

describe("acceptAll / rejectAll", () => {
  const source =
    "\\added[id=A]{one} \\deleted[id=B]{two} \\replaced[id=A]{three}{3} \\highlight{h}";

  it("resolves every suggestion and leaves highlights", () => {
    expect(applyEdits(source, acceptAll(source))).toBe("one three \\highlight{h}");
    expect(applyEdits(source, rejectAll(source))).toBe("two 3 \\highlight{h}");
  });

  it("filters by author, null meaning no id", () => {
    expect(applyEdits(source, acceptAll(source, { author: "A" }))).toBe(
      "one \\deleted[id=B]{two} three \\highlight{h}",
    );
    expect(applyEdits(source, rejectAll(source, { author: "B" }))).toBe(
      "\\added[id=A]{one} two \\replaced[id=A]{three}{3} \\highlight{h}",
    );
    const anon = "\\added{x} \\added[id=A]{y}";
    expect(applyEdits(anon, acceptAll(anon, { author: null }))).toBe(
      "x \\added[id=A]{y}",
    );
  });

  it("returns ordered, non-overlapping edits", () => {
    const edits = acceptAll(source);
    for (let i = 1; i < edits.length; i++)
      expect(edits[i].from).toBeGreaterThanOrEqual(edits[i - 1].to);
  });

  it("resolves nested suggestions, by author too", () => {
    const nested = "\\added[id=A]{x \\deleted[id=B]{y} z}";
    expect(applyEdits(nested, acceptAll(nested))).toBe("x z");
    expect(applyEdits(nested, rejectAll(nested))).toBe("");
    expect(applyEdits(nested, acceptAll(nested, { author: "B" }))).toBe(
      "\\added[id=A]{x z}",
    );
    expect(applyEdits(nested, acceptAll(nested, { author: "A" }))).toBe(
      "x \\deleted[id=B]{y} z",
    );
  });

  it("returns no edits without suggestions", () => {
    expect(acceptAll("plain text")).toEqual([]);
    expect(rejectAll("")).toEqual([]);
  });
});

describe("finalText / originalText", () => {
  it("accepts or rejects everything, unwrapping highlights", () => {
    const body = DOC.slice(DOC.indexOf("The results"), DOC.indexOf("\\end{document}"));
    expect(finalText(body).text).toBe(
      [
        "The results confirm our model.",
        "We really like braces \\{ and \\} and 100\\%.",
        "An \\emph{emphasised} {nested {group}} note.",
        "new \\textbf{bold}",
        "and anon.",
        "spaced",
        "marked",
        "Unicode: Grüße, café",
        "",
      ].join("\n"),
    );
    expect(originalText(body).text).toBe(
      [
        "The results suggest our model.",
        "We like very braces \\{ and \\} and 100\\%.",
        "",
        "old",
        "no author and.",
        "",
        "marked",
        "",
        "",
      ].join("\n"),
    );
  });

  it("is the source itself without suggestions (fast path)", () => {
    const source = "Plain \\emph{text}.\n";
    const { text, map } = finalText(source);
    expect(text).toBe(source);
    for (let i = 0; i <= source.length; i++) {
      expect(map.toSource(i)).toBe(i);
      expect(map.toText(i)).toBe(i);
    }
    expect(finalText("").text).toBe("");
    expect(finalText("").map.toSource(0)).toBe(0);
  });

  it("maps every final offset back to the same character in the source", () => {
    const sources = [
      DOC,
      "a \\replaced{😀 x}{y} \\deleted{z} é\r\n\\added{w}",
      "\\added[id=A]{x \\deleted{y} z}",
    ];
    for (const source of sources) {
      const { text, map } = finalText(source);
      for (let i = 0; i < text.length; i++) {
        expect(source[map.toSource(i)]).toBe(text[i]);
        expect(map.toText(map.toSource(i))).toBe(i);
      }
      expect(map.toSource(text.length)).toBeLessThanOrEqual(source.length);
    }
  });

  it("maps source offsets in removed text to the cut", () => {
    const source = "ab \\deleted{xyz} cd";
    const { text, map } = finalText(source);
    expect(text).toBe("ab cd");
    expect(map.toText(source.indexOf("y"))).toBe(2);
    expect(map.toText(source.indexOf("cd"))).toBe(3);
    expect(map.toSource(3)).toBe(source.indexOf("cd"));
  });

  it("handles a document of nothing but a deletion", () => {
    const { text, map } = finalText("\\deleted{x}");
    expect(text).toBe("");
    expect(map.toSource(0)).toBe(0);
    expect(map.toText(5)).toBe(0);
  });
});

describe("round trips", () => {
  const sources = [
    DOC,
    "a \\replaced[id=A]{x}{y} b \\deleted{c} d \\added{e}.",
    "\\deleted{x} start \\added[id=B]{😀}\r\n\\deleted{y}\r\nend",
    "\\added[id=A]{x \\deleted[id=B]{y} z} \\replaced{\\emph{p}}{q}",
    "word \\deleted{x}. Next \\added{a}\\deleted{b} \\deleted{c} \\deleted{d} e",
  ];

  it("accepting everything gives the final text, rejecting the original", () => {
    for (const source of sources) {
      const noHighlight = source.replace(/\\highlight\[id=LG\]\{marked\}/, "marked");
      expect(applyEdits(noHighlight, acceptAll(noHighlight))).toBe(
        finalText(noHighlight).text,
      );
      expect(applyEdits(noHighlight, rejectAll(noHighlight))).toBe(
        originalText(noHighlight).text,
      );
    }
  });

  it("accepting one at a time ends at the final text", () => {
    for (const source of sources) {
      let text = source.replace(/\\highlight\[id=LG\]\{marked\}/, "marked");
      const expected = finalText(text).text;
      let guard = 0;
      for (
        let changes: Change[];
        (changes = parseChanges(text)).length > 0 && guard++ < 50;
      ) {
        text = applyEdits(text, acceptChange(text, changes[changes.length - 1]));
      }
      expect(text).toBe(expected);
    }
  });

  it("final text is unchanged by accepting any one suggestion", () => {
    for (const source of sources) {
      const expected = finalText(source).text;
      for (const change of parseChanges(source)) {
        expect(finalText(applyEdits(source, acceptChange(source, change))).text).toBe(
          expected,
        );
      }
    }
  });
});

describe("ensurePreamble", () => {
  const base =
    "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nHi\n\\end{document}\n";
  const leon = { name: "Leon van der Grient", initials: "LG" };

  it("adds the package and the author after the last package", () => {
    const { id, edits } = ensurePreamble(base, { ...leon, color: "orange" });
    expect(id).toBe("LG");
    expect(applyEdits(base, edits)).toBe(
      "\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{changes}\n" +
        "\\definechangesauthor[name={Leon van der Grient}, color=orange]{LG}\n\\begin{document}\nHi\n\\end{document}\n",
    );
  });

  it("produces markup the parser reads back", () => {
    const { id, edits } = ensurePreamble(base, { name: "A & B_c", initials: "AB" });
    const authors = parseAuthors(applyEdits(base, edits));
    expect(authors).toMatchObject([{ id, name: "A & B_c", color: "orange" }]);
  });

  it("does nothing when the author is already defined", () => {
    expect(ensurePreamble(DOC, leon)).toEqual({ id: "LG", edits: [] });
    expect(ensurePreamble(DOC, { name: "Ann & Bo", initials: "AB" })).toEqual({
      id: "LG2",
      edits: [],
    });
  });

  it("gives clashing initials a digit and a free color", () => {
    const { id, edits } = ensurePreamble(DOC, { name: "Lisa Green", initials: "LG" });
    expect(id).toBe("LG3");
    const next = applyEdits(DOC, edits);
    expect(next).toContain(
      "\\definechangesauthor[color=blue, name={Ann \\& Bo}]{LG2}\n" +
        "\\definechangesauthor[name={Lisa Green}, color=red]{LG3}\n\\begin{document}",
    );
    expect(next.match(/\\usepackage\{changes\}/g)).toHaveLength(1);
  });

  it("adds the author after the package when it is loaded", () => {
    const source =
      "\\documentclass{article}\n\\usepackage[final]{changes}\n\\usepackage{x}\n\\begin{document}\n";
    expect(applyEdits(source, ensurePreamble(source, leon).edits)).toBe(
      "\\documentclass{article}\n\\usepackage[final]{changes}\n" +
        "\\definechangesauthor[name={Leon van der Grient}, color=orange]{LG}\n\\usepackage{x}\n\\begin{document}\n",
    );
  });

  it("inserts before \\begin{document} without packages, keeping CRLF", () => {
    const source =
      "\\documentclass{article}\r\n% \\usepackage{changes}\r\n\\begin{document}\r\n";
    expect(applyEdits(source, ensurePreamble(source, leon).edits)).toBe(
      "\\documentclass{article}\r\n% \\usepackage{changes}\r\n\\usepackage{changes}\r\n" +
        "\\definechangesauthor[name={Leon van der Grient}, color=orange]{LG}\r\n\\begin{document}\r\n",
    );
  });

  it("adds nothing to a file that is not a main file", () => {
    expect(ensurePreamble("Just a chapter.", leon)).toEqual({ id: "LG", edits: [] });
  });
});

describe("setNote", () => {
  const set = (source: string, text: string | null) =>
    applyEdits(source, setNote(source, 0, text));

  it("adds options when there are none", () => {
    expect(set("\\added{x}", "Why?")).toBe("\\added[comment={Why?}]{x}");
    expect(set("\\added[]{x}", "Why?")).toBe("\\added[comment={Why?}]{x}");
  });

  it("appends to or rewrites existing options", () => {
    expect(set("\\added[id=LG]{x}", "Why?")).toBe("\\added[id=LG, comment={Why?}]{x}");
    expect(set("\\added[id=LG, comment={Old}]{x}", "New")).toBe(
      "\\added[id=LG, comment={New}]{x}",
    );
    expect(set("\\added[comment=old,id=LG]{x}", "New")).toBe(
      "\\added[comment={New},id=LG]{x}",
    );
  });

  it("removes the note and empty options", () => {
    expect(set("\\added[id=LG, comment={Old}]{x}", null)).toBe("\\added[id=LG]{x}");
    expect(set("\\added[comment={Old}, id=LG]{x}", "  ")).toBe("\\added[id=LG]{x}");
    expect(set("\\added[comment={Old}]{x}", null)).toBe("\\added{x}");
    expect(set("\\added[id=LG]{x}", null)).toBe("\\added[id=LG]{x}");
    expect(set("\\added{x}", null)).toBe("\\added{x}");
  });

  it("escapes LaTeX specials and reads them back", () => {
    const source = set("\\replaced[id=LG]{a}{b}", "50% {really}? a\\b & c\nd");
    expect(source).toBe(
      "\\replaced[id=LG, comment={50\\% \\{really\\}? a\\textbackslash{}b \\& c d}]{a}{b}",
    );
    expect(parseChanges(source)[0].note).toBe("50% {really}? a\\b & c d");
  });

  it("finds the change by offset and returns nothing elsewhere", () => {
    expect(setNote("plain", 0, "x")).toEqual([]);
  });
});

describe("removeSetup", () => {
  const remove = (source: string) => applyEdits(source, removeSetup(source));

  it("drops the package line and every author line", () => {
    const source =
      "\\documentclass{article}\n\\usepackage{graphicx}\n\\usepackage{changes}\n" +
      "\\definechangesauthor[name={Ann}, color=orange]{AN}\n" +
      "\\definechangesauthor[name={Bob}]{BO}\n\\begin{document}\nHi\n\\end{document}\n";
    expect(remove(source)).toBe(
      "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nHi\n\\end{document}\n",
    );
  });

  it("keeps other packages in a shared list and text on shared lines", () => {
    const source =
      "\\usepackage{xcolor,changes} % tc\n\\definechangesauthor{AN} \\relax\n";
    expect(remove(source)).toBe("\\usepackage{xcolor} % tc\n \\relax\n");
  });

  it("does nothing without a setup", () => {
    expect(removeSetup("\\usepackage{graphicx}\nText\n")).toEqual([]);
  });
});

describe("showSuggestionsInPdf", () => {
  const set = (source: string, show: boolean) =>
    applyEdits(source, showSuggestionsInPdf(source, show));

  it("adds and removes the final option", () => {
    const shown = "\\usepackage{changes}\n\\begin{document}\n";
    expect(suggestionsShownInPdf(shown)).toBe(true);
    const hidden = set(shown, false);
    expect(hidden).toBe("\\usepackage[final]{changes}\n\\begin{document}\n");
    expect(suggestionsShownInPdf(hidden)).toBe(false);
    expect(set(hidden, true)).toBe(shown);
  });

  it("keeps other options and splits a shared package list", () => {
    expect(set("\\usepackage[markup=underlined]{changes}\n", false)).toBe(
      "\\usepackage[markup=underlined, final]{changes}\n",
    );
    expect(set("\\usepackage{xcolor,changes}\n", false)).toBe(
      "\\usepackage{xcolor}\n\\usepackage[final]{changes}\n",
    );
  });

  it("is null without the package", () => {
    expect(suggestionsShownInPdf("\\usepackage{graphicx}\n")).toBeNull();
    expect(showSuggestionsInPdf("\\usepackage{graphicx}\n", false)).toEqual([]);
  });
});

describe("optionsWithNote", () => {
  it("sets, changes and removes a note in an options string", () => {
    expect(optionsWithNote("[id=LG]", "Why?")).toBe("[id=LG, comment={Why?}]");
    expect(optionsWithNote("[id=LG, comment={Why?}]", "Because")).toBe(
      "[id=LG, comment={Because}]",
    );
    expect(optionsWithNote("[id=LG, comment={Why?}]", null)).toBe("[id=LG]");
    expect(optionsWithNote(null, "50% sure")).toBe("[comment={50\\% sure}]");
    expect(optionsWithNote("[comment={x}]", null)).toBeNull();
  });
});
