import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { exportPdf } from "@/lib/tauri";
import { isWeb } from "@/lib/target";
import { useProjectStore } from "@/store/project";
import { usePreviewStore } from "@/store/preview";

/** Ask where to save the built PDF and copy it there. In the browser,
 *  download the PDF the preview shows. */
export async function exportPdfAs(): Promise<void> {
  const { project, mainFile } = useProjectStore.getState();
  if (!project || !mainFile) return;
  if (isWeb) {
    downloadPreviewPdf(`${project.name}.pdf`);
    return;
  }
  try {
    const dest = await saveDialog({
      defaultPath: `${project.name}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (typeof dest === "string" && dest) {
      await exportPdf(project.path, mainFile, dest);
    }
  } catch (e) {
    usePreviewStore.getState().setNotice(String(e));
  }
}

function downloadPreviewPdf(name: string) {
  const bytes = usePreviewStore.getState().pdfBytes;
  if (!bytes) {
    usePreviewStore.getState().setNotice("Compile the project first.");
    return;
  }
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Give the download a moment to start before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
