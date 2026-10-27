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

/// The API key travels in a header: only HTTPS may carry it, except to
/// a model served on this machine (Ollama, LM Studio, llama.cpp).
pub fn check_base_url(base_url: &str) -> Result<(), String> {
    check_service_url(base_url, "the AI base URL")
}

/// A service URL may use plain http only to this machine; `what` names
/// it in the error ("the AI base URL").
pub fn check_service_url(base_url: &str, what: &str) -> Result<(), String> {
    let lower = base_url.trim().to_ascii_lowercase();
    if lower.starts_with("https://") {
        return Ok(());
    }
    if let Some(rest) = lower.strip_prefix("http://") {
        let host = rest.split(['/', '?', '#']).next().unwrap_or("");
        let host = match host.strip_prefix('[') {
            Some(v6) => v6.split(']').next().unwrap_or(""),
            None => host.split(':').next().unwrap_or(""),
        };
        if matches!(host, "localhost" | "127.0.0.1" | "::1") {
            return Ok(());
        }
    }
    Err(format!(
        "{what} must start with https:// (plain http is only allowed for localhost)"
    ))
}

/// One chat completion; returns the assistant message's content.
#[tauri::command]
pub async fn ai_chat(args: AiChatArgs) -> Result<String, String> {
    check_base_url(&args.base_url)?;
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

    #[test]
    fn requires_https_except_on_localhost() {
        assert!(check_base_url("https://api.mistral.ai/v1").is_ok());
        assert!(check_base_url("http://localhost:11434/v1").is_ok());
        assert!(check_base_url("http://127.0.0.1/v1").is_ok());
        assert!(check_base_url("http://[::1]:8080/v1").is_ok());
        assert!(check_base_url("http://api.example.com/v1").is_err());
        assert!(check_base_url("http://localhost.evil.com/v1").is_err());
        assert!(check_base_url("ftp://x").is_err());
    }
}
