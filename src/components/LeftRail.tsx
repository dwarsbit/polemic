import type { ReactNode } from "react";
import { AlertTriangle, Folder, ListTree, ScrollText, Sigma } from "lucide-react";
import type { IssuesTool } from "@/components/IssuesPanel";
import type { LeftTab } from "@/components/Sidebar";
import { cn } from "cn";

/** Navigator panels, selectable from the top of the rail. */
const NAVIGATOR_TABS: { id: LeftTab; label: string; icon: typeof Folder }[] = [
  { id: "files", label: "Files", icon: Folder },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "symbols", label: "Symbols", icon: Sigma },
];

/** Bottom-dock tools (the issues row), selectable from the bottom. */
const ISSUE_TOOLS: { id: IssuesTool; label: string; icon: typeof Folder }[] = [
  { id: "issues", label: "Issues", icon: AlertTriangle },
  { id: "log", label: "Compile Log", icon: ScrollText },
];

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-current={active}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The icon strip on the left window edge: navigator tabs above, bottom-dock
 *  tools below. Both act JetBrains-style: clicking the active icon of an
 *  open dock hides it; clicking another icon switches and shows it. */
export function LeftRail({
  navigatorTab,
  navigatorOpen,
  onSelectNavigatorTab,
  issuesTool,
  issuesOpen,
  onSelectIssuesTool,
}: {
  navigatorTab: LeftTab;
  navigatorOpen: boolean;
  onSelectNavigatorTab: (tab: LeftTab) => void;
  issuesTool: IssuesTool;
  issuesOpen: boolean;
  onSelectIssuesTool: (tool: IssuesTool) => void;
}) {
  return (
    <nav className="flex w-10 shrink-0 flex-col items-center gap-1.5 py-3">
      {NAVIGATOR_TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <RailButton
            key={tab.id}
            label={tab.label}
            active={navigatorOpen && navigatorTab === tab.id}
            onClick={() => onSelectNavigatorTab(tab.id)}
          >
            <Icon className="size-4" />
          </RailButton>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-1.5">
        {ISSUE_TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <RailButton
              key={tool.id}
              label={tool.label}
              active={issuesOpen && issuesTool === tool.id}
              onClick={() => onSelectIssuesTool(tool.id)}
            >
              <Icon className="size-4" />
            </RailButton>
          );
        })}
      </div>
    </nav>
  );
}
