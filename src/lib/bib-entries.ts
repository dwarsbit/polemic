/**
 * Full BibTeX entry parsing: type, key, fields, and the source
 * positions of everything, so the panel can jump to entries and the
 * entry editor can rewrite values in place (preserving the author's
 * formatting). Pure: text in, data out.
 */

import type { FileEntry } from "./tauri";

export interface BibField {
  name: string;
  /** The value with its delimiters, as written (braces or quotes). */
  raw: string;
  /** The value for display: delimiters and braces stripped. */
  value: string;
  /** Range of the field name. */
  nameFrom: number;
  nameTo: number;
  /** Range of the value including delimiters. */
  from: number;
  to: number;
}

export interface BibEntry {
  type: string;
  key: string;
  /** Range of the key inside the entry head. */
  keyFrom: number;
  keyTo: number;
  /** The whole entry, [from, to). */
  from: number;
  to: number;
  /** 1-based line of the `@`. */
  line: number;
  fields: BibField[];
  /** Index of the closing brace; new fields are inserted before it. */
  bodyEnd: number;
}

export interface ParsedBib {
  entries: BibEntry[];
  /** `@string` definitions: name → raw value (no substitution applied). */
  strings: Record<string, string>;
}

/**
 * Which program reads the project's .bib files: classic BibTeX, or
 * biblatex (with biber), which knows more entry types and fields.
 */
export type BibBackend = "bibtex" | "biblatex";

/** A required field; a list means any one of them will do. */
type Requirement = string | readonly string[];

const AUTHOR_OR_EDITOR = ["author", "editor"];

/** BibTeX's required fields per type (btxdoc); others validate loosely. */
const BIBTEX_REQUIRED: Record<string, Requirement[]> = {
  article: ["author", "title", "journal", "year"],
  book: [AUTHOR_OR_EDITOR, "title", "publisher", "year"],
  booklet: ["title"],
  inbook: [AUTHOR_OR_EDITOR, "title", ["chapter", "pages"], "publisher", "year"],
  incollection: ["author", "title", "booktitle", "publisher", "year"],
  inproceedings: ["author", "title", "booktitle", "year"],
  conference: ["author", "title", "booktitle", "year"],
  manual: ["title"],
  mastersthesis: ["author", "title", "school", "year"],
  phdthesis: ["author", "title", "school", "year"],
  proceedings: ["title", "year"],
  techreport: ["author", "title", "institution", "year"],
  unpublished: ["author", "title", "note"],
};

const DATE = ["date", "year"];

/** biblatex's required fields per type (manual §2.1), aliases included. */
const BIBLATEX_REQUIRED: Record<string, Requirement[]> = {
  article: ["author", "title", "journaltitle", DATE],
  book: ["author", "title", DATE],
  mvbook: ["author", "title", DATE],
  inbook: ["author", "title", "booktitle", DATE],
  bookinbook: ["author", "title", "booktitle", DATE],
  suppbook: ["author", "title", "booktitle", DATE],
  booklet: [AUTHOR_OR_EDITOR, "title", DATE],
  collection: ["editor", "title", DATE],
  mvcollection: ["editor", "title", DATE],
  incollection: ["author", "title", "booktitle", DATE],
  suppcollection: ["author", "title", "booktitle", DATE],
  dataset: [AUTHOR_OR_EDITOR, "title", DATE],
  manual: [AUTHOR_OR_EDITOR, "title", DATE],
  misc: [AUTHOR_OR_EDITOR, "title", DATE],
  software: [AUTHOR_OR_EDITOR, "title", DATE],
  online: [AUTHOR_OR_EDITOR, "title", DATE, ["url", "doi", "eprint"]],
  electronic: [AUTHOR_OR_EDITOR, "title", DATE, ["url", "doi", "eprint"]],
  www: [AUTHOR_OR_EDITOR, "title", DATE, ["url", "doi", "eprint"]],
  patent: ["author", "title", "number", DATE],
  periodical: ["editor", "title", DATE],
  proceedings: ["title", DATE],
  mvproceedings: ["title", DATE],
  inproceedings: ["author", "title", "booktitle", DATE],
  conference: ["author", "title", "booktitle", DATE],
  reference: ["editor", "title", DATE],
  mvreference: ["editor", "title", DATE],
  inreference: ["author", "title", "booktitle", DATE],
  report: ["author", "title", "type", "institution", DATE],
  thesis: ["author", "title", "type", "institution", DATE],
  // Aliases with the type preset: no `type` field needed.
  mastersthesis: ["author", "title", "institution", DATE],
  phdthesis: ["author", "title", "institution", DATE],
  techreport: ["author", "title", "institution", DATE],
  unpublished: ["author", "title", DATE],
};

