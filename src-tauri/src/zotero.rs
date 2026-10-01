//! The Zotero desktop integration's transport. Zotero's local API
//! (127.0.0.1:23119) drops connections that carry an Origin header,
//! so the webview can never fetch it directly — requests go through
//! here instead, as plain HTTP on the loopback interface.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const HOST: &str = "127.0.0.1:23119";

/// Split an HTTP response into its status code and body.
fn parse_response(raw: &[u8]) -> Result<(u16, String), String> {
    let text = String::from_utf8_lossy(raw);
    let (head, body) = match text.find("\r\n\r\n") {
        Some(index) => (&text[..index], text[index + 4..].to_string()),
        None => return Err("Zotero sent an incomplete response".into()),
    };
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or("Zotero sent an unreadable status line")?;
    Ok((status, body))
}

/// GET one path of the local Zotero API; returns the JSON body.
/// No Origin header is sent, so Zotero answers instead of dropping
/// the connection as it does for webview fetches.
pub fn local_get(path: &str, query: &str) -> Result<String, String> {
    let mut stream = TcpStream::connect(HOST)
        .map_err(|e| format!("Zotero is not reachable: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    let request = format!(
        "GET /api/{path}?{query} HTTP/1.1\r\nHost: localhost:23119\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let (status, body) = parse_response(&raw)?;
    if !(200..300).contains(&status) {
        return Err(format!("Zotero request failed ({status})"));
    }
    Ok(body)
}

/// One GET against the local Zotero API, for the webview.
#[tauri::command]
pub fn zotero_local_fetch(path: String, query: String) -> Result<String, String> {
    local_get(&path, &query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_status_and_body() {
        let raw = b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n[{\"key\":\"A\"}]";
        let (status, body) = parse_response(raw).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body, "[{\"key\":\"A\"}]");
    }

    #[test]
    fn rejects_error_status() {
        let raw = b"HTTP/1.0 404 Not Found\r\n\r\n[]";
        let (status, _) = parse_response(raw).unwrap();
        assert_eq!(status, 404);
    }

    #[test]
    fn rejects_incomplete_response() {
        assert!(parse_response(b"HTTP/1.0 200 OK\r\n").is_err());
    }

    /// Hits the real local Zotero server; run explicitly with
    /// `cargo test zotero -- --ignored`.
    #[test]
    #[ignore = "needs a running Zotero with the API enabled"]
    fn live_probe_answers_items() {
        let body = local_get("users/0/items", "limit=1").unwrap();
        assert!(body.starts_with('['));
    }
}
