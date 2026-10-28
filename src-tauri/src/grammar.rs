//! Grammar and style checks of prose (the frontend extracts it from
//! LaTeX). Two engines: Harper, built in, offline, English only; and
//! LanguageTool, any language, either through a server the user
//! configures (one running locally, or the public service, opt-in like
//! the DOI lookup) or through the Polemic account's server, which
//! speaks LanguageTool's API under /api/grammar/v2 for Professional
//! accounts. Spelling stays with `spell`, so Harper's own spellcheck
//! rule is off. Offsets are UTF-16 code units, as JavaScript counts.

use harper_core::linting::LintGroup;
use harper_core::spell::FstDictionary;
use harper_core::{Dialect, Document};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GrammarIssue {
    /// Range in the block's text, UTF-16 code units.
    pub from: usize,
    pub to: usize,
    pub message: String,
    /// Stable rule id, for turning the rule off.
    pub rule: String,
    /// A broad category (Grammar, Punctuation, Style, …).
    pub category: String,
    /// Replacement texts for the range, best first.
    pub replacements: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GrammarRule {
    pub id: String,
    pub description: String,
}

/// Harper's rule ids that never apply here.
const HARPER_OFF: [&str; 1] = ["SpellCheck"];

/// UTF-16 offset of every char boundary in `text` (len = chars + 1).
fn utf16_offsets(text: &str) -> Vec<usize> {
    let mut out = Vec::with_capacity(text.len() + 1);
    let mut at = 0;
    out.push(0);
    for c in text.chars() {
        at += c.len_utf16();
        out.push(at);
    }
    out
}

pub struct Harper {
    group: LintGroup,
}

impl Harper {
    pub fn new(dialect: Dialect) -> Self {
        Self {
            group: LintGroup::new_curated(FstDictionary::curated(), dialect),
        }
    }

    /// Every rule with its description, for the settings.
    pub fn rules(&self) -> Vec<GrammarRule> {
        let mut rules: Vec<GrammarRule> = self
            .group
            .all_descriptions()
            .into_iter()
            .filter(|(id, _)| !HARPER_OFF.contains(id))
            .map(|(id, description)| GrammarRule {
                id: id.to_string(),
                description: description.to_string(),
            })
            .collect();
        rules.sort_by(|a, b| a.id.cmp(&b.id));
        rules
    }

    /// Issues per block, with the given rules switched off.
    pub fn check(&mut self, blocks: &[String], disabled: &[String]) -> Vec<Vec<GrammarIssue>> {
        let keys: Vec<String> = self.group.iter_keys().map(str::to_string).collect();
        for key in &keys {
            let off = HARPER_OFF.contains(&key.as_str()) || disabled.contains(key);
            if off {
                self.group.config.set_rule_enabled(key, false);
            } else {
                self.group.config.unset_rule_enabled(key);
            }
        }
        self.group.config.fill_with_curated();
        blocks
            .iter()
            .map(|text| {
                let document = Document::new_plain_english_curated(text);
                let offsets = utf16_offsets(text);
                let mut issues = Vec::new();
                for (rule, lints) in self.group.organized_lints(&document) {
                    for lint in lints {
                        let (Some(&from), Some(&to)) =
                            (offsets.get(lint.span.start), offsets.get(lint.span.end))
                        else {
                            continue;
                        };
                        let original: String =
                            text.chars().skip(lint.span.start).take(lint.span.end - lint.span.start).collect();
                        let replacements = lint
                            .suggestions
                            .iter()
                            .filter_map(|s| match s {
                                harper_core::linting::Suggestion::ReplaceWith(chars) => {
                                    Some(chars.iter().collect())
                                }
                                harper_core::linting::Suggestion::InsertAfter(chars) => {
                                    Some(format!("{original}{}", chars.iter().collect::<String>()))
                                }
                                harper_core::linting::Suggestion::Remove => Some(String::new()),
                            })
                            .collect();
                        issues.push(GrammarIssue {
                            from,
                            to,
                            message: lint.message,
                            rule: rule.clone(),
                            category: format!("{:?}", lint.lint_kind),
                            replacements,
                        });
                    }
                }
                issues.sort_by_key(|issue| (issue.from, issue.to));
                issues
            })
            .collect()
    }
}

/// The Harper dialect for a language setting ("en", "en-GB", …).
pub fn dialect_for(language: &str) -> Dialect {
    match language.to_ascii_lowercase().as_str() {
        "en-gb" => Dialect::British,
        "en-au" => Dialect::Australian,
        "en-ca" => Dialect::Canadian,
        "en-in" => Dialect::Indian,
        _ => Dialect::American,
    }
}

// --- LanguageTool ------------------------------------------------------------

#[derive(Deserialize)]
struct LtResponse {
    matches: Vec<LtMatch>,
}

#[derive(Deserialize)]
struct LtMatch {
    message: String,
    offset: usize,
    length: usize,
    replacements: Vec<LtReplacement>,
    rule: LtRule,
}

#[derive(Deserialize)]
struct LtReplacement {
    value: String,
}

#[derive(Deserialize)]
struct LtRule {
    id: String,
    category: LtCategory,
}

#[derive(Deserialize)]
struct LtCategory {
    name: String,
}

/// The blank line joining blocks into one request (fewer requests,
/// within the public service's rate limits).
const SEPARATOR: &str = "\n\n";

/// Join blocks into one text; returns it and each block's UTF-16 start.
fn join_blocks(blocks: &[String]) -> (String, Vec<usize>) {
    let mut text = String::new();
    let mut starts = Vec::with_capacity(blocks.len());
    for (i, block) in blocks.iter().enumerate() {
        if i > 0 {
            text.push_str(SEPARATOR);
        }
        starts.push(text.encode_utf16().count());
        text.push_str(block);
    }
    (text, starts)
}

/// Split LanguageTool matches (offsets in the joined text, UTF-16, as
/// Java counts) back into per-block issues.
fn split_matches(matches: Vec<LtMatch>, blocks: &[String], starts: &[usize]) -> Vec<Vec<GrammarIssue>> {
    let mut out: Vec<Vec<GrammarIssue>> = vec![Vec::new(); blocks.len()];
    for m in matches {
        let Some(index) = starts.iter().rposition(|&start| start <= m.offset) else {
            continue;
        };
        let from = m.offset - starts[index];
        let to = from + m.length;
        if to > blocks[index].encode_utf16().count() {
            continue; // spans the separator
        }
        out[index].push(GrammarIssue {
            from,
            to,
            message: m.message,
            rule: m.rule.id,
            category: m.rule.category.name,
            replacements: m.replacements.into_iter().take(5).map(|r| r.value).collect(),
        });
    }
    out
}

/// Which checker runs (settings `grammar.provider`).
#[derive(Debug, PartialEq)]
pub enum Provider<'a> {
    /// Harper, built in.
    Builtin,
    /// LanguageTool on the Polemic account's server (Professional).
    Polemic,
    /// The user's own LanguageTool server, up to /v2.
    LanguageTool(&'a str),
}

/// The provider for the settings. Without an explicit choice (settings
/// from before the Polemic provider), a LanguageTool URL picks it.
pub fn provider(settings: &crate::settings::GrammarSettings) -> Provider<'_> {
    let url = settings.language_tool_url.as_deref();
    match (settings.provider.as_deref(), url) {
        (Some("polemic"), _) => Provider::Polemic,
        (Some("builtin"), _) => Provider::Builtin,
        (_, Some(url)) => Provider::LanguageTool(url),
        (_, None) => Provider::Builtin,
    }
}

