import { FilePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSuggestStore } from "@/store/suggest";
import { cn } from "cn";

/**
 * The Suggest switch: in the editor toolbars as a labeled button, in
 * the status bar as a compact one that also shows suggest notices.
 */
export function SuggestToggle({ compact = false }: { compact?: boolean }) {
  const enabled = useSuggestStore((s) => s.enabled);
  const setEnabled = useSuggestStore((s) => s.setEnabled);
  const message = useSuggestStore((s) => s.message);
  const title = enabled
    ? "Suggesting: edits are recorded as suggestions. Click to edit directly."
    : "Editing: click to record edits as suggestions.";
  if (compact) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-pressed={enabled}
          title={title}
          className={cn(
            "flex items-center gap-1 rounded px-1 hover:text-foreground",
            enabled && "font-medium text-amber-700 dark:text-amber-400",
          )}
          onClick={() => setEnabled(!enabled)}
        >
          <FilePen className="size-3" />
          {enabled ? "Suggesting" : "Editing"}
        </button>
        {message && <span className="truncate text-foreground">{message}</span>}
      </span>
    );
  }
  return (
    <Button
      variant={enabled ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={enabled}
      title={title}
      className={cn(
        "h-7 gap-1 px-2 text-xs",
        enabled && "text-amber-700 dark:text-amber-400",
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setEnabled(!enabled)}
    >
      <FilePen className="size-4" />
      Suggest
    </Button>
  );
}
