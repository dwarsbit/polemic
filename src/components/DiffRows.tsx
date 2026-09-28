import type { DiffRow } from "@/lib/diff";
import { cn } from "cn";

/** Renders unified diff rows (lines + collapsed gaps) in a mono font. */
export function DiffRows({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="font-mono text-xs leading-5">
      {rows.map((row, index) =>
        row.kind === "gap" ? (
          <p key={index} className="my-1 text-center text-[11px] text-muted-foreground">
            ⋯ {row.count} unchanged lines
          </p>
        ) : (
          <p
            key={index}
            className={cn(
              "flex gap-3 px-1",
              row.line.type === "add" &&
                "bg-emerald-600/10 text-emerald-700 dark:text-emerald-300",
              row.line.type === "remove" && "bg-destructive/10",
            )}
          >
            <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">
              {row.line.oldLine ?? ""}
            </span>
            <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">
              {row.line.newLine ?? ""}
            </span>
            <span className="w-3 shrink-0 text-muted-foreground">
              {row.line.type === "add" ? "+" : row.line.type === "remove" ? "−" : ""}
            </span>
            <span className="whitespace-pre-wrap break-all">
              {row.line.text || " "}
            </span>
          </p>
        ),
      )}
    </div>
  );
}