/// The provider names `grammar.provider` accepts.
pub const PROVIDERS: [&str; 3] = ["builtin", "polemic", "languagetool"];

/// Where LanguageTool checks go.
pub struct Endpoint<'a> {
    /// Up to /v2: the user's server, or `<account server>/api/grammar/v2`.
    pub base_url: &'a str,
    /// The account token. Only ever set for the account's own server:
    /// it must not reach a LanguageTool URL the user typed.
    pub bearer: Option<&'a str>,
    /// Most UTF-16 units per request; longer checks are split.
    pub max_chars: usize,
}

/// The Polemic server's limit per check (GRAMMAR_MAX_CHARS).
pub const POLEMIC_MAX_CHARS: usize = 100_000;

/// Why a check failed, for the grammar status in the UI.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GrammarErrorKind {
    /// No account token, or the server no longer accepts it.
    SignedOut,
    /// The account is on the free plan.
    PlanRequired,
    /// A check was longer than the server takes.
    TooLong,
    /// Too many checks; `retry_after` says when to try again.
    RateLimited,
    /// The server can't check right now (or has no grammar service).
    Unavailable,
    Failed,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GrammarError {
    pub kind: GrammarErrorKind,
    pub message: String,
    /// Seconds, for `RateLimited`.
    pub retry_after: Option<u64>,
}

