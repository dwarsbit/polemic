import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/store/settings";

/** The AI quickfix section of the settings dialog: any
 *  OpenAI-compatible chat-completions endpoint. */
export function AiSettingsSection() {
  const setAi = useSettingsStore((s) => s.setAi);
  // The dialog is transient; the fields start from the saved block
  // and keep what the user typed until Save.
  const [baseUrl, setBaseUrl] = useState(
    () => useSettingsStore.getState().ai?.baseUrl ?? "",
  );
  const [apiKey, setApiKey] = useState(
    () => useSettingsStore.getState().ai?.apiKey ?? "",
  );
  const [model, setModel] = useState(
    () => useSettingsStore.getState().ai?.model ?? "",
  );
  const [saved, setSaved] = useState(false);

  async function onSave() {
    await setAi({
      baseUrl: baseUrl.trim() || null,
      apiKey: apiKey.trim() || null,
      model: model.trim() || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-3 py-4">
      <div>
        <label className="text-xs text-muted-foreground" htmlFor="ai-base-url">
          Base URL (OpenAI-compatible, including /v1)
        </label>
        <Input
          id="ai-base-url"
          className="mt-1"
          placeholder="https://api.mistral.ai/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground" htmlFor="ai-key">
          API key
        </label>
        <Input
          id="ai-key"
          className="mt-1"
          type="password"
          placeholder="sk-…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground" htmlFor="ai-model">
          Model
        </label>
        <Input
          id="ai-model"
          className="mt-1"
          placeholder="mistral-large-latest"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" onClick={() => void onSave()}>
          Save
        </Button>
        {saved && (
          <span className="text-xs text-muted-foreground">Saved.</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        The key is stored in the app settings on this machine and sent
        only to the base URL above, by the app's Rust process.
      </p>
    </div>
  );
}
