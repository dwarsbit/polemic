import { describe, expect, it } from "vitest";

import {
  displayValue,
  entryByline,
  entryTitle,
  findMatching,
  formatEntry,
  missingFields,
  parseBibEntries,
  planEntryEdits,
  suggestKey,
  typeLabel,
} from "./bib-entries";
import { applyEdits } from "./label-index";

const source = [
  "This file has prose and % a comment.",
  "@article{knuth84,",
  "  author = {Knuth, Donald E.},",
  '  title = "Literate Programming",',
  "  journal = {The Computer Journal},",
  "  year = 1984,",
  "  volume = {27},",
  "}",
  "@book{lamport94, author = {Lamport, Leslie}, title = {{LaTeX: A Document Preparation System}}, publisher = {Addison-Wesley}, year = {1994}}",
  "@inproceedings{doe99, author = \"Doe, Jane\" # {, Jr.}, title = {A {Nested} Paper}, booktitle = {Proc. of X}, year = 1999}",
  "@comment{not an entry @article{fake, title = {x}}}",
  "@string{acm = {Association for Computing Machinery}}",
  "@preamble{\"stuff\"}",
  "@misc{nothing}",
  "@techreport{tr1,author={A},title={B},institution={C},year={2001}}",
].join("\n");

describe("parseBibEntries", () => {
  const { entries, strings } = parseBibEntries(source);

  it("collects entries with type and key, skipping comment/preamble", () => {
    expect(entries.map((entry) => entry.key)).toEqual([
      "knuth84",
      "lamport94",
      "doe99",
      "nothing",
      "tr1",
    ]);
    expect(entries[0].type).toBe("article");
    expect(entries[1].type).toBe("book");
  });

  it("parses fields with names, display values, and positions", () => {
    const knuth = entries[0];
    const author = knuth.fields.find((field) => field.name === "author");
    expect(author?.value).toBe("Knuth, Donald E.");
    expect(source.slice(author!.from, author!.to)).toBe("{Knuth, Donald E.}");
    const title = knuth.fields.find((field) => field.name === "title");
    expect(source.slice(title!.from, title!.to)).toBe('"Literate Programming"');
    const year = knuth.fields.find((field) => field.name === "year");
    expect(year?.value).toBe("1984");
  });

  it("tracks the whole entry, key range, and line", () => {
    const knuth = entries[0];
    expect(source.slice(knuth.from, knuth.to)).toBe(
      source.match(/@article\{knuth84[\s\S]*?\n\}/)![0],
    );
    expect(source.slice(knuth.keyFrom, knuth.keyTo)).toBe("knuth84");
    expect(knuth.line).toBe(2);
  });

  it("handles nested braces and quoted values with concatenation", () => {
    const doe = entries[2];
    expect(doe.fields.find((field) => field.name === "author")?.value).toBe(
      "Doe, Jane, Jr.",
    );
    expect(doe.fields.find((field) => field.name === "title")?.value).toBe(
      "A Nested Paper",
    );
  });

  it("collects @string definitions without substituting them", () => {
    expect(strings["acm"]).toBe("{Association for Computing Machinery}");
  });

  it("survives entries without fields", () => {
    expect(entries[3].fields).toEqual([]);
  });

  it("does not treat an unclosed trailing entry as an entry", () => {
    const { entries: partial } = parseBibEntries("@article{open,");
    expect(partial).toEqual([]);
  });
});

describe("missingFields", () => {
  it("lists required fields per type", () => {
    const { entries } = parseBibEntries(source);
    expect(missingFields(entries[0])).toEqual([]);
    expect(missingFields(entries[3])).toEqual([]); // misc: nothing required
    const tr = entries[4];
    expect(missingFields({ type: tr.type, fields: tr.fields })).toEqual([]);
    expect(missingFields({ type: "article", fields: tr.fields })).toEqual([
      "journal",
    ]);
  });
});

describe("entryTitle", () => {
  it("uses the title, falling back to the author", () => {
    const { entries } = parseBibEntries(source);
    expect(entryTitle(entries[0])).toBe("Literate Programming");
    expect(entryTitle(entries[3])).toBe("");
  });
});

describe("displayValue", () => {
  it("strips braces and collapses whitespace", () => {
    expect(displayValue("{A\n  B}")).toBe("A B");
    expect(displayValue('"quoted"')).toBe("quoted");
    expect(displayValue("1994")).toBe("1994");
  });
});

describe("findMatching", () => {
  it("finds the matching close for nested braces and parens", () => {
    expect(findMatching("{a{b}c}", 0, "{")).toBe(6);
    expect(findMatching("(a(b)c)", 0, "(")).toBe(6);
    expect(findMatching("{open", 0, "{")).toBe(-1);
  });
});

