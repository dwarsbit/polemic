use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompileIssue {
    /// "error" | "warning"
    pub severity: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub message: String,
    /// The context block TeX prints right after an error: the
    /// `l.12 \frrac` line (the source up to the point of the error)
    /// plus its wrapped continuation lines. Empty for warnings and
    /// errors without a context block.
    pub detail: Vec<String>,
    /// What to do about it, for issues whose message alone does not
    /// say (a crashed biber, a missing .bib file).
    pub hint: Option<String>,
}

/// Parse an error line produced by pdflatex with -file-line-error,
/// e.g. `./chapters/intro.tex:12: Undefined control sequence.`
fn parse_file_line_error(line: &str) -> Option<(String, u32, String)> {
    let rest = line.strip_prefix("./")?;
    let idx = rest.find(": ")?;
    let (loc, message) = (&rest[..idx], &rest[idx + 2..]);
    let (file, num) = loc.rsplit_once(':')?;
    let line_no = num.parse::<u32>().ok()?;
    Some((file.to_string(), line_no, message.to_string()))
}

/// The context line TeX prints after an error: `l.12 ...` with the
/// source line up to the point where the error occurred.
fn context_line_no(detail_line: &str) -> Option<u32> {
    let rest = detail_line.strip_prefix('l')?;
    let rest = rest.strip_prefix('.')?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u32>().ok()
}

/// The error context block: the `l.N` line, when it follows the
/// error directly or after one `<inserted text>`-style line, plus
/// its indented continuation lines. Returns the block and the index
/// of the first unconsumed line.
fn detail_from(lines: &[&str], start: usize) -> (Vec<String>, usize) {
    let is_context_line = |l: &str| {
        let Some(rest) = l.strip_prefix('l') else {
            return false;
        };
        let Some(rest) = rest.strip_prefix('.') else {
            return false;
        };
        rest.chars().next().is_some_and(|c| c.is_ascii_digit())
    };
    let mut ctx_at = None;
    if start < lines.len() && is_context_line(lines[start]) {
        ctx_at = Some(start);
    } else if start + 1 < lines.len()
        && lines[start].starts_with('<')
        && is_context_line(lines[start + 1])
    {
        ctx_at = Some(start + 1);
    }
    let Some(at) = ctx_at else {
        return (Vec::new(), start);
    };
    let mut detail = vec![lines[at].to_string()];
    let mut i = at + 1;
    while i < lines.len() && lines[i].starts_with(' ') && detail.len() < 4 {
        detail.push(lines[i].to_string());
        i += 1;
    }
    (detail, i)
}

/// `... on input line 4.` trailing location of LaTeX warnings.
fn warning_line(message: &str) -> Option<u32> {
    let idx = message.rfind("on input line ")?;
    let rest = &message[idx + "on input line ".len()..];
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let n = digits.parse::<u32>().ok()?;
    // The sentence ends with `.`; anything else means we grabbed
    // prose, not a line number.
    let after = &rest[digits.len()..];
    if after.is_empty() || after.starts_with('.') {
        Some(n)
    } else {
        None
    }
}

pub fn parse_issues(log_text: &str) -> Vec<CompileIssue> {
    let lines: Vec<&str> = log_text.lines().map(|l| l.trim_end()).collect();
    let mut issues = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.is_empty() {
            i += 1;
            continue;
        }
        let mut issue = None;
        if let Some((file, line_no, message)) = parse_file_line_error(line) {
            issue = Some(CompileIssue {
                severity: "error".into(),
                file: Some(file),
                line: Some(line_no),
                message,
                detail: Vec::new(),
                hint: None,
            });
        } else if let Some(rest) = line.strip_prefix('!') {
            issue = Some(CompileIssue {
                severity: "error".into(),
                file: None,
                line: None,
                message: rest.trim().to_string(),
                detail: Vec::new(),
                hint: None,
            });
        } else {
            let is_latex_warning = line.starts_with("LaTeX") && line.contains("Warning:");
            let is_package_warning = line.starts_with("Package ") && line.contains(" Warning:");
            if is_latex_warning || is_package_warning {
                let message = line.trim_end_matches('.');
                issue = Some(CompileIssue {
                    severity: "warning".into(),
                    file: None,
                    line: warning_line(message),
                    message: message.to_string(),
                    detail: Vec::new(),
                    hint: None,
                });
            }
        }
        if let Some(mut issue) = issue {
            let mut next = i + 1;
            if issue.severity == "error" {
                let (detail, consumed) = detail_from(&lines, next);
                if !detail.is_empty() {
                    if issue.line.is_none() {
                        if let Some(n) = context_line_no(&detail[0]) {
                            issue.line = Some(n);
                        }
                    }
                    issue.detail = detail;
                }
                next = consumed.max(next);
            }
            issues.push(issue);
            i = next;
            continue;
        }
        i += 1;
    }
    issues
}

