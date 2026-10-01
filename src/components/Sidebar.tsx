import { AssetsPanel } from "@/components/AssetsPanel";
import { BibliographyPanel } from "@/components/BibliographyPanel";
import { FilesPanel } from "@/components/FilesPanel";
import { LabelsPanel } from "@/components/LabelsPanel";
import { OutlinePanel } from "@/components/OutlinePanel";
import { SymbolsPanel } from "@/components/SymbolsPanel";

export type LeftTab =
  | "files"
  | "outline"
  | "symbols"
  | "assets"
  | "labels"
  | "bibliography";

/** The navigator column: the panel selected by the top of the left rail. */
export function Sidebar({ activeTab }: { activeTab: LeftTab }) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      {activeTab === "files" ? (
        <FilesPanel />
      ) : activeTab === "outline" ? (
        <OutlinePanel />
      ) : activeTab === "assets" ? (
        <AssetsPanel />
      ) : activeTab === "labels" ? (
        <LabelsPanel />
      ) : activeTab === "bibliography" ? (
        <BibliographyPanel />
      ) : (
        <SymbolsPanel />
      )}
    </div>
  );
}
