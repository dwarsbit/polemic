import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CITE_STYLES,
  renderBibliography,
  renderCitations,
  type CiteStyle,
  type PreviewEntry,
} from "@/lib/citation-preview";

/**
 * How an entry renders under a biblatex style: the in-text citation
 * commands and the bibliography line. The style starts at the
 * project's own (see detectBiblatexStyle) and can be switched to
 * compare; switching never touches the document.
 */
export function CitationPreview({
  entry,
  defaultStyle,
  note,
}: {
  entry: PreviewEntry;
  defaultStyle: CiteStyle;
  /** A line under the preview, e.g. that the project's style is approximated. */
  note?: string;
}) {
  const [style, setStyle] = useState<CiteStyle>(defaultStyle);
  const citations = useMemo(() => renderCitations(entry, style, 1), [entry, style]);
  const bibliography = useMemo(() => renderBibliography(entry, style), [entry, style]);

  return (
    <div className="space-y-1.5 rounded-md border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Citation preview</span>
        <Select value={style} onValueChange={(value) => setStyle(value as CiteStyle)}>
          <SelectTrigger className="h-6 w-32 text-[11px]" title="biblatex style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CITE_STYLES.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ul className="space-y-0.5 text-xs">
        {citations.map((citation) => (
          <li key={citation.command} className="flex gap-2">
            <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">
              {citation.command}
            </span>
            <span>{citation.output}</span>
          </li>
        ))}
      </ul>
      <p className="border-t pt-1.5 text-xs leading-relaxed">
        {bibliography.length === 0 ? (
          <span className="text-muted-foreground">Nothing to show yet.</span>
        ) : (
          bibliography.map((segment, i) =>
            segment.italic ? (
              <em key={i}>{segment.text}</em>
            ) : (
              <span key={i}>{segment.text}</span>
            ),
          )
        )}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {note ?? "An approximation of biblatex's default options."}
      </p>
    </div>
  );
}
