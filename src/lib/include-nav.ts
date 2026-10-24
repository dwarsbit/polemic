import { resolveIncludePath, texPathsOf } from "@/lib/doc-structure";
import { usePreviewStore } from "@/store/preview";
import { useProjectStore } from "@/store/project";

/**
 * Open the file an \input/\include spec names (Cmd/Ctrl+click on
 * the command). Specs resolve like LaTeX does: relative to the project
 * root, `.tex` implied. A spec with no file says so instead.
 */
export async function openIncludeTarget(spec: string): Promise<boolean> {
  const { files, activeFile, openFile } = useProjectStore.getState();
  const target = resolveIncludePath(spec, texPathsOf(files));
  if (target === null) {
    usePreviewStore
      .getState()
      .setNotice(`No file in the project matches \\input{${spec}}.`);
    return false;
  }
  if (target !== activeFile) await openFile(target);
  return true;
}
