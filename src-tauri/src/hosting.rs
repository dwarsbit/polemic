//! What GitHub and GitLab share: the OAuth device flow (RFC 8628),
//! the HTTP client, the client-ID choice, and the steps of Publish.
//!
//! The device flow needs no redirect and no client secret: the host
//! shows the user a short code to type on its own page while the
//! editor polls for the token. Tokens go from the host straight into
//! the OS credential store; no Polemic server is involved.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::git::{self, Credentials};

const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent(concat!("Polemic/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// The first client ID that is set: run time, then build time, then
/// Polemic's own. An empty value counts as unset.
pub fn first_client_id(candidates: &[Option<&str>]) -> Option<String> {
    candidates
        .iter()
        .flatten()
        .map(|id| id.trim())
        .find(|id| !id.is_empty())
        .map(str::to_string)
}

/// One host's device flow.
pub struct Flow {
    /// The host's name in messages ("GitHub").
    pub provider: &'static str,
    /// Where to ask for a code.
    pub code_url: String,
    /// Where to poll for the token (and to refresh it).
    pub token_url: String,
    pub scope: &'static str,
}

/// What the user needs to finish signing in on the host's page.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    /// Seconds until the codes expire.
    pub expires_in: u64,
    /// Seconds to wait between polls.
    #[serde(default = "default_interval")]
    pub interval: u64,
}

fn default_interval() -> u64 {
    5
}

/// What a sign-in or a refresh hands back.
#[derive(Clone, Debug, PartialEq)]
pub struct Tokens {
    pub access_token: String,
    /// Only for hosts whose tokens expire (GitLab).
    pub refresh_token: Option<String>,
    /// Seconds the access token lives, when it expires.
    pub expires_in: Option<u64>,
}

async fn post_form(
    flow: &Flow,
    url: &str,
    form: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let response = client()?
        .post(url)
        .header("Accept", "application/json")
        .form(form)
        .send()
        .await
        .map_err(|e| format!("Could not reach {}: {e}", flow.provider))?;
    let status = response.status();
    response
        .json()
        .await
        .map_err(|_| format!("{} answered {status}", flow.provider))
}

fn tokens_of(body: &serde_json::Value) -> Option<Tokens> {
    let access_token = body.get("access_token")?.as_str()?.to_string();
    Some(Tokens {
        access_token,
        refresh_token: body
            .get("refresh_token")
            .and_then(|t| t.as_str())
            .map(str::to_string),
        expires_in: body.get("expires_in").and_then(|e| e.as_u64()),
    })
}

/// Ask for a code for the user to type.
pub async fn request_device_code(flow: &Flow, client_id: &str) -> Result<DeviceCode, String> {
    let body = post_form(
        flow,
        &flow.code_url,
        &[("client_id", client_id), ("scope", flow.scope)],
    )
    .await?;
    if let Some(error) = body.get("error").and_then(|e| e.as_str()) {
        let p = flow.provider;
        return Err(match error {
            "device_flow_disabled" => {
                format!("{p} sign-in is not enabled for this app (device flow is off)")
            }
            "incorrect_client_credentials" | "invalid_client" | "unauthorized_client" => {
                format!("{p} does not know this app's client ID")
            }
            "invalid_scope" => format!("{p} refused the permissions Polemic asks for"),
            other => format!("{p} refused the sign-in: {other}"),
        });
    }
    serde_json::from_value(body)
        .map_err(|e| format!("Unexpected answer from {}: {e}", flow.provider))
}

/// One poll's answer.
#[derive(Debug, PartialEq)]
enum Poll {
    Done(Tokens),
    Pending,
    SlowDown,
}

async fn poll_once(flow: &Flow, client_id: &str, device_code: &str) -> Result<Poll, String> {
    let body = post_form(
        flow,
        &flow.token_url,
        &[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ],
    )
    .await?;
    if let Some(tokens) = tokens_of(&body) {
        return Ok(Poll::Done(tokens));
    }
    let p = flow.provider;
    match body.get("error").and_then(|e| e.as_str()) {
        Some("authorization_pending") => Ok(Poll::Pending),
        Some("slow_down") => Ok(Poll::SlowDown),
        Some("expired_token") => Err("The code expired before it was entered: sign in again".into()),
        Some("access_denied") => Err(format!("The sign-in was cancelled on {p}")),
        Some(other) => Err(format!("{p} refused the sign-in: {other}")),
        None => Err(format!("Unexpected answer from {p}")),
    }
}

/// Poll until the user has entered the code (or it expires, or the
/// sign-in is cancelled). `unit` is one second outside tests.
pub async fn wait_for_tokens(
    flow: &Flow,
    client_id: &str,
    code: &DeviceCode,
    cancel: Arc<AtomicBool>,
    unit: Duration,
) -> Result<Tokens, String> {
    let deadline = Instant::now() + unit * code.expires_in as u32;
    let mut interval = code.interval.max(1);
    loop {
        // Sleep in small steps so a cancel takes effect quickly.
        let wake = Instant::now() + unit * interval as u32;
        while Instant::now() < wake {
            if cancel.load(Ordering::Relaxed) {
                return Err("Sign-in cancelled".into());
            }
            sleep(unit.min(Duration::from_millis(200))).await;
        }
        if Instant::now() > deadline {
            return Err("The code expired before it was entered: sign in again".into());
        }
        match poll_once(flow, client_id, &code.device_code).await? {
            Poll::Done(tokens) => return Ok(tokens),
            Poll::Pending => {}
            // The host asks for 5 more seconds each time.
            Poll::SlowDown => interval += 5,
        }
    }
}

/// Trade a refresh token for a new access token (and refresh token).
pub async fn refresh(flow: &Flow, client_id: &str, refresh_token: &str) -> Result<Tokens, String> {
    let body = post_form(
        flow,
        &flow.token_url,
        &[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ],
    )
    .await?;
    tokens_of(&body).ok_or_else(|| {
        format!(
            "The {} sign-in has expired: sign in to {} again in the git accounts",
            flow.provider, flow.provider
        )
    })
}

async fn sleep(duration: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

/// A repository name both hosts take: letters, digits, `-`, `_`, `.`.
pub fn check_repo_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("The repository name is empty".into());
    }
    if name.len() > 100
        || name == "."
        || name == ".."
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("A repository name takes letters, digits, -, _ and . only".into());
    }
    Ok(name.to_string())
}

