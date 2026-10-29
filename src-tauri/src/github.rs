//! GitHub: sign-in through the OAuth device flow, and Publish (create
//! a repository for a project, set it as origin, push).
//!
//! The device flow needs no redirect: GitHub shows the user a short
//! code to type at github.com/login/device, while the editor polls for
//! the token. The token (scope `repo`) becomes an ordinary git account
//! for github.com (see git_accounts.rs), so fetch, pull and push use it
//! like any other.
//!
//! The OAuth App's client ID is not a secret: Polemic's own is below,
//! so builds from source sign in out of the box. A fork can use its
//! own OAuth App (device flow enabled) by setting
//! POLEMIC_GITHUB_CLIENT_ID at build time or at run time. No client
//! secret exists or is needed, and no Polemic server is involved: the
//! editor talks to github.com directly.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;

use crate::git::Credentials;
pub use crate::hosting::{check_repo_name, first_client_id, DeviceCode};
use crate::hosting::{self, client, Flow};

pub const HOST: &str = "github.com";
const SCOPE: &str = "repo";

/// Polemic's GitHub OAuth App ("Polemic", owned by dwarsbit).
pub const DEFAULT_CLIENT_ID: &str = "Ov23li7iBrzadnQWtIZv";

/// The OAuth App's client ID this build signs in with.
pub fn client_id() -> Option<String> {
    let runtime = std::env::var("POLEMIC_GITHUB_CLIENT_ID").ok();
    first_client_id(&[
        runtime.as_deref(),
        option_env!("POLEMIC_GITHUB_CLIENT_ID"),
        Some(DEFAULT_CLIENT_ID),
    ])
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

fn flow(endpoints: &Endpoints) -> Flow {
    Flow {
        provider: "GitHub",
        code_url: format!("{}/login/device/code", endpoints.web),
        token_url: format!("{}/login/oauth/access_token", endpoints.web),
        scope: SCOPE,
    }
}

/// `POST /login/device/code`: a code for the user to type.
pub async fn request_device_code(
    endpoints: &Endpoints,
    client_id: &str,
) -> Result<DeviceCode, String> {
    hosting::request_device_code(&flow(endpoints), client_id).await
}

/// Poll until the user has entered the code; the access token (GitHub's
/// OAuth App tokens do not expire).
pub async fn wait_for_token(
    endpoints: &Endpoints,
    client_id: &str,
    code: &DeviceCode,
    cancel: Arc<AtomicBool>,
    unit: Duration,
) -> Result<String, String> {
    hosting::wait_for_tokens(&flow(endpoints), client_id, code, cancel, unit)
        .await
        .map(|tokens| tokens.access_token)
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
    hosting::check_can_publish(dir)?;
    let url = create_repo(endpoints, token, name, private).await?;
    let credentials: Credentials = Some((username.to_string(), token.to_string()));
    hosting::push_to_new_remote(dir, &url, credentials).await?;
    Ok(url)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::git;
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
    fn picks_the_first_client_id_that_is_set() {
        assert_eq!(first_client_id(&[None, None, Some("own")]).as_deref(), Some("own"));
        assert_eq!(first_client_id(&[Some("fork"), None, Some("own")]).as_deref(), Some("fork"));
        // An empty build variable (an unset repository variable) is no override.
        assert_eq!(first_client_id(&[None, Some(" "), Some("own")]).as_deref(), Some("own"));
        assert!(client_id().is_some());
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
