import { useEffect, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { collectAssetPaths } from "@/lib/assets";
import {
  columnNames,
  csvPlot,
  csvTable,
  isNumber,
  labelFor,
  numericColumns,
  parseCsv,
  type CsvData,
  type Delimiter,
  type PlotKind,
} from "@/lib/csv";
import { ensurePackages } from "@/lib/editor-figure";
import { insertAtCursor } from "@/lib/editor-insert";
import { importAssets, readProjectFile } from "@/lib/tauri";
import { useDialogsStore } from "@/store/dialogs";
import { useProjectStore } from "@/store/project";
import { cn } from "cn";

const DATA_FILE = /\.(csv|tsv|txt|dat)$/i;
const PREVIEW_ROWS = 8;

/** Whether the first row reads as a header: text over numbers. */
function guessHeader(data: CsvData): boolean {
  if (data.rows.length < 2) return false;
  const first = data.rows[0];
  return first.every((f) => !isNumber(f)) && data.rows[1].some((f) => isNumber(f));
}

/**
 * The CSV import assistant: a data file in the project becomes a
 * booktabs table (values copied in) or a pgfplots plot (reading the
 * file when compiling). Files from elsewhere are copied into assets/
 * first, so the plot keeps working.
 */
export function CsvImportDialog() {
  const request = useDialogsStore((s) => s.csvImport);
  return request === null ? null : <CsvImport initialPath={request.path} />;
}

function CsvImport({ initialPath }: { initialPath: string | null }) {
  const setCsvImport = useDialogsStore((s) => s.setCsvImport);
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const dataFiles = useMemo(
    () => collectAssetPaths(files).filter((p) => DATA_FILE.test(p)),
    [files],
  );
  const [path, setPath] = useState<string | null>(initialPath);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delimiter, setDelimiter] = useState<Delimiter | "auto">("auto");
  const [headerChoice, setHeaderChoice] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"table" | "plot">("table");
  const [caption, setCaption] = useState("");
  const [x, setX] = useState<number | null>(null);
  const [ys, setYs] = useState<number[] | null>(null);
  const [kind, setKind] = useState<PlotKind>("line");
  const [xlabel, setXlabel] = useState<string | null>(null);
  const [ylabel, setYlabel] = useState<string | null>(null);

  useEffect(() => {
    if (path === null || project === null) return;
    let cancelled = false;
    readProjectFile(project.path, path)
      .then((content) => {
        if (!cancelled) setText(content);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, project]);

  const data = useMemo(
    () =>
      text === null
        ? null
        : parseCsv(text, delimiter === "auto" ? undefined : delimiter),
    [text, delimiter],
  );
  const header = headerChoice ?? (data !== null && guessHeader(data));
  const names = data === null ? [] : columnNames(data, header);
  const numeric = data === null ? [] : numericColumns(data, header);
  const numericIndices = numeric.flatMap((n, i) => (n ? [i] : []));
  const xCol = x ?? numericIndices[0] ?? null;
  const yCols = ys ?? numericIndices.filter((i) => i !== xCol).slice(0, 1);
  const bodyRows = data === null ? 0 : data.rows.length - (header ? 1 : 0);

  const close = () => setCsvImport(null);

  async function importFile() {
    if (project === null) return;
    setError(null);
    const picked = await openFileDialog({
      multiple: false,
      title: "Import data (copied into the project)",
      filters: [{ name: "Data", extensions: ["csv", "tsv", "txt", "dat"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const [imported] = await importAssets(project.path, [picked]);
      await useProjectStore.getState().refreshFiles();
      setText(null);
      setPath(imported);
    } catch (e) {
      setError(String(e));
    }
  }

  function insert() {
    if (data === null || path === null) return;
    if (mode === "table") {
      ensurePackages(["booktabs"]);
      insertAtCursor(
        csvTable(data, {
          header,
          caption,
          label: caption ? labelFor("tab", caption) : "",
        }),
      );
    } else {
      if (xCol === null || yCols.length === 0) return;
      ensurePackages(["pgfplots"]);
      insertAtCursor(
        csvPlot(path, data, {
          header,
          x: xCol,
          ys: yCols,
          kind,
          xlabel: xlabel ?? names[xCol] ?? "",
          ylabel: ylabel ?? (yCols.length === 1 ? (names[yCols[0]] ?? "") : ""),
          caption,
          label: caption ? labelFor("fig", caption) : "",
        }),
      );
    }
    close();
  }

  const canPlot = numericIndices.length >= 2;
  const ready =
    data !== null &&
    data.rows.length > 0 &&
    (mode === "table" || (xCol !== null && yCols.length > 0));

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Table or plot from CSV</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-sm">
          <div className="flex items-center gap-2">
            <Select
              value={path ?? ""}
              onValueChange={(value) => {
                setText(null);
                setPath(value);
              }}
            >
              <SelectTrigger className="min-w-0 flex-1">
                <SelectValue placeholder="Choose a data file in the project" />
              </SelectTrigger>
              <SelectContent>
                {dataFiles.map((file) => (
                  <SelectItem key={file} value={file}>
                    {file}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void importFile()}>
              <FileUp />
              Import file…
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {data !== null && (
            <>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2">
                  <Switch checked={header} onCheckedChange={setHeaderChoice} />
                  First row is a header
                </label>
                <label className="flex items-center gap-2">
                  Separator
                  <Select
                    value={delimiter}
                    onValueChange={(v) => setDelimiter(v as Delimiter | "auto")}
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        Auto ({data.delimiter === "\t" ? "tab" : data.delimiter})
                      </SelectItem>
                      <SelectItem value=",">Comma</SelectItem>
                      <SelectItem value=";">Semicolon</SelectItem>
                      <SelectItem value={"\t"}>Tab</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <span className="text-muted-foreground">
                  {bodyRows} rows × {names.length} columns
                </span>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <tbody>
                    {data.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                      <tr
                        key={r}
                        className={cn(header && r === 0 && "border-b font-medium")}
                      >
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            className={cn(
                              "px-2 py-1 whitespace-nowrap",
                              numeric[c] && !(header && r === 0) && "text-right",
                            )}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.rows.length > PREVIEW_ROWS && (
                  <p className="border-t px-2 py-1 text-xs text-muted-foreground">
                    … {data.rows.length - PREVIEW_ROWS} more rows
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                {(["table", "plot"] as const).map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={mode === m ? "secondary" : "ghost"}
                    aria-pressed={mode === m}
                    disabled={m === "plot" && !canPlot}
                    title={
                      m === "plot" && !canPlot
                        ? "A plot needs at least two numeric columns"
                        : undefined
                    }
                    onClick={() => setMode(m)}
                  >
                    {m === "table" ? "Table (booktabs)" : "Plot (pgfplots)"}
                  </Button>
                ))}
              </div>
              {mode === "table" ? (
                <p className="text-xs text-muted-foreground">
                  The values are copied into the document; numbers align right.
                  {bodyRows > 40 &&
                    " A table this long may not fit on one page; consider the longtable package."}
                </p>
              ) : (
                <div className="space-y-2 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2">
                      x
                      <Select
                        value={xCol === null ? "" : String(xCol)}
                        onValueChange={(v) => setX(Number(v))}
                      >
                        <SelectTrigger className="h-7 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {numericIndices.map((i) => (
                            <SelectItem key={i} value={String(i)}>
                              {names[i]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="flex items-center gap-2">
                      Style
                      <Select
                        value={kind}
                        onValueChange={(v) => setKind(v as PlotKind)}
                      >
                        <SelectTrigger className="h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="line">Lines</SelectItem>
                          <SelectItem value="scatter">Points</SelectItem>
                          <SelectItem value="bar">Bars</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span>y</span>
                    {numericIndices
                      .filter((i) => i !== xCol)
                      .map((i) => (
                        <label key={i} className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={yCols.includes(i)}
                            onChange={(e) =>
                              setYs(
                                e.target.checked
                                  ? [...yCols, i].sort((a, b) => a - b)
                                  : yCols.filter((y) => y !== i),
                              )
                            }
                          />
                          {names[i]}
                        </label>
                      ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="x axis label"
                      value={xlabel ?? (xCol !== null ? names[xCol] : "")}
                      onChange={(e) => setXlabel(e.target.value)}
                    />
                    <Input
                      placeholder="y axis label"
                      value={ylabel ?? (yCols.length === 1 ? names[yCols[0]] : "")}
                      onChange={(e) => setYlabel(e.target.value)}
                    />
                  </div>
                  <p className="text-muted-foreground">
                    The plot reads {path} when compiling, so later changes to the file
                    show up in the PDF.
                  </p>
                </div>
              )}
              <Input
                placeholder="Caption (optional)"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={insert}>
            Insert {mode === "table" ? "table" : "plot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
