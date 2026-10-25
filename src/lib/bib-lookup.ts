/**
 * DOI/arXiv import: turning what a user pastes into a DOI to look up,
 * and the BibTeX the registry answers with into an entry draft ready
 * for the project's bibliography. Pure; the network call itself is
 * the Rust-side lookup_bibtex command.
 */

import {
  displayValue,
  parseBibEntries,
  suggestKey,
  type EntryDraft,
} from "./bib-entries";

export type LookupId =
  { kind: "doi"; doi: string } | { kind: "arxiv"; id: string; doi: string };

/** arXiv preprints are registered with DataCite under this prefix. */
const ARXIV_DOI_PREFIX = "10.48550/arXiv.";

const NEW_ARXIV = /^\d{4}\.\d{4,5}(?:v\d+)?$/;
const OLD_ARXIV = /^[a-z-]+(?:\.[A-Za-z]{2})?\/\d{7}(?:v\d+)?$/;

function arxivLookup(id: string): LookupId {
  const bare = id.replace(/v\d+$/, "");
  return { kind: "arxiv", id: bare, doi: `${ARXIV_DOI_PREFIX}${bare}` };
}

/**
 * Recognize a DOI or arXiv identifier in pasted text: bare IDs,
 * `doi:` / `arXiv:` prefixes, and doi.org / arxiv.org URLs. Null when
 * the text is neither.
 */
export function parseLookupId(input: string): LookupId | null {
  let text = input.trim();
  if (text.length === 0) return null;

  const urlMatch = /^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i.exec(text);
  if (urlMatch !== null) {
    try {
      text = decodeURIComponent(urlMatch[1]);
    } catch {
      text = urlMatch[1];
    }
  }
  const arxivUrl =
    /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i.exec(text);
  if (arxivUrl !== null) text = arxivUrl[1];

  text = text.replace(/^doi:\s*/i, "").replace(/^arxiv:\s*/i, "");

  if (NEW_ARXIV.test(text) || OLD_ARXIV.test(text)) return arxivLookup(text);

  if (/^10\.\d{4,9}\/\S+$/.test(text)) {
    const arxiv = /^10\.48550\/arxiv\.(.+)$/i.exec(text);
    if (arxiv !== null && (NEW_ARXIV.test(arxiv[1]) || OLD_ARXIV.test(arxiv[1]))) {
      return arxivLookup(arxiv[1]);
    }
    return { kind: "doi", doi: text };
  }
  return null;
}

const MONTHS: Record<string, string> = {
  jan: "1",
  feb: "2",
  mar: "3",
  apr: "4",
  may: "5",
  jun: "6",
  jul: "7",
  aug: "8",
  sep: "9",
  oct: "10",
  nov: "11",
  dec: "12",
};

/**
 * The first entry of a registry's BibTeX answer as a draft: the
 * registry's own key (often a URL) is replaced by a surname+year key
 * unique against `taken`, month macros become numbers, and arXiv
 * lookups gain eprint fields. Null when no entry can be read.
 */
export function bibtexToDraft(
  raw: string,
  taken: string[],
  id: LookupId,
): EntryDraft | null {
  const entry = parseBibEntries(raw).entries[0];
  if (entry === undefined) return null;

  const fields: { name: string; value: string }[] = [];
  for (const field of entry.fields) {
    const name = field.name.toLowerCase();
    let value = displayValue(field.raw);
    if (value.length === 0) continue;
    // DataCite adds licence and subject noise to preprint records.
    if (name === "copyright") continue;
    if (id.kind === "arxiv" && name === "keywords") continue;
    if (name === "month") value = MONTHS[value.toLowerCase()] ?? value;
    fields.push({ name, value });
  }
  if (id.kind === "arxiv") {
    if (!fields.some((f) => f.name === "eprint")) {
      fields.push({ name: "eprint", value: id.id });
    }
    if (!fields.some((f) => f.name === "archiveprefix")) {
      fields.push({ name: "archiveprefix", value: "arXiv" });
    }
  }
  const type = entry.type;
  return { key: suggestKey(type, fields, taken), type, fields };
}
