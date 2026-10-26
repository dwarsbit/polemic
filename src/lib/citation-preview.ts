/**
 * A preview of how an entry renders under a biblatex style: the
 * in-text citation and the bibliography line. An approximation of
 * the standard biblatex styles (numeric, alphabetic, authoryear,
 * authortitle) with default options — enough to judge whether the
 * fields are complete and read right, not a typesetting engine.
 * Pure: entry data in, text segments out.
 */

export type CiteStyle = "numeric" | "alphabetic" | "authoryear" | "authortitle";

export const CITE_STYLES: { id: CiteStyle; label: string }[] = [
  { id: "numeric", label: "numeric" },
  { id: "alphabetic", label: "alphabetic" },
  { id: "authoryear", label: "authoryear" },
  { id: "authortitle", label: "authortitle" },
];

export interface PreviewEntry {
  type: string;
  key: string;
  /** Values as written in the .bib (outer delimiters already removed). */
  fields: { name: string; value: string }[];
}

export interface Segment {
  text: string;
  italic?: boolean;
}

interface Person {
  family: string;
  given: string;
}

/** Plain text from a BibTeX value: braces, ties, and dashes resolved. */
function clean(value: string): string {
  return value
    .replace(/\\&/g, "&")
    .replace(/~/g, " ")
    .replace(/[{}]/g, "")
    .replace(/(\d)\s*(?:--|-)\s*(\d)/g, "$1–$2")
    .replace(/--/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePeople(raw: string | undefined): Person[] {
  if (raw === undefined) return [];
  // Split on top-level " and " only, so {Barnes and Noble} survives.
  const names: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") depth--;
    else if (depth === 0 && /^\s+and\s+/i.test(raw.slice(i))) {
      names.push(raw.slice(start, i));
      i += /^\s+and\s+/i.exec(raw.slice(i))![0].length - 1;
      start = i + 1;
    }
  }
  names.push(raw.slice(start));
  return names
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => {
      if (/^\{.*\}$/.test(name)) return { family: clean(name), given: "" };
      if (name.includes(",")) {
        const [family, ...rest] = name.split(",");
        return { family: clean(family), given: clean(rest.join(" ")) };
      }
      const words = clean(name).split(" ");
      return { family: words.pop() ?? "", given: words.join(" ") };
    });
}

function field(entry: PreviewEntry, ...names: string[]): string | undefined {
  for (const name of names) {
    const found = entry.fields.find((f) => f.name.toLowerCase() === name);
    if (found !== undefined && found.value.trim().length > 0) return found.value;
  }
  return undefined;
}

function text(entry: PreviewEntry, ...names: string[]): string | undefined {
  const value = field(entry, ...names);
  return value === undefined ? undefined : clean(value);
}

function year(entry: PreviewEntry): string | undefined {
  return /\d{4}/.exec(field(entry, "year", "date") ?? "")?.[0];
}

/** The people credited first: authors, else editors. */
function credited(entry: PreviewEntry): Person[] {
  const authors = parsePeople(field(entry, "author"));
  return authors.length > 0 ? authors : parsePeople(field(entry, "editor"));
}

function givenFamily(person: Person): string {
  return [person.given, person.family].filter(Boolean).join(" ");
}

