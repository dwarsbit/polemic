//! Transport for the assistant: POSTs to an OpenAI-compatible
//! chat-completions endpoint. Runs Rust-side because most LLM
//! providers do not send the CORS headers the webview needs.
//!
//! `ai_agent_turn` is one turn of the assistant: a message history plus
//! tool definitions, streamed back, with the tool calls assembled here.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::sync::Notify;

/// The API key travels in a header: only HTTPS may carry it, except to
/// a model served on this machine (Ollama, LM Studio, llama.cpp).
pub fn check_base_url(base_url: &str) -> Result<(), String> {
    check_service_url(base_url, "the AI base URL")
}

/// A service URL may use plain http only to this machine; `what` names
/// it in the error ("the AI base URL").
pub fn check_service_url(base_url: &str, what: &str) -> Result<(), String> {
    let err =
        || format!("{what} must start with https:// (plain http is only allowed for localhost)");
    // Parse rather than split by hand: `http://localhost@evil.example`
    // has evil.example as its host. Userinfo is refused outright, so a
    // credential never rides in the URL.
    let url = url::Url::parse(base_url.trim()).map_err(|_| err())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(err());
    }
    let host = url.host_str().unwrap_or("");
    let ok = match url.scheme() {
        "https" => !host.is_empty(),
        "http" => matches!(host, "localhost" | "127.0.0.1" | "[::1]"),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(err())
    }
}

/// Assistant turns in flight, by the id the webview gave them, so
/// `ai_cancel` can stop one.
#[derive(Default)]
pub struct AiRequests(Mutex<HashMap<u32, Arc<Notify>>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentArgs {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    /// Chat messages in the OpenAI shape, system message first.
    pub messages: Vec<Value>,
    /// Tool definitions in the OpenAI shape; empty for none.
    pub tools: Vec<Value>,
    /// Chosen by the webview; names the turn for `ai_cancel`.
    pub request_id: u32,
}

/// What streams to the webview while a turn runs.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentEvent {
    /// More of the assistant's reply text.
    Text { delta: String },
}

/// Assembles a streamed completion: text deltas and tool-call
/// fragments (OpenAI sends a call's arguments in pieces by index).
#[derive(Default)]
pub struct StreamAssembler {
    buffer: String,
    content: String,
    calls: Vec<(String, String, String)>,
    done: bool,
}

impl StreamAssembler {
    /// Feeds raw bytes of the event stream; returns the text deltas
    /// they completed, or the provider's error.
    pub fn feed(&mut self, chunk: &str) -> Result<Vec<String>, String> {
        self.buffer.push_str(chunk);
        let mut deltas = Vec::new();
        while let Some(end) = self.buffer.find('\n') {
            let line: String = self.buffer.drain(..=end).collect();
            if let Some(delta) = self.line(line.trim())? {
                deltas.push(delta);
            }
        }
        Ok(deltas)
    }

    fn line(&mut self, line: &str) -> Result<Option<String>, String> {
        let Some(data) = line.strip_prefix("data:") else {
            return Ok(None);
        };
        let data = data.trim();
        if data == "[DONE]" {
            self.done = true;
            return Ok(None);
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            return Ok(None);
        };
        if let Some(message) = event["error"]["message"].as_str() {
            return Err(format!("the provider returned an error: {message}"));
        }
        let delta = &event["choices"][0]["delta"];
        if let Some(calls) = delta["tool_calls"].as_array() {
            for call in calls {
                let index = call["index"].as_u64().unwrap_or(self.calls.len() as u64) as usize;
                while self.calls.len() <= index {
                    self.calls.push(Default::default());
                }
                let slot = &mut self.calls[index];
                if let Some(id) = call["id"].as_str() {
                    slot.0.push_str(id);
                }
                if let Some(name) = call["function"]["name"].as_str() {
                    slot.1.push_str(name);
                }
                if let Some(args) = call["function"]["arguments"].as_str() {
                    slot.2.push_str(args);
                }
            }
        }
        match delta["content"].as_str() {
            Some(text) if !text.is_empty() => {
                self.content.push_str(text);
                Ok(Some(text.to_string()))
            }
            _ => Ok(None),
        }
    }

    /// The assistant message the stream spelled out.
    pub fn finish(mut self) -> Value {
        let rest = std::mem::take(&mut self.buffer);
        let _ = self.line(rest.trim());
        assistant_message(
            self.content,
            self.calls
                .into_iter()
                .enumerate()
                .map(|(i, (id, name, args))| {
                    let id = if id.is_empty() { format!("call_{i}") } else { id };
                    let args = if args.trim().is_empty() { "{}".into() } else { args };
                    json!({ "id": id, "type": "function", "function": { "name": name, "arguments": args } })
                })
                .collect(),
        )
    }
}

fn assistant_message(content: String, calls: Vec<Value>) -> Value {
    let mut message = json!({ "role": "assistant", "content": content });
    if !calls.is_empty() {
        message["tool_calls"] = Value::Array(calls);
    }
    message
}