describe("formatEntry", () => {
  it("formats a new entry, skipping empty fields", () => {
    expect(
      formatEntry("Article", "knuth84", [
        { name: "author", value: "Knuth" },
        { name: "year", value: "1984" },
        { name: "note", value: "  " },
      ]),
    ).toBe("@article{knuth84,\n  author = {Knuth},\n  year = {1984},\n}\n");
  });
});

describe("planEntryEdits", () => {
  const bib = [
    "@article{knuth84,",
    "  author = {Knuth, Donald E.},",
    "  title = {Literate Programming},",
    "  journal = {The Computer Journal},",
    "  year = 1984",
    "}",
    "@book{lamport94, author = {Lamport, Leslie}, title = {L}, year = {1994}}",
    "@misc{nothing}",
  ].join("\n");

  it("changes a field value in place", () => {
    const edits = planEntryEdits(bib, "knuth84", {
      key: "knuth84",
      type: "article",
      fields: [
        { name: "author", value: "Knuth, Donald E." },
        { name: "title", value: "Literate Programming" },
        { name: "journal", value: "Computing Journal" },
        { name: "year", value: "1984" },
      ],
    })!;
    const next = applyEdits(bib, edits);
    expect(next).toContain("journal = {Computing Journal}");
    expect(next).toContain("title = {Literate Programming}");
    expect(next).toContain("@book{lamport94, author = {Lamport, Leslie}, title = {L}, year = {1994}}");
  });

  it("renames the key and type, removes and adds fields", () => {
    const edits = planEntryEdits(bib, "knuth84", {
      key: "knuth1984",
      type: "inproceedings",
      fields: [
        { name: "author", value: "Knuth, Donald E." },
        { name: "year", value: "1984" },
        { name: "booktitle", value: "Proc. X" },
      ],
    })!;
    const next = applyEdits(bib, edits);
    expect(next).toContain("@inproceedings{knuth1984,");
    expect(next).not.toContain("Literate Programming");
    expect(next).not.toContain("journal");
    expect(next).toContain("booktitle = {Proc. X},");
  });

  it("adds the missing comma when the entry had none", () => {
    const edits = planEntryEdits(bib, "nothing", {
      key: "nothing",
      type: "misc",
      fields: [{ name: "note", value: "n" }],
    })!;
    const next = applyEdits(bib, edits);
    expect(next).toContain("@misc{nothing,\n  note = {n},}");
  });

  it("returns null for a missing entry", () => {
    expect(planEntryEdits(bib, "absent", { key: "x", type: "misc", fields: [] })).toBeNull();
  });
});

describe("suggestKey", () => {
  it("builds surname+year keys, made unique", () => {
    const fields = [
      { name: "author", value: "Knuth, Donald E." },
      { name: "year", value: "1984" },
    ];
    expect(suggestKey("article", fields, ["other"])).toBe("knuth1984");
    expect(suggestKey("article", fields, ["knuth1984"])).toBe("knuth19842");
  });

  it("falls back to the type when no author", () => {
    expect(suggestKey("misc", [{ name: "year", value: "2001" }], [])).toBe(
      "misc2001",
    );
  });
});

describe("typeLabel", () => {
  it("maps the common types to friendly names", () => {
    expect(typeLabel("article")).toBe("Journal article");
    expect(typeLabel("inproceedings")).toBe("Conference paper");
    expect(typeLabel("phdthesis")).toBe("PhD thesis");
  });

  it("passes unknown types through", () => {
    expect(typeLabel("customthing")).toBe("customthing");
  });
});

describe("entryByline", () => {
  it("gives the surname, et al., and the year", () => {
    const { entries } = parseBibEntries(source);
    const knuth = entries.find((entry) => entry.key === "knuth84")!;
    expect(entryByline(knuth)).toBe("Knuth · 1984");
  });

  it("uses a bare surname for single authors", () => {
    const { entries } = parseBibEntries(source);
    const lamport = entries.find((entry) => entry.key === "lamport94")!;
    expect(entryByline(lamport)).toBe("Lamport · 1994");
  });

  it("splits authors on 'and' and reads years from date fields", () => {
    const entry = {
      fields: [
        { name: "author", value: "Doe, Jane and Smith, John" },
        { name: "date", value: "2021-05-01" },
      ],
    };
    expect(entryByline(entry as never)).toBe("Doe et al. · 2021");
  });

  it("is empty without author or year", () => {
    const entry = { fields: [{ name: "title", value: "Only a title" }] };
    expect(entryByline(entry as never)).toBe("");
  });
});
