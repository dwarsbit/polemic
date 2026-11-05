/**
 * Ways into the assistant from elsewhere in the editor: the editor's
 * context menu (the selection as context) and Ask AI on a compile
 * issue. Both open the assistant panel.
 */

import { readCursor } from "@/lib/editor-edits";
import { runPanelCommand } from "@/lib/panel-commands";
import type { CompileIssue } from "@/lib/tauri";
import { useAssistantStore } from "@/store/assistant";
import { useProjectStore } from "@/store/project";

/** Opens the panel with the editor's selection attached, if any. */
export function askAboutSelection(): void {
  const path = useProjectStore.getState().activeFile;
  const cursor = readCursor();
  if (path !== null && cursor?.selection) {
    useAssistantStore
      .getState()
      .setContext({ selection: { path, ...cursor.selection } });
  }
  runPanelCommand("show-assistant");
}

/** Opens the panel and asks for a fix for the issue. */
export function askAboutIssue(issue: CompileIssue): void {
  runPanelCommand("show-assistant");
  const store = useAssistantStore.getState();
  if (store.running) {
    store.setContext({ issue });
    return;
  }
  store.setContext({ issue });
  void store.ask("Fix this error.");
}
