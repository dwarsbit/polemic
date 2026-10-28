//! The Polemic Professional account: signing in to a Polemic server
//! (app.polemicapp.com, or a self-hosted install) from the editor.
//!
//! Sign-in follows RFC 8252: the editor listens on a random loopback
//! port, opens the server's /desktop/authorize page in the browser
//! with a PKCE challenge (RFC 7636, S256), and the server sends the
//! browser back to the loopback address with a one-time code. The
//! editor trades the code and its verifier for a bearer token, which
//! lives in the OS credential store (never in settings.json, never in
//! the webview). Signing out revokes the token on the server.
//!
//! The request and response shapes mirror the server's
//! `@polemic/contracts` schemas.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::secrets::{OsStore, Store};

pub const DEFAULT_SERVER: &str = "https://app.polemicapp.com";

/// How long the editor waits for the browser: long enough to create
/// an account and confirm the email address on the way.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const CALLBACK_PATH: &str = "/callback";

/// The signed-in user (`GET /api/me`, contracts' `meResponse`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub email_verified: bool,
    pub created_at: String,
    /// "free" or "professional"; None from servers before billing.
    #[serde(default)]
    pub plan: Option<String>,
}

/// `POST /api/desktop/token` (contracts' `desktopTokenResponse`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    token: String,
    user: AccountUser,
}

/// Non-2xx bodies outside /api/auth (contracts' `errorResponse`).
#[derive(Deserialize)]
struct ErrorResponse {
    message: String,
}

/// What the credential store holds: the token and the server it is for.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Credential {
    server: String,
    token: String,
}

/// The Account page's view.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub server: String,
    pub signed_in: bool,
    /// None while signed in but the server can't be reached.
    pub user: Option<AccountUser>,
    /// Why the user could not be fetched (offline, server error).
    pub problem: Option<String>,
}

pub static STORE: OsStore = OsStore::new("account");

/// The running sign-in's cancel flag; a new sign-in cancels the old one.
static PENDING: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

/// A server URL as typed: trimmed, without trailing slashes; https,
/// or plain http for localhost (a self-hosted install under test).
pub fn normalize_server(input: &str) -> Result<String, String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(DEFAULT_SERVER.into());
    }
    crate::ai::check_service_url(trimmed, "The server URL")?;
    let url =
        url::Url::parse(trimmed).map_err(|_| "The server URL is not a valid URL".to_string())?;
    if url.host_str().is_none()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
    {
        return Err("The server URL should look like https://polemic.example.org".into());
    }
    Ok(trimmed.to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent(concat!("Polemic/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

fn random_token(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| format!("no randomness available: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

/// RFC 7636 S256 challenge for a verifier.
pub fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// The browser page that starts the sign-in.
pub fn authorize_url(server: &str, challenge: &str, redirect_uri: &str, state: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", state)
        .finish();
    format!("{server}/desktop/authorize?{query}")
}

/// The computer's name, shown on the server next to the session.
fn device_name() -> Option<String> {
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        // SAFETY: the buffer is valid for its length; gethostname writes at most that much.
        let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
        if rc == 0 {
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            let name = String::from_utf8_lossy(&buf[..end]).trim().to_string();
            if !name.is_empty() {
                return Some(name.chars().take(100).collect());
            }
        }
        None
    }
    #[cfg(windows)]
    {
        std::env::var("COMPUTERNAME")
            .ok()
            .filter(|n| !n.is_empty())
            .map(|n| n.chars().take(100).collect())
    }
}

/// What the browser brought back to the loopback address.
#[derive(Debug, PartialEq)]
enum Callback {
    Code(String),
    Denied,
    /// Not the callback (a favicon request) or not ours (wrong state).
    Ignore,
}

/// Reads one request line ("GET /callback?code=…&state=… HTTP/1.1").
fn parse_callback(request_line: &str, state: &str) -> Callback {
    let mut parts = request_line.split(' ');
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Callback::Ignore;
    };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return Callback::Ignore;
    }
    let mut code = None;
    let mut got_state = None;
    let mut error = None;
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match &*key {
            "code" => code = Some(value.into_owned()),
            "state" => got_state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }
    if got_state.as_deref() != Some(state) {
        return Callback::Ignore;
    }
    match (code, error) {
        (_, Some(_)) => Callback::Denied,
        (Some(code), None) if !code.is_empty() => Callback::Code(code),
        _ => Callback::Ignore,
    }
}

fn page(title: &str, text: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>{title}</title>\
         <meta name=\"viewport\" content=\"width=device-width\">\
         <style>body{{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;\
         color:#222;background:#fafafa}}@media(prefers-color-scheme:dark){{body{{color:#eee;background:#18181b}}}}\
         main{{max-width:28rem;padding:1rem;text-align:center}}h1{{font-size:1.25rem}}</style></head>\
         <body><main><h1>{title}</h1><p>{text}</p></main></body></html>"
    )
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// The first line of an HTTP request, read with a size and time limit.
fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < 16 * 1024 {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => return None,
        }
    }
    let text = String::from_utf8_lossy(&buf);
    text.lines().next().map(str::to_string)
}

