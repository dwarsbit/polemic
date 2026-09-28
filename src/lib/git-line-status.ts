import { lineDiff } from "./diff";

/**
 * Which lines of the current text differ from HEAD. Lines whose diff
 * chunk pairs them with removed lines count as modified; unpaired new
 * lines count as added. A null HEAD (untracked file, unborn repo, no
 * repository) leaves everything unmarked.
 */
export function lineStatus(
  headText: string | null,
  currentText: string,
): Map<number, "added" | "modified"> {
  const result = new Map<number, "added" | "modified">();
  if (headText === null) return result;

  const lines = lineDiff(headText, currentText);
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type === "context") {
      index++;
      continue;
    }
    // One contiguous change block: its removes and adds pair up.
    let removes = 0;
    const adds: number[] = [];
    while (index < lines.length && lines[index].type !== "context") {
      if (lines[index].type === "remove") {
        removes++;
      } else {
        adds.push(lines[index].newLine!);
      }
      index++;
    }
    const paired = Math.min(removes, adds.length);
    adds.forEach((line, position) => {
      result.set(line, position < paired ? "modified" : "added");
    });
  }
  return result;
}
