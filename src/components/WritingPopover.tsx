import { useEffect, useState } from "react";
import { addSpellcheckWord, spellcheckSuggestions } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

/** A spelling or grammar issue under the pointer, in document positions. */
export type WritingIssue = {
  kind: "spelling";
  word: string;
  from: number;
  to: number;
};

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
  /** Close; `recheck` when the dictionary or ignore list changed. */
  onDone: (recheck: boolean) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    spellcheckSuggestions(issue.word)
      .then((words) => {
        if (!cancelled) setSuggestions(words);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [issue.word]);

  const accept = (action: () => Promise<void>) => {
    void action()
      .then(() => onDone(true))
      .catch(() => onDone(false));
  };

  return (
    <div
      className="fixed z-50 min-w-44 rounded-md border bg-popover p-1 text-xs shadow-md"
      style={{
        left: Math.min(x, window.innerWidth - 240),
        top: Math.min(y + 8, window.innerHeight - 260),
      }}
      // Clicks inside must not reach the editor (which closes this).
      onMouseDown={(event) => event.stopPropagation()}
    >
      {suggestions === null ? (
        <p className="px-2 py-1 text-muted-foreground">Looking for corrections…</p>
      ) : suggestions.length === 0 ? (
        <p className="px-2 py-1 text-muted-foreground">No corrections found</p>
      ) : (
        suggestions.map((word) => (
          <button
            key={word}
            type="button"
            className="block w-full rounded px-2 py-1 text-left font-medium hover:bg-accent"
            onClick={() => onReplace(word)}
          >
            {word}
          </button>
        ))
      )}
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
        onClick={() => accept(() => addSpellcheckWord(issue.word))}
      >
        Add “{issue.word}” to dictionary
      </button>
      <button
        type="button"
        className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
        onClick={() => accept(() => useProjectStore.getState().ignoreWord(issue.word))}
      >
        Ignore in this project
      </button>
    </div>
  );
}
