import { useEffect, useMemo, useState } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { useDocumentOrder } from "@/hooks/useDocumentOrder";
import { parseOutline, type OutlineEntry } from "@/lib/outline";
import { readProjectFile } from "@/lib/tauri";
import {
  addStats,
  countWords,
  countWordsBySection,
  emptyStats,
  totalWords,
  type WordStats,
} from "@/lib/word-count";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

const WORDS_PER_MINUTE = 200;

/** One heading of the document with the words of its own block (up
 *  to the next heading of any level). */
interface SectionCount {
  file: string;
  entry: OutlineEntry;
  own: WordStats;
}

interface DocumentCount {
  total: WordStats;
  files: number;
  /** Words before the first heading of each file, summed. */
  untitled: WordStats;
  sections: SectionCount[];
}

/** Word counts over every file in document order (debounced): the
 *  active file from the live editor, others from buffers or disk. */
function useDocumentWordCount(): DocumentCount | null {
  const project = useProjectStore((s) => s.project);
  const activeFile = useProjectStore((s) => s.activeFile);
  const buffers = useProjectStore((s) => s.buffers);
  const content = useEditorStore((s) => s.content);
  const order = useDocumentOrder();
  const [count, setCount] = useState<DocumentCount | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!project || order === null) {
          setCount(null);
          return;
        }
        const result: DocumentCount = {
          total: emptyStats(),
          files: 0,
          untitled: emptyStats(),
          sections: [],
        };
        for (const file of order) {
          let text: string | null;
          if (file === activeFile) {
            text = content;
          } else if (buffers[file] !== undefined) {
            text = buffers[file];
          } else {
            text = await readProjectFile(project.path, file).catch(() => null);
          }
          if (text === null) continue;
          const entries = parseOutline(text);
          const parts = countWordsBySection(
            text,
            entries.map((e) => e.line),
          );
          result.files += 1;
          result.untitled = addStats(result.untitled, parts[0]);
          entries.forEach((entry, i) => {
            result.sections.push({ file, entry, own: parts[i + 1] });
          });
          for (const part of parts) result.total = addStats(result.total, part);
        }
        if (!cancelled) setCount(result);
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, order, activeFile, buffers, content]);

  return count;
}

/** Each section's words including its subsections, in document order. */
function withSubsections(
  sections: SectionCount[],
): { section: SectionCount; words: number }[] {
  return sections.map((section, i) => {
    let words = totalWords(section.own);
    for (const next of sections.slice(i + 1)) {
      if (next.entry.level <= section.entry.level) break;
      words += totalWords(next.own);
    }
    return { section, words };
  });
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

function goTo(file: string, line: number) {
  const { activeFile, openFile } = useProjectStore.getState();
  if (file === activeFile) {
    useEditorStore.getState().jumpTo(line);
    return;
  }
  void openFile(file).then(() => useEditorStore.getState().jumpTo(line));
}

function SubRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between py-0.5 pr-2 pl-5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-muted-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

function SectionRow({
  title,
  words,
  indent,
  muted = false,
  onClick,
}: {
  title: string;
  words: number;
  indent: number;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={onClick === undefined}
      className="flex w-full items-center gap-2 rounded py-0.5 pr-2 text-left text-xs hover:bg-accent disabled:hover:bg-transparent"
      style={{ paddingLeft: 8 + indent * 12 }}
      title={title}
      onClick={onClick}
    >
      <span
        className={
          muted
            ? "min-w-0 flex-1 truncate text-muted-foreground italic"
            : "min-w-0 flex-1 truncate"
        }
      >
        {title}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {words.toLocaleString()}
      </span>
    </button>
  );
}

export function PropertiesPanel() {
  const activeFile = useProjectStore((s) => s.activeFile);
  const content = useEditorStore((s) => s.content);
  const doc = useDocumentWordCount();

  const stats = useMemo(() => {
    const counts = countWords(content);
    const words = totalWords(counts);
    const characters = content.length;
    const charactersNoSpaces = content.replace(/\s/g, "").length;
    const lines = content.length === 0 ? 0 : content.split("\n").length;
    return { counts, words, characters, charactersNoSpaces, lines };
  }, [content]);

  const sectionRows = useMemo(
    () => (doc === null ? [] : withSubsections(doc.sections)),
    [doc],
  );
  const minLevel = useMemo(
    () => Math.min(...sectionRows.map((row) => row.section.entry.level), 0),
    [sectionRows],
  );

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
            <SubRow label="Text" value={stats.counts.text} />
            <SubRow label="Headings" value={stats.counts.header} />
            <SubRow label="Captions & footnotes" value={stats.counts.other} />
            <SubRow
              label="Math (inline · display)"
              value={`${stats.counts.inlineMath} · ${stats.counts.displayMath}`}
            />
            <StatRow label="Characters" value={stats.characters.toLocaleString()} />
            <StatRow
              label="Characters (no spaces)"
              value={stats.charactersNoSpaces.toLocaleString()}
            />
            <StatRow label="Lines" value={stats.lines.toLocaleString()} />
            <StatRow label="Reading time" value={readingTime(stats.words)} />
            {doc !== null && doc.files > 0 && (
              <>
                <p className="mt-4 px-2 pb-1 text-xs font-medium text-muted-foreground">
                  Document
                  {doc.files > 1 ? ` · ${doc.files} files` : ""}
                </p>
                <StatRow label="Words" value={totalWords(doc.total).toLocaleString()} />
                <StatRow
                  label="Reading time"
                  value={readingTime(totalWords(doc.total))}
                />
                {sectionRows.length > 0 && (
                  <div className="mt-1">
                    {totalWords(doc.untitled) > 0 && (
                      <SectionRow
                        title="Before the first heading"
                        words={totalWords(doc.untitled)}
                        indent={0}
                        muted
                      />
                    )}
                    {sectionRows.map(({ section, words }) => (
                      <SectionRow
                        key={`${section.file}:${section.entry.line}`}
                        title={section.entry.title}
                        words={words}
                        indent={section.entry.level - minLevel}
                        onClick={() => goTo(section.file, section.entry.line)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
            <p className="mt-2 px-2 text-[11px] text-muted-foreground">
              Counted like texcount: words in the document body (text, headings,
              captions, footnotes); commands, math, comments, and the bibliography are
              excluded. Section counts include their subsections.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
