import type { LucideIcon } from "lucide-react";
import { RailButton } from "@/components/LeftRail";

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
    <nav className="flex w-10 shrink-0 flex-col items-center gap-1 py-1 pr-2">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <RailButton
            key={tab.id}
            side="right"
            label={tab.label}
            active={panelOpen && activeTab === tab.id}
            onClick={() => onSelect(tab.id)}
          >
            <Icon className="size-4" />
          </RailButton>
        );
      })}
    </nav>
  );
}