/** BibTeX field names biblatex reads as its own (biber's default map). */
const BIBLATEX_FIELD_ALIASES: Record<string, string> = {
  journal: "journaltitle",
  school: "institution",
  address: "location",
};

function requirements(type: string, backend: BibBackend): Requirement[] {
  const table = backend === "biblatex" ? BIBLATEX_REQUIRED : BIBTEX_REQUIRED;
  return table[type.toLowerCase()] ?? [];
}

/** The field a requirement asks for first (the one to offer). */
function primaryName(requirement: Requirement): string {
  return typeof requirement === "string" ? requirement : requirement[0];
}

/** Whether a field counts toward the type's required fields. */
export function isRequiredField(
  type: string,
  name: string,
  backend: BibBackend = "bibtex",
): boolean {
  const canonical =
    backend === "biblatex" ? (BIBLATEX_FIELD_ALIASES[name] ?? name) : name;
  return requirements(type, backend).some((requirement) =>
    typeof requirement === "string"
      ? requirement === canonical
      : requirement.includes(canonical),
  );
}

/** The entry types the editor offers. */
export function entryTypes(backend: BibBackend = "bibtex"): string[] {
  return backend === "biblatex"
    ? [
        "article",
        "book",
        "mvbook",
        "inbook",
        "booklet",
        "collection",
        "incollection",
        "inproceedings",
        "proceedings",
        "thesis",
        "report",
        "online",
        "dataset",
        "software",
        "manual",
        "patent",
        "periodical",
        "reference",
        "inreference",
        "unpublished",
        "misc",
      ]
    : [
        "article",
        "inproceedings",
        "conference",
        "incollection",
        "book",
        "inbook",
        "phdthesis",
        "mastersthesis",
        "techreport",
        "unpublished",
        "proceedings",
        "misc",
      ];
}

/** Fields the entry editor offers beyond what an entry already has. */
export function commonFields(backend: BibBackend = "bibtex"): string[] {
  return backend === "biblatex"
    ? [
        "author",
        "editor",
        "title",
        "journaltitle",
        "booktitle",
        "publisher",
        "location",
        "institution",
        "date",
        "volume",
        "number",
        "pages",
        "type",
        "doi",
        "eprint",
        "url",
        "note",
        "abstract",
        "keywords",
      ]
    : [
        "author",
        "editor",
        "title",
        "journal",
        "booktitle",
        "publisher",
        "year",
        "volume",
        "number",
        "pages",
        "doi",
        "url",
        "note",
        "abstract",
        "keywords",
      ];
}