/// The bibliography tool latexmk ran for the document.
#[derive(Clone, Copy, PartialEq, Debug)]
enum BibTool {
    Biber,
    Bibtex,
}

impl BibTool {
    fn name(self) -> &'static str {
        match self {
            BibTool::Biber => "biber",
            BibTool::Bibtex => "BibTeX",
        }
    }
}

/// Which bibliography tool failed, judging by latexmk's own report:
/// an error return, errors in the .blg, or no .blg at all. Rules are
/// named after the command (`biber build/main`, `bibtex build/main`).
fn failed_bib_tool(latexmk_output: &str) -> Option<BibTool> {
    for line in latexmk_output.lines() {
        let line = line.trim();
        let rule = line
            .strip_prefix("Latexmk: Error return from '")
            .map(|rest| rest.to_ascii_lowercase());
        let lower = line.to_ascii_lowercase();
        let says = |tool: &str| {
            rule.as_deref().is_some_and(|r| r.starts_with(tool))
                || lower.starts_with(&format!("{tool} errors: see file"))
                || lower.starts_with(&format!("could not open {tool} log file"))
                || lower.starts_with(&format!("could not find all {tool} source files"))
        };
        if says("biber") {
            return Some(BibTool::Biber);
        }
        // bibtex8 and upbibtex share BibTeX's rule name prefix.
        if says("bibtex") || rule.as_deref().is_some_and(|r| r.contains("bibtex")) {
            return Some(BibTool::Bibtex);
        }
    }
    None
}

/// The tool's own complaint: ERROR lines from biber's .blg, the error
/// messages from BibTeX's .blg (with the .bib location BibTeX gives
/// after them), or what the tool printed when it died before writing
/// a .blg (a crash, or a shell that could not find it).
fn bib_tool_reasons(
    tool: BibTool,
    latexmk_output: &str,
    blg: Option<&str>,
) -> Vec<(String, Option<(String, u32)>)> {
    let mut reasons: Vec<(String, Option<(String, u32)>)> = Vec::new();
    if let Some(blg) = blg {
        let lines: Vec<&str> = blg.lines().map(str::trim_end).collect();
        for (i, line) in lines.iter().enumerate() {
            match tool {
                BibTool::Biber => {
                    if let Some(idx) = line.find("ERROR - ") {
                        reasons.push((line[idx + "ERROR - ".len()..].to_string(), None));
                    }
                }
                BibTool::Bibtex => {
                    // `I couldn't open database file refs.bib` and
                    // friends, or a message followed by `---line 5 of
                    // file refs.bib`.
                    if let Some(rest) = line.strip_prefix("---line ") {
                        let mut parts = rest.splitn(2, " of file ");
                        let line_no = parts.next().and_then(|n| n.trim().parse::<u32>().ok());
                        let file = parts.next().map(str::trim);
                        if let (Some(n), Some(file), Some(prev)) = (line_no, file, i.checked_sub(1)) {
                            let location = (!file.starts_with('/')).then(|| (file.to_string(), n));
                            reasons.push((lines[prev].trim().to_string(), location));
                        }
                    } else if line.starts_with("I couldn't open")
                        || line.starts_with("I found no")
                    {
                        let message = line.split("---").next().unwrap_or(line).trim();
                        reasons.push((message.to_string(), None));
                    }
                }
            }
        }
    }
    if reasons.is_empty() {
        let program = match tool {
            BibTool::Biber => "biber",
            BibTool::Bibtex => "bibtex",
        };
        for line in latexmk_output.lines().map(str::trim) {
            let lower = line.to_ascii_lowercase();
            let printed_by_tool = lower.starts_with(&format!("{program}:"))
                || lower.starts_with(&format!("{program}8:"))
                || lower.contains(&format!("{program}: command not found"))
                || lower.contains(&format!("'{program}' is not recognized"));
            if printed_by_tool {
                reasons.push((line.to_string(), None));
            }
        }
    }
    reasons.dedup_by(|a, b| a.0 == b.0);
    reasons
}

