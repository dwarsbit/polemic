//! GitLab (gitlab.com): sign-in through the OAuth device flow, and
//! Publish (a new project, set as origin, pushed).
//!
//! Unlike GitHub's, GitLab's OAuth tokens expire after two hours, so the
//! account keeps the refresh token too and the editor renews the access
//! token before a fetch, pull or push (see lib.rs). Over HTTPS, git
//! sends an OAuth token with the username `oauth2`.
//!
//! The application ID is public; there is no secret. Polemic's own
//! goes in DEFAULT_CLIENT_ID; until it is set, POLEMIC_GITLAB_CLIENT_ID
//! (at build or run time) turns sign-in on. A self-hosted GitLab is a
//! custom remote with a personal access token.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;

use crate::git::Credentials;
use crate::hosting::{self, client, first_client_id, DeviceCode, Flow, Tokens};

pub const HOST: &str = "gitlab.com";
const SCOPE: &str = "api";
/// The username git sends with an OAuth token.
pub const OAUTH_USERNAME: &str = "oauth2";
/// Polemic's GitLab application, once registered (empty: none yet).
pub const DEFAULT_CLIENT_ID: &str = "";
/// GitLab's access tokens live two hours unless it says otherwise.
pub const DEFAULT_LIFETIME: u64 = 7200;

/// The application ID this build signs in with, if any.
pub fn client_id() -> Option<String> {
    let runtime = std::env::var("POLEMIC_GITLAB_CLIENT_ID").ok();
    first_client_id(&[
        runtime.as_deref(),
        option_env!("POLEMIC_GITLAB_CLIENT_ID"),
        Some(DEFAULT_CLIENT_ID),
    ])
}

/// Where GitLab lives; tests point both at a local server.
#[derive(Clone, Debug)]
pub struct Endpoints {
    /// gitlab.com: the device flow and the token endpoint.
    pub web: String,
    /// gitlab.com/api/v4: the REST API.
    pub api: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            web: "https://gitlab.com".into(),
            api: "https://gitlab.com/api/v4".into(),
        }
    }
}

fn flow(endpoints: &Endpoints) -> Flow {
    Flow {
        provider: "GitLab",
        code_url: format!("{}/oauth/authorize_device", endpoints.web),
        token_url: format!("{}/oauth/token", endpoints.web),
        scope: SCOPE,
    }
}

pub async fn request_device_code(
    endpoints: &Endpoints,
    client_id: &str,
) -> Result<DeviceCode, String> {
    hosting::request_device_code(&flow(endpoints), client_id).await
}

pub async fn wait_for_tokens(
    endpoints: &Endpoints,
    client_id: &str,
    code: &DeviceCode,
    cancel: Arc<AtomicBool>,
    unit: Duration,
) -> Result<Tokens, String> {
    hosting::wait_for_tokens(&flow(endpoints), client_id, code, cancel, unit).await
}

pub async fn refresh(
    endpoints: &Endpoints,
    client_id: &str,
    refresh_token: &str,
) -> Result<Tokens, String> {
    hosting::refresh(&flow(endpoints), client_id, refresh_token).await
}

#[derive(Deserialize)]
struct User {
    username: String,
}

/// The signed-in user's username (`GET /user`).
pub async fn username_of(endpoints: &Endpoints, token: &str) -> Result<String, String> {
    let response = client()?
        .get(format!("{}/user", endpoints.api))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Could not reach GitLab: {e}"))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("GitLab does not accept this token".into());
    }
    if !response.status().is_success() {
        return Err(format!("GitLab answered {}", response.status()));
    }
    let user: User = response
        .json()
        .await
        .map_err(|e| format!("Unexpected answer from GitLab: {e}"))?;
    Ok(user.username)
}

#[derive(Deserialize)]
struct CreatedProject {
    http_url_to_repo: String,
}

/// `POST /projects`: a new, empty project; its HTTPS clone URL.
pub async fn create_project(
    endpoints: &Endpoints,
    token: &str,
    name: &str,
    private: bool,
) -> Result<String, String> {
    let name = hosting::check_repo_name(name)?;
    let response = client()?
        .post(format!("{}/projects", endpoints.api))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "name": name,
            "path": name,
            "visibility": if private { "private" } else { "public" },
            "initialize_with_readme": false,
            "description": "Written with Polemic",
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach GitLab: {e}"))?;
    let status = response.status();
    if status.is_success() {
        let project: CreatedProject = response
            .json()
            .await
            .map_err(|e| format!("Unexpected answer from GitLab: {e}"))?;
        return Ok(project.http_url_to_repo);
    }
    // GitLab's message is a string or a map of field → messages.
    let message = response
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|body| body.get("message").cloned())
        .map(|m| match m {
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        })
        .unwrap_or_default();
    Err(match status.as_u16() {
        401 => "GitLab does not accept this token: sign in again".into(),
        403 => "The GitLab token may not create projects: it needs the api scope".into(),
        400 if message.contains("has already been taken") => {
            format!("You already have a project named {name} on GitLab")
        }
        _ if !message.is_empty() => format!("GitLab refused: {message}"),
        _ => format!("GitLab answered {status}"),
    })
}

