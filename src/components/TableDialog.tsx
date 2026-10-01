import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ensurePackages } from "@/lib/editor-figure";
import { insertAtCursor } from "@/lib/editor-insert";
import { generateTable, tableLabel, type TableSpec } from "@/lib/table-generate";
import { cn } from "cn";

const PLACEMENTS = ["h", "ht", "htbp"];
const MAX_COLUMNS = 20;
const MAX_ROWS = 100;

/** Stepper for rows/columns. */
function Counter({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-xs text-muted-foreground">{label}</span>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
        title={`Fewer ${label.toLowerCase()}`}
      >
        <Minus className="size-3" />
      </Button>
      <span className="w-6 text-center text-sm tabular-nums">{value}</span>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        title={`More ${label.toLowerCase()}`}
      >
        <Plus className="size-3" />
      </Button>
    </div>
  );
}

/** The table assistant: parameters in, a skeleton table out. */
export function TableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [columns, setColumns] = useState(3);
  const [rows, setRows] = useState(3);
  const [header, setHeader] = useState(true);
  const [booktabs, setBooktabs] = useState(true);
  const [alignment, setAlignment] = useState<string[]>(["l", "l", "l"]);
  const [placement, setPlacement] = useState("htbp");
  const [caption, setCaption] = useState("");
  const [label, setLabel] = useState("");
  // The label follows the caption until the user edits it.
  const [labelTouched, setLabelTouched] = useState(false);

  function changeColumns(next: number) {
    setColumns(next);
    setAlignment((prev) => {
      const out = prev.slice(0, next);
      while (out.length < next) out.push("l");
      return out;
    });
  }

  function cycleAlignment(index: number) {
    const order = ["l", "c", "r"];
    setAlignment((prev) =>
      prev.map((a, i) =>
        i === index ? order[(order.indexOf(a) + 1) % order.length] : a,
      ),
    );
  }

  const effectiveLabel = labelTouched ? label : tableLabel(caption);

  function insert() {
    const spec: TableSpec = {
      columns,
      rows,
      header,
      alignment,
      booktabs,
      caption,
      label: effectiveLabel,
      placement,
    };
    if (booktabs) {
      ensurePackages(["booktabs"]);
    }
    insertAtCursor(generateTable(spec));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Insert table</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-8">
            <Counter label="Columns" value={columns} onChange={changeColumns} max={MAX_COLUMNS} />
            <Counter label="Rows" value={rows} onChange={setRows} max={MAX_ROWS} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">
              Alignment
            </span>
            <div className="flex flex-wrap gap-1">
              {alignment.map((align, index) => (
                <button
                  key={index}
                  type="button"
                  title={`Column ${index + 1} alignment`}
                  className="size-6 rounded-md border text-center font-mono text-xs hover:bg-accent"
                  onClick={() => cycleAlignment(index)}
                >
                  {align}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-8">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={header} onCheckedChange={setHeader} />
              Header row
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={booktabs} onCheckedChange={setBooktabs} />
              Booktabs rules
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">
              Placement
            </span>
            <div className="flex gap-1">
              {PLACEMENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-xs",
                    placement === p
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent",
                  )}
                  onClick={() => setPlacement(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <Input
            className="h-8 text-sm"
            placeholder="Caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <Input
            className="h-8 font-mono text-sm"
            placeholder="\label"
            title={caption ? "Derived from the caption" : undefined}
            value={effectiveLabel}
            onChange={(e) => {
              setLabel(e.target.value);
              setLabelTouched(true);
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={insert}>
            Insert table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
