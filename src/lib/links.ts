/** Where Help and Report an issue lead, in the menu and the browser build. */
export const HELP_URL = "https://github.com/dwarsbit/polemic#readme";
export const ISSUES_URL = "https://github.com/dwarsbit/polemic/issues/new";
/** Where the browser sends people for the desktop app. */
export const DOWNLOAD_URL = "https://polemicapp.com/download";
/** Opens a project of the account in the desktop app, which registers the scheme. */
export const desktopProjectUrl = (projectId: string) =>
  `polemic://open?project=${encodeURIComponent(projectId)}`;
