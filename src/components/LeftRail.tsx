import type { ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  FileCog,
  Folder,
  GalleryVertical,
  Images,
  ListTree,
  Package,
  ScrollText,
  Search,
  Sigma,
  Tags,
} from "lucide-react";
import type { IssuesTool } from "@/components/IssuesPanel";
import type { LeftTab } from "@/components/Sidebar";
import { useDialogsStore } from "@/store/dialogs";
import { formatShortcut } from "@/lib/platform";
import { cn } from "cn";

/** Navigator panels, selectable from the top of the rail. */
const NAVIGATOR_TABS: { id: LeftTab; label: string; icon: typeof Folder }[] = [
  { id: "files", label: "Files", icon: Folder },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "symbols", label: "Symbols", icon: Sigma },
  { id: "assets", label: "Assets", icon: Images },
  { id: "floats", label: "Figures & tables", icon: GalleryVertical },
  { id: "labels", label: "Labels", icon: Tags },
  { id: "bibliography", label: "Bibliography", icon: BookOpen },
];

/** Bottom-dock tools (the issues row), selectable from the bottom. */
const ISSUE_TOOLS: { id: IssuesTool; label: string; icon: typeof Folder }[] = [
  { id: "issues", label: "Issues", icon: AlertTriangle },
  { id: "log", label: "Compile log", icon: ScrollText },
  { id: "search", label: "Search in project", icon: Search },
];

/** A rail icon. The open panel's icon sits on the accent surface with
 *  a violet bar on the window edge. Shared with the right rail. */
export function RailButton({
  label,
  active,
  side = "left",
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  side?: "left" | "right";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={active}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-accent text-foreground after:absolute after:top-1.5 after:bottom-1.5 after:w-0.5 after:rounded-full after:bg-tint"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        active && (side === "left" ? "after:-left-2" : "after:-right-2"),
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
    <nav className="flex w-10 shrink-0 flex-col items-center gap-1 py-1 pl-2">
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
      {/* Actions, not panels: the package manager and document settings
          dialogs. */}
      <div className="my-1 w-5 border-t" />
      <RailButton
        label={`Packages (${formatShortcut("Mod+Alt+P")})`}
        active={false}
        onClick={() => useDialogsStore.getState().setPackagesDialogOpen(true)}
      >
        <Package className="size-4" />
      </RailButton>
      <RailButton
        label="Document settings"
        active={false}
        onClick={() => useDialogsStore.getState().setDocumentSettingsOpen(true)}
      >
        <FileCog className="size-4" />
      </RailButton>
      <div className="mt-auto flex flex-col items-center gap-1 pb-1">
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