/// What to do about a failed bibliography run, by its first reason.
fn bib_tool_hint(tool: BibTool, reason: &str) -> String {
    let lower = reason.to_ascii_lowercase();
    let biber_fallback = if tool == BibTool::Biber {
        " For now, backend=bibtex in the biblatex options avoids biber."
    } else {
        ""
    };
    if lower.contains("command not found") || lower.contains("is not recognized") {
        return format!(
            "{} is not installed or not on the PATH. Install it with your TeX distribution.{biber_fallback}",
            tool.name()
        );
    }
    if lower.contains("control file version") || lower.contains("expected version") {
        return "biber and biblatex come from different releases. Update your TeX distribution so they match.".into();
    }
    if lower.contains("cannot find") || lower.contains("couldn't open database") {
        return match tool {
            BibTool::Biber => "Check the \\addbibresource path: it is relative to the main file and includes the .bib extension.".into(),
            BibTool::Bibtex => "Check the \\bibliography path: it is relative to the main file and leaves out the .bib extension.".into(),
        };
    }
    if lower.contains("found no \\citation") {
        return "BibTeX needs at least one \\cite (or \\nocite{*}) before it builds a bibliography.".into();
    }
    if lower.contains("found no \\bibdata") {
        return "Add \\bibliography{name} (without .bib) where the bibliography should appear.".into();
    }
    if lower.contains("found no \\bibstyle") {
        return "Add a style, e.g. \\bibliographystyle{plain}.".into();
    }
    if lower.contains("syntax error") || lower.contains("bibtex subsystem") {
        return "An entry in the .bib file is malformed; the Bibliography panel flags entries it cannot parse.".into();
    }
    if tool == BibTool::Biber
        && !lower.starts_with("error")
        && (lower.starts_with("biber:") || lower.contains("lipo") || lower.contains("killed"))
    {
        return format!(
            "biber crashed before reading your files, which points at the biber installation. Update your TeX distribution.{biber_fallback}"
        );
    }
    format!("The compile log has {}'s full output.", tool.name())
}

/// The failure of biber or BibTeX in a latexmk run, as one issue with
/// a hint. These never reach the LaTeX .log, which only says to rerun
/// them; `latexmk_output` is latexmk's stdout and stderr, `blg` the
/// tool's own log from this run, if any.
pub fn parse_bib_tool_failure(latexmk_output: &str, blg: Option<&str>) -> Option<CompileIssue> {
    let tool = failed_bib_tool(latexmk_output)?;
    let reasons = bib_tool_reasons(tool, latexmk_output, blg);
    let (message, location, hint) = match reasons.first() {
        Some((reason, location)) => (
            format!("{} failed: {reason}", tool.name()),
            location.clone(),
            bib_tool_hint(tool, reason),
        ),
        None => (
            format!("{} failed, so citations and the bibliography were not built", tool.name()),
            None,
            bib_tool_hint(tool, ""),
        ),
    };
    Some(CompileIssue {
        severity: "error".into(),
        file: location.as_ref().map(|(file, _)| file.clone()),
        line: location.map(|(_, line)| line),
        message,
        detail: reasons.iter().skip(1).take(3).map(|(r, _)| r.clone()).collect(),
        hint: Some(hint),
    })
}

