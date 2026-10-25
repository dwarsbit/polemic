//! DOI/arXiv import transport: one GET to doi.org with content
//! negotiation, which answers with BibTeX for Crossref and DataCite
//! DOIs (arXiv preprints have DataCite DOIs, 10.48550/arXiv.<id>).
//! Runs Rust-side so it needs no webview CSP exception, and only when
//! the user has switched online lookup on in Settings > Bibliography.

use std::time::Duration;

use tauri::Manager;

use crate::settings::SettingsState;

/// A DOI is `10.<registrant>/<suffix>`; the suffix may hold most
/// printable ASCII, but never whitespace or control characters. The
/// check keeps the value safe to put into a URL path.
pub fn check_doi(doi: &str) -> Result<(), String> {
    let valid = doi.starts_with("10.")
        && doi.contains('/')
        && doi.len() <= 200
        && doi
            .chars()
            .all(|c| c.is_ascii_graphic() && !matches!(c, '?' | '#' | '\\' | '"' | '<' | '>'));
    if valid {
        Ok(())
    } else {
        Err("that is not a valid DOI".into())
    }
}

/// Percent-encode everything in a DOI that is not URL-path safe;
/// slashes stay, as doi.org expects them.
fn encode_doi(doi: &str) -> String {
    doi.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric()
                || matches!(c, '/' | '-' | '.' | '_' | '~' | ':' | ';' | '(' | ')')
            {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}

/// Fetch the BibTeX record of one DOI. Refuses unless the user has
/// opted in to online lookups.
#[tauri::command]
pub async fn lookup_bibtex(app: tauri::AppHandle, doi: String) -> Result<String, String> {
    let enabled = app
        .state::<SettingsState>()
        .0
        .lock()
        .map_err(|_| "settings are unavailable".to_string())?
        .online_lookup
        .unwrap_or(false);
    if !enabled {
        return Err("online lookup is off: enable it in Settings > Bibliography".into());
    }
    check_doi(&doi)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Polemic (https://github.com/dwarsbit/polemic)")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("https://doi.org/{}", encode_doi(&doi)))
        .header("Accept", "application/x-bibtex; charset=utf-8")
        .send()
        .await
        .map_err(|e| format!("the lookup failed: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("no record found for that identifier".into());
    }
    if !status.is_success() {
        return Err(format!("the lookup failed ({status})"));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("the lookup failed: {e}"))?;
    if !body.trim_start().starts_with('@') {
        return Err("the registry returned no BibTeX for that identifier".into());
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_real_dois() {
        assert!(check_doi("10.1145/3292500.3330701").is_ok());
        assert!(check_doi("10.48550/arXiv.1706.03762").is_ok());
    }

    #[test]
    fn rejects_unsafe_values() {
        assert!(check_doi("not a doi").is_err());
        assert!(check_doi("10.1000/abc def").is_err());
        assert!(check_doi("10.1000/abc?x=1").is_err());
        assert!(check_doi("10.1000/abc\r\nHost: x").is_err());
        assert!(check_doi("11.1000/abc").is_err());
        assert!(check_doi("10.1002/x<693>").is_err());
    }

    #[test]
    fn encodes_path_unsafe_characters() {
        assert_eq!(encode_doi("10.1000/a+b[1]"), "10.1000/a%2Bb%5B1%5D");
    }
}
