import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionHeader({
  label,
  collapsed,
  onToggle,
  actions,
}: {
  label: string;
  collapsed: boolean;
  onToggle?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 px-3 text-xs font-medium text-muted-foreground">
      {onToggle && (
        <button
          type="button"
          title={collapsed ? "Expand" : "Collapse"}
          className="rounded p-0.5 hover:bg-accent hover:text-foreground"
          onClick={onToggle}
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
          />
        </button>
      )}
      <span className="flex-1">{label}</span>
      {actions}
    </div>
  );
}