impl GrammarError {
    pub fn new(kind: GrammarErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after: None,
        }
    }

    pub fn signed_out() -> Self {
        Self::new(
            GrammarErrorKind::SignedOut,
            "Sign in to your Polemic account to check grammar with Polemic.",
        )
    }
}

impl From<String> for GrammarError {
    fn from(message: String) -> Self {
        Self::new(GrammarErrorKind::Failed, message)
    }
}

/// How long to wait when a 429 carries no usable Retry-After.
const DEFAULT_RETRY_AFTER: u64 = 60;

/// Until when a server asked us to wait (429), by base URL. Checks in
/// that time fail at once instead of hitting the server again.
static BACKOFF: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn backoff_remaining(base_url: &str) -> Option<u64> {
    let guard = BACKOFF.lock().ok()?;
    let (url, until) = guard.as_ref()?;
    let left = until.checked_duration_since(Instant::now())?;
    (url == base_url).then(|| left.as_secs().max(1))
}

fn back_off(base_url: &str, seconds: u64) {
    if let Ok(mut guard) = BACKOFF.lock() {
        *guard = Some((base_url.to_string(), Instant::now() + Duration::from_secs(seconds)));
    }
}

fn rate_limited(seconds: u64) -> GrammarError {
    GrammarError {
        retry_after: Some(seconds),
        ..GrammarError::new(
            GrammarErrorKind::RateLimited,
            format!("Too many grammar checks. Checking again in {seconds} s."),
        )
    }
}

/// The error for a non-2xx answer. `polemic`: the answer came from a
/// Polemic server (401 and 402 are about the account, 404 means it
/// has no grammar service). LanguageTool's own 4xx answers are plain
/// text and pass through as the message.
fn error_for(status: u16, retry_after: Option<&str>, body: &str, polemic: bool) -> GrammarError {
    use GrammarErrorKind::*;
    let unavailable = || {
        GrammarError::new(
            Unavailable,
            if polemic {
                "Polemic grammar checking is unavailable right now."
            } else {
                "The LanguageTool server is unavailable right now."
            },
        )
    };
    match status {
        401 if polemic => GrammarError::signed_out(),
        402 if polemic => GrammarError::new(
            PlanRequired,
            "Grammar checking with Polemic needs Polemic Professional.",
        ),
        404 if polemic => GrammarError::new(
            Unavailable,
            "This Polemic server has no grammar checking.",
        ),
        413 => GrammarError::new(TooLong, "A paragraph is too long to check."),
        429 => rate_limited(
            retry_after
                .and_then(|v| v.trim().parse::<u64>().ok())
                .unwrap_or(DEFAULT_RETRY_AFTER)
                .clamp(1, 3600),
        ),
        500..=599 => unavailable(),
        _ => {
            let text = body.trim();
            let message = if text.is_empty() || text.starts_with('<') || text.starts_with('{') {
                format!("LanguageTool answered {status}")
            } else {
                format!("LanguageTool: {}", text.chars().take(300).collect::<String>())
            };
            GrammarError::new(Failed, message)
        }
    }
}