/// Publish's first step: the project needs a commit and no origin yet.
pub fn check_can_publish(dir: &std::path::Path) -> Result<(), String> {
    if git::remote_url(dir).is_some() {
        return Err("This project already has a remote".into());
    }
    if !git::has_commits(dir) {
        return Err("Make a first commit before publishing".into());
    }
    Ok(())
}

/// Publish's last step: the new repository becomes origin, then a push.
pub async fn push_to_new_remote(
    dir: &std::path::Path,
    url: &str,
    credentials: Credentials,
) -> Result<(), String> {
    git::set_remote(dir, url)?;
    let push_dir = dir.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || git::push(&push_dir, credentials))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("The repository was created, but the push failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::tests::mock_server;

    fn flow(base: &str) -> Flow {
        Flow {
            provider: "Host",
            code_url: format!("{base}/code"),
            token_url: format!("{base}/token"),
            scope: "api",
        }
    }

    #[test]
    fn reads_rfc_style_errors_from_a_400() {
        // GitLab answers errors with 400 and a JSON body (GitHub with 200).
        let (base, _) = mock_server(Box::new(|_| (400, r#"{"error":"access_denied"}"#.into())));
        let code = DeviceCode {
            device_code: "d".into(),
            user_code: "U".into(),
            verification_uri: "https://host/device".into(),
            expires_in: 60,
            interval: 1,
        };
        let error = tauri::async_runtime::block_on(wait_for_tokens(
            &flow(&base),
            "cid",
            &code,
            Arc::new(AtomicBool::new(false)),
            Duration::from_millis(5),
        ))
        .unwrap_err();
        assert_eq!(error, "The sign-in was cancelled on Host");
    }

    #[test]
    fn keeps_the_refresh_token_and_its_lifetime() {
        let (base, seen) = mock_server(Box::new(|_| {
            (200, r#"{"access_token":"a2","refresh_token":"r2","expires_in":7200,"token_type":"Bearer"}"#.into())
        }));
        let tokens =
            tauri::async_runtime::block_on(refresh(&flow(&base), "cid", "r1")).unwrap();
        assert_eq!(
            tokens,
            Tokens {
                access_token: "a2".into(),
                refresh_token: Some("r2".into()),
                expires_in: Some(7200),
            }
        );
        let body = &seen.lock().unwrap()[0].body;
        assert!(body.contains("grant_type=refresh_token") && body.contains("refresh_token=r1"));
    }

    #[test]
    fn a_refused_refresh_asks_to_sign_in_again() {
        let (base, _) = mock_server(Box::new(|_| (400, r#"{"error":"invalid_grant"}"#.into())));
        let error =
            tauri::async_runtime::block_on(refresh(&flow(&base), "cid", "old")).unwrap_err();
        assert!(error.contains("sign in to Host again"), "{error}");
    }
}
