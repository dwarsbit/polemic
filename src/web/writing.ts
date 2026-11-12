/**
 * Writing aids in the browser build: spelling (src/lib/spell.ts, with
 * the desktop app's word lists), grammar through the server's managed
 * LanguageTool, and the DOI lookup. They answer the same commands of
 * src/lib/tauri.ts as the Rust side does on the desktop.
 */

import wordsUrl from "../../src-tauri/assets/words-en.txt?url";
import {
  chunkBlocks,
  errorFor,
  joinBlocks,
  POLEMIC_MAX_CHARS,
  rateLimited,
  splitMatches,
  type LtMatch,
} from "@/lib/languagetool";
import { parseFrequencyList, SpellState } from "@/lib/spell";
import type { GrammarError, GrammarIssue } from "@/lib/tauri";
import { loadSettings, updateSettings } from "@/web/settings";

type Args = Record<string, unknown>;

// --- spelling ------------------------------------------------------------

/** Word lists that can be downloaded on demand, as on the desktop. */
const DOWNLOADABLE_LANGUAGES = ["de", "fr", "es", "it", "nl"];

const USER_WORDS_KEY = "polemic.userWords";
/** Downloaded word lists live in Cache Storage under these addresses. */
const LISTS_CACHE = "polemic-spelling";
const listKey = (lang: string) => `/spelling/${lang}.txt`;

function userWords(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(USER_WORDS_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
}

function saveUserWords(words: string[]) {
  try {
    localStorage.setItem(USER_WORDS_KEY, JSON.stringify(words));
  } catch {
    // Storage blocked: the word holds until the page reloads.
  }
}

/** Lists downloaded in this tab, for when Cache Storage is unavailable. */
const downloaded = new Map<string, string>();

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(LISTS_CACHE);
  } catch {
    return null;
  }
}

async function storedList(lang: string): Promise<string | null> {
  const memory = downloaded.get(lang);
  if (memory !== undefined) return memory;
  const response = await (await openCache())?.match(listKey(lang));
  return response ? response.text() : null;
}

let state: { lang: string; spell: Promise<SpellState> } | null = null;

async function load(lang: string): Promise<SpellState> {
  if (lang === "en") {
    const response = await fetch(wordsUrl);
    if (!response.ok)
      throw "Could not load the dictionary. Reload the page to try again.";
    return SpellState.fromLines(await response.text(), userWords());
  }
  const content = await storedList(lang);
  if (content === null)
    throw `The dictionary for “${lang}” isn't downloaded yet. Download it in Settings.`;
  return new SpellState(parseFrequencyList(content), userWords());
}

/** The checker for the language in the settings, loaded on first use. */
function speller(): Promise<SpellState> {
  const lang = loadSettings().spellcheckLanguage ?? "en";
  if (state?.lang !== lang) {
    const spell = load(lang);
    state = { lang, spell };
    // A failed load is tried again on the next check.
    spell.catch(() => {
      if (state?.spell === spell) state = null;
    });
  }
  return state.spell;
}

function checkedLanguage(lang: unknown): string {
  const value = String(lang);
  if (value !== "en" && !DOWNLOADABLE_LANGUAGES.includes(value)) {
    throw `unsupported language: ${value}`;
  }
  return value;
}

async function switchLanguage(lang: string) {
  state = { lang, spell: load(lang) };
  await state.spell;
  updateSettings((s) => {
    s.spellcheckLanguage = lang;
  });
}

// --- grammar -------------------------------------------------------------

const GRAMMAR_URL = "/api/grammar/v2/check";
const GRAMMAR_TIMEOUT_MS = 30_000;

/** Until when the server asked us to wait (429): checks fail at once till then. */
let backoffUntil = 0;

async function requestCheck(
  language: string,
  text: string,
  disabled: string[],
): Promise<LtMatch[]> {
  const left = Math.ceil((backoffUntil - Date.now()) / 1000);
  if (left > 0) throw rateLimited(left);
  const form = new URLSearchParams({ text, language });
  if (disabled.length > 0) form.set("disabledRules", disabled.join(","));
  let response: Response;
  try {
    response = await fetch(GRAMMAR_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(GRAMMAR_TIMEOUT_MS),
    });
  } catch {
    throw {
      kind: "unavailable",
      message: "Could not reach Polemic.",
      retryAfter: null,
    } satisfies GrammarError;
  }
  if (!response.ok) {
    const error = errorFor(
      response.status,
      response.headers.get("retry-after"),
      await response.text().catch(() => ""),
    );
    if (error.retryAfter !== null) backoffUntil = Date.now() + error.retryAfter * 1000;
    throw error;
  }
  try {
    return ((await response.json()) as { matches: LtMatch[] }).matches;
  } catch {
    throw {
      kind: "failed",
      message: "LanguageTool gave an answer Polemic can't read. Try again in a moment.",
      retryAfter: null,
    } satisfies GrammarError;
  }
}

