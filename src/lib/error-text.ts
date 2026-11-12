/**
 * The message to show for something that was thrown. The app's own
 * failures arrive as a sentence (a string), or as an object with one
 * in `message`; anything else falls back to how it prints, without
 * the "Error: " that printing an Error puts in front.
 */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "object" && e !== null) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return String(e);
}
