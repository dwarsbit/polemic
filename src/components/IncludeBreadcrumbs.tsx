import { ChevronRight } from "lucide-react";
import { useDocumentStructure } from "@/hooks/useDocumentOrder";
import { includeChain, includeLineOf, texPathsOf } from "@/lib/doc-structure";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

/** Open an ancestor with the cursor on the line including `child`. */
async function openAncestor(file: string, child: string) {
  await useProjectStore.getState().openFile(file);
  const { files, activeFile } = useProjectStore.getState();
  if (activeFile !== file) return;
  const line = includeLineOf(useEditorStore.getState().content, child, texPathsOf(files));
  if (line !== null) useEditorStore.getState().jumpTo(line);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Where the active .tex file sits in the document: the include chain
 * from the main file down to it, each ancestor clickable. Hidden for
 * the main file itself; a file the document never includes says so.
 */
export function IncludeBreadcrumbs() {
  const activeFile = useProjectStore((s) => s.activeFile);
  const mainFile = useProjectStore((s) => s.mainFile);
  const structure = useDocumentStructure();

  if (
    activeFile === null ||
    mainFile === null ||
    activeFile === mainFile ||
    !activeFile.endsWith(".tex") ||
    structure === null
  ) {
    return null;
  }
  const chain = includeChain(activeFile, mainFile, structure.parents);

  return (
    <nav
      aria-label="Include path"
      className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden border-b px-2 text-[11px] text-muted-foreground"
    >
      {chain === null ? (
        <span className="truncate" title={activeFile}>
          Not included from {mainFile}
        </span>
      ) : (
        chain.map((file, index) => {
          const last = index === chain.length - 1;
          return (
            <span key={file} className="flex min-w-0 items-center gap-0.5">
              {index > 0 && <ChevronRight className="size-3 shrink-0" />}
              {last ? (
                <span className="truncate text-foreground" title={file}>
                  {baseName(file)}
                </span>
              ) : (
                <button
                  type="button"
                  className="truncate rounded px-0.5 hover:bg-accent hover:text-foreground"
                  title={file}
                  onClick={() => void openAncestor(file, chain[index + 1])}
                >
                  {baseName(file)}
                </button>
              )}
            </span>
          );
        })
      )}
    </nav>
  );
}