async function checkGrammar(blocks: string[]): Promise<GrammarIssue[][]> {
  const { spellcheckLanguage, grammar } = loadSettings();
  const language = spellcheckLanguage ?? "en";
  const ltLanguage = language === "en" ? (grammar.englishVariant ?? "en-US") : language;
  const out: GrammarIssue[][] = blocks.map(() => []);
  for (const chunk of chunkBlocks(blocks, POLEMIC_MAX_CHARS)) {
    const part = chunk.map((i) => blocks[i]);
    const { text, starts } = joinBlocks(part);
    const matches = await requestCheck(ltLanguage, text, grammar.disabledRules);
    splitMatches(matches, part, starts).forEach((issues, k) => {
      out[chunk[k]] = issues;
    });
  }
  return out;
}

// --- DOI lookup ----------------------------------------------------------

/** Whether `doi` is one to send, as bib_lookup.rs checks. */
export function checkDoi(doi: string): void {
  const valid =
    doi.startsWith("10.") &&
    doi.includes("/") &&
    doi.length <= 200 &&
    /^[!-~]+$/.test(doi) &&
    !/[?#\\"<>]/.test(doi);
  if (!valid) throw "That isn't a valid DOI.";
}

/** Percent-encodes what a URL path can't hold, as bib_lookup.rs does. */
export function encodeDoi(doi: string): string {
  return doi.replace(
    /[^A-Za-z0-9/\-._~:;()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

async function lookupBibtex(doi: string): Promise<string> {
  if (!loadSettings().onlineLookup) {
    throw "Online lookup is off. Turn it on to look up DOIs and arXiv IDs.";
  }
  checkDoi(doi);
  let response: Response;
  try {
    response = await fetch(`https://doi.org/${encodeDoi(doi)}`, {
      headers: { accept: "application/x-bibtex; charset=utf-8" },
      credentials: "omit",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw "Could not reach doi.org. Check your internet connection.";
  }
  if (response.status === 404)
    throw "No record was found for that identifier. Check it for typos.";
  if (!response.ok) throw `The lookup failed: doi.org answered ${response.status}.`;
  const body = await response.text();
  if (!body.trimStart().startsWith("@")) {
    throw "The registry has no BibTeX for that identifier. Add the entry by hand.";
  }
  return body;
}

// --- commands ------------------------------------------------------------

export const writingCommands: Record<string, (args: Args) => unknown> = {
  check_words: async (args) => (await speller()).check((args.words as string[]) ?? []),

  spellcheck_suggestions: async (args) =>
    (await speller()).suggest(String(args.word ?? ""), 6),

  add_spellcheck_word: async (args) => {
    const word = String(args.word ?? "")
      .trim()
      .toLowerCase();
    if (!word) throw "There is no word to add.";
    const words = userWords();
    if (!words.includes(word)) saveUserWords([...words, word]);
    (await speller()).add(word);
  },

  list_spellcheck_languages: async () => {
    const cache = await openCache();
    const languages = ["en"];
    for (const lang of DOWNLOADABLE_LANGUAGES) {
      if (downloaded.has(lang) || (await cache?.match(listKey(lang)))) {
        languages.push(lang);
      }
    }
    return languages;
  },

  install_spellcheck_language: async (args) => {
    const lang = checkedLanguage(args.lang);
    if (lang === "en") throw `unsupported language: ${lang}`;
    const content = String(args.content ?? "");
    downloaded.set(lang, content);
    const cache = await openCache();
    try {
      if (cache) {
        await cache.put(
          listKey(lang),
          new Response(content, { headers: { "content-type": "text/plain" } }),
        );
        // Kept in the cache: this tab needs no copy of its own.
        downloaded.delete(lang);
      }
    } catch {
      // No room: the list holds until the page reloads.
    }
    await switchLanguage(lang);
  },

  set_spellcheck_language: (args) => switchLanguage(checkedLanguage(args.lang)),

  check_grammar: (args) => checkGrammar((args.blocks as string[]) ?? []),

  // The managed checker's rules are LanguageTool's: turned off from an
  // underline, with no list to search.
  grammar_rules: () => [],

  lookup_bibtex: (args) => lookupBibtex(String(args.doi ?? "")),
};
