import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { grammarRules, type GrammarRule } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

/** The public LanguageTool service (opt-in: the text leaves the machine). */
const PUBLIC_LANGUAGETOOL = "https://api.languagetool.org/v2";

/**
 * The grammar checker and its rules: the built-in checker (English,
 * offline) unless a LanguageTool server is set, and switches for
 * individual rules.
 */
export function GrammarSettingsSection() {
  const grammar = useSettingsStore((s) => s.grammar);
  const setGrammar = useSettingsStore((s) => s.setGrammar);
  const [url, setUrl] = useState(() => grammar.languageToolUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function saveUrl(next: string) {
    setError(null);
    try {
      await setGrammar({ ...grammar, languageToolUrl: next.trim() || null });
    } catch (e) {
      setError(String(e));
      return;
    }
    setUrl(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-4 py-4">
      <div>
        <label className="text-xs text-muted-foreground" htmlFor="languagetool-url">
          LanguageTool server (optional, up to /v2)
        </label>
        <div className="mt-1 flex gap-2">
          <Input
            id="languagetool-url"
            placeholder="http://localhost:8081/v2"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={() => void saveUrl(url)}>
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Empty: the built-in checker, offline, English only. A server checks every
          language: run one locally, or{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => void saveUrl(PUBLIC_LANGUAGETOOL)}
          >
            use the public LanguageTool service
          </button>
          , which sends your paragraphs to languagetool.org.
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <GrammarRulesList />
    </div>
  );
}

/** Switches for individual rules: the switched-off ones first, then a
 *  search over the built-in checker's rules. */
function GrammarRulesList() {
  const grammar = useSettingsStore((s) => s.grammar);
  const setGrammar = useSettingsStore((s) => s.setGrammar);
  const [rules, setRules] = useState<GrammarRule[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    grammarRules()
      .then((list) => {
        if (!cancelled) setRules(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const disabled = useMemo(() => new Set(grammar.disabledRules), [grammar]);
  const descriptions = useMemo(
    () => new Map(rules.map((rule) => [rule.id, rule.description])),
    [rules],
  );
  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0
      ? []
      : rules
          .filter(
            (rule) =>
              !disabled.has(rule.id) &&
              `${rule.id} ${rule.description}`.toLowerCase().includes(q),
          )
          .slice(0, 30);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(grammar.disabledRules);
    if (on) next.delete(id);
    else next.add(id);
    void setGrammar({ ...grammar, disabledRules: [...next].sort() });
  };

  const row = (id: string, on: boolean) => (
    <li key={id} className="flex items-start gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs">{id}</p>
        {descriptions.get(id) && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {descriptions.get(id)}
          </p>
        )}
      </div>
      <Switch checked={on} onCheckedChange={(v) => toggle(id, v)} />
    </li>
  );

  return (
    <div>
      <p className="text-xs text-muted-foreground">
        Rules switched off ({grammar.disabledRules.length}). Right-click an underline
        and pick “Turn off this rule”, or find one here.
      </p>
      {grammar.disabledRules.length > 0 && (
        <ul className="mt-1 divide-y">
          {grammar.disabledRules.map((id) => row(id, false))}
        </ul>
      )}
      <Input
        className="mt-2"
        placeholder="Find a rule (e.g. passive, comma, article)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="mt-1 max-h-64 divide-y overflow-y-auto">
          {matches.map((rule) => row(rule.id, true))}
        </ul>
      )}
    </div>
  );
}
