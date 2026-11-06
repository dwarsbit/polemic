import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** GET /api/usage, the parts shown here. */
interface Usage {
  storage: { usedBytes: number; limitBytes: number };
  compile: { usedSeconds: number; limitSeconds: number | null };
}

/** Decimal units, as the plans state them: "100 MB", "5 GB". */
export function formatStorage(bytes: number): string {
  const units: [number, string][] = [
    [1e9, "GB"],
    [1e6, "MB"],
    [1e3, "KB"],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) return `${Number((bytes / size).toFixed(1))} ${unit}`;
  }
  return `${bytes} B`;
}

const minutes = (seconds: number) => Number((seconds / 60).toFixed(1));

/**
 * The browser build's note under the project list: storage and today's
 * compile time against the plan, with a link to the account page.
 */
export function UsageSummary() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let live = true;
    void import("@/web/server")
      .then(({ request }) => request<Usage>("/api/usage"))
      .then((answer) => {
        if (live) setUsage(answer);
      })
      .catch(() => {
        // Not worth an error on the start screen.
      });
    return () => {
      live = false;
    };
  }, []);

  if (usage === null) return null;
  const { storage, compile } = usage;
  const full = storage.usedBytes >= storage.limitBytes;
  const compileUsedUp =
    compile.limitSeconds !== null && compile.usedSeconds >= compile.limitSeconds;
  return (
    <p className="mt-4 text-xs text-muted-foreground">
      <span className={cn(full && "text-warning")}>
        {full ? "Your storage is full" : "Storage"}: {formatStorage(storage.usedBytes)}{" "}
        of {formatStorage(storage.limitBytes)}.
      </span>{" "}
      {compile.limitSeconds !== null && (
        <span className={cn(compileUsedUp && "text-warning")}>
          Compile time today: {minutes(compile.usedSeconds)} of{" "}
          {minutes(compile.limitSeconds)} minutes.
        </span>
      )}{" "}
      <a
        href="/account"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        See your plan
      </a>
    </p>
  );
}
