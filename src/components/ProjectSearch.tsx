import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import * as api from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

interface SearchResult {
  file: string;
  line: number;
  text: string;
}

const SEARCHABLE_EXTENSIONS = [".tex", ".bib", ".txt", ".md", ".sty", ".cls"];
const MAX_RESULTS = 100;

function collectSearchablePaths(entries: api.FileEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDir) {
      paths.push(...collectSearchablePaths(entry.children));
    } else if (SEARCHABLE_EXTENSIONS.some((ext) => entry.path.endsWith(ext))) {
      paths.push(entry.path);
    }
  }
  return paths;
}

export function ProjectSearch() {
  const project = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  const openFile = useProjectStore((s) => s.openFile);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const cacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        const trimmed = query.trim();
        if (!project || trimmed.length < 2) {
          setResults([]);
          return;
        }
        const needle = trimmed.toLowerCase();
        const found: SearchResult[] = [];
        for (const path of collectSearchablePaths(files)) {
          let content = cacheRef.current.get(path);
          if (content === undefined) {
            try {
              content = await api.readProjectFile(project.path, path);
            } catch {
              content = "";
            }
            cacheRef.current.set(path, content);
          }
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(needle)) {
              found.push({
                file: path,
                line: i + 1,
                text: lines[i].trim().slice(0, 120),
              });
              if (found.length >= MAX_RESULTS) break;
            }
          }
          if (found.length >= MAX_RESULTS) break;
        }
        setResults(found);
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [query, files, project]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground">
        <Search className="size-3.5" />
        SEARCH
      </div>
      <div className="px-2">
        <Input
          className="h-7 text-xs"
          placeholder="Find in project…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {results.length > 0 && (
        <div className="max-h-36 overflow-y-auto px-2 pt-1">
          <ul>
            {results.map((result, index) => (
              <li key={`${result.file}-${result.line}-${index}`}>
                <button
                  type="button"
                  className="flex w-full flex-col rounded px-2 py-1 text-left hover:bg-accent"
                  onClick={() => {
                    void (async () => {
                      await openFile(result.file);
                      useEditorStore.getState().jumpTo(result.line);
                    })();
                  }}
                >
                  <span className="truncate text-[10px] text-muted-foreground">
                    {result.file}:{result.line}
                  </span>
                  <span className="truncate text-xs">{result.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