/// Serves the loopback address until the browser brings the code back,
/// the user cancels, or time runs out.
fn wait_for_code(
    listener: &TcpListener,
    state: &str,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Sign-in cancelled".into());
        }
        if Instant::now() > deadline {
            return Err("Sign-in timed out. Try again.".into());
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let Some(line) = read_request_line(&mut stream) else {
            continue;
        };
        match parse_callback(&line, state) {
            Callback::Code(code) => {
                respond(
                    &mut stream,
                    "200 OK",
                    &page(
                        "You're signed in",
                        "Return to Polemic. You can close this tab.",
                    ),
                );
                return Ok(code);
            }
            Callback::Denied => {
                respond(
                    &mut stream,
                    "200 OK",
                    &page(
                        "Sign-in cancelled",
                        "Polemic was not signed in. You can close this tab.",
                    ),
                );
                return Err("Sign-in cancelled in the browser".into());
            }
            Callback::Ignore => respond(&mut stream, "404 Not Found", &page("Not found", "")),
        }
    }
}

async fn error_message(response: reqwest::Response) -> String {
    let status = response.status();
    match response.json::<ErrorResponse>().await {
        Ok(body) => body.message,
        Err(_) => format!("The server answered {status}"),
    }
}

/// The whole sign-in against `server`: `open` shows the authorize page
/// in the browser. Returns the stored credential's user.
pub async fn sign_in_with(
    server: &str,
    store: &impl Store,
    cancel: Arc<AtomicBool>,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<AccountUser, String> {
    let verifier = random_token(32)?;
    let state = random_token(16)?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("could not listen for the browser: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");

    open(&authorize_url(
        server,
        &code_challenge(&verifier),
        &redirect_uri,
        &state,
    ))?;

    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    let wait_state = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_code(&listener, &wait_state, &cancel, deadline)
    })
    .await
    .map_err(|e| e.to_string())??;

    let mut body =
        serde_json::json!({ "code": code, "codeVerifier": verifier, "redirectUri": redirect_uri });
    if let Some(name) = device_name() {
        body["deviceName"] = name.into();
    }
    let response = client()?
        .post(format!("{server}/api/desktop/token"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach {server}: {e}"))?;
    if !response.status().is_success() {
        return Err(error_message(response).await);
    }
    let token: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Unexpected answer from the server: {e}"))?;

    let credential = Credential {
        server: server.to_string(),
        token: token.token,
    };
    let json = serde_json::to_string(&credential).map_err(|e| e.to_string())?;
    if let Err(e) = store.set(&json) {
        // Without a credential store the token has nowhere safe to go.
        let _ = revoke(&credential).await;
        return Err(format!(
            "Could not save the sign-in in the system's credential store: {e}"
        ));
    }
    Ok(token.user)
}

fn load(store: &impl Store) -> Option<Credential> {
    store
        .get()
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
}

/// The stored token for `server`; None when signed out or signed in
/// to another server.
pub fn token_with(server: &str, store: &impl Store) -> Option<String> {
    load(store)
        .filter(|credential| credential.server == server)
        .map(|credential| credential.token)
}

/// Forgets a token `server` no longer accepts (a 401 from a paid
/// service), as `status_with` does.
pub fn forget_rejected_with(server: &str, token: &str, store: &impl Store) {
    if load(store).is_some_and(|c| c.server == server && c.token == token) {
        let _ = store.delete();
    }
}

async fn revoke(credential: &Credential) -> Result<(), String> {
    client()?
        .delete(format!("{}/api/desktop/session", credential.server))
        .bearer_auth(&credential.token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Revokes the token (best effort: offline, it just expires) and forgets it.
pub async fn sign_out_with(store: &impl Store) -> Result<(), String> {
    if let Some(credential) = load(store) {
        let _ = revoke(&credential).await;
    }
    store.delete()
}

/// The account for `server`. A token the server no longer accepts is
/// forgotten; a token for another server is revoked and forgotten.
pub async fn status_with(server: &str, store: &impl Store) -> AccountStatus {
    let signed_out = AccountStatus {
        server: server.to_string(),
        signed_in: false,
        user: None,
        problem: None,
    };
    let Some(credential) = load(store) else {
        return signed_out;
    };
    if credential.server != server {
        let _ = sign_out_with(store).await;
        return signed_out;
    }
    let fetched = match client() {
        Ok(client) => {
            client
                .get(format!("{server}/api/me"))
                .bearer_auth(&credential.token)
                .send()
                .await
        }
        Err(e) => {
            return AccountStatus {
                problem: Some(e),
                signed_in: true,
                ..signed_out
            }
        }
    };
    match fetched {
        Ok(response) if response.status() == reqwest::StatusCode::UNAUTHORIZED => {
            let _ = store.delete();
            AccountStatus {
                problem: Some("Your sign-in has expired. Sign in again.".into()),
                ..signed_out
            }
        }
        Ok(response) if response.status().is_success() => {
            match response.json::<AccountUser>().await {
                Ok(user) => AccountStatus {
                    signed_in: true,
                    user: Some(user),
                    ..signed_out
                },
                Err(e) => AccountStatus {
                    signed_in: true,
                    problem: Some(format!("Unexpected answer from the server: {e}")),
                    ..signed_out
                },
            }
        }
        Ok(response) => {
            let problem = Some(error_message(response).await);
            AccountStatus {
                signed_in: true,
                problem,
                ..signed_out
            }
        }
        Err(_) => AccountStatus {
            signed_in: true,
            problem: Some(format!("Could not reach {server}.")),
            ..signed_out
        },
    }
}

// --- commands ----------------------------------------------------------------

pub fn server_of(app: &tauri::AppHandle) -> Result<String, String> {
    let settings = crate::settings::snapshot(app)?;
    Ok(settings
        .account_server
        .unwrap_or_else(|| DEFAULT_SERVER.into()))
}

#[tauri::command]
pub async fn account_status(app: tauri::AppHandle) -> Result<AccountStatus, String> {
    let server = server_of(&app)?;
    Ok(status_with(&server, &STORE).await)
}

/// Changes the server; signs out of the old one first.
#[tauri::command]
pub async fn account_set_server(
    app: tauri::AppHandle,
    server: String,
) -> Result<AccountStatus, String> {
    let server = normalize_server(&server)?;
    if server != server_of(&app)? {
        sign_out_with(&STORE).await?;
    }
    let stored = (server != DEFAULT_SERVER).then(|| server.clone());
    crate::settings::update(&app, |s| s.account_server = stored)?;
    Ok(status_with(&server, &STORE).await)
}

#[tauri::command]
pub async fn account_sign_in(app: tauri::AppHandle) -> Result<AccountUser, String> {
    use tauri_plugin_opener::OpenerExt;
    let server = server_of(&app)?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut pending) = PENDING.lock() {
        if let Some(old) = pending.replace(cancel.clone()) {
            old.store(true, Ordering::Relaxed);
        }
    }
    let result = sign_in_with(&server, &STORE, cancel.clone(), |url| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| format!("could not open the browser: {e}"))
    })
    .await;
    if let Ok(mut pending) = PENDING.lock() {
        if pending.as_ref().is_some_and(|p| Arc::ptr_eq(p, &cancel)) {
            *pending = None;
        }
    }
    result
}

