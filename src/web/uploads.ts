/**
 * Files picked in the browser. The file picker (`open` in
 * src/web/dialog.ts) answers a name for each file in place of a path
 * on this computer, which a browser never gives, and the commands that
 * take files look the file up by that name. The name ends with the
 * file's own name, so it reads like a path.
 */

const PREFIX = "upload:";
const picked = new Map<string, File>();
let count = 0;

/** A name for a picked file, kept until the tab closes. */
export function rememberFile(file: File): string {
  count += 1;
  const name = `${PREFIX}${count}/${file.name}`;
  picked.set(name, file);
  return name;
}

/** The file a picked name stands for, or null. */
export function pickedFile(name: string): File | null {
  return picked.get(name) ?? null;
}

/** Shows the browser's file picker; no files when it is cancelled. */
export function pickFiles({
  multiple,
  accept,
}: {
  multiple: boolean;
  accept: string;
}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
