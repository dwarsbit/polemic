import { useEffect, useMemo, useState } from "react";
import { ensurePreamble, parseAuthors, type ChangeAuthor } from "@/lib/changes";
import type { SuggestAuthor } from "@/lib/changes-view";
import { readProjectFile } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { suggestionAuthor, useSettingsStore } from "@/store/settings";
import { useSuggestStore } from "@/store/suggest";

/** The main file's text while a chapter is open: its unsaved buffer,
 *  else the disk copy (null for the main file itself, or while it loads). */
function useMainText(): string | null {
  const activeFile = useProjectStore((s) => s.activeFile);
  const mainFile = useProjectStore((s) => s.mainFile);
  const projectPath = useProjectStore((s) => s.project?.path);
  const mainBuffer = useProjectStore((s) =>
    s.mainFile === null ? undefined : s.buffers[s.mainFile],
  );
  const [disk, setDisk] = useState<{ path: string; text: string } | null>(null);
  const chapter = mainFile !== null && activeFile !== mainFile && !!projectPath;
  useEffect(() => {
    if (!chapter || mainBuffer !== undefined || mainFile === null || !projectPath)
      return;
    let cancelled = false;
    void readProjectFile(projectPath, mainFile)
      .catch(() => "")
      .then((text) => {
        if (!cancelled) setDisk({ path: mainFile, text });
      });
    return () => {
      cancelled = true;
    };
    // activeFile: re-read when switching chapters (the disk may have changed).
  }, [chapter, mainBuffer, mainFile, projectPath, activeFile]);
  if (!chapter) return null;
  if (mainBuffer !== undefined) return mainBuffer;
  return disk !== null && disk.path === mainFile ? disk.text : null;
}

/** The suggestion authors declared in the main file, when a chapter
 *  is open (the open file's own declarations are read by the views). */
export function useMainFileAuthors(): ChangeAuthor[] {
  const text = useMainText();
  return useMemo(() => (text === null ? [] : parseAuthors(text)), [text]);
}

/**
 * Who suggests while suggest mode is on, null otherwise: the name and
 * initials from Settings, the id from the main file's preamble (an
 * existing definition with the same name, else the initials).
 */
export function useSuggestAuthor(): SuggestAuthor | null {
  const enabled = useSuggestStore((s) => s.enabled);
  const authorName = useSettingsStore((s) => s.authorName);
  const authorInitials = useSettingsStore((s) => s.authorInitials);
  const activeFile = useProjectStore((s) => s.activeFile);
  const mainFile = useProjectStore((s) => s.mainFile);
  const mainText = useMainText();
  const author = enabled ? suggestionAuthor({ authorName, authorInitials }) : null;
  const tex = activeFile !== null && activeFile.endsWith(".tex");
  const hasPreamble = mainFile === null || activeFile === mainFile;
  // The id, from the live text when it holds the preamble.
  const liveId = useEditorStore((s) =>
    author !== null && tex && hasPreamble ? ensurePreamble(s.content, author).id : null,
  );
  const id =
    author === null || !tex
      ? null
      : hasPreamble
        ? liveId
        : mainText === null
          ? null
          : ensurePreamble(mainText, author).id;
  const name = author?.name ?? null;
  const initials = author?.initials ?? null;
  return useMemo(
    () =>
      id === null || name === null || initials === null
        ? null
        : { id, name, initials, hasPreamble },
    [id, name, initials, hasPreamble],
  );
}
