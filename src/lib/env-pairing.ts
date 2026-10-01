import { EditorState, type TransactionSpec } from "@codemirror/state";
import { Transaction } from "@codemirror/state";
import { envNameAt } from "@/lib/env-pairs";

/**
 * Environment pairing: renaming the name inside a \begin{…} syncs its
 * \end{…} and vice versa. Creating the pair is left to autocompletion
 * and the snippets; this extension only keeps existing pairs in sync.
 *
 * Implemented as a transaction filter so the mirrored text becomes
 * part of the *same* transaction as the user's edit — atomic, one
 * undo step, no re-entrant filtering.
 */
export function envPairing() {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const additions: { from: number; to: number; insert: string }[] = [];
    const oldDoc = tr.startState.doc.toString();

    // Mirror name edits into the partner tag. Ranges are read from the
    // pre-transaction document; the merge machinery maps the addition
    // through the user's own change, so positions stay in those
    // coordinates (no manual shifting).
    tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      void fromB;
      void toB;
      const loc = envNameAt(oldDoc, fromA);
      if (loc === null || loc.partner === null) return;
      // Only edits fully inside the name range.
      if (fromA < loc.range.from || toA > loc.range.to) return;
      const name = oldDoc.slice(loc.range.from, loc.range.to);
      const partner = oldDoc.slice(loc.partner.from, loc.partner.to);
      const next = splice(
        name,
        fromA - loc.range.from,
        toA - loc.range.from,
        inserted.toString(),
      );
      if (next === partner) return;
      additions.push({
        from: loc.partner.from,
        to: loc.partner.to,
        insert: next,
      });
    });

    if (additions.length === 0) return tr;
    const specs: TransactionSpec[] = [
      {
        changes: tr.changes,
        selection: tr.selection,
        effects: tr.effects,
        scrollIntoView: tr.scrollIntoView,
        userEvent: tr.annotation(Transaction.userEvent) ?? undefined,
      },
      { changes: additions },
    ];
    return specs;
  });
}

function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}
