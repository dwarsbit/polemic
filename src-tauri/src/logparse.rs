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
            });
        } else if let Some(rest) = line.strip_prefix('!') {
            issue = Some(CompileIssue {
                severity: "error".into(),
                file: None,
                line: None,
                message: rest.trim().to_string(),
                detail: Vec::new(),
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
}
