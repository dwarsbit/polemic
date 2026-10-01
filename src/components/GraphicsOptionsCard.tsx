import { X } from "lucide-react";
import { AssetThumb } from "@/components/AssetThumb";
import { Switch } from "@/components/ui/switch";
import { assetKind } from "@/lib/assets";
import {
  getOptionFlag,
  getOptionValue,
  setOptionFlag,
  setOptionValue,
  type OptionEntry,
} from "@/lib/graphics-options";
import { cn } from "cn";

const WIDTH_PRESETS = ["0.5\\textwidth", "0.75\\textwidth", "\\textwidth"];
const ANGLE_PRESETS = ["90", "180", "270"];

function OptionInput({
  value,
  placeholder,
  onChange,
  className,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <input
      className={cn(
        "h-6 min-w-0 rounded-md border bg-transparent px-1.5 text-[11px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
        className,
      )}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Presets({
  values,
  onPick,
}: {
  values: string[];
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex shrink-0 gap-0.5">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className="rounded border px-1 py-0.5 font-mono text-[9px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => onPick(value)}
        >
          {value.replace("\\textwidth", "\\TW")}
        </button>
      ))}
    </div>
  );
}

/**
 * The image options assistant: anchored at an \includegraphics,
 * opened via Cmd/Ctrl+click or its hover cog. Fully controlled from
 * the source — every field change is written back live through the
 * onChange handler. Prefers anchoring above the command so it never
 * covers the text below it.
 */
export function GraphicsOptionsCard({
  x,
  anchorTop,
  anchorBottom,
  path,
  previewPath,
  entries,
  onChange,
  onClose,
}: {
  x: number;
  /** Top edge of the command line, for anchoring above. */
  anchorTop: number;
  /** Bottom edge of the command line, for anchoring below. */
  anchorBottom: number;
  path: string;
  /** The concrete asset file behind the (often extension-less) path. */
  previewPath: string | null;
  entries: OptionEntry[];
  onChange: (entries: OptionEntry[]) => void;
  onClose: () => void;
}) {
  const width = getOptionValue(entries, "width") ?? "";
  const scale = getOptionValue(entries, "scale") ?? "";
  const angle = getOptionValue(entries, "angle") ?? "";
  const trim = (getOptionValue(entries, "trim") ?? "").split(/\s+/);
  const clip = getOptionFlag(entries, "clip");
  const keepAspect = getOptionFlag(entries, "keepaspectratio");
  const page = getOptionValue(entries, "page") ?? "";
  const isPdf = path.toLowerCase().endsWith(".pdf");

  function updateTrim(index: number, value: string) {
    const parts = [0, 1, 2, 3].map((i) =>
      i === index ? value : trim[i] ?? "",
    );
    onChange(setOptionValue(entries, "trim", parts.join(" ")));
  }

  // Anchor above the command when there is room; else below.
  const placeAbove = anchorTop > 340;
  const style: React.CSSProperties = placeAbove
    ? { left: x, bottom: window.innerHeight - anchorTop + 8 }
    : { left: x, top: anchorBottom + 8 };

  return (
    <div
      className="fixed z-50 w-72 space-y-1.5 rounded-xl border bg-card p-2.5 text-xs shadow-md"
      style={style}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {previewPath !== null && (
            <AssetThumb path={previewPath} kind={assetKind(previewPath)} />
          )}
        </div>
        <p
          className="min-w-0 flex-1 self-center truncate text-[11px] text-muted-foreground"
          title={path}
        >
          {path || "(no file)"}
        </p>
        <button
          type="button"
          title="Close"
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 pt-1">
        <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
          Width
        </span>
        <OptionInput
          className="flex-1"
          value={width}
          placeholder="0.8\\textwidth"
          onChange={(value) => onChange(setOptionValue(entries, "width", value))}
        />
        <Presets
          values={WIDTH_PRESETS}
          onPick={(value) => onChange(setOptionValue(entries, "width", value))}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
          Scale
        </span>
        <OptionInput
          className="w-16"
          value={scale}
          placeholder="1.5"
          onChange={(value) => onChange(setOptionValue(entries, "scale", value))}
        />
        <span className="ml-1 w-10 shrink-0 text-[10px] text-muted-foreground">
          Angle
        </span>
        <OptionInput
          className="w-12"
          value={angle}
          placeholder="90"
          onChange={(value) => onChange(setOptionValue(entries, "angle", value))}
        />
        <Presets
          values={ANGLE_PRESETS}
          onPick={(value) => onChange(setOptionValue(entries, "angle", value))}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
          Trim
        </span>
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((index) => (
            <OptionInput
              key={index}
              className="w-9 text-center"
              value={trim[index] ?? ""}
              placeholder="0"
              onChange={(value) => updateTrim(index, value)}
            />
          ))}
        </div>
        <label className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Switch checked={clip} onCheckedChange={(v) => onChange(setOptionFlag(entries, "clip", v))} />
          Clip
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Switch
            checked={keepAspect}
            onCheckedChange={(v) =>
              onChange(setOptionFlag(entries, "keepaspectratio", v))
            }
          />
          Keep aspect ratio
        </label>
        {isPdf && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            Page
            <OptionInput
              className="w-10"
              value={page}
              placeholder="1"
              onChange={(value) => onChange(setOptionValue(entries, "page", value))}
            />
          </span>
        )}
      </div>
    </div>
  );
}
