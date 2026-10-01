import { useProjectStore } from "@/store/project";
import { useUiStore, type EditorFace } from "@/store/ui";
import { cn } from "cn";

/** Does the file kind have a Visual face? */
export function hasEditorFace(path: string | null): boolean {
  return path !== null && (path.endsWith(".tex") || path.endsWith(".bib"));
}

/**
 * The Visual/Code toggle in the window header: the active file's face
 * in the editor column. Visual is the rendered or managed form — the
 * References card for .bib files, the coming rich text mode for .tex —
 * Code is the raw text. Remembered per file kind; styled like the
 * workspace switch next to it.
 */
export function EditorFaceToggle() {
  const activeFile = useProjectStore((s) => s.activeFile);
  const texMode = useUiStore((s) => s.texEditorMode);
  const bibMode = useUiStore((s) => s.bibEditorMode);
  const setTexMode = useUiStore((s) => s.setTexEditorMode);
  const setBibMode = useUiStore((s) => s.setBibEditorMode);

  if (!hasEditorFace(activeFile)) return null;
  const isBib = activeFile!.endsWith(".bib");
  const mode: EditorFace = isBib ? bibMode : texMode;
  const setMode = isBib ? setBibMode : setTexMode;
  const faces: { id: EditorFace; label: string }[] = [
    { id: "visual", label: "Visual" },
    { id: "code", label: "Code" },
  ];

  return (
    <div
      className="flex shrink-0 items-center rounded-lg bg-accent/50 p-0.5"
      role="tablist"
      aria-label="Editor face"
    >
      {faces.map((face) => (
        <button
          key={face.id}
          type="button"
          role="tab"
          aria-selected={mode === face.id}
          title={
            face.id === "visual"
              ? "The rendered or managed form of the file"
              : "The raw text of the file"
          }
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
            mode === face.id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setMode(face.id)}
        >
          {face.label}
        </button>
      ))}
    </div>
  );
}
