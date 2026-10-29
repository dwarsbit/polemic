//! GitHub: sign-in through the OAuth device flow, and Publish (create
//! a repository for a project, set it as origin, push).
//!
//! The device flow needs no redirect: GitHub shows the user a short
//! code to type at github.com/login/device, while the editor polls for
//! the token. The token (scope `repo`) becomes an ordinary git account
//! for github.com (see git_accounts.rs), so fetch, pull and push use it
//! like any other.
//!
//! The OAuth App's client ID is not a secret; it is set at build time
//! with POLEMIC_GITHUB_CLIENT_ID (or at run time, for development).
//! Without one, GitHub sign-in is off and Publish still works with a
//! github.com account added by hand.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::git::{self, Credentials};

pub const HOST: &str = "github.com";
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const SCOPE: &str = "repo";

/// The OAuth App's client ID, if this build has one.
pub fn client_id() -> Option<String> {
    std::env::var("POLEMIC_GITHUB_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("POLEMIC_GITHUB_CLIENT_ID").map(str::to_string))
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

/// Where GitHub lives; tests point both at a local server.
#[derive(Clone, Debug)]
pub struct Endpoints {
    /// github.com: the device flow.
    pub web: String,
    /// api.github.com: the REST API.
    pub api: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            web: "https://github.com".into(),
            api: "https://api.github.com".into(),
        }
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent(concat!("Polemic/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// What the user needs to finish signing in on github.com.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    /// Seconds until the codes expire.
    pub expires_in: u64,
    /// Seconds to wait between polls.
    pub interval: u64,
}

/// `POST /login/device/code`: a code for the user to type.
pub async fn request_device_code(
    endpoints: &Endpoints,
    client_id: &str,
) -> Result<DeviceCode, String> {
    let response = client()?
        .post(format!("{}/login/device/code", endpoints.web))
        .header("Accept", "application/json")
        .form(&[("client_id", client_id), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Unexpected answer from GitHub: {e}"))?;
    if let Some(error) = body.get("error").and_then(|e| e.as_str()) {
        return Err(match error {
            "device_flow_disabled" => {
                "GitHub sign-in is not enabled for this app (device flow is off)".into()
            }
            "incorrect_client_credentials" => "GitHub does not know this app's client ID".into(),
            other => format!("GitHub refused the sign-in: {other}"),
        });
    }
    if !status.is_success() {
        return Err(format!("GitHub answered {status}"));
    }
    serde_json::from_value(body).map_err(|e| format!("Unexpected answer from GitHub: {e}"))
}

/// One poll's answer.
#[derive(Debug, PartialEq)]
enum Poll {
    Token(String),
    Pending,
    SlowDown,
}

async fn poll_once(
    endpoints: &Endpoints,
    client_id: &str,
    device_code: &str,
) -> Result<Poll, String> {
    let response = client()?
        .post(format!("{}/login/oauth/access_token", endpoints.web))
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Unexpected answer from GitHub: {e}"))?;
    if let Some(token) = body.get("access_token").and_then(|t| t.as_str()) {
        return Ok(Poll::Token(token.to_string()));
    }
    match body.get("error").and_then(|e| e.as_str()) {
        Some("authorization_pending") => Ok(Poll::Pending),
        Some("slow_down") => Ok(Poll::SlowDown),
        Some("expired_token") => Err("The code expired before it was entered: sign in again".into()),
        Some("access_denied") => Err("The sign-in was cancelled on GitHub".into()),
        Some(other) => Err(format!("GitHub refused the sign-in: {other}")),
        None => Err("Unexpected answer from GitHub".into()),
    }
}

/// Poll until the user has entered the code (or it expires, or the
/// sign-in is cancelled). `unit` is one second outside tests.
pub async fn wait_for_token(
    endpoints: &Endpoints,
    client_id: &str,
    code: &DeviceCode,
    cancel: Arc<AtomicBool>,
    unit: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + unit * code.expires_in as u32;
    let mut interval = code.interval.max(1);
    loop {
        // Sleep in small steps so a cancel takes effect quickly.
        let wake = Instant::now() + unit * interval as u32;
        while Instant::now() < wake {
            if cancel.load(Ordering::Relaxed) {
                return Err("Sign-in cancelled".into());
            }
            tokio_sleep(unit.min(Duration::from_millis(200))).await;
        }
        if Instant::now() > deadline {
            return Err("The code expired before it was entered: sign in again".into());
        }
        match poll_once(endpoints, client_id, &code.device_code).await? {
            Poll::Token(token) => return Ok(token),
            Poll::Pending => {}
            // GitHub asks for 5 more seconds each time.
            Poll::SlowDown => interval += 5,
        }
    }
}

async fn tokio_sleep(duration: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

#[derive(Deserialize)]
struct User {
    login: String,
}

/// The signed-in user's login (`GET /user`).
pub async fn login_of(endpoints: &Endpoints, token: &str) -> Result<String, String> {
    let response = client()?
        .get(format!("{}/user", endpoints.api))
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("GitHub does not accept this token".into());
    }
    if !response.status().is_success() {
        return Err(format!("GitHub answered {}", response.status()));
    }
    let user: User = response
        .json()
        .await
        .map_err(|e| format!("Unexpected answer from GitHub: {e}"))?;
    Ok(user.login)
}

#[derive(Deserialize)]
struct CreatedRepo {
    clone_url: String,
}

#[derive(Deserialize)]
struct ApiError {
    message: String,
    #[serde(default)]
    errors: Vec<serde_json::Value>,
}

/// A repository name GitHub will take: letters, digits, `-`, `_`, `.`.
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

/// `POST /user/repos`: a new, empty repository; its HTTPS clone URL.
pub async fn create_repo(
    endpoints: &Endpoints,
    token: &str,
    name: &str,
    private: bool,
) -> Result<String, String> {
    let name = check_repo_name(name)?;
    let response = client()?
        .post(format!("{}/user/repos", endpoints.api))
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(token)
        .json(&serde_json::json!({
            "name": name,
            "private": private,
            "auto_init": false,
            "description": "Written with Polemic",
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?;
    let status = response.status();
    if status.is_success() {
        let repo: CreatedRepo = response
            .json()
            .await
            .map_err(|e| format!("Unexpected answer from GitHub: {e}"))?;
        return Ok(repo.clone_url);
    }
    let error = response.json::<ApiError>().await.ok();
    let taken = error.as_ref().is_some_and(|e| {
        e.errors.iter().any(|item| {
            item.get("message")
                .and_then(|m| m.as_str())
                .is_some_and(|m| m.contains("already exists"))
        })
    });
    Err(match status.as_u16() {
        401 => "GitHub does not accept this token: sign in again".into(),
        403 | 404 => {
            "The GitHub token may not create repositories: it needs the repo scope".into()
        }
        422 if taken => format!("You already have a repository named {name} on GitHub"),
        _ => error
            .map(|e| format!("GitHub refused: {}", e.message))
            .unwrap_or_else(|| format!("GitHub answered {status}")),
    })
}

/// Publish a project: a new repository, set as origin, then a push.
/// The project needs a commit and no origin yet.
pub async fn publish_with(
    endpoints: &Endpoints,
    dir: &std::path::Path,
    username: &str,
    token: &str,
    name: &str,
    private: bool,
) -> Result<String, String> {
    if git::remote_url(dir).is_some() {
        return Err("This project already has a remote".into());
    }
    if !git::has_commits(dir) {
        return Err("Make a first commit before publishing".into());
    }
    let url = create_repo(endpoints, token, name, private).await?;
    git::set_remote(dir, &url)?;
    let credentials: Credentials = Some((username.to_string(), token.to_string()));
    let push_dir = dir.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || git::push(&push_dir, credentials))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("The repository was created, but the push failed: {e}"))?;
    Ok(url)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Mutex;

    /// A request as the mock server saw it.
    #[derive(Clone, Debug)]
    pub struct Seen {
        pub method: String,
        pub path: String,
        pub headers: String,
        pub body: String,
    }

    type Handler = dyn Fn(&Seen) -> (u16, String) + Send + Sync;

    /// A local HTTP server answering each request with `handler`; it
    /// stops when the test ends (the thread is detached).
    pub fn mock_server(handler: Box<Handler>) -> (String, Arc<Mutex<Vec<Seen>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut data = Vec::new();
                let mut buf = [0u8; 4096];
                // Read the headers, then the body by Content-Length.
                let (head, body_start) = loop {
                    let n = stream.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        break (String::new(), 0);
                    }
                    data.extend_from_slice(&buf[..n]);
                    if let Some(i) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        break (String::from_utf8_lossy(&data[..i]).into_owned(), i + 4);
                    }
                };
                if head.is_empty() {
                    continue;
                }
                let length = head
                    .lines()
                    .find_map(|l| {
                        let (k, v) = l.split_once(':')?;
                        k.eq_ignore_ascii_case("content-length").then(|| v.trim().parse::<usize>().ok())?
                    })
                    .unwrap_or(0);
                while data.len() < body_start + length {
                    let n = stream.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    data.extend_from_slice(&buf[..n]);
                }
                let mut first = head.lines().next().unwrap_or("").split(' ');
                let request = Seen {
                    method: first.next().unwrap_or("").to_string(),
                    path: first.next().unwrap_or("").to_string(),
                    headers: head.clone(),
                    body: String::from_utf8_lossy(&data[body_start..]).into_owned(),
                };
                let (status, body) = handler(&request);
                log.lock().unwrap().push(request);
                let response = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (base, seen)
    }

    fn endpoints(base: &str) -> Endpoints {
        Endpoints { web: base.to_string(), api: base.to_string() }
    }

    fn device_code() -> DeviceCode {
        DeviceCode {
            device_code: "dev-1".into(),
            user_code: "ABCD-1234".into(),
            verification_uri: "https://github.com/login/device".into(),
            expires_in: 60,
            interval: 1,
        }
    }

    #[test]
    fn names_repositories() {
        assert!(check_repo_name("my-paper_v2.0").is_ok());
        assert!(check_repo_name("my paper").is_err());
        assert!(check_repo_name("..").is_err());
        assert!(check_repo_name("").is_err());
    }

    #[test]
    fn requests_a_device_code_with_the_repo_scope() {
        let (base, seen) = mock_server(Box::new(|_| {
            (200, r#"{"device_code":"dev-1","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#.into())
        }));
        let code = tauri::async_runtime::block_on(request_device_code(&endpoints(&base), "cid"))
            .unwrap();
        assert_eq!(code.user_code, "ABCD-1234");
        assert_eq!(code.interval, 5);
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].path, "/login/device/code");
        assert!(seen[0].body.contains("client_id=cid") && seen[0].body.contains("scope=repo"));
    }

    #[test]
    fn device_flow_disabled_is_explained() {
        let (base, _) = mock_server(Box::new(|_| (200, r#"{"error":"device_flow_disabled"}"#.into())));
        let error = tauri::async_runtime::block_on(request_device_code(&endpoints(&base), "cid"))
            .unwrap_err();
        assert!(error.contains("device flow is off"), "{error}");
    }

    #[test]
    fn polls_through_pending_and_slow_down_to_the_token() {
        let count = Arc::new(Mutex::new(0));
        let counter = count.clone();
        let (base, seen) = mock_server(Box::new(move |_| {
            let mut n = counter.lock().unwrap();
            *n += 1;
            let body = match *n {
                1 => r#"{"error":"authorization_pending"}"#,
                2 => r#"{"error":"slow_down"}"#,
                _ => r#"{"access_token":"gho_token","token_type":"bearer","scope":"repo"}"#,
            };
            (200, body.into())
        }));
        let token = tauri::async_runtime::block_on(wait_for_token(
            &endpoints(&base),
            "cid",
            &device_code(),
            Arc::new(AtomicBool::new(false)),
            Duration::from_millis(5),
        ))
        .unwrap();
        assert_eq!(token, "gho_token");
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 3);
        assert!(seen[0].body.contains("device_code=dev-1"));
        assert!(seen[0].body.contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"));
    }

    #[test]
    fn a_denied_or_cancelled_sign_in_stops() {
        let (base, _) = mock_server(Box::new(|_| (200, r#"{"error":"access_denied"}"#.into())));
        let error = tauri::async_runtime::block_on(wait_for_token(
            &endpoints(&base),
            "cid",
            &device_code(),
            Arc::new(AtomicBool::new(false)),
            Duration::from_millis(5),
        ))
        .unwrap_err();
        assert!(error.contains("cancelled on GitHub"), "{error}");

        let (base, seen) =
            mock_server(Box::new(|_| (200, r#"{"error":"authorization_pending"}"#.into())));
        let error = tauri::async_runtime::block_on(wait_for_token(
            &endpoints(&base),
            "cid",
            &device_code(),
            Arc::new(AtomicBool::new(true)),
            Duration::from_millis(5),
        ))
        .unwrap_err();
        assert_eq!(error, "Sign-in cancelled");
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn reads_the_login_with_the_token() {
        let (base, seen) = mock_server(Box::new(|r| {
            if r.headers.contains("Bearer gho_token") {
                (200, r#"{"login":"ada","id":1}"#.into())
            } else {
                (401, r#"{"message":"Bad credentials"}"#.into())
            }
        }));
        let e = endpoints(&base);
        assert_eq!(tauri::async_runtime::block_on(login_of(&e, "gho_token")).unwrap(), "ada");
        let error = tauri::async_runtime::block_on(login_of(&e, "wrong")).unwrap_err();
        assert!(error.contains("does not accept"), "{error}");
        assert_eq!(seen.lock().unwrap()[0].path, "/user");
    }

    #[test]
    fn explains_a_taken_name_and_a_missing_scope() {
        let (base, _) = mock_server(Box::new(|r| {
            if r.body.contains("\"name\":\"taken\"") {
                (422, r#"{"message":"Repository creation failed.","errors":[{"resource":"Repository","code":"custom","field":"name","message":"name already exists on this account"}]}"#.into())
            } else {
                (403, r#"{"message":"Resource not accessible by integration"}"#.into())
            }
        }));
        let e = endpoints(&base);
        let error = tauri::async_runtime::block_on(create_repo(&e, "t", "taken", true)).unwrap_err();
        assert!(error.contains("already have a repository named taken"), "{error}");
        let error = tauri::async_runtime::block_on(create_repo(&e, "t", "other", true)).unwrap_err();
        assert!(error.contains("repo scope"), "{error}");
    }

    /// Publish end to end: the API creates the repository (a local bare
    /// repository stands in for GitHub's), origin is set, and the
    /// project's commits arrive there.
    #[test]
    fn publishes_a_project_to_a_new_repository() {
        if !git::available() {
            return;
        }
        let root = std::env::temp_dir().join(format!("polemic-publish-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let bare = root.join("remote.git");
        let project = root.join("paper");
        std::fs::create_dir_all(&bare).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        let run = |dir: &std::path::Path, args: &[&str]| {
            let out = std::process::Command::new("git").args(args).current_dir(dir).output().unwrap();
            assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        };
        run(&bare, &["init", "-q", "--bare", "-b", "main"]);
        let bare_url = url::Url::from_file_path(&bare).unwrap().to_string();
        let answer = format!(r#"{{"clone_url":"{bare_url}","private":true}}"#);
        let (base, seen) = mock_server(Box::new(move |r| {
            if r.method == "POST" && r.path == "/user/repos" {
                (201, answer.clone())
            } else {
                (404, "{}".into())
            }
        }));
        let e = endpoints(&base);

        run(&project, &["init", "-q", "-b", "main"]);
        run(&project, &["config", "user.email", "t@example.com"]);
        run(&project, &["config", "user.name", "T"]);
        let error = tauri::async_runtime::block_on(publish_with(&e, &project, "ada", "t", "paper", true))
            .unwrap_err();
        assert!(error.contains("first commit"), "{error}");

        std::fs::write(project.join("main.tex"), "hello\n").unwrap();
        run(&project, &["add", "main.tex"]);
        run(&project, &["commit", "-qm", "first"]);
        let url = tauri::async_runtime::block_on(publish_with(&e, &project, "ada", "t", "paper", true))
            .unwrap();
        assert_eq!(url, bare_url);
        assert_eq!(git::remote_url(&project).as_deref(), Some(bare_url.as_str()));
        let status = git::status(&project);
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!(status.ahead, 0);
        let request = &seen.lock().unwrap()[0];
        assert!(request.headers.contains("Bearer t"));
        assert!(request.body.contains("\"private\":true") && request.body.contains("\"name\":\"paper\""));

        let error = tauri::async_runtime::block_on(publish_with(&e, &project, "ada", "t", "paper", true))
            .unwrap_err();
        assert!(error.contains("already has a remote"), "{error}");
        let _ = std::fs::remove_dir_all(root);
    }
}
