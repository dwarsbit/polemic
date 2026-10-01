import { describe, expect, it } from "vitest";
import { bibParser, type BibState } from "@/lib/bib-syntax";

/** The parser entry points, freed of CodeMirror's stream type. */
const startState = bibParser.startState as unknown as () => BibState;
const token = bibParser.token as unknown as (
  stream: FakeStream,
  state: BibState,
) => string | null;

/** The StringStream subset the tokenizer uses, over one line. */
class FakeStream {
  pos = 0;
  constructor(readonly string: string) {}
  eol(): boolean {
    return this.pos >= this.string.length;
  }
  eatSpace(): boolean {
    const start = this.pos;
    while (this.pos < this.string.length && /\s/.test(this.string[this.pos])) {
      this.pos++;
    }
    return this.pos > start;
  }
  peek(): string {
    return this.string[this.pos] ?? "";
  }
  next(): string {
    const ch = this.string[this.pos];
    this.pos++;
    return ch;
  }
  eat(match: string | RegExp): string | undefined {
    const ch = this.peek();
    if (ch.length === 0) return undefined;
    const ok =
      typeof match === "string"
        ? match.includes(ch)
        : match.test(ch);
    if (!ok) return undefined;
    this.pos++;
    return ch;
  }
  match(pattern: RegExp): RegExpMatchArray | null {
    const rest = this.string.slice(this.pos);
    const m = rest.match(pattern);
    if (m === null || m.index !== 0) return null;
    this.pos += m[0].length;
    return m;
  }
  skipToEnd(): void {
    this.pos = this.string.length;
  }
}

/** Tokenize text, feeding lines like CodeMirror would. */
function tokenize(text: string): { text: string; name: string | null }[] {
  const state = startState();
  const out: { text: string; name: string | null }[] = [];
  for (const line of text.split("\n")) {
    const stream = new FakeStream(line);
    while (!stream.eol()) {
      const from = stream.pos;
      const name = token(stream, state) ?? null;
      const consumed = line.slice(from, stream.pos);
      if (consumed.length === 0) throw new Error("tokenizer stalled");
      out.push({ text: consumed, name });
    }
    // A newline resets nothing in bibtex; states carry over.
  }
  return out;
}

function names(tokens: { name: string | null }[]): (string | null)[] {
  return tokens.map((token) => token.name);
}

describe("bibtex tokenizer", () => {
  it("marks entry types, keys, field names, and values", () => {
    const tokens = tokenize('@article{knuth84,\n  author = "Knuth",\n}');
    expect(names(tokens)).toEqual([
      "keyword",
      "bracket",
      "atom",
      "bracket",
      null,
      "builtin",
      null,
      "bracket",
      null,
      "string",
      "string",
      "bracket",
      "bracket",
      "bracket",
    ]);
  });

  it("highlights braced values and nested braces", () => {
    const tokens = tokenize("@book{a, title = {The {Big} Book}, year = 1984}");
    expect(names(tokens)).toEqual([
      "keyword",
      "bracket",
      "atom",
      "bracket",
      null,
      "builtin",
      null,
      "bracket",
      null,
      "bracket",
      "string",
      "bracket",
      "string",
      "bracket",
      null,
      "string",
      "bracket",
      "bracket",
      null,
      "builtin",
      null,
      "bracket",
      null,
      "string",
      "bracket",
    ]);
  });

  it("treats % as a comment to the end of the line", () => {
    const tokens = tokenize("% a comment\n@misc{x, a = 1}");
    expect(tokens[0]).toEqual({ text: "% a comment", name: "comment" });
    expect(names(tokens.slice(1))[0]).toBe("keyword");
  });

  it("returns to the start state after an entry closes", () => {
    const tokens = tokenize("@misc{a}\n@misc{b}");
    expect(names(tokens)).toEqual([
      "keyword",
      "bracket",
      "atom",
      "bracket",
      "keyword",
      "bracket",
      "atom",
      "bracket",
    ]);
  });

  it("handles parenthesized entries", () => {
    const tokens = tokenize("@misc(a, b = c)");
    expect(names(tokens)).toEqual([
      "keyword",
      "bracket",
      "atom",
      "bracket",
      null,
      "builtin",
      null,
      "bracket",
      null,
      "string",
      "bracket",
    ]);
  });
});
