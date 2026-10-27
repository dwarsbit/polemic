import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Rows3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  pasteCells,
  serializeTable,
  setAlign,
  setCell,
  type Align,
  type TableGrid,
} from "@/lib/table-grid";
import { useDialogsStore, type TableGridRequest } from "@/store/dialogs";
import { cn } from "cn";

/** A rule line's name for the divider label (\toprule -> "toprule"). */
function ruleName(rule: string): string {
  return rule.replace(/^\\/, "").replace(/[[({].*$/, "");
}

/**
 * The table grid editor: a tabular's cells as a grid of inputs. The
 * toolbar acts on the focused cell's row and column; Enter moves down
 * (adding a row at the end); pasting tab-separated text (from a
 * spreadsheet) fills cells from the focused one. Cells hold raw LaTeX.
 */
export function TableGridDialog() {
  const request = useDialogsStore((s) => s.tableGrid);
  // A fresh editor (and state) per request.
  return request === null ? null : (
    <TableGridEditor key={nextKey(request)} request={request} />
  );
}

const requestKeys = new WeakMap<TableGridRequest, number>();
let keyCounter = 0;
function nextKey(request: TableGridRequest): number {
  let key = requestKeys.get(request);
  if (key === undefined) {
    key = ++keyCounter;
    requestKeys.set(request, key);
  }
  return key;
}

function TableGridEditor({ request }: { request: TableGridRequest }) {
  const setTableGrid = useDialogsStore((s) => s.setTableGrid);
  const [grid, setGrid] = useState<TableGrid>(request.grid);
  const [focus, setFocus] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const cellRefs = useRef(new Map<string, HTMLInputElement>());
  // Focus to move to once the grid re-renders (after Enter or a paste).
  const pendingFocus = useRef<{ row: number; col: number } | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    cellRefs.current.get(`${target.row}:${target.col}`)?.focus();
  });
  const columns = Math.max(grid.columns.length, ...grid.rows.map((r) => r.length));
  const row = Math.min(focus.row, grid.rows.length - 1);
  const col = Math.min(focus.col, columns - 1);
  const align = grid.columns[col]?.align ?? null;

  const close = () => setTableGrid(null);
  const update = (next: TableGrid, nextFocus?: { row: number; col: number }) => {
    setGrid(next);
    if (nextFocus !== undefined) {
      setFocus(nextFocus);
      pendingFocus.current = nextFocus;
    }
  };

  const onKeyDown = (event: React.KeyboardEvent, r: number, c: number) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (r === grid.rows.length - 1)
        update(insertRow(grid, grid.rows.length), { row: r + 1, col: c });
      else update(grid, { row: r + 1, col: c });
    } else if (event.key === "ArrowDown" && r < grid.rows.length - 1) {
      event.preventDefault();
      update(grid, { row: r + 1, col: c });
    } else if (event.key === "ArrowUp" && r > 0) {
      event.preventDefault();
      update(grid, { row: r - 1, col: c });
    }
  };

  const onPaste = (event: React.ClipboardEvent, r: number, c: number) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.replace(/\n$/, "").includes("\n")) return;
    event.preventDefault();
    update(pasteCells(grid, r, c, text), { row: r, col: c });
  };

  const ruleRow = (rules: string[], key: string) =>
    rules.length > 0 && (
      <tr key={key} aria-hidden>
        <td colSpan={columns + 1} className="px-1 py-0.5">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            {rules.map(ruleName).join(" · ")}
            <div className="h-px flex-1 bg-border" />
          </div>
        </td>
      </tr>
    );

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Edit table</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-0.5 border-b pb-2">
          <ToolButton
            label="Insert row above"
            onClick={() => update(insertRow(grid, row), { row, col })}
          >
            <ArrowUpToLine className="size-4" />
          </ToolButton>
          <ToolButton
            label="Insert row below"
            onClick={() => update(insertRow(grid, row + 1), { row: row + 1, col })}
          >
            <ArrowDownToLine className="size-4" />
          </ToolButton>
          <ToolButton
            label="Delete row"
            disabled={grid.rows.length <= 1}
            onClick={() =>
              update(deleteRow(grid, row), { row: Math.max(0, row - 1), col })
            }
          >
            <Rows3 className="size-4 text-destructive" />
          </ToolButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolButton
            label="Insert column left"
            disabled={grid.hasSpans}
            onClick={() => update(insertColumn(grid, col), { row, col })}
          >
            <ArrowLeftToLine className="size-4" />
          </ToolButton>
          <ToolButton
            label="Insert column right"
            disabled={grid.hasSpans}
            onClick={() => update(insertColumn(grid, col + 1), { row, col: col + 1 })}
          >
            <ArrowRightToLine className="size-4" />
          </ToolButton>
          <ToolButton
            label="Delete column"
            disabled={grid.hasSpans || grid.columns.length <= 1}
            onClick={() =>
              update(deleteColumn(grid, col), { row, col: Math.max(0, col - 1) })
            }
          >
            <Columns3 className="size-4 text-destructive" />
          </ToolButton>
          <div className="mx-1 h-5 w-px bg-border" />
          {(
            [
              ["l", "Align column left", AlignLeft],
              ["c", "Center column", AlignCenter],
              ["r", "Align column right", AlignRight],
            ] as [Align, string, typeof AlignLeft][]
          ).map(([value, label, Icon]) => (
            <Button
              key={value}
              variant={align === value ? "secondary" : "ghost"}
              size="icon-sm"
              title={label}
              aria-label={label}
              aria-pressed={align === value}
              disabled={grid.columns[col] === undefined}
              onClick={() => update(setAlign(grid, col, value), { row, col })}
            >
              <Icon className="size-4" />
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            Row {row + 1}, column {col + 1}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="w-6" />
                {Array.from({ length: columns }, (_, c) => (
                  <th
                    key={c}
                    className={cn(
                      "px-1 pb-1 text-left font-mono font-normal text-muted-foreground",
                      c === col && "text-foreground",
                    )}
                    title="Column spec"
                  >
                    {grid.columns[c]?.raw ?? "?"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.flatMap((cells, r) => [
                ruleRow(grid.rules[r] ?? [], `rule-${r}`),
                <tr key={`row-${r}`}>
                  <td className="pr-1 text-right text-muted-foreground tabular-nums">
                    {r + 1}
                  </td>
                  {Array.from({ length: columns }, (_, c) => (
                    <td key={c}>
                      <input
                        ref={(el) => {
                          if (el) cellRefs.current.set(`${r}:${c}`, el);
                          else cellRefs.current.delete(`${r}:${c}`);
                        }}
                        aria-label={`Row ${r + 1}, column ${c + 1}`}
                        spellCheck={false}
                        disabled={c >= cells.length}
                        className={cn(
                          "w-full min-w-24 rounded border bg-background px-1.5 py-1 font-mono outline-none focus:border-primary",
                          grid.columns[c]?.align === "c" && "text-center",
                          grid.columns[c]?.align === "r" && "text-right",
                          c >= cells.length && "border-dashed bg-muted",
                        )}
                        value={cells[c] ?? ""}
                        onFocus={() => setFocus({ row: r, col: c })}
                        onChange={(e) => update(setCell(grid, r, c, e.target.value))}
                        onKeyDown={(e) => onKeyDown(e, r, c)}
                        onPaste={(e) => onPaste(e, r, c)}
                      />
                    </td>
                  ))}
                </tr>,
              ])}
              {ruleRow(grid.rules[grid.rows.length] ?? [], "rule-end")}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Cells are LaTeX. Enter moves down (and adds a row at the end); paste cells
          copied from a spreadsheet to fill several at once.
          {grid.hasSpans &&
            " This table has merged cells (\\multicolumn/\\multirow): columns cannot be added or removed here."}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              request.onSave(serializeTable(grid));
              close();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A toolbar icon button. */
function ToolButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
