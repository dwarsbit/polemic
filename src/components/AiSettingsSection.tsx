import { errorText } from "@/lib/error-text";
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2 } from "lucide-react";
import { SettingsRow } from "@/components/SettingsRow";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_PROVIDERS,
  CUSTOM_PROVIDER,
  aiProvider,
  providerOf,
  type AiProvider,
} from "@/lib/ai-providers";
import { aiListModels, type AiSettings } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

const link = "underline underline-offset-2 hover:text-foreground";

/** The select entry that reveals the field for a model name. */
const OTHER = "__other__";

const EMPTY: AiSettings = { provider: null, baseUrl: null, apiKey: null, model: null };

/** What a models request came back with. */
type Loaded =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; models: string[] }
  | { state: "error"; message: string };

/** Backend errors start lowercase; a note starts a sentence. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The assistant section of the settings dialog: a provider preset (or
 * a custom OpenAI-compatible endpoint), its key where it needs one,
 * and the model. Loading the provider's models doubles as the
 * connection check. Each field saves as it changes.
 */
export function AiSettingsSection() {
  const ai = useSettingsStore((s) => s.ai) ?? EMPTY;
  const setAi = useSettingsStore((s) => s.setAi);
  const provider = providerOf(ai);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });
  // The model field stays open once chosen, also while it is empty.
  const [typingModel, setTypingModel] = useState(false);
  const loadRequest = useRef(0);

  async function save(next: AiSettings) {
    setError(null);
    try {
      await setAi(next);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function loadModels(settings: AiSettings) {
    const baseUrl = settings.baseUrl?.trim() ?? "";
    if (baseUrl === "") return;
    const request = ++loadRequest.current;
    setLoaded({ state: "loading" });
    try {
      const models = await aiListModels(baseUrl, settings.apiKey ?? "");
      if (request === loadRequest.current) setLoaded({ state: "ok", models });
    } catch (e) {
      if (request === loadRequest.current) {
        setLoaded({ state: "error", message: errorText(e) });
      }
    }
  }

  // A local server lists its models without a key: ask it as soon as
  // the section opens on one. (The request is the external system
  // here; the state it sets is its progress.)
  const localUrl =
    provider !== null && !provider.needsKey && provider.id !== CUSTOM_PROVIDER.id
      ? ai.baseUrl
      : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localUrl) void loadModels({ ...EMPTY, baseUrl: localUrl });
  }, [localUrl]);

  async function chooseProvider(id: string) {
    const next = aiProvider(id);
    if (next === null || next.id === provider?.id) return;
    setTypingModel(false);
    setLoaded({ state: "idle" });
    // The key belongs to the old provider: it is not sent to the new one.
    await save({
      provider: next.id,
      baseUrl: next.baseUrl,
      apiKey: null,
      model: next.models[0] ?? null,
    });
  }

  async function saveKey(value: string) {
    const apiKey = value.trim() || null;
    if (apiKey === (ai.apiKey ?? null)) return;
    const next = { ...ai, apiKey };
    await save(next);
    if (apiKey !== null) void loadModels(next);
  }

  async function saveBaseUrl(value: string) {
    const baseUrl = value.trim() || null;
    if (baseUrl === (ai.baseUrl ?? null)) return;
    await save({ ...ai, provider: CUSTOM_PROVIDER.id, baseUrl });
  }

  async function chooseModel(value: string) {
    if (value === OTHER) {
      setTypingModel(true);
      return;
    }
    setTypingModel(false);
    if (value !== ai.model) await save({ ...ai, model: value });
  }

  const known = provider?.models ?? [];
  const fetched = loaded.state === "ok" ? loaded.models : [];
  const options = [...known, ...fetched.filter((m) => !known.includes(m))];
  const model = ai.model ?? "";
  const listed = model !== "" && options.includes(model);
  const other = typingModel || (model !== "" && !listed);

  return (
    <div className="divide-y divide-border">
      <SettingsRow
        label="Provider"
        description={<ProviderNote provider={provider} />}
        control={
          <Select
            value={provider?.id ?? ""}
            onValueChange={(v) => void chooseProvider(v)}
          >
            <SelectTrigger className="w-44" aria-label="Provider">
              <SelectValue placeholder="Choose a provider" />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {provider?.id === CUSTOM_PROVIDER.id && (
        <SettingsRow
          label="Base URL"
          description="Up to /v1. Remote servers need https."
          control={
            <Input
              key={`url:${ai.baseUrl ?? ""}`}
              className="h-8 w-44 text-xs"
              placeholder="https://example.com/v1"
              aria-label="Base URL"
              defaultValue={ai.baseUrl ?? ""}
              onBlur={(e) => void saveBaseUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          }
        />
      )}

      {provider !== null &&
        (provider.needsKey || provider.id === CUSTOM_PROVIDER.id) && (
          <SettingsRow
            label="API key"
            description={<KeyNote provider={provider} baseUrl={ai.baseUrl} />}
            control={
              <Input
                key={`key:${provider.id}`}
                className="h-8 w-44 text-xs"
                type="password"
                autoComplete="off"
                placeholder={provider.needsKey ? "Paste your key" : "None"}
                aria-label="API key"
                defaultValue={ai.apiKey ?? ""}
                onBlur={(e) => void saveKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            }
          />
        )}

      {provider !== null && (
        <SettingsRow
          label="Model"
          description={
            <ModelNote
              provider={provider}
              loaded={loaded}
              canLoad={(ai.baseUrl ?? "") !== "" && (!provider.needsKey || !!ai.apiKey)}
              onLoad={() => void loadModels(ai)}
            />
          }
          control={
            <Select
              value={other ? OTHER : listed ? model : ""}
              onValueChange={chooseModel}
            >
              <SelectTrigger className="w-44" aria-label="Model">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {options.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Other…</SelectItem>
              </SelectContent>
            </Select>
          }
        >
          {other && (
            <div className="mt-2 flex justify-end">
              <Input
                key={`model:${model}`}
                className="h-8 w-44 text-xs"
                placeholder="Model name"
                aria-label="Model name"
                autoFocus={typingModel}
                defaultValue={listed ? "" : model}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value !== "" && value !== model)
                    void save({ ...ai, model: value });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
          )}
        </SettingsRow>
      )}

      {error !== null && (
        <p className="pt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Under the provider: where requests go. */
function ProviderNote({ provider }: { provider: AiProvider | null }) {
  if (provider === null)
    return <>Your own account with a provider, or a model on this computer.</>;
  if (provider.id === CUSTOM_PROVIDER.id) {
    return <>Any OpenAI-compatible API whose models support tool calls.</>;
  }
  if (!provider.needsKey) {
    return <>A model served by {provider.name} on this computer. Nothing leaves it.</>;
  }
  return <>Your questions and the files the assistant reads go to {provider.host}.</>;
}

/** Under the key: where it is kept and sent, and where to get one. */
function KeyNote({
  provider,
  baseUrl,
}: {
  provider: AiProvider;
  baseUrl: string | null;
}) {
  const host = provider.host ?? hostOf(baseUrl);
  return (
    <>
      {provider.needsKey
        ? "Stored on this machine"
        : "Optional. Stored on this machine"}
      {host ? ` and sent only to ${host}.` : "."}
      {provider.keyUrl && (
        <>
          {" "}
          <button
            type="button"
            className={link}
            onClick={() => void openUrl(provider.keyUrl!)}
          >
            Get a key
          </button>
        </>
      )}
    </>
  );
}

/** Under the model: the load action and what it came back with. */
function ModelNote({
  provider,
  loaded,
  canLoad,
  onLoad,
}: {
  provider: AiProvider;
  loaded: Loaded;
  canLoad: boolean;
  onLoad: () => void;
}) {
  const local = !provider.needsKey && provider.id !== CUSTOM_PROVIDER.id;
  const action = (
    <button type="button" className={link} disabled={!canLoad} onClick={onLoad}>
      {loaded.state === "idle" ? `Load models from ${provider.name}` : "Load again"}
    </button>
  );
  switch (loaded.state) {
    case "loading":
      return (
        <span className="inline-flex items-center gap-1" role="status">
          <Loader2 className="size-3 animate-spin" />
          Loading models…
        </span>
      );
    case "ok":
      return (
        <span role="status">
          {loaded.models.length === 0
            ? `${provider.name} lists no models. `
            : `${provider.name} lists ${loaded.models.length} model${loaded.models.length === 1 ? "" : "s"}. `}
          {local ? "" : "Pick one that supports tool calls. "}
          {action}
        </span>
      );
    case "error":
      return (
        <span className="text-destructive" role="status">
          {local
            ? `${provider.name} did not answer. Is it running? `
            : `${sentence(loaded.message)}. `}
          {action}
        </span>
      );
    default:
      return (
        <>
          {local
            ? "The models you have pulled. "
            : "Pick one that supports tool calls. "}
          {canLoad ? action : provider.needsKey ? "Add a key to load the list." : null}
        </>
      );
  }
}