/// A provider that ignored `stream`: the whole completion's message.
fn message_from_completion(body: &Value) -> Result<Value, String> {
    let message = &body["choices"][0]["message"];
    if message.is_null() {
        return Err("the AI response had no message".into());
    }
    let content = message["content"].as_str().unwrap_or("").to_string();
    let calls = message["tool_calls"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    Ok(assistant_message(content, calls))
}

/// One assistant turn: streams the reply text over `on_event` and
/// returns the complete assistant message (content and tool calls).
#[tauri::command]
pub async fn ai_agent_turn(
    args: AiAgentArgs,
    on_event: Channel<AgentEvent>,
    requests: tauri::State<'_, AiRequests>,
) -> Result<Value, String> {
    check_base_url(&args.base_url)?;
    let stop = Arc::new(Notify::new());
    requests
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(args.request_id, stop.clone());
    let result = tokio::select! {
        result = run_turn(&args, &on_event) => result,
        _ = stop.notified() => Err("cancelled".into()),
    };
    if let Ok(mut map) = requests.0.lock() {
        map.remove(&args.request_id);
    }
    result
}

async fn run_turn(args: &AiAgentArgs, on_event: &Channel<AgentEvent>) -> Result<Value, String> {
    let url = format!("{}/chat/completions", args.base_url.trim_end_matches('/'));
    let mut body = json!({
        "model": args.model,
        "messages": args.messages,
        "stream": true,
    });
    if !args.tools.is_empty() {
        body["tools"] = Value::Array(args.tools.clone());
    }
    let mut response = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&args.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("the AI request failed: {e}"))?;
    let status = response.status();
    let streamed = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"));
    if !status.is_success() || !streamed {
        let text = response
            .text()
            .await
            .map_err(|e| format!("the AI response could not be read: {e}"))?;
        let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !status.is_success() {
            let detail = body["error"]["message"]
                .as_str()
                .or_else(|| body["message"].as_str())
                .unwrap_or("no further detail");
            return Err(format!("the provider returned {status}: {detail}"));
        }
        let message = message_from_completion(&body)?;
        if let Some(text) = message["content"].as_str().filter(|t| !t.is_empty()) {
            let _ = on_event.send(AgentEvent::Text {
                delta: text.to_string(),
            });
        }
        return Ok(message);
    }
    let mut assembler = StreamAssembler::default();
    // Bytes of a UTF-8 character split across chunks wait here.
    let mut pending: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("the AI response was cut off: {e}"))?
    {
        pending.extend_from_slice(&chunk);
        let valid = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(e) => e.valid_up_to(),
        };
        let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
        pending.drain(..valid);
        for delta in assembler.feed(&text)? {
            let _ = on_event.send(AgentEvent::Text { delta });
        }
        if assembler.done {
            break;
        }
    }
    Ok(assembler.finish())
}

/// Stops a running assistant turn; unknown ids are ignored.
#[tauri::command]
pub fn ai_cancel(request_id: u32, requests: tauri::State<'_, AiRequests>) {
    if let Ok(map) = requests.0.lock() {
        if let Some(stop) = map.get(&request_id) {
            stop.notify_one();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn rejects_userinfo_in_service_urls() {
        assert!(check_base_url("http://localhost:80@evil.example/v1").is_err());
        assert!(check_base_url("http://127.0.0.1:1@evil.example/").is_err());
        assert!(check_base_url("http://[::1]@evil.example/").is_err());
        assert!(check_base_url("http://localhost@evil.example/").is_err());
        assert!(check_base_url("https://user:pass@api.mistral.ai/v1").is_err());
        assert!(check_base_url("https://key@api.mistral.ai/v1").is_err());
        assert!(check_base_url("http://localhost.evil.com").is_err());
        assert!(check_base_url("https://").is_err());
    }

    #[test]
    fn assembles_streamed_text_and_tool_calls() {
        let mut a = StreamAssembler::default();
        let mut text = Vec::new();
        text.extend(a.feed("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n").unwrap());
        // A line split across chunks.
        text.extend(a.feed("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"read_file\",\"argu").unwrap());
        text.extend(a.feed("ments\":\"{\\\"path\"}}]}}]}\n").unwrap());
        text.extend(a.feed("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\":\\\"a.tex\\\"}\"}}]}}]}\n").unwrap());
        text.extend(a.feed("data: [DONE]\n").unwrap());
        assert_eq!(text, vec!["Hel".to_string(), "lo".to_string()]);
        let message = a.finish();
        assert_eq!(message["content"], "Hello");
        assert_eq!(message["tool_calls"][0]["id"], "c1");
        assert_eq!(message["tool_calls"][0]["function"]["name"], "read_file");
        assert_eq!(
            message["tool_calls"][0]["function"]["arguments"],
            "{\"path\":\"a.tex\"}"
        );
    }

    #[test]
    fn surfaces_errors_inside_the_stream() {
        let mut a = StreamAssembler::default();
        let err = a
            .feed("data: {\"error\":{\"message\":\"rate limited\"}}\n")
            .unwrap_err();
        assert!(err.contains("rate limited"));
    }

    #[test]
    fn reads_a_completion_that_was_not_streamed() {
        let body = json!({"choices":[{"message":{"role":"assistant","content":null,
            "tool_calls":[{"id":"x","type":"function","function":{"name":"compile","arguments":"{}"}}]}}]});
        let message = message_from_completion(&body).unwrap();
        assert_eq!(message["content"], "");
        assert_eq!(message["tool_calls"][0]["function"]["name"], "compile");
        assert!(message_from_completion(&json!({})).is_err());
    }
}
