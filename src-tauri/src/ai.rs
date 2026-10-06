//! Transport for the AI quickfix: one POST to an OpenAI-compatible
//! chat-completions endpoint. Runs Rust-side because most LLM
//! providers do not send the CORS headers the webview needs.

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatArgs {
    /// Base URL of the provider, e.g. https://api.mistral.ai/v1.
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub system: String,
    pub user: String,
}

/// One chat completion; returns the assistant message's content.
#[tauri::command]
pub async fn ai_chat(args: AiChatArgs) -> Result<String, String> {
    let url = format!(
        "{}/chat/completions",
        args.base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .bearer_auth(&args.api_key)
        .json(&serde_json::json!({
            "model": args.model,
            "response_format": { "type": "json_object" },
            "messages": [
                { "role": "system", "content": args.system },
                { "role": "user", "content": args.user },
            ],
        }))
        .send()
        .await
        .map_err(|e| format!("the AI request failed: {e}"))?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("the AI response was not JSON: {e}"))?;
    if !status.is_success() {
        let detail = body["error"]["message"]
            .as_str()
            .unwrap_or("no further detail");
        return Err(format!("the provider returned {status}: {detail}"));
    }
    body["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "the AI response had no message content".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_the_completions_url() {
        let args = AiChatArgs {
            base_url: "https://api.mistral.ai/v1/".into(),
            api_key: "k".into(),
            model: "m".into(),
            system: "s".into(),
            user: "u".into(),
        };
        let url = format!(
            "{}/chat/completions",
            args.base_url.trim_end_matches('/')
        );
        assert_eq!(url, "https://api.mistral.ai/v1/chat/completions");
    }
}
