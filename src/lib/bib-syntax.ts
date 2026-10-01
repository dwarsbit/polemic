import { StreamLanguage, type StreamParser } from "@codemirror/language";

/**
 * A BibTeX tokenizer for the raw-text side of the .bib editor:
 * entry types, citation keys, field names, and values (braced and
 * quoted), plus % comments. Token names map through StreamLanguage's
 * default table onto the same tags the stex themes style.
 */

/** Where the tokenizer is inside an entry. */
export interface BibState {
  stage: "start" | "key" | "field" | "value";
  /** Brace depth inside the entry body. */
  depth: number;
  /** Inside a quoted field value. */
  quoted: boolean;
}

/** The BibTeX tokenizer (exported for tests). */
export const bibParser: StreamParser<BibState> = {
  name: "bibtex",
  startState: () => ({ stage: "start", depth: 0, quoted: false }),
  copyState: (state) => ({ ...state }),
  token: (stream, state) => {
    if (stream.eatSpace()) return null;
    if (stream.peek() === "%") {
      stream.skipToEnd();
      return "comment";
    }
    switch (state.stage) {
      case "start": {
        if (stream.match(/@[a-zA-Z]+/)) {
          state.stage = "key";
          return "keyword";
        }
        stream.next();
        return null;
      }
      case "key": {
        if (stream.eat(/[({]/)) {
          state.depth = 1;
          return "bracket";
        }
        if (stream.eat(",")) {
          state.stage = "field";
          return "bracket";
        }
        if (stream.eat(/[})]/)) {
          state.stage = "start";
          state.depth = 0;
          return "bracket";
        }
        if (stream.match(/[^,=(){}\s]+/)) return "atom";
        stream.next();
        return null;
      }
      case "field": {
        if (stream.eat("=")) {
          state.stage = "value";
          return "bracket";
        }
        if (stream.eat(",")) return "bracket";
        if (stream.eat(/[})]/)) {
          state.stage = "start";
          state.depth = 0;
          return "bracket";
        }
        if (stream.match(/[a-zA-Z][\w-]*/)) return "builtin";
        stream.next();
        return null;
      }
      case "value": {
        if (state.quoted) {
          if (stream.eat('"')) {
            state.quoted = false;
            state.stage = "field";
            return "bracket";
          }
          if (stream.match(/[^{}"]+/)) return "string";
          if (stream.eat("{")) {
            state.depth++;
            return "bracket";
          }
          if (stream.eat("}")) {
            state.depth--;
            return "bracket";
          }
          stream.next();
          return "string";
        }
        if (stream.eat('"')) {
          state.quoted = true;
          return "string";
        }
        if (stream.eat("{")) {
          state.depth++;
          return "bracket";
        }
        if (stream.eat("}")) {
          state.depth--;
          if (state.depth <= 0) {
            state.depth = 0;
            state.stage = "start";
          } else if (state.depth === 1) {
            state.stage = "field";
          }
          return "bracket";
        }
        if (stream.eat(")")) {
          state.depth = 0;
          state.stage = "start";
          return "bracket";
        }
        if (stream.eat(",")) {
          state.stage = "field";
          return "bracket";
        }
        if (stream.eatSpace()) return null;
        if (stream.match(/[^,{}")]+/)) return "string";
        stream.next();
        return null;
      }
    }
  },
  languageData: { commentTokens: { line: "%" } },
};

/** The BibTeX syntax mode for CodeMirror. */
export const bibSyntax = StreamLanguage.define(bibParser);
