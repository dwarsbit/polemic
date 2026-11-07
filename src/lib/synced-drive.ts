/**
 * Folders that a sync service keeps in step with other computers. A
 * linked project inside one has two sync paths for the same files,
 * which race each other, so the editor warns once (it doesn't block).
 */

const DRIVES: [RegExp, string][] = [
  [/\/Library\/Mobile Documents\//i, "iCloud Drive"],
  [/\/iCloud ?Drive\//i, "iCloud Drive"],
  [/\/Library\/CloudStorage\/GoogleDrive/i, "Google Drive"],
  [/\/(Google Drive|My Drive)\//i, "Google Drive"],
  [/\/Library\/CloudStorage\/ProtonDrive/i, "Proton Drive"],
  [/\/Proton ?Drive\//i, "Proton Drive"],
  [/\/(Library\/CloudStorage\/)?Dropbox[^/]*\//i, "Dropbox"],
  [/\/(Library\/CloudStorage\/)?OneDrive[^/]*\//i, "OneDrive"],
];

/** The sync service whose folder holds `path`, or null. */
export function syncedDriveOf(path: string): string | null {
  const slashed = path.replace(/\\/g, "/") + "/";
  return DRIVES.find(([pattern]) => pattern.test(slashed))?.[1] ?? null;
}