/// Whether an issue only repeats what a bibliography failure already
/// says (biblatex's "Please (re)run Biber").
pub fn is_rerun_bib_tool_warning(issue: &CompileIssue) -> bool {
    issue.message.starts_with("Package biblatex Warning: Please (re)run")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_file_line_errors_and_warnings() {
        let log = r#"./main.tex:3: Undefined control sequence.
./chapters/intro.tex:12: LaTeX Error: File `missing.png' not found.
LaTeX Warning: Reference `fig:1' on page 1 undefined on input line 4.
Package hyperref Warning: Token not allowed in a PDF string
Random log line
"#;
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 4);
        assert_eq!(issues[0].severity, "error");
        assert_eq!(issues[0].file.as_deref(), Some("main.tex"));
        assert_eq!(issues[0].line, Some(3));
        assert_eq!(issues[0].message, "Undefined control sequence.");
        assert_eq!(issues[1].file.as_deref(), Some("chapters/intro.tex"));
        assert_eq!(issues[2].severity, "warning");
        assert_eq!(issues[2].line, Some(4));
        assert_eq!(issues[3].severity, "warning");
        assert_eq!(issues[3].line, None);
    }

    #[test]
    fn captures_error_context_blocks() {
        let log = r#"! Undefined control sequence.
l.12 \frrac
     {a}{b}
! Missing $ inserted.
<inserted text>
l.5 ...x_1
LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.
"#;
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 3);
        assert_eq!(issues[0].line, Some(12));
        assert_eq!(issues[0].detail, vec!["l.12 \\frrac", "     {a}{b}"]);
        // The bare `!` error gets its line from the context block.
        assert_eq!(issues[1].line, Some(5));
        assert_eq!(issues[1].detail[0], "l.5 ...x_1");
        assert_eq!(issues[2].detail.len(), 0);
        assert_eq!(issues[2].line, None);
    }

    #[test]
    fn does_not_swallow_a_following_errors_context() {
        let log = r#"./main.tex:3: LaTeX Error: File `x.png' not found.
./main.tex:5: Missing $ inserted.
l.5 y_1
"#;
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].detail.len(), 0);
        assert_eq!(issues[1].detail[0], "l.5 y_1");
    }

    #[test]
    fn reports_a_biber_crash_with_a_hint() {
        let out = "Running 'biber  \"build/main.bcf\"'
biber: extracting arm64 binary with lipo failed (wstatus=256)
Latexmk: Error return from 'biber build/main'
  biber build/main: Could not open biber log file for 'build/main'
";
        let issue = parse_bib_tool_failure(out, None).unwrap();
        assert_eq!(issue.severity, "error");
        assert_eq!(
            issue.message,
            "biber failed: biber: extracting arm64 binary with lipo failed (wstatus=256)"
        );
        let hint = issue.hint.unwrap();
        assert!(hint.contains("crashed"), "{hint}");
        assert!(hint.contains("backend=bibtex"), "{hint}");
    }

    #[test]
    fn reports_a_missing_biber() {
        let out = "sh: biber: command not found\nLatexmk: Error return from 'biber build/main'\n";
        let issue = parse_bib_tool_failure(out, None).unwrap();
        assert!(issue.hint.unwrap().contains("not installed"));
    }

    #[test]
    fn takes_biber_errors_from_the_blg() {
        let out = "Latexmk: Error return from 'biber build/main'\n";
        let blg = "[0] Config.pm:307> INFO - This is Biber 2.19
[52] Utils.pm:411> ERROR - Cannot find 'refs.bib'!
[53] Biber.pm:136> INFO - ERRORS: 1
";
        let issue = parse_bib_tool_failure(out, Some(blg)).unwrap();
        assert_eq!(issue.message, "biber failed: Cannot find 'refs.bib'!");
        assert!(issue.hint.unwrap().contains("\\addbibresource"));
    }

    #[test]
    fn locates_bibtex_errors_in_the_bib_file() {
        let out = "Latexmk: Summary of warnings:\n  Bibtex errors: See file 'build/main.blg'\n";
        let blg = "This is BibTeX, Version 0.99d
I was expecting a `,' or a `}'
---line 5 of file refs.bib
 :   title = {Superism
(There was 1 error message)
";
        let issue = parse_bib_tool_failure(out, Some(blg)).unwrap();
        assert_eq!(issue.message, "BibTeX failed: I was expecting a `,' or a `}'");
        assert_eq!(issue.file.as_deref(), Some("refs.bib"));
        assert_eq!(issue.line, Some(5));
    }

    #[test]
    fn ignores_runs_where_the_bib_tool_succeeded() {
        let out = "Running 'biber  \"build/main.bcf\"'\nLatexmk: All targets are up-to-date\n";
        assert!(parse_bib_tool_failure(out, None).is_none());
    }
}
