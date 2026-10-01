/**
 * Pointer-based dragging of assets/files into the editor. HTML5 drag
 * does not work in the webview (see TabsBar), so a ghost chip follows
 * the pointer; releasing over the editor hands the drop to the
 * handler registered by the editor component.
 */

type EditorDropHandler = (clientX: number, clientY: number, paths: string[]) => void;

/** Shows the drop indicator; a null x hides it again. */
type IndicatorHandler = (x: number | null, y: number) => void;

let dropHandler: EditorDropHandler | null = null;
let indicatorHandler: IndicatorHandler | null = null;
let lastDragEnd = 0;

/** The editor registers this while it is mounted. */
export function setEditorDropHandler(handler: EditorDropHandler | null) {
  dropHandler = handler;
}

/** The editor registers this to draw its insertion indicator. */
export function setEditorDropIndicator(handler: IndicatorHandler | null) {
  indicatorHandler = handler;
}

/** True when a pointer drag just ended (suppresses the trailing click). */
export function wasDragged(): boolean {
  return Date.now() - lastDragEnd < 300;
}

const DRAG_THRESHOLD_PX = 4;

function editorAt(x: number, y: number): boolean {
  const element = document.elementFromPoint(x, y);
  return element !== null && element.closest(".cm-editor") !== null;
}

/** Start dragging a project file. Call on pointerdown of a card/row. */
export function startAssetDrag(
  path: string,
  event: { button: number; clientX: number; clientY: number },
) {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let ghost: HTMLElement | null = null;
  let active = false;

  const cleanup = () => {
    ghost?.remove();
    ghost = null;
    document.body.style.cursor = "";
    indicatorHandler?.(null, 0);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", onKeyDown);
  };

  const cancel = () => {
    const wasActive = active;
    cleanup();
    if (wasActive) lastDragEnd = Date.now();
  };

  const onMove = (event: PointerEvent) => {
    if (!active) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      active = true;
      ghost = document.createElement("div");
      ghost.textContent = path.split("/").pop() ?? path;
      ghost.className =
        "pointer-events-none fixed z-50 rounded-md border bg-card px-2 py-1 text-xs shadow-md";
      document.body.appendChild(ghost);
      document.body.style.cursor = "grabbing";
    }
    if (ghost !== null) {
      ghost.style.left = `${event.clientX + 8}px`;
      ghost.style.top = `${event.clientY + 8}px`;
      const overEditor = editorAt(event.clientX, event.clientY);
      ghost.classList.toggle("border-primary", overEditor);
      indicatorHandler?.(overEditor ? event.clientX : null, event.clientY);
    }
  };

  const onUp = (event: PointerEvent) => {
    const overEditor = active && editorAt(event.clientX, event.clientY);
    cleanup();
    if (active) {
      lastDragEnd = Date.now();
      if (overEditor) {
        dropHandler?.(event.clientX, event.clientY, [path]);
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancel();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", onKeyDown);
}
