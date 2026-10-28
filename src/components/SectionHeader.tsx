import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The header of every panel card: a sentence-case title, an optional
 * count beside it, actions on the right, and a hairline below. With
 * onToggle it also collapses its section.
 */
export function SectionHeader({
  label,
  count,
  collapsed = false,
  onToggle,
  actions,
  children,
  className,
}: {
  label: string;
  /** A count shown as meta text beside the title. */
  count?: number | string;
  collapsed?: boolean;
  onToggle?: () => void;
  actions?: React.ReactNode;
  /** Extra inline content after the title (status, filters). */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 border-b px-3",
        onToggle && "pl-2",
        className,
      )}
    >
      {onToggle && (
        <button
          type="button"
          title={collapsed ? "Expand" : "Collapse"}
          className="-mr-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onToggle}
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
          />
        </button>
      )}
      <span className="truncate text-xs font-medium">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
      {children}
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>
      )}
    </div>
  );
}
