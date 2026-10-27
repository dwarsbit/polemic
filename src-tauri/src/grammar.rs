//! Grammar and style checks of prose (the frontend extracts it from
//! LaTeX). Two engines: Harper, built in, offline, English only; and
//! LanguageTool, any language, through a server the user configures
//! (one running locally, or the public service, opt-in like the DOI
//! lookup). Spelling stays with `spell`, so Harper's own spellcheck
//! rule is off. Offsets are UTF-16 code units, as JavaScript counts.

use harper_core::linting::LintGroup;
use harper_core::spell::FstDictionary;
use harper_core::{Dialect, Document};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

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

/// Check blocks with a LanguageTool server (`base_url` up to `/v2`).
pub async fn check_languagetool(
    base_url: &str,
    language: &str,
    blocks: &[String],
    disabled: &[String],
) -> Result<Vec<Vec<GrammarIssue>>, String> {
    crate::ai::check_service_url(base_url, "the LanguageTool URL")?;
    if blocks.is_empty() {
        return Ok(Vec::new());
    }
    let (text, starts) = join_blocks(blocks);
    let url = format!("{}/check", base_url.trim().trim_end_matches('/'));
    let mut form: HashMap<&str, String> = HashMap::new();
    form.insert("text", text);
    form.insert("language", language.to_string());
    if !disabled.is_empty() {
        form.insert("disabledRules", disabled.join(","));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(url)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("LanguageTool is not reachable: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("LanguageTool answered {}", response.status()));
    }
    let body: LtResponse = response
        .json()
        .await
        .map_err(|e| format!("unexpected LanguageTool answer: {e}"))?;
    Ok(split_matches(body.matches, blocks, &starts))
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
}
