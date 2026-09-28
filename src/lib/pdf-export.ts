import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { exportPdf } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";
import { usePreviewStore } from "@/store/preview";

/** Ask where to save the built PDF and copy it there. */
export async function exportPdfAs(): Promise<void> {
  const { project, mainFile } = useProjectStore.getState();
  if (!project || !mainFile) return;
  try {
    const dest = await saveDialog({
      defaultPath: `${project.name}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (typeof dest === "string" && dest) {
      await exportPdf(project.path, mainFile, dest);
    }
  } catch (e) {
    usePreviewStore.setState({ status: "error", error: String(e) });
  }
}
