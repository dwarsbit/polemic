import { useState } from "react";
import { Folder, ListTree, Sigma } from "lucide-react";
import { FilesPanel } from "@/components/FilesPanel";
import { OutlinePanel } from "@/components/OutlinePanel";
import { SymbolsPanel } from "@/components/SymbolsPanel";
import { cn } from "cn";

type LeftTab = "files" | "outline" | "symbols";

const TABS: { id: LeftTab; label: string; icon: typeof Folder }[] = [
  { id: "files", label: "Files", icon: Folder },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "symbols", label: "Symbols", icon: Sigma },
];

export function Sidebar({ open, onExpand }: { open: boolean; onExpand: () => void }) {
  const [activeTab, setActiveTab] = useState<LeftTab>("files");

  return (
    <aside className="flex h-full w-full bg-sidebar text-sidebar-foreground">
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r py-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              title={tab.label}
              aria-current={isActive}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              onClick={() => {
                setActiveTab(tab.id);
                if (!open) onExpand();
              }}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
      {open && (
        <div className="min-w-0 flex-1 overflow-hidden border-r">
          {activeTab === "files" ? (
            <FilesPanel />
          ) : activeTab === "outline" ? (
            <OutlinePanel />
          ) : (
            <SymbolsPanel />
          )}
        </div>
      )}
    </aside>
  );
}
