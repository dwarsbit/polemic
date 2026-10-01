/**
 * Zotero item JSON → BibTeX: the conversion that lets live Zotero
 * results land in a project's .bib. Pure: item data in, entry draft
 * out (type, fields, and a generated key — plain Zotero items carry
 * no BibTeX keys, so keys are derived from the first author's
 * surname and the year, made unique against the taken keys).
 */

import { suggestKey } from "./bib-entries";

export interface ZoteroCreator {
  creatorType: string;
  /** Single-field names (organizations) use `name` instead. */
  name?: string;
  firstname?: string;
  lastname?: string;
}

export interface ZoteroItemData {
  itemType: string;
  key?: string;
  title?: string;
  shortTitle?: string;
  creators?: ZoteroCreator[];
  date?: string;
  publicationTitle?: string;
  proceedingsTitle?: string;
  bookTitle?: string;
  publisher?: string;
  university?: string;
  thesisType?: string;
  institution?: string;
  place?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  DOI?: string;
  url?: string;
  abstractNote?: string;
  repository?: string;
  genre?: string;
  reportType?: string;
  tags?: { tag: string }[];
}

/** Zotero item type → BibTeX entry type. */
const TYPE_MAP: Record<string, string> = {
  journalArticle: "article",
  book: "book",
  conferencePaper: "inproceedings",
  report: "techreport",
  thesis: "phdthesis",
  preprint: "misc",
  webpage: "misc",
  bookSection: "incollection",
  document: "misc",
  blogPost: "misc",
  forumPost: "misc",
  newspaperArticle: "article",
  encyclopediaArticle: "misc",
  letter: "misc",
  presentation: "misc",
};

/** The result ready for formatEntry / planEntryEdits. */
export interface ZoteroBibEntry {
  key: string;
  type: string;
  title: string;
  fields: { name: string; value: string }[];
}

/** BibTeX name list: "Family, Given and Family, Given". */
export function zoteroCreators(creators: ZoteroCreator[] | undefined): string {
  return (creators ?? [])
    .map((creator) =>
      creator.name !== undefined && creator.name.length > 0
        ? creator.name
        : [creator.lastname, creator.firstname].filter(Boolean).join(", "),
    )
    .filter((name) => name.length > 0)
    .join(" and ");
}

/** The first four-digit year in a Zotero date ("1984-06" → "1984"). */
export function zoteroYear(date: string | undefined): string {
  const match = /\b(\d{4})\b/.exec(date ?? "");
  return match === null ? "" : match[1];
}

/**
 * Convert one Zotero item. Fields map per BibTeX type; unmapped item
 * types fall back to @misc. The key is generated (surname+year, made
 * unique against `taken` — usually the project's existing keys).
 */
export function zoteroItemToBib(
  item: ZoteroItemData,
  taken: string[],
): ZoteroBibEntry {
  const creators = item.creators ?? [];
  const authors = zoteroCreators(
    creators.filter((creator) => creator.creatorType === "author"),
  );
  const editors = zoteroCreators(
    creators.filter((creator) => creator.creatorType === "editor"),
  );
  const year = zoteroYear(item.date);
  const title = item.title ?? "";
  const type = TYPE_MAP[item.itemType] ?? "misc";
  const keywords = (item.tags ?? []).map((tag) => tag.tag).join(", ");

  const fields: { name: string; value: string }[] = [];
  const push = (name: string, value: string | undefined) => {
    if (value !== undefined && value.trim().length > 0) {
      fields.push({ name, value: value.trim() });
    }
  };

  // Authors, or editors for edited books.
  if (authors.length > 0) push("author", authors);
  else if (editors.length > 0) push("editor", editors);

  push("title", title);

  switch (type) {
    case "article":
      push("journal", item.publicationTitle);
      break;
    case "inproceedings":
      push("booktitle", item.proceedingsTitle);
      break;
    case "incollection":
      push("booktitle", item.bookTitle);
      push("publisher", item.publisher);
      break;
    case "book":
      push("publisher", item.publisher);
      break;
    case "techreport":
      push("institution", item.institution);
      break;
    case "phdthesis":
    case "mastersthesis":
      push("school", item.university);
      break;
    case "misc":
      if (item.itemType === "preprint") {
        push("note", "Preprint");
        push("url", item.url);
      } else if (item.itemType === "webpage") {
        push("note", "Online");
        push("url", item.url);
      }
      break;
    default:
      break;
  }

  push("year", year);
  push("volume", item.volume);
  push("number", item.issue);
  push("pages", item.pages);
  push("doi", item.DOI);
  if (type !== "misc") push("url", item.url);
  push("keywords", keywords);
  push("abstract", item.abstractNote);

  const key = suggestKey(type, fields, taken);
  return { key, type, title, fields };
}
