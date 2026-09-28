import { useMemo } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { extractWordRanges } from "@/lib/spellcheck";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

const WORDS_PER_MINUTE = 200;

function countWords(text: string): number {
  return extractWordRanges(text).length;
}

function readingTime(words: number): string {
  const minutes = words / WORDS_PER_MINUTE;
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return `${hours} h ${rest} min`;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function PropertiesPanel() {
  const activeFile = useProjectStore((s) => s.activeFile);
  const content = useEditorStore((s) => s.content);

  const stats = useMemo(() => {
    const words = countWords(content);
    const characters = content.length;
    const charactersNoSpaces = content.replace(/\s/g, "").length;
    const lines = content.length === 0 ? 0 : content.split("\n").length;
    return { words, characters, charactersNoSpaces, lines };
  }, [content]);

  return (
    <div className="flex h-full flex-col">
      <SectionHeader label="PROPERTIES" collapsed={false} />
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {activeFile === null ? (
          <p className="px-2 text-xs text-muted-foreground">No file open.</p>
        ) : (
          <>
            <p className="mt-2 px-2 pb-1 truncate text-xs text-muted-foreground">
              {activeFile}
            </p>
            <StatRow label="Words" value={stats.words.toLocaleString()} />
            <StatRow label="Characters" value={stats.characters.toLocaleString()} />
            <StatRow
              label="Characters (no spaces)"
              value={stats.charactersNoSpaces.toLocaleString()}
            />
            <StatRow label="Lines" value={stats.lines.toLocaleString()} />
            <StatRow label="Reading time" value={readingTime(stats.words)} />
            <p className="mt-2 px-2 text-[11px] text-muted-foreground">
              Words count prose only: commands, math, and comments are excluded, like
              the spellchecker.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
