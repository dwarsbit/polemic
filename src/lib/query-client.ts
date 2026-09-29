import { QueryClient } from "@tanstack/react-query";

/** Shared client so non-React modules (stores) can invalidate queries. */
export const queryClient = new QueryClient();

/**
 * Refetch the git-derived queries (file tree status colors, ignored
 * files) after the app writes to disk. Fire-and-forget safe.
 */
export function invalidateGitState(): Promise<void> {
  return invalidateGitQueries(["git-status", "git-ignored"]);
}

/**
 * Refetch everything git-derived when the window regains focus, so
 * changes made outside the app (git CLI, other editors) show up in
 * the file tree, change bars, and history.
 */
export function refetchGitState(): Promise<void> {
  return invalidateGitQueries([
    "git-status",
    "git-ignored",
    "git-head",
    "git-log",
  ]);
}

function invalidateGitQueries(keys: string[]): Promise<void> {
  return Promise.all(
    keys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  ).then(() => undefined);
}
