import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

export interface RightRailTab {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** The icon strip on the right window edge, selecting the properties
 *  column. Clicking the active icon of an open column hides it,
 *  JetBrains-style; clicking another icon switches and shows it. */
export function RightRail({
  tabs,
  activeTab,
  panelOpen,
  onSelect,
}: {
  tabs: RightRailTab[];
  activeTab: string;
  panelOpen: boolean;
  onSelect: (tab: string) => void;
}) {
  return (
    <nav className="flex w-10 shrink-0 flex-col items-center gap-1.5 py-2 pr-2">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = panelOpen && activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            title={tab.label}
            aria-current={active}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            onClick={() => onSelect(tab.id)}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </nav>
  );
}