/// Groups block indices into requests of at most `max` UTF-16 units
/// once joined. A block longer than `max` on its own is left out (it
/// gets no issues rather than failing the whole check).
fn chunk_blocks(blocks: &[String], max: usize) -> Vec<Vec<usize>> {
    let separator = SEPARATOR.encode_utf16().count();
    let mut chunks: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut length = 0;
    for (i, block) in blocks.iter().enumerate() {
        let size = block.encode_utf16().count();
        if size > max {
            continue;
        }
        let added = if current.is_empty() { size } else { separator + size };
        if length + added > max {
            chunks.push(std::mem::take(&mut current));
            length = size;
        } else {
            length += added;
        }
        current.push(i);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// One /check request; the matches in the joined text.
async fn request_check(
    client: &reqwest::Client,
    endpoint: &Endpoint<'_>,
    language: &str,
    text: String,
    disabled: &[String],
) -> Result<Vec<LtMatch>, GrammarError> {
    let base = endpoint.base_url.trim().trim_end_matches('/');
    let polemic = endpoint.bearer.is_some();
    if let Some(seconds) = backoff_remaining(base) {
        return Err(rate_limited(seconds));
    }
    let mut form: HashMap<&str, String> = HashMap::new();
    form.insert("text", text);
    form.insert("language", language.to_string());
    if !disabled.is_empty() {
        form.insert("disabledRules", disabled.join(","));
    }
    let mut request = client.post(format!("{base}/check")).form(&form);
    if let Some(token) = endpoint.bearer {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|e| {
        if polemic {
            GrammarError::new(
                GrammarErrorKind::Unavailable,
                "Could not reach the Polemic server.",
            )
        } else {
            GrammarError::new(
                GrammarErrorKind::Unavailable,
                format!("LanguageTool is not reachable: {e}"),
            )
        }
    })?;
    let status = response.status();
    if !status.is_success() {
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let body = response.text().await.unwrap_or_default();
        let error = error_for(status.as_u16(), retry_after.as_deref(), &body, polemic);
        if let Some(seconds) = error.retry_after {
            back_off(base, seconds);
        }
        return Err(error);
    }
    let body: LtResponse = response
        .json()
        .await
        .map_err(|e| GrammarError::from(format!("unexpected LanguageTool answer: {e}")))?;
    Ok(body.matches)
}

/// Check blocks with a LanguageTool server: blocks joined by blank
/// lines, in as few requests as the endpoint's limit allows.
pub async fn check_languagetool(
    endpoint: &Endpoint<'_>,
    language: &str,
    blocks: &[String],
    disabled: &[String],
) -> Result<Vec<Vec<GrammarIssue>>, GrammarError> {
    crate::ai::check_service_url(endpoint.base_url, "the LanguageTool URL")?;
    let mut out: Vec<Vec<GrammarIssue>> = vec![Vec::new(); blocks.len()];
    if blocks.is_empty() {
        return Ok(out);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("Polemic/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    for chunk in chunk_blocks(blocks, endpoint.max_chars) {
        let part: Vec<String> = chunk.iter().map(|&i| blocks[i].clone()).collect();
        let (text, starts) = join_blocks(&part);
        let matches = request_check(&client, endpoint, language, text, disabled).await?;
        for (issues, &i) in split_matches(matches, &part, &starts).into_iter().zip(&chunk) {
            out[i] = issues;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harper_finds_grammar_but_not_spelling() {
        let mut harper = Harper::new(Dialect::American);
        let blocks = vec![
            "This is an test of the the checker.".to_string(),
            "Zorglub writes well.".to_string(),
        ];
        let issues = harper.check(&blocks, &[]);
        assert!(issues[0].iter().any(|i| i.replacements.iter().any(|r| r == "a")));
        assert!(issues[0].iter().all(|i| i.rule != "SpellCheck"));
        assert!(issues[1].is_empty(), "{:?}", issues[1]);
    }

    #[test]
    fn harper_rules_can_be_switched_off() {
        let mut harper = Harper::new(Dialect::American);
        let blocks = vec!["This is an test.".to_string()];
        let rule = harper.check(&blocks, &[])[0][0].rule.clone();
        assert!(harper.check(&blocks, &[rule.clone()])[0].iter().all(|i| i.rule != rule));
        // And back on.
        assert!(harper.check(&blocks, &[])[0].iter().any(|i| i.rule == rule));
        assert!(harper.rules().iter().any(|r| r.id == rule));
    }

    #[test]
    fn offsets_count_utf16_units() {
        let mut harper = Harper::new(Dialect::American);
        let text = "Ünïcode 😀 is an test.".to_string();
        let issue = harper.check(&[text.clone()], &[])[0][0].clone();
        let units: Vec<u16> = text.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[issue.from..issue.to]).unwrap(), "an");
    }

    #[test]
    fn languagetool_matches_split_back_into_blocks() {
        let blocks = vec!["One é.".to_string(), "Two two.".to_string()];
        let (text, starts) = join_blocks(&blocks);
        assert_eq!(text, "One é.\n\nTwo two.");
        assert_eq!(starts, vec![0, 8]);
        let m = |offset, length| LtMatch {
            message: "m".into(),
            offset,
            length,
            replacements: vec![LtReplacement { value: "x".into() }],
            rule: LtRule { id: "R".into(), category: LtCategory { name: "C".into() } },
        };
        let issues = split_matches(vec![m(4, 1), m(8, 7), m(5, 4)], &blocks, &starts);
        assert_eq!((issues[0][0].from, issues[0][0].to), (4, 5));
        assert_eq!((issues[1][0].from, issues[1][0].to), (0, 7));
        assert_eq!(issues[0].len() + issues[1].len(), 2, "the separator-spanning match is dropped");
    }

    #[test]
    fn provider_follows_the_choice_then_the_url() {
        use crate::settings::GrammarSettings;
        let with = |provider: Option<&str>, url: Option<&str>| GrammarSettings {
            provider: provider.map(str::to_string),
            language_tool_url: url.map(str::to_string),
            ..Default::default()
        };
        assert_eq!(provider(&with(None, None)), Provider::Builtin);
        assert_eq!(provider(&with(None, Some("https://lt"))), Provider::LanguageTool("https://lt"));
        assert_eq!(provider(&with(Some("builtin"), Some("https://lt"))), Provider::Builtin);
        assert_eq!(provider(&with(Some("polemic"), Some("https://lt"))), Provider::Polemic);
        assert_eq!(provider(&with(Some("languagetool"), None)), Provider::Builtin);
    }

    #[test]
    fn long_checks_are_split_below_the_limit() {
        let blocks: Vec<String> = ["aaaa", "bb", "cccccc", "dd", "é"].map(String::from).to_vec();
        // Joined with "\n\n": aaaa+bb = 8, +cccccc would be 16.
        assert_eq!(chunk_blocks(&blocks, 10), vec![vec![0, 1], vec![2, 3], vec![4]]);
        // A block over the limit on its own is left out.
        assert_eq!(chunk_blocks(&blocks, 5), vec![vec![0], vec![1], vec![3, 4]]);
        assert_eq!(chunk_blocks(&blocks, usize::MAX), vec![vec![0, 1, 2, 3, 4]]);
        assert!(chunk_blocks(&[], 10).is_empty());
    }

    #[test]
    fn maps_server_answers_to_states() {
        use GrammarErrorKind::*;
        let kind = |status, polemic| error_for(status, None, "", polemic).kind;
        assert_eq!(kind(401, true), SignedOut);
        assert_eq!(kind(402, true), PlanRequired);
        assert_eq!(kind(404, true), Unavailable);
        assert_eq!(kind(413, true), TooLong);
        assert_eq!(kind(502, true), Unavailable);
        assert_eq!(kind(503, false), Unavailable);
        // Not about an account on the user's own server.
        assert_eq!(kind(401, false), Failed);
        let limited = error_for(429, Some("17"), "", true);
        assert_eq!((limited.kind, limited.retry_after), (RateLimited, Some(17)));
        assert_eq!(error_for(429, Some("soon"), "", true).retry_after, Some(DEFAULT_RETRY_AFTER));
        // LanguageTool's own 4xx text passes through.
        let bad = error_for(400, None, "Error: 'xx' is not a language code", true);
        assert_eq!(bad.kind, Failed);
        assert!(bad.message.contains("'xx' is not a language code"));
        assert_eq!(error_for(400, None, "{\"error\":\"x\"}", true).message, "LanguageTool answered 400");
    }

    // --- against a stub server ---

    use std::io::{Read, Write};
    use std::net::TcpListener;

    struct Seen {
        authorization: Option<String>,
        form: HashMap<String, String>,
    }

    /// Serves one canned answer per request, in order; returns the port
    /// and what each request carried.
    fn stub(answers: Vec<String>) -> (u16, std::thread::JoinHandle<Vec<Seen>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for answer in answers {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = Vec::new();
                let mut chunk = [0u8; 8192];
                let (head_end, length) = loop {
                    let n = stream.read(&mut chunk).unwrap();
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(at) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..at]).to_ascii_lowercase();
                        let length = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .map_or(0, |v| v.trim().parse().unwrap());
                        break (at + 4, length);
                    }
                };
                while buf.len() < head_end + length {
                    let n = stream.read(&mut chunk).unwrap();
                    buf.extend_from_slice(&chunk[..n]);
                }
                let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                let authorization = head.lines().find_map(|l| {
                    let (name, value) = l.split_once(':')?;
                    name.eq_ignore_ascii_case("authorization").then(|| value.trim().to_string())
                });
                let form = url::form_urlencoded::parse(&buf[head_end..head_end + length])
                    .into_owned()
                    .collect();
                seen.push(Seen { authorization, form });
                stream.write_all(answer.as_bytes()).unwrap();
            }
            seen
        });
        (port, handle)
    }

    fn answer(status: &str, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn json(body: &str) -> String {
        answer("200 OK", "Content-Type: application/json\r\n", body)
    }

    fn check(base: &str, bearer: Option<&str>, max: usize, blocks: &[&str]) -> Result<Vec<Vec<GrammarIssue>>, GrammarError> {
        let blocks: Vec<String> = blocks.iter().map(|b| b.to_string()).collect();
        let endpoint = Endpoint { base_url: base, bearer, max_chars: max };
        tauri::async_runtime::block_on(check_languagetool(&endpoint, "en-US", &blocks, &["R1".into()]))
    }

    const MATCH: &str = r#"{"matches":[{"message":"m","offset":0,"length":2,"replacements":[{"value":"x"}],"rule":{"id":"R","category":{"name":"C"}}}]}"#;

    #[test]
    fn polemic_checks_send_the_token_and_split_long_texts() {
        let (port, server) = stub(vec![json(MATCH), json(MATCH)]);
        let base = format!("http://127.0.0.1:{port}/api/grammar/v2");
        let issues = check(&base, Some("tok"), 10, &["aaaa", "bb", "cccccc"]).unwrap();
        // Each request's first match lands on its first block.
        assert_eq!(issues[0].len(), 1);
        assert!(issues[1].is_empty());
        assert_eq!((issues[2][0].from, issues[2][0].to), (0, 2));
        let seen = server.join().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0].form["text"], "aaaa\n\nbb");
        assert_eq!(seen[1].form["text"], "cccccc");
        assert_eq!(seen[0].form["language"], "en-US");
        assert_eq!(seen[0].form["disabledRules"], "R1");
        assert!(seen.iter().all(|s| s.authorization.as_deref() == Some("Bearer tok")));
    }

    #[test]
    fn own_servers_never_get_a_token() {
        let (port, server) = stub(vec![json(r#"{"matches":[]}"#)]);
        let issues = check(&format!("http://127.0.0.1:{port}/v2"), None, usize::MAX, &["Hi."]).unwrap();
        assert_eq!(issues, vec![Vec::new()]);
        assert_eq!(server.join().unwrap()[0].authorization, None);
    }

    #[test]
    fn polemic_errors_become_states() {
        let error = |status: &str, headers: &str, body: &str| {
            let (port, server) = stub(vec![answer(status, headers, body)]);
            let base = format!("http://127.0.0.1:{port}/api/grammar/v2");
            let result = check(&base, Some("tok"), POLEMIC_MAX_CHARS, &["Text."]);
            server.join().unwrap();
            result.unwrap_err()
        };
        let problem = "Content-Type: application/json\r\n";
        use GrammarErrorKind::*;
        assert_eq!(error("401 Unauthorized", problem, r#"{"error":"unauthorized","message":"Sign in"}"#).kind, SignedOut);
        assert_eq!(error("402 Payment Required", problem, r#"{"error":"plan_required","message":"x"}"#).kind, PlanRequired);
        assert_eq!(error("413 Payload Too Large", problem, r#"{"error":"text_too_long","message":"x"}"#).kind, TooLong);
        assert_eq!(error("502 Bad Gateway", problem, r#"{"error":"grammar_unavailable","message":"x"}"#).kind, Unavailable);
        assert_eq!(error("404 Not Found", problem, r#"{"error":"grammar_disabled","message":"x"}"#).kind, Unavailable);
        let bad = error("400 Bad Request", "Content-Type: text/plain\r\n", "Error: 'xx' is not a language code");
        assert_eq!(bad.kind, Failed);
        assert!(bad.message.contains("not a language code"));
    }

    #[test]
    fn rate_limits_are_honoured_without_retrying() {
        let (port, server) = stub(vec![answer(
            "429 Too Many Requests",
            "Retry-After: 30\r\nContent-Type: application/json\r\n",
            r#"{"error":"rate_limited","message":"x"}"#,
        )]);
        let base = format!("http://127.0.0.1:{port}/api/grammar/v2");
        let first = check(&base, Some("tok"), POLEMIC_MAX_CHARS, &["Text."]).unwrap_err();
        assert_eq!((first.kind, first.retry_after), (GrammarErrorKind::RateLimited, Some(30)));
        assert_eq!(server.join().unwrap().len(), 1);
        // The stub is gone: a second request would fail as unreachable.
        let second = check(&base, Some("tok"), POLEMIC_MAX_CHARS, &["Text."]).unwrap_err();
        assert_eq!(second.kind, GrammarErrorKind::RateLimited);
        assert!(second.retry_after.is_some_and(|s| (1..=30).contains(&s)));
    }

    #[test]
    fn unreachable_servers_are_unavailable() {
        let port = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
        let error = check(&format!("http://127.0.0.1:{port}/api/grammar/v2"), Some("tok"), 10, &["Text."]).unwrap_err();
        assert_eq!(error.kind, GrammarErrorKind::Unavailable);
    }

    /// Against a running Polemic server with managed grammar and a
    /// desktop token (see account's e2e test for getting one). With
    /// POLEMIC_E2E_EXPECT=planRequired, the account is on the free plan.
    ///
    /// POLEMIC_E2E_SERVER=http://localhost:4000 POLEMIC_E2E_TOKEN=… cargo test e2e_polemic -- --ignored
    #[test]
    #[ignore]
    fn e2e_polemic_grammar() {
        let server = std::env::var("POLEMIC_E2E_SERVER").expect("POLEMIC_E2E_SERVER");
        let token = std::env::var("POLEMIC_E2E_TOKEN").expect("POLEMIC_E2E_TOKEN");
        let base = format!("{server}/api/grammar/v2");
        let blocks = ["This is an test.", "Ünïcode 😀 is an test too."];
        let result = check(&base, Some(&token), POLEMIC_MAX_CHARS, &blocks);
        if std::env::var("POLEMIC_E2E_EXPECT").as_deref() == Ok("planRequired") {
            assert_eq!(result.unwrap_err().kind, GrammarErrorKind::PlanRequired);
        } else {
            let issues = result.unwrap();
            for (block, found) in blocks.iter().zip(&issues) {
                let units: Vec<u16> = block.encode_utf16().collect();
                let marked: Vec<String> =
                    found.iter().map(|i| String::from_utf16(&units[i.from..i.to]).unwrap()).collect();
                assert!(marked.iter().any(|m| m == "an"), "{block}: {marked:?}");
            }
        }
        let wrong = check(&base, Some("not-a-token"), POLEMIC_MAX_CHARS, &blocks).unwrap_err();
        assert_eq!(wrong.kind, GrammarErrorKind::SignedOut);
    }
}