#[tauri::command]
pub fn account_cancel_sign_in() {
    if let Ok(mut pending) = PENDING.lock() {
        if let Some(cancel) = pending.take() {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub async fn account_sign_out() -> Result<(), String> {
    sign_out_with(&STORE).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    pub struct MemoryStore(Mutex<Option<String>>);

    impl Store for MemoryStore {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, value: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.into());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn challenge_matches_rfc7636_example() {
        // RFC 7636, appendix B.
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn normalizes_server_urls() {
        assert_eq!(normalize_server("").unwrap(), DEFAULT_SERVER);
        assert_eq!(
            normalize_server(" https://polemic.example.org/ ").unwrap(),
            "https://polemic.example.org"
        );
        assert_eq!(
            normalize_server("http://localhost").unwrap(),
            "http://localhost"
        );
        assert!(normalize_server("http://polemic.example.org").is_err());
        assert!(normalize_server("https://polemic.example.org/?x=1").is_err());
        assert!(normalize_server("ftp://polemic.example.org").is_err());
    }

    #[test]
    fn builds_the_authorize_url() {
        let url = authorize_url(
            "https://app.test",
            "abc",
            "http://127.0.0.1:5000/callback",
            "st",
        );
        assert_eq!(
            url,
            "https://app.test/desktop/authorize?code_challenge=abc&code_challenge_method=S256\
             &redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback&state=st"
        );
    }

    #[test]
    fn reads_the_callback() {
        assert_eq!(
            parse_callback("GET /callback?code=c1&state=s HTTP/1.1", "s"),
            Callback::Code("c1".into())
        );
        assert_eq!(
            parse_callback("GET /callback?error=access_denied&state=s HTTP/1.1", "s"),
            Callback::Denied
        );
        assert_eq!(
            parse_callback("GET /callback?code=c1&state=other HTTP/1.1", "s"),
            Callback::Ignore
        );
        assert_eq!(
            parse_callback("GET /callback?error=access_denied HTTP/1.1", "s"),
            Callback::Ignore
        );
        assert_eq!(
            parse_callback("GET /favicon.ico HTTP/1.1", "s"),
            Callback::Ignore
        );
        assert_eq!(
            parse_callback("POST /callback?code=c1&state=s HTTP/1.1", "s"),
            Callback::Ignore
        );
    }

    fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn loopback_waits_for_the_matching_callback() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            let favicon = get(port, "/favicon.ico");
            let forged = get(port, "/callback?code=evil&state=wrong");
            let real = get(port, "/callback?code=the-code&state=s1");
            (favicon, forged, real)
        });
        let cancel = AtomicBool::new(false);
        let code = wait_for_code(
            &listener,
            "s1",
            &cancel,
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap();
        assert_eq!(code, "the-code");
        let (favicon, forged, real) = browser.join().unwrap();
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(forged.starts_with("HTTP/1.1 404"));
        assert!(real.starts_with("HTTP/1.1 200") && real.contains("signed in"));
    }

    #[test]
    fn loopback_stops_on_cancel_and_denial() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let cancel = AtomicBool::new(true);
        let err = wait_for_code(
            &listener,
            "s",
            &cancel,
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap_err();
        assert!(err.contains("cancelled"));

        let port = listener.local_addr().unwrap().port();
        let browser =
            std::thread::spawn(move || get(port, "/callback?error=access_denied&state=s"));
        let cancel = AtomicBool::new(false);
        let err = wait_for_code(
            &listener,
            "s",
            &cancel,
            Instant::now() + Duration::from_secs(10),
        )
        .unwrap_err();
        assert!(err.contains("cancelled in the browser"));
        assert!(browser.join().unwrap().contains("Sign-in cancelled"));
    }

    #[test]
    fn signed_out_without_a_credential() {
        let store = MemoryStore::default();
        let status = tauri::async_runtime::block_on(status_with("https://app.test", &store));
        assert_eq!(
            status,
            AccountStatus {
                server: "https://app.test".into(),
                signed_in: false,
                user: None,
                problem: None
            }
        );
    }

    #[test]
    fn tokens_go_only_to_their_own_server() {
        let store = MemoryStore::default();
        assert_eq!(token_with("https://app.test", &store), None);
        let credential = Credential {
            server: "https://app.test".into(),
            token: "tok".into(),
        };
        store
            .set(&serde_json::to_string(&credential).unwrap())
            .unwrap();
        assert_eq!(
            token_with("https://app.test", &store).as_deref(),
            Some("tok")
        );
        assert_eq!(token_with("https://other.test", &store), None);

        // A stale 401 (an older token) leaves a newer sign-in alone.
        forget_rejected_with("https://app.test", "old", &store);
        assert!(load(&store).is_some());
        forget_rejected_with("https://app.test", "tok", &store);
        assert!(load(&store).is_none());
    }

    #[test]
    fn users_from_servers_before_billing_have_no_plan() {
        let old = r#"{"id":"u","name":"N","email":"e@x","emailVerified":true,"createdAt":"t"}"#;
        assert_eq!(serde_json::from_str::<AccountUser>(old).unwrap().plan, None);
        let new = r#"{"id":"u","name":"N","email":"e@x","emailVerified":true,"createdAt":"t","plan":"professional","image":null}"#;
        assert_eq!(
            serde_json::from_str::<AccountUser>(new)
                .unwrap()
                .plan
                .as_deref(),
            Some("professional")
        );
    }

    /// Full sign-in against a running server (the Compose stack). The
    /// test plays the browser through `POLEMIC_E2E_BROWSER`, a command
    /// that receives the authorize URL as its argument.
    ///
    /// POLEMIC_E2E_SERVER=http://localhost POLEMIC_E2E_BROWSER=… cargo test e2e -- --ignored
    #[test]
    #[ignore]
    fn e2e_sign_in_status_and_sign_out() {
        let server = std::env::var("POLEMIC_E2E_SERVER").expect("POLEMIC_E2E_SERVER");
        let browser = std::env::var("POLEMIC_E2E_BROWSER").expect("POLEMIC_E2E_BROWSER");
        let store = MemoryStore::default();
        tauri::async_runtime::block_on(async {
            let user = sign_in_with(&server, &store, Arc::new(AtomicBool::new(false)), |url| {
                std::process::Command::new(&browser)
                    .arg(url)
                    .spawn()
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            })
            .await
            .unwrap();
            let status = status_with(&server, &store).await;
            assert!(status.signed_in);
            assert_eq!(status.user.as_ref(), Some(&user));
            let token = load(&store).unwrap().token;

            sign_out_with(&store).await.unwrap();
            assert!(load(&store).is_none());
            let me = client()
                .unwrap()
                .get(format!("{server}/api/me"))
                .bearer_auth(token)
                .send()
                .await
                .unwrap();
            assert_eq!(me.status(), reqwest::StatusCode::UNAUTHORIZED);
            println!("signed in and out as {}", user.email);
        });
    }
}
