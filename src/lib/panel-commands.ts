/**
 * Show/hide commands for the main panels, shared by the OS menu items
 * and the command palette. The editor registers the handlers while it
 * is mounted (it owns the panel refs and toggle state).
 */
export type PanelCommand = "toggle-sidebar" | "toggle-preview" | "toggle-right";

const handlers = new Map<PanelCommand, () => void>();

export function setPanelCommandHandler(
  command: PanelCommand,
  handler: (() => void) | null,
) {
  if (handler === null) handlers.delete(command);
  else handlers.set(command, handler);
}

/** Run a panel command; no-op when the editor is not mounted. */
export function runPanelCommand(command: PanelCommand) {
  handlers.get(command)?.();
}
