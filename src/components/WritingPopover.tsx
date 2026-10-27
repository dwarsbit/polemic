import { useEffect, useState } from "react";
import type { PlacedIssue } from "@/lib/grammar-check";
import { addSpellcheckWord, spellcheckSuggestions } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";

/** A spelling or grammar issue under the pointer, in document positions. */
export type WritingIssue =
  | { kind: "spelling"; word: string; from: number; to: number }
  | { kind: "grammar"; issue: PlacedIssue; from: number; to: number };

const itemClass = "block w-full rounded px-2 py-1 text-left hover:bg-accent";

/**
 * The fixes for a spelling or grammar issue, shown where the user
 * right-clicked: corrections first, then the ways to accept the text
 * as it is. Shared by the Code and Visual editors.
 */
export function WritingPopover({
  issue,
  x,
  y,
  onReplace,
  onDone,
}: {
  issue: WritingIssue;
  x: number;
  y: number;
  /** Replace the issue's text with a correction. */
  onReplace: (text: string) => void;
  /** Close; `recheck` when the dictionary, ignore list or rules changed. */
  onDone: (recheck: boolean) => void;
}) {
  const accept = (action: () => Promise<void>) => {
    void action()
      .then(() => onDone(true))
      .catch(() => onDone(false));
  };

  return (
    <div
      className="fixed z-50 max-w-80 min-w-44 rounded-md border bg-popover p-1 text-xs shadow-md"
      style={{
        left: Math.min(x, window.innerWidth - 330),
        top: Math.min(y + 8, window.innerHeight - 260),
      }}
      // Clicks inside must not reach the editor (which closes this).
      onMouseDown={(event) => event.stopPropagation()}
    >
      {issue.kind === "spelling" ? (
        <SpellingItems word={issue.word} onReplace={onReplace} onAccept={accept} />
      ) : (
        <GrammarItems issue={issue.issue} onReplace={onReplace} onAccept={accept} />
      )}
    </div>
  );
}

function SpellingItems({
  word,
  onReplace,
  onAccept,
}: {
  word: string;
  onReplace: (text: string) => void;
  onAccept: (action: () => Promise<void>) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    spellcheckSuggestions(word)
      .then((words) => {
        if (!cancelled) setSuggestions(words);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [word]);

  return (
    <>
      {suggestions === null ? (
        <p className="px-2 py-1 text-muted-foreground">Looking for corrections…</p>
      ) : suggestions.length === 0 ? (
        <p className="px-2 py-1 text-muted-foreground">No corrections found</p>
      ) : (
        suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={`${itemClass} font-medium`}
            onClick={() => onReplace(suggestion)}
          >
            {suggestion}
          </button>
        ))
      )}
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        className={itemClass}
        onClick={() => onAccept(() => addSpellcheckWord(word))}
      >
        Add “{word}” to dictionary
      </button>
      <button
        type="button"
        className={itemClass}
        onClick={() => onAccept(() => useProjectStore.getState().ignoreWord(word))}
      >
        Ignore in this project
      </button>
    </>
  );
}

function GrammarItems({
  issue,
  onReplace,
  onAccept,
}: {
  issue: PlacedIssue;
  onReplace: (text: string) => void;
  onAccept: (action: () => Promise<void>) => void;
}) {
  return (
    <>
      <p className="px-2 pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {issue.category}
      </p>
      <p className="px-2 pb-1">{issue.message}</p>
      {issue.replaceable &&
        issue.replacements.map((text) => (
          <button
            key={text}
            type="button"
            className={`${itemClass} font-medium`}
            onClick={() => onReplace(text)}
          >
            {text === "" ? `Remove “${issue.text}”` : text}
          </button>
        ))}
      {!issue.replaceable && issue.replacements.length > 0 && (
        <p className="px-2 py-1 text-muted-foreground">
          Suggested: {issue.replacements.slice(0, 3).join(", ")} (markup inside, edit by
          hand)
        </p>
      )}
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        className={itemClass}
        onClick={() =>
          onAccept(async () => {
            const store = useSettingsStore.getState();
            const disabled = new Set(store.grammar.disabledRules);
            disabled.add(issue.rule);
            await store.setGrammar({ ...store.grammar, disabledRules: [...disabled] });
          })
        }
      >
        Turn off this rule
      </button>
    </>
  );
}