function familyGiven(person: Person): string {
  return person.given.length > 0 ? `${person.family}, ${person.given}` : person.family;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** biblatex default maxcitenames=2: three or more authors shorten. */
function citeNames(people: Person[]): string {
  if (people.length === 0) return "";
  if (people.length > 2) return `${people[0].family} et al.`;
  return joinList(people.map((p) => p.family));
}

/** biblatex default maxbibnames=3: four or more authors shorten. */
function bibNames(people: Person[], invertFirst: boolean): string {
  const shown = people.length > 3 ? people.slice(0, 1) : people;
  const names = shown.map((p, i) =>
    i === 0 && invertFirst ? familyGiven(p) : givenFamily(p),
  );
  if (people.length > 3) return `${names[0]} et al.`;
  return joinList(names);
}

function shortTitle(entry: PreviewEntry): string {
  return text(entry, "shorttitle", "title") ?? entry.key;
}

const ARTICLE_LIKE = new Set([
  "article",
  "inproceedings",
  "conference",
  "incollection",
  "inbook",
]);

/** alphabetic labels: Vas+17, KL84, Knu84. */
function alphaLabel(entry: PreviewEntry): string {
  const people = credited(entry);
  const yy = (year(entry) ?? "").slice(2);
  if (people.length === 0)
    return `${(text(entry, "title") ?? entry.key).slice(0, 3)}${yy}`;
  if (people.length === 1) return `${people[0].family.slice(0, 3)}${yy}`;
  if (people.length <= 4)
    return `${people.map((p) => p.family[0] ?? "").join("")}${yy}`;
  return `${people
    .slice(0, 3)
    .map((p) => p.family[0] ?? "")
    .join("")}+${yy}`;
}

/** The in-text citation: \cite for numeric/alphabetic, \parencite
 *  and \textcite for the author styles. `index` is the entry's
 *  position in the bibliography (numeric). */
export function renderCitations(
  entry: PreviewEntry,
  style: CiteStyle,
  index: number,
): { command: string; output: string }[] {
  const people = credited(entry);
  const names = citeNames(people);
  const y = year(entry);
  switch (style) {
    case "numeric":
      return [{ command: "\\cite", output: `[${index}]` }];
    case "alphabetic":
      return [{ command: "\\cite", output: `[${alphaLabel(entry)}]` }];
    case "authoryear": {
      const lead = names.length > 0 ? names : shortTitle(entry);
      return [
        { command: "\\parencite", output: `(${[lead, y].filter(Boolean).join(" ")})` },
        { command: "\\textcite", output: y !== undefined ? `${lead} (${y})` : lead },
      ];
    }
    case "authortitle": {
      const lead = names.length > 0 ? names : "";
      const title = shortTitle(entry);
      const shown = ARTICLE_LIKE.has(entry.type.toLowerCase()) ? `“${title}”` : title;
      const body = [lead, shown].filter(Boolean).join(", ");
      return [
        { command: "\\parencite", output: `(${body})` },
        {
          command: "\\textcite",
          output: lead.length > 0 ? `${lead} (${shown})` : shown,
        },
      ];
    }
  }
}

function plain(value: string): Segment {
  return { text: value };
}

/** Join chunks with ". " (biblatex's unit punctuation), ending in ".". */
function sentences(chunks: (Segment[] | null)[]): Segment[] {
  const out: Segment[] = [];
  const present = chunks.filter((c): c is Segment[] => c !== null && c.length > 0);
  present.forEach((chunk, i) => {
    out.push(...chunk);
    const last = out[out.length - 1];
    out.push(
      plain(i === present.length - 1 ? (last.text.endsWith(".") ? "" : ".") : ". "),
    );
  });
  return out.filter((s) => s.text.length > 0);
}

function opt(
  value: string | undefined,
  wrap: (v: string) => Segment[],
): Segment[] | null {
  return value === undefined ? null : wrap(value);
}

function pagesText(entry: PreviewEntry): string | undefined {
  const pages = text(entry, "pages");
  if (pages === undefined) return undefined;
  return /[–,]/.test(pages) ? `pp. ${pages}` : `p. ${pages}`;
}

/** The bibliography line for the entry. */
export function renderBibliography(entry: PreviewEntry, style: CiteStyle): Segment[] {
  const type = entry.type.toLowerCase();
  const people = credited(entry);
  const authorLike = style === "authoryear" || style === "authortitle";
  const y = year(entry);
  const title = text(entry, "title");
  const doi = text(entry, "doi");
  const url = text(entry, "url");
  const editors = parsePeople(field(entry, "editor"));
  const hasAuthor = parsePeople(field(entry, "author")).length > 0;

  const lead: Segment[] | null =
    people.length === 0
      ? null
      : [plain(bibNames(people, authorLike) + (!hasAuthor ? " (ed.)" : ""))];
  const yearChunk: Segment[] | null =
    authorLike && y !== undefined ? [plain(`(${y})`)] : null;
  // authoryear: "Lead (year)." — the year belongs to the lead chunk.
  const head: (Segment[] | null)[] =
    lead !== null && yearChunk !== null
      ? [[...lead, plain(" "), ...yearChunk]]
      : [lead, yearChunk];

  const quoted = opt(title, (t) => [plain(`“${t}”`)]);
  const italicTitle = opt(title, (t) => [{ text: t, italic: true }]);
  const yearInline = !authorLike && y !== undefined ? y : undefined;

  const link: (Segment[] | null)[] = [
    doi !== undefined ? [plain(`DOI: ${doi}`)] : null,
    doi === undefined && url !== undefined ? [plain(`URL: ${url}`)] : null,
  ];

  switch (type) {
    case "article": {
      const journal = text(entry, "journaltitle", "journal");
      const volume = text(entry, "volume");
      const number = text(entry, "number");
      const vol = [volume, number].filter(Boolean).join(".");
      const yearPart = yearInline !== undefined ? ` (${yearInline})` : "";
      const pages = pagesText(entry);
      const inChunk: Segment[] | null =
        journal === undefined
          ? null
          : [
              plain("In: "),
              { text: journal, italic: true },
              plain(
                [
                  vol.length > 0 ? ` ${vol}` : "",
                  yearPart,
                  pages ? `, ${pages}` : "",
                ].join(""),
              ),
            ];
      return sentences([...head, quoted, inChunk, ...link]);
    }
    case "inproceedings":
    case "conference":
    case "incollection":
    case "inbook": {
      const booktitle = text(entry, "booktitle");
      const publisher = text(entry, "publisher");
      const place = text(entry, "location", "address");
      const pages = pagesText(entry);
      const edBy =
        editors.length > 0 && hasAuthor
          ? [plain(`Ed. by ${joinList(editors.map(givenFamily))}`)]
          : null;
      const inChunk: Segment[] | null =
        booktitle === undefined
          ? null
          : [plain("In: "), { text: booktitle, italic: true }];
      const imprint = [
        place !== undefined && publisher !== undefined
          ? `${place}: ${publisher}`
          : (publisher ?? place),
        yearInline,
      ]
        .filter(Boolean)
        .join(", ");
      return sentences([
        ...head,
        quoted,
        inChunk,
        edBy,
        imprint.length > 0
          ? [plain(imprint + (pages ? `, ${pages}` : ""))]
          : pages
            ? [plain(pages)]
            : null,
        ...link,
      ]);
    }
    case "phdthesis":
    case "mastersthesis":
    case "thesis": {
      const kind = type === "mastersthesis" ? "Master’s thesis" : "PhD thesis";
      const school = text(entry, "institution", "school");
      const tail = [school, yearInline].filter(Boolean).join(", ");
      return sentences([
        ...head,
        italicTitle,
        [plain(kind)],
        tail.length > 0 ? [plain(tail)] : null,
        ...link,
      ]);
    }
    case "techreport":
    case "report": {
      const institution = text(entry, "institution");
      const number = text(entry, "number");
      const tail = [institution, yearInline].filter(Boolean).join(", ");
      return sentences([
        ...head,
        italicTitle,
        [plain(number !== undefined ? `Tech. rep. ${number}` : "Tech. rep.")],
        tail.length > 0 ? [plain(tail)] : null,
        ...link,
      ]);
    }
    case "book":
    case "proceedings":
    case "collection":
    case "mvbook": {
      const publisher = text(entry, "publisher");
      const place = text(entry, "location", "address");
      const imprint = [
        place !== undefined && publisher !== undefined
          ? `${place}: ${publisher}`
          : (publisher ?? place),
        yearInline,
      ]
        .filter(Boolean)
        .join(", ");
      return sentences([
        ...head,
        italicTitle,
        imprint.length > 0 ? [plain(imprint)] : null,
        ...link,
      ]);
    }
    default: {
      // misc, online, unpublished, preprints, anything else.
      const publisher = text(entry, "publisher", "howpublished");
      const eprint = text(entry, "eprint");
      const prefix = text(entry, "archiveprefix", "eprinttype");
      const note = text(entry, "note");
      const tail = [publisher, yearInline].filter(Boolean).join(", ");
      return sentences([
        ...head,
        italicTitle,
        tail.length > 0 ? [plain(tail)] : null,
        eprint !== undefined ? [plain(`${prefix ?? "eprint"}: ${eprint}`)] : null,
        note !== undefined ? [plain(note)] : null,
        ...link,
      ]);
    }
  }
}

/** Whether a .tex source loads biblatex (`\usepackage{biblatex}`). */
export function loadsBiblatex(source: string): boolean {
  return detectBiblatexStyle([source]) !== null;
}

/**
 * The biblatex style a project loads, from its .tex sources: the
 * `style=` / `citestyle=` option of `\usepackage[…]{biblatex}`.
 * Null when biblatex is not loaded; unknown styles (apa, ieee,
 * chem-acs, …) are returned as written with `known: false`, and the
 * preview falls back to the closest standard family.
 */
export function detectBiblatexStyle(
  texTexts: string[],
): { name: string; known: boolean; style: CiteStyle } | null {
  const re = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
  for (const source of texTexts) {
    const stripped = source.replace(/(^|[^\\])%.*$/gm, "$1");
    for (const match of stripped.matchAll(re)) {
      const packages = match[2].split(",").map((p) => p.trim().toLowerCase());
      if (!packages.includes("biblatex")) continue;
      const options = match[1] ?? "";
      const chosen =
        /(?:^|[,\s])(?:citestyle|style)\s*=\s*([\w-]+)/
          .exec(options)?.[1]
          ?.toLowerCase() ?? "numeric";
      const base = chosen.split("-")[0];
      const exact = CITE_STYLES.find((s) => s.id === chosen);
      if (exact !== undefined) return { name: chosen, known: true, style: exact.id };
      const family =
        base === "authoryear" || chosen === "apa" || chosen === "chicago-authordate"
          ? "authoryear"
          : base === "alphabetic" || base === "authortitle"
            ? (base as CiteStyle)
            : "numeric";
      return { name: chosen, known: false, style: family };
    }
  }
  return null;
}
