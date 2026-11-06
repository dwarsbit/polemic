/**
 * Which app this bundle is: the desktop app (Tauri) or the browser
 * build (`vite --mode web`, see src/web). Fixed at build time, so the
 * bundler drops the other target's branches.
 */
export const isWeb = import.meta.env.MODE === "web";

/**
 * Desktop features the browser build leaves out, for now or for good.
 * Components check these rather than `isWeb`, so each hidden feature
 * says why it is hidden.
 */
export const features = {
  /** Folders on this computer: open a folder, the projects folder,
   *  reveal in the file manager, file pickers, the system PDF viewer. */
  localFiles: !isWeb,
  /** Git and local snapshots, with their panels and settings. */
  versionControl: !isWeb,
  /** TeX on this computer and the choice of where to compile. */
  localTex: !isWeb,
  /** Signing the desktop app in; the browser uses the site's session. */
  desktopAccount: !isWeb,
  /** The assistant, until it runs through the server. */
  assistant: !isWeb,
  /** Spelling and grammar checks, until they run in the browser. */
  writingAids: !isWeb,
  /** Reference sources outside the project: .bib files and Zotero. */
  referenceSources: !isWeb,
} as const;