/** The matching closing delimiter for the one at `from`, -1 if none. */
export function findMatching(source: string, from: number, open: string): number {
  const close = open === "{" ? "}" : ")";
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

/** End quote for a value starting with a double quote at `from`. */
function findQuotedEnd(source: string, from: number): number {
  for (let i = from + 1; i < source.length; i++) {
    if (source[i] === '"' && source[i - 1] !== "\\") return i;
  }
  return -1;
}

/** Strip delimiters and braces for display. */
export function displayValue(raw: string): string {
  // Concatenated parts join without a separator (BibTeX semantics).
  return splitConcat(raw)
    .map((part) => {
      let value = part.trim();
      if (value.startsWith("{") && value.endsWith("}")) {
        value = value.slice(1, -1);
      } else if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    })
    .join("");
}

/** Split a value on top-level `#` concatenation operators. */
function splitConcat(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === '"' && depth === 0) inQuotes = !inQuotes;
    else if (ch === "#" && depth === 0 && !inQuotes) {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

/**
 * Parse a .bib file. Everything outside an entry is ignored;
 * `@comment`, `@preamble`, and `@string` bodies are skipped (string
 * names are collected but never substituted — the raw text stays
 * authoritative for editing).
 */
export function parseBibEntries(source: string): ParsedBib {
  const entries: BibEntry[] = [];
  const strings: Record<string, string> = {};
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "@") continue;
    const headMatch = /^@\s*([A-Za-z]+)\s*([{(])/.exec(source.slice(i, i + 64));
    if (headMatch === null) continue;
    const type = headMatch[1].toLowerCase();
    const open = headMatch[2];
    const openAt = i + headMatch[0].length - 1;
    const closeAt = findMatching(source, openAt, open);
    if (closeAt === -1) break; // still being typed
    if (type === "comment" || type === "preamble") {
      i = closeAt;
      continue;
    }
    if (type === "string") {
      const def = /^\s*([\w.]+)\s*=\s*/.exec(source.slice(openAt + 1, closeAt));
      if (def !== null) {
        const from = openAt + 1 + def[0].length;
        strings[def[1].toLowerCase()] = source.slice(from, closeAt).trim();
      }
      i = closeAt;
      continue;
    }
    const keyMatch = /^\s*([^,\s}]+)/.exec(source.slice(openAt + 1, closeAt));
    if (keyMatch === null) {
      i = closeAt;
      continue;
    }
    const key = keyMatch[1];
    const keyFrom = openAt + 1 + keyMatch[0].length - key.length;
    const entry: BibEntry = {
      type,
      key,
      keyFrom,
      keyTo: keyFrom + key.length,
      from: i,
      to: closeAt + 1,
      line: source.slice(0, i).split("\n").length,
      fields: [],
      bodyEnd: closeAt,
    };
    const bodyFrom = keyToBody(source, entry.keyTo, closeAt);
    entry.fields = parseFields(source, bodyFrom, closeAt);
    entries.push(entry);
    i = closeAt;
  }
  return { entries, strings };
}

/** The offset where the entry body starts (after the key's comma). */
function keyToBody(source: string, keyTo: number, closeAt: number): number {
  const comma = source.indexOf(",", keyTo);
  return comma === -1 || comma >= closeAt ? closeAt : comma + 1;
}

function parseFields(source: string, at: number, closeAt: number): BibField[] {
  const fields: BibField[] = [];
  while (at < closeAt) {
    const nameMatch = /^\s*([A-Za-z][\w.+-]*)\s*=\s*/.exec(source.slice(at, closeAt));
    if (nameMatch === null) break;
    const nameFrom = at + (nameMatch[0].length - nameMatch[0].trimStart().length);
    at += nameMatch[0].length;
    const value = parseValue(source, at, closeAt);
    if (value === null) break;
    at = value.to;
    fields.push({
      name: nameMatch[1].toLowerCase(),
      raw: value.raw,
      value: displayValue(value.raw),
      nameFrom,
      nameTo: nameFrom + nameMatch[1].length,
      from: value.from,
      to: value.to,
    });
    const comma = source.indexOf(",", at);
    if (comma === -1 || comma >= closeAt) break;
    at = comma + 1;
  }
  return fields;
}

/**
 * One field value: a single part or several joined by `#`. The raw
 * text spans from the first part to the last, so the editor can
 * replace the whole value in one edit.
 */
function parseValue(
  source: string,
  from: number,
  closeAt: number,
): { raw: string; from: number; to: number } | null {
  let at = from;
  for (;;) {
    const ws = source.slice(at, closeAt).match(/^\s*/);
    at += ws === null ? 0 : ws[0].length;
    if (source[at] === "{") {
      const end = findMatching(source, at, "{");
      if (end === -1 || end >= closeAt) return null;
      at = end + 1;
    } else if (source[at] === '"') {
      const end = findQuotedEnd(source, at);
      if (end === -1 || end >= closeAt) return null;
      at = end + 1;
    } else {
      const bare = /^[^,#}]+/.exec(source.slice(at, closeAt));
      if (bare === null) return null;
      at += bare[0].length;
    }
    const hash = /^\s*#/.exec(source.slice(at, closeAt));
    if (hash === null) return { raw: source.slice(from, at), from, to: at };
    at += hash[0].length;
  }
}

/** The requirements the entry does not meet. Under biblatex, BibTeX
 *  names it maps (journal, school, address) count for its own fields. */
function unmet(
  entry: { type: string; fields: { name: string }[] },
  backend: BibBackend,
): Requirement[] {
  const present = new Set(
    entry.fields.map((field) => {
      const name = field.name.toLowerCase();
      return backend === "biblatex" ? (BIBLATEX_FIELD_ALIASES[name] ?? name) : name;
    }),
  );
  return requirements(entry.type, backend).filter((requirement) =>
    typeof requirement === "string"
      ? !present.has(requirement)
      : !requirement.some((name) => present.has(name)),
  );
}

/** Required fields missing from the entry; a group of alternatives
 *  reads "date or year". */
export function missingFields(
  entry: { type: string; fields: { name: string }[] },
  backend: BibBackend = "bibtex",
): string[] {
  return unmet(entry, backend).map((requirement) =>
    typeof requirement === "string" ? requirement : requirement.join(" or "),
  );
}

/** The fields to add for what is missing (the first of each group). */
export function missingFieldNames(
  entry: { type: string; fields: { name: string }[] },
  backend: BibBackend = "bibtex",
): string[] {
  return unmet(entry, backend).map(primaryName);
}

/** Project-relative paths of every .bib file in a tree, depth first. */
export function flattenBibPaths(entries: FileEntry[]): string[] {
  const out: string[] = [];
  const walk = (list: FileEntry[]) => {
    for (const entry of list) {
      if (entry.isDir) walk(entry.children);
      else if (entry.path.toLowerCase().endsWith(".bib")) out.push(entry.path);
    }
  };
  walk(entries);
  return out;
}

/** The entry's title (or author as fallback) for display. */
export function entryTitle(entry: Pick<BibEntry, "fields">): string {
  const title = entry.fields.find((field) => field.name === "title")?.value ?? "";
  return title || (entry.fields.find((field) => field.name === "author")?.value ?? "");
}

/** Friendly names for the common BibTeX types; unknown types fall
 *  back to the raw name. */
export const TYPE_LABELS: Record<string, string> = {
  article: "Journal article",
  inproceedings: "Conference paper",
  conference: "Conference paper",
  incollection: "Book chapter",
  book: "Book",
  inbook: "Book section",
  mvbook: "Multi-volume book",
  bookinbook: "Book in book",
  suppbook: "Book supplement",
  booklet: "Booklet",
  collection: "Collection",
  mvcollection: "Multi-volume collection",
  suppcollection: "Collection supplement",
  thesis: "Thesis",
  report: "Report",
  periodical: "Periodical",
  mvproceedings: "Multi-volume proceedings",
  reference: "Reference work",
  mvreference: "Multi-volume reference work",
  inreference: "Reference entry",
  software: "Software",
  phdthesis: "PhD thesis",
  mastersthesis: "Master's thesis",
  techreport: "Technical report",
  unpublished: "Unpublished",
  proceedings: "Proceedings",
  manual: "Manual",
  online: "Online source",
  dataset: "Dataset",
  patent: "Patent",
  misc: "Miscellaneous",
};

/** The entry type's friendly label (raw name when unknown). */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/** The first author's surname, with "et al." for more. */
function authorByline(entry: Pick<BibEntry, "fields">): string {
  const raw =
    entry.fields.find((field) => field.name === "author")?.value ??
    entry.fields.find((field) => field.name === "editor")?.value;
  if (raw === undefined) return "";
  const names = displayValue(raw)
    .split(/\s+and\s+/i)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) return "";
  const first = names[0];
  const surname = first.includes(",")
    ? first.split(",")[0].trim()
    : (first.split(/\s+/).pop() ?? "");
  return names.length > 1 ? `${surname} et al.` : surname;
}

/** The entry's byline: first author's surname and year, e.g.
 *  "Knuth et al. · 1984". */
export function entryByline(entry: Pick<BibEntry, "fields">): string {
  const yearRaw =
    entry.fields.find((field) => field.name === "year")?.value ??
    entry.fields.find((field) => field.name === "date")?.value ??
    "";
  const year = displayValue(yearRaw).match(/\d{4}/)?.[0] ?? "";
  return [authorByline(entry), year].filter((part) => part.length > 0).join(" · ");
}

/** Format a new entry to append to a .bib file. */
export function formatEntry(
  type: string,
  key: string,
  fields: { name: string; value: string }[],
): string {
  const lines = fields
    .filter((field) => field.value.trim().length > 0)
    .map((field) => `  ${field.name} = {${field.value.trim()}},`);
  return `@${type.toLowerCase()}{${key},\n${lines.join("\n")}\n}\n`;
}

/** A plausible unique key for a new entry: surname + year. */
export function suggestKey(
  type: string,
  fields: { name: string; value: string }[],
  taken: string[],
): string {
  const get = (name: string) =>
    fields.find((field) => field.name === name)?.value.trim() ?? "";
  const first = get("author").split(" and ")[0];
  const surname = first.split(",")[0].trim();
  const year = (get("year") || get("date")).match(/\d{4}/)?.[0] ?? "";
  const base =
    (surname.length > 0 ? surname.toLowerCase().replace(/[^a-z]+/g, "") : type) + year;
  let key = base;
  let n = 2;
  while (taken.includes(key)) {
    key = `${base}${n}`;
    n++;
  }
  return key;
}

/** An edited entry: the full field set, in any order. */
export interface EntryDraft {
  key: string;
  type: string;
  fields: { name: string; value: string }[];
}

/** A new article with its required fields empty, ready to fill in. */
export function newEntryDraft(
  taken: string[],
  backend: BibBackend = "bibtex",
): EntryDraft {
  return {
    key: suggestKey("article", [], taken),
    type: "article",
    fields: requirements("article", backend).map((requirement) => ({
      name: primaryName(requirement),
      value: "",
    })),
  };
}

/**
 * Edits that turn the entry `originalKey` into the draft: value
 * replacements in place, removed fields deleted, new fields inserted
 * before the closing brace, key and type rewritten. Positions are in
 * the given (fresh) source; null when the entry is not found.
 */
export function planEntryEdits(
  source: string,
  originalKey: string,
  draft: EntryDraft,
): { from: number; to: number; insert: string }[] | null {
  const entry = parseBibEntries(source).entries.find(
    (candidate) => candidate.key === originalKey,
  );
  if (entry === undefined) return null;
  const edits: { from: number; to: number; insert: string }[] = [];
  if (draft.key !== originalKey) {
    edits.push({ from: entry.keyFrom, to: entry.keyTo, insert: draft.key });
  }
  const draftType = draft.type.toLowerCase();
  if (draftType !== entry.type) {
    edits.push({
      from: entry.from + 1,
      to: entry.from + 1 + entry.type.length,
      insert: draftType,
    });
  }
  const byName = new Map(draft.fields.map((field) => [field.name, field.value]));
  for (const field of entry.fields) {
    const next = byName.get(field.name);
    if (next === undefined) {
      // Removed: drop the name, value, and trailing comma.
      let to = field.to;
      const comma = source.slice(to, entry.bodyEnd).match(/^\s*,/);
      if (comma !== null) to += comma[0].length;
      edits.push({ from: field.nameFrom, to, insert: "" });
    } else if (next !== field.value) {
      edits.push({ from: field.from, to: field.to, insert: `{${next}}` });
    }
  }
  const before = source.slice(entry.keyTo, entry.bodyEnd).trimEnd();
  const needsComma = !before.endsWith(",");
  for (const [name, value] of byName) {
    if (entry.fields.some((field) => field.name === name)) continue;
    if (value.trim().length === 0) continue;
    edits.push({
      from: entry.bodyEnd,
      to: entry.bodyEnd,
      insert: `${needsComma ? "," : ""}\n  ${name} = {${value.trim()}},`,
    });
  }
  return edits;
}
