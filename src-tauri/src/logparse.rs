use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompileIssue {
    /// "error" | "warning"
    pub severity: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub message: String,
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

pub fn parse_issues(log_text: &str) -> Vec<CompileIssue> {
    let mut issues = Vec::new();
    for raw in log_text.lines() {
        let line = raw.trim_end();
        if line.is_empty() {
            continue;
        }
        if let Some((file, line_no, message)) = parse_file_line_error(line) {
            issues.push(CompileIssue {
                severity: "error".into(),
                file: Some(file),
                line: Some(line_no),
                message,
            });
            continue;
        }
        if line.starts_with('!') {
            issues.push(CompileIssue {
                severity: "error".into(),
                file: None,
                line: None,
                message: line[1..].trim().to_string(),
            });
            continue;
        }
        let is_latex_warning = line.starts_with("LaTeX") && line.contains("Warning:");
        let is_package_warning = line.starts_with("Package ") && line.contains(" Warning:");
        if is_latex_warning || is_package_warning {
            issues.push(CompileIssue {
                severity: "warning".into(),
                file: None,
                line: None,
                message: line.trim_end_matches('.').to_string(),
            });
        }
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
        assert_eq!(issues[1].line, Some(12));
        assert_eq!(issues[2].severity, "warning");
        assert_eq!(issues[3].severity, "warning");
    }
}

