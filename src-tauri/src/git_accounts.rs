//! Git accounts: the token a private HTTPS remote wants (GitHub,
//! GitLab, Gitea, Overleaf's git bridge, any server). The host and
//! the username live in settings.json; the tokens in the OS credential
//! store, all under one "git-tokens" credential (a JSON map id → token),
//! never in the webview. SSH remotes need nothing here: git uses the
//! user's keys and agent.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::secrets::{OsStore, Store};
use crate::settings::GitAccount;

pub static STORE: OsStore = OsStore::new("git-tokens");

/// An account as the Settings page sees it: never the token itself.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitAccountView {
    pub id: String,
    pub host: String,
    pub username: String,
    pub has_token: bool,
}

type Tokens = BTreeMap<String, String>;

fn tokens(store: &impl Store) -> Tokens {
    store
        .get()
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn write(store: &impl Store, tokens: &Tokens) -> Result<(), String> {
    if tokens.is_empty() {
        return store.delete();
    }
    let json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    store.set(&json)
}

pub fn set_token_with(store: &impl Store, id: &str, token: &str) -> Result<(), String> {
    let mut map = tokens(store);
    map.insert(id.to_string(), token.to_string());
    write(store, &map)
        .map_err(|e| format!("Could not save the token in the system's credential store: {e}"))
}

pub fn remove_token_with(store: &impl Store, id: &str) -> Result<(), String> {
    let mut map = tokens(store);
    if map.remove(id).is_none() {
        return Ok(());
    }
    write(store, &map).map_err(|e| format!("Could not update the credential store: {e}"))
}

pub fn views_with(accounts: &[GitAccount], store: &impl Store) -> Vec<GitAccountView> {
    let map = tokens(store);
    accounts
        .iter()
        .map(|account| GitAccountView {
            id: account.id.clone(),
            host: account.host.clone(),
            username: account.username.clone(),
            has_token: map.contains_key(&account.id),
        })
        .collect()
}

/// A host as typed: "github.com", "https://gitlab.example.org/" or
/// "git.overleaf.com:443" all come out as the bare lowercase host.
pub fn normalize_host(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("The host is empty".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = url::Url::parse(&with_scheme)
        .map_err(|_| "The host should look like github.com".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "The host should look like github.com".to_string())?;
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Ok(format!("{}{port}", host.to_ascii_lowercase()))
}

/// The host (and port) an HTTP(S) remote URL points at; None for SSH
/// and local remotes, which take no token.
pub fn host_of(remote_url: &str) -> Option<String> {
    let url = url::Url::parse(remote_url.trim()).ok()?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return None;
    }
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Some(format!("{}{port}", url.host_str()?.to_ascii_lowercase()))
}

/// The account for a remote: the one on its host, preferring the one
/// whose username the URL names (https://ada@github.com/...).
pub fn account_for<'a>(accounts: &'a [GitAccount], remote_url: &str) -> Option<&'a GitAccount> {
    let host = host_of(remote_url)?;
    let named = url::Url::parse(remote_url.trim())
        .ok()
        .map(|u| u.username().to_string())
        .filter(|u| !u.is_empty());
    let on_host = accounts.iter().filter(|a| a.host == host);
    match named {
        Some(name) => on_host
            .clone()
            .find(|a| a.username == name)
            .or_else(|| accounts.iter().find(|a| a.host == host)),
        None => on_host.clone().next(),
    }
}

/// What git's credential prompt gets for a remote: (username, token).
pub fn credentials_with(
    accounts: &[GitAccount],
    remote_url: &str,
    store: &impl Store,
) -> Option<(String, String)> {
    let account = account_for(accounts, remote_url)?;
    let token = tokens(store).remove(&account.id)?;
    Some((account.username.clone(), token))
}

pub fn credentials_for(accounts: &[GitAccount], remote_url: &str) -> Option<(String, String)> {
    credentials_with(accounts, remote_url, &STORE)
}

/// A fresh account id.
pub fn new_id() -> Result<String, String> {
    let mut buf = [0u8; 8];
    getrandom::fill(&mut buf).map_err(|e| format!("no randomness available: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

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

    fn account(id: &str, host: &str, username: &str) -> GitAccount {
        GitAccount { id: id.into(), host: host.into(), username: username.into() }
    }

    #[test]
    fn normalizes_hosts() {
        assert_eq!(normalize_host("github.com").unwrap(), "github.com");
        assert_eq!(normalize_host(" https://GitLab.example.org/ ").unwrap(), "gitlab.example.org");
        assert_eq!(normalize_host("git.example.org:8443/x").unwrap(), "git.example.org:8443");
        assert!(normalize_host("").is_err());
        assert!(normalize_host("not a host").is_err());
    }

    #[test]
    fn only_http_remotes_have_a_host() {
        assert_eq!(host_of("https://github.com/ada/paper.git").as_deref(), Some("github.com"));
        assert_eq!(host_of("http://localhost:3000/ada/paper.git").as_deref(), Some("localhost:3000"));
        assert_eq!(host_of("git@github.com:ada/paper.git"), None);
        assert_eq!(host_of("ssh://git@github.com/ada/paper.git"), None);
        assert_eq!(host_of("file:///tmp/paper.git"), None);
    }

    #[test]
    fn picks_the_account_on_the_host_and_the_named_user() {
        let accounts = vec![
            account("1", "github.com", "ada"),
            account("2", "github.com", "bob"),
            account("3", "gitlab.com", "ada"),
        ];
        assert_eq!(account_for(&accounts, "https://github.com/x/y.git").unwrap().id, "1");
        assert_eq!(account_for(&accounts, "https://bob@github.com/x/y.git").unwrap().id, "2");
        // An unknown name on a known host still gets the host's account.
        assert_eq!(account_for(&accounts, "https://eve@github.com/x/y.git").unwrap().id, "1");
        assert_eq!(account_for(&accounts, "https://GITLAB.com/x/y.git").unwrap().id, "3");
        assert!(account_for(&accounts, "https://codeberg.org/x/y.git").is_none());
        assert!(account_for(&accounts, "git@github.com:x/y.git").is_none());
    }

    #[test]
    fn tokens_come_and_go_through_the_store() {
        let store = MemoryStore::default();
        let accounts = vec![account("1", "github.com", "ada"), account("2", "gitlab.com", "ada")];
        assert_eq!(credentials_with(&accounts, "https://github.com/x/y.git", &store), None);
        set_token_with(&store, "1", "ghp_secret").unwrap();
        set_token_with(&store, "2", "glpat-secret").unwrap();
        assert_eq!(
            credentials_with(&accounts, "https://github.com/x/y.git", &store),
            Some(("ada".into(), "ghp_secret".into()))
        );
        let views = views_with(&accounts, &store);
        assert!(views.iter().all(|v| v.has_token));
        remove_token_with(&store, "1").unwrap();
        assert_eq!(credentials_with(&accounts, "https://github.com/x/y.git", &store), None);
        assert_eq!(views_with(&accounts, &store)[0].has_token, false);
        remove_token_with(&store, "2").unwrap();
        assert!(store.get().unwrap().is_none(), "the credential goes with the last token");
        remove_token_with(&store, "missing").unwrap();
    }
}