/// Publish a project: a new GitLab project, set as origin, then a push.
pub async fn publish_with(
    endpoints: &Endpoints,
    dir: &std::path::Path,
    username: &str,
    token: &str,
    name: &str,
    private: bool,
) -> Result<String, String> {
    hosting::check_can_publish(dir)?;
    let url = create_project(endpoints, token, name, private).await?;
    let credentials: Credentials = Some((username.to_string(), token.to_string()));
    hosting::push_to_new_remote(dir, &url, credentials).await?;
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git;
    use crate::github::tests::mock_server;

    fn endpoints(base: &str) -> Endpoints {
        Endpoints { web: base.to_string(), api: format!("{base}/api/v4") }
    }

    #[test]
    fn has_no_client_id_until_one_is_set() {
        assert_eq!(DEFAULT_CLIENT_ID, "");
        if std::env::var("POLEMIC_GITLAB_CLIENT_ID").is_err()
            && option_env!("POLEMIC_GITLAB_CLIENT_ID").is_none()
        {
            assert_eq!(client_id(), None);
        }
    }

    #[test]
    fn signs_in_with_the_api_scope_and_keeps_the_refresh_token() {
        let polls = Arc::new(std::sync::Mutex::new(0));
        let counter = polls.clone();
        let (base, seen) = mock_server(Box::new(move |r| match r.path.as_str() {
            "/oauth/authorize_device" => (200, r#"{"device_code":"dev","user_code":"WXYZ-1234","verification_uri":"https://gitlab.com/oauth/device","verification_uri_complete":"https://gitlab.com/oauth/device?user_code=WXYZ-1234","expires_in":300,"interval":1}"#.into()),
            "/oauth/token" => {
                let mut n = counter.lock().unwrap();
                *n += 1;
                if *n == 1 {
                    (400, r#"{"error":"authorization_pending","error_description":"..."}"#.into())
                } else {
                    (200, r#"{"access_token":"glo-a","token_type":"Bearer","expires_in":7200,"refresh_token":"glo-r","scope":"api"}"#.into())
                }
            }
            "/api/v4/user" => (200, r#"{"id":1,"username":"ada","name":"Ada"}"#.into()),
            _ => (404, "{}".into()),
        }));
        let e = endpoints(&base);
        let code = tauri::async_runtime::block_on(request_device_code(&e, "app")).unwrap();
        assert_eq!(code.user_code, "WXYZ-1234");
        let tokens = tauri::async_runtime::block_on(wait_for_tokens(
            &e,
            "app",
            &code,
            Arc::new(AtomicBool::new(false)),
            Duration::from_millis(5),
        ))
        .unwrap();
        assert_eq!(tokens.access_token, "glo-a");
        assert_eq!(tokens.refresh_token.as_deref(), Some("glo-r"));
        assert_eq!(tokens.expires_in, Some(7200));
        assert_eq!(tauri::async_runtime::block_on(username_of(&e, "glo-a")).unwrap(), "ada");
        let seen = seen.lock().unwrap();
        assert!(seen[0].body.contains("scope=api") && seen[0].body.contains("client_id=app"));
        assert!(seen.last().unwrap().headers.contains("Bearer glo-a"));
    }

    #[test]
    fn explains_a_taken_name_and_a_missing_scope() {
        let (base, _) = mock_server(Box::new(|r| {
            if r.body.contains("\"name\":\"taken\"") {
                (400, r#"{"message":{"name":["has already been taken"],"path":["has already been taken"]}}"#.into())
            } else {
                (403, r#"{"message":"403 Forbidden"}"#.into())
            }
        }));
        let e = endpoints(&base);
        let error = tauri::async_runtime::block_on(create_project(&e, "t", "taken", true)).unwrap_err();
        assert!(error.contains("already have a project named taken"), "{error}");
        let error = tauri::async_runtime::block_on(create_project(&e, "t", "other", true)).unwrap_err();
        assert!(error.contains("api scope"), "{error}");
    }

    /// Publish end to end: the API creates the project (a local bare
    /// repository stands in for GitLab's) and the commits arrive there.
    #[test]
    fn publishes_a_project_to_a_new_gitlab_project() {
        if !git::available() {
            return;
        }
        let root = std::env::temp_dir().join(format!("polemic-gl-publish-{}", std::process::id()));
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
        let answer = format!(r#"{{"id":7,"http_url_to_repo":"{bare_url}"}}"#);
        let (base, seen) = mock_server(Box::new(move |r| {
            if r.method == "POST" && r.path == "/api/v4/projects" {
                (201, answer.clone())
            } else {
                (404, "{}".into())
            }
        }));
        run(&project, &["init", "-q", "-b", "main"]);
        run(&project, &["config", "user.email", "t@example.com"]);
        run(&project, &["config", "user.name", "T"]);
        std::fs::write(project.join("main.tex"), "hello\n").unwrap();
        run(&project, &["add", "main.tex"]);
        run(&project, &["commit", "-qm", "first"]);

        let url = tauri::async_runtime::block_on(publish_with(
            &endpoints(&base),
            &project,
            OAUTH_USERNAME,
            "glo-a",
            "paper",
            true,
        ))
        .unwrap();
        assert_eq!(url, bare_url);
        assert_eq!(git::status(&project).upstream.as_deref(), Some("origin/main"));
        let request = &seen.lock().unwrap()[0];
        assert!(request.headers.contains("Bearer glo-a"));
        assert!(request.body.contains("\"visibility\":\"private\"") && request.body.contains("\"path\":\"paper\""));
        let _ = std::fs::remove_dir_all(root);
    }
}
