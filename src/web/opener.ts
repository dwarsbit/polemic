/**
 * The browser build's stand-in for `@tauri-apps/plugin-opener`: links
 * open in a new tab. Revealing a file in the file manager has no
 * browser counterpart and does nothing (`features.localFiles` hides it).
 */

export async function openUrl(url: string | URL): Promise<void> {
  window.open(String(url), "_blank", "noopener,noreferrer");
}

export async function revealItemInDir(): Promise<void> {}
