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

/// What Polemic cannot do about an error, when the message alone
/// does not say.
fn error_hint(message: &str) -> Option<String> {
    if message.contains("-shell-escape") {
        return Some(
            "Polemic compiles without shell escape, so packages that run other programs \
             (minted, the TikZ externalization library) don't work. The listings package \
             highlights code without it."
                .into(),
        );
    }
    None
}

/// The files TeX has open, read from the `(./chapters/intro.tex` and
/// `)` it prints while compiling. Parentheses that open no file (a
/// message's "(or package)") are counted so their `)` closes nothing.
struct FileStack {
    /// Each open file, and whether it is a project file (`./…`,
    /// outside build/) rather than one from the TeX distribution.
    open: Vec<(String, bool)>,
    other_parens: usize,
}

impl FileStack {
    fn new() -> Self {
        FileStack { open: Vec::new(), other_parens: 0 }
    }

    /// The project file TeX is reading, if the innermost open file is one.
    fn current_project_file(&self) -> Option<String> {
        match self.open.last() {
            Some((file, true)) => Some(file.clone()),
            _ => None,
        }
    }

    /// Is TeX reading a file from the distribution (a .sty, a .cls)?
    fn in_package_file(&self) -> bool {
        matches!(self.open.last(), Some((_, false)))
    }

    fn read(&mut self, line: &str) {
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'(' => {
                    let rest = &line[i + 1..];
                    let token: &str = rest
                        .split(|c: char| c.is_whitespace() || c == ')' || c == '(')
                        .next()
                        .unwrap_or("");
                    if looks_like_path(token) {
                        let project = token.starts_with("./") && !token.starts_with("./build/");
                        let file = token.strip_prefix("./").unwrap_or(token).to_string();
                        self.open.push((file, project));
                        i += 1 + token.len();
                        continue;
                    }
                    self.other_parens += 1;
                }
                b')' => {
                    if self.other_parens > 0 {
                        self.other_parens -= 1;
                    } else {
                        self.open.pop();
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }
}

/// A file name as TeX prints it when it opens the file.
fn looks_like_path(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    let drive = token.len() > 2
        && token.as_bytes()[0].is_ascii_alphabetic()
        && token.as_bytes()[1] == b':'
        && (token.as_bytes()[2] == b'/' || token.as_bytes()[2] == b'\\');
    token.starts_with("./")
        || token.starts_with("../")
        || token.starts_with('/')
        || drive
        || (token.contains('/') && token.rsplit('/').next().is_some_and(|name| name.contains('.')))
}

/// The lines a message continues on: `(pkg)   …` lines, as LaTeX and
/// its packages print them, and for warnings any indented line. Returns
/// the text to append and the index of the first unconsumed line.
fn continuation(lines: &[&str], start: usize, indented_too: bool) -> (String, usize) {
    let mut text = String::new();
    let mut i = start;
    while i < lines.len() {
        let line = lines[i];
        let paren = line
            .strip_prefix('(')
            .and_then(|rest| rest.split_once(')'))
            .filter(|(name, rest)| {
                !name.is_empty()
                    && name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
                    && rest.starts_with(' ')
            })
            .map(|(_, rest)| rest.trim());
        let part = match paren {
            Some(rest) => rest,
            None if indented_too && line.starts_with(' ') && !line.trim().is_empty() => line.trim(),
            None => break,
        };
        text.push(' ');
        text.push_str(part);
        i += 1;
    }
    (text, i)
}

/// Warnings about citations and cross-references that are only missing
/// because the run stopped early: latexmk runs the bibliography tool and
/// the extra passes that resolve them only after a run without errors.
fn is_unresolved_reference_warning(issue: &CompileIssue) -> bool {
    let m = issue.message.as_str();
    m.starts_with("LaTeX Warning: Citation ")
        || m.starts_with("LaTeX Warning: Reference ")
        || m.starts_with("LaTeX Warning: There were undefined references")
        || m.starts_with("LaTeX Warning: Label(s) may have changed")
        || m.starts_with("LaTeX Warning: Empty bibliography")
        || m.starts_with("Package rerunfilecheck Warning: File ")
        || m.starts_with("Package natbib Warning: Citation ")
        || m.starts_with("Package natbib Warning: There were undefined citations")
        || m.starts_with("Package biblatex Warning: Please (re)run")
        || m.starts_with("Package biblatex Warning: Please rerun LaTeX")
}

pub fn parse_issues(log_text: &str) -> Vec<CompileIssue> {
    let lines: Vec<&str> = log_text.lines().map(|l| l.trim_end()).collect();
    let mut issues: Vec<CompileIssue> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut files = FileStack::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.is_empty() {
            i += 1;
            continue;
        }
        let mut issue = None;
        let mut next = i + 1;
        if let Some((file, line_no, message)) = parse_file_line_error(line) {
            let (more, consumed) = continuation(&lines, next, false);
            next = consumed;
            issue = Some(CompileIssue {
                severity: "error".into(),
                file: Some(file),
                line: Some(line_no),
                message: format!("{message}{more}"),
                detail: Vec::new(),
                hint: None,
            });
        } else if let Some(rest) = line.strip_prefix('!') {
            let (more, consumed) = continuation(&lines, next, false);
            next = consumed;
            issue = Some(CompileIssue {
                severity: "error".into(),
                file: None,
                line: None,
                message: format!("{}{more}", rest.trim()),
                detail: Vec::new(),
                hint: None,
            });
        } else {
            let is_latex_warning = line.starts_with("LaTeX") && line.contains("Warning:");
            let is_package_warning = (line.starts_with("Package ") || line.starts_with("Class "))
                && line.contains(" Warning:");
            if is_latex_warning || is_package_warning {
                let (more, consumed) = continuation(&lines, next, true);
                next = consumed;
                let message = format!("{line}{more}");
                let message = message.trim_end_matches('.');
                // A line number inside a package's own file leads
                // nowhere in the project.
                let line_no = warning_line(message).filter(|_| !files.in_package_file());
                issue = Some(CompileIssue {
                    severity: "warning".into(),
                    file: files.current_project_file(),
                    line: line_no,
                    message: message.to_string(),
                    detail: Vec::new(),
                    hint: None,
                });
            }
        }
        if let Some(mut issue) = issue {
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
                issue.hint = error_hint(&issue.message);
            }
            // The same message at the same place, again (a font that
            // is missing on every page), says nothing new; one without
            // a line has no place, so the file does not count.
            let file = issue.line.and(issue.file.clone());
            let key = (issue.severity.clone(), file, issue.line, issue.message.clone());
            if seen.insert(key) {
                issues.push(issue);
            }
            for consumed in &lines[i..next] {
                files.read(consumed);
            }
            i = next;
            continue;
        }
        files.read(line);
        i += 1;
    }
    if issues.iter().any(|issue| issue.severity == "error") {
        issues.retain(|issue| !is_unresolved_reference_warning(issue));
    }
    // Errors first: they stop the compile, and warnings often follow from them.
    issues.sort_by_key(|issue| issue.severity != "error");
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

/// After a compile with Polemic: a font fontspec cannot find is usually
/// one installed on this computer, which the server does not have.
pub fn add_font_hints(issues: &mut [CompileIssue]) {
    for issue in issues {
        if issue.hint.is_none() && issue.message.contains("fontspec Error: The font") {
            issue.hint = Some(
                "Polemic's server has TeX Live's fonts, not the ones installed on this \
                 computer. Put the font file (.otf or .ttf) in the project and load it by \
                 file name, e.g. \\setmainfont{MyFont-Regular.otf}."
                    .into(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hints_at_fonts_missing_on_the_server() {
        let log = "./main.tex:3: Package fontspec Error: The font \"Comic Neue\" cannot\n(fontspec)                be found.\n./main.tex:9: Undefined control sequence.\n";
        let mut issues = parse_issues(log);
        add_font_hints(&mut issues);
        assert!(issues[0].hint.as_deref().unwrap().contains("font file"));
        assert_eq!(issues[1].hint, None);
    }

    #[test]
    fn parses_file_line_errors_and_warnings() {
        let log = r#"./main.tex:3: Undefined control sequence.
./chapters/intro.tex:12: LaTeX Error: File `missing.png' not found.
LaTeX Warning: Float too large for page by 3.0pt on input line 4.
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
    fn attributes_warnings_to_the_file_tex_is_reading() {
        let log = "(./main.tex (./chapters/intro.tex\nLaTeX Warning: Reference `fig:1' on page 1 undefined on input line 4.\n) (/usr/share/texlive/caption.sty\nPackage caption Warning: Unknown document class (or package),\n(caption)                standard defaults will be used.\n)\nLaTeX Warning: There were undefined references.\n)\n";
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 3);
        assert_eq!(issues[0].file.as_deref(), Some("chapters/intro.tex"));
        assert_eq!(issues[0].line, Some(4));
        // Inside caption.sty: the "(or package)" closes no file, and
        // the message continues on the (caption) line.
        assert_eq!(issues[1].file, None);
        assert_eq!(
            issues[1].message,
            "Package caption Warning: Unknown document class (or package), standard defaults will be used"
        );
        assert_eq!(issues[2].file.as_deref(), Some("main.tex"));
    }

    #[test]
    fn drops_line_numbers_inside_package_files() {
        let log = "(./main.tex (/usr/share/texlive/fancyhdr.sty\nPackage fancyhdr Warning: \\headheight is too small on input line 12.\n))\n";
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].line, None);
    }

    #[test]
    fn joins_continued_messages_and_hints_at_shell_escape() {
        let log = "(./main.tex\n./main.tex:6: Package minted Error: You must invoke LaTeX with the\n(minted)                -shell-escape flag.\nLaTeX Warning: Unused global option(s):\n    [margin=0mm].\n\n)\n";
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 2);
        assert_eq!(
            issues[0].message,
            "Package minted Error: You must invoke LaTeX with the -shell-escape flag."
        );
        assert!(issues[0].hint.as_deref().unwrap().contains("shell escape"));
        assert_eq!(issues[1].message, "LaTeX Warning: Unused global option(s): [margin=0mm]");
    }

    #[test]
    fn reports_a_repeated_issue_once() {
        let log = "(./main.tex\n./main.tex:6: Font TU/Fira/m/n/10=\"Fira\" not loadable.\n./main.tex:6: Font TU/Fira/m/n/10=\"Fira\" not loadable.\n(./a.tex\nPackage fancyhdr Warning: \\headheight is too small.\n) (./b.tex\nPackage fancyhdr Warning: \\headheight is too small.\n))\n";
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].severity, "error");
        assert_eq!(issues[1].severity, "warning");
    }

    #[test]
    fn captures_error_context_blocks() {
        let log = r#"! Undefined control sequence.
l.12 \frrac
     {a}{b}
! Missing $ inserted.
<inserted text>
l.5 ...x_1
LaTeX Warning: Float too large for page by 12.0pt on input line 9.
"#;
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 3);
        assert_eq!(issues[0].line, Some(12));
        assert_eq!(issues[0].detail, vec!["l.12 \\frrac", "     {a}{b}"]);
        // The bare `!` error gets its line from the context block.
        assert_eq!(issues[1].line, Some(5));
        assert_eq!(issues[1].detail[0], "l.5 ...x_1");
        assert_eq!(issues[2].detail.len(), 0);
        assert_eq!(issues[2].line, Some(9));
    }

    #[test]
    fn drops_unresolved_references_when_the_run_has_errors() {
        let log = "LaTeX Warning: Citation 'otsu1979' on page 2 undefined on input line 8.
LaTeX Warning: Reference `sec:methods' on page 2 undefined on input line 33.
Package biblatex Warning: 'babel/polyglossia' detected but 'csquotes' missing.

./main.tex:9: Undefined control sequence.
LaTeX Warning: There were undefined references.
LaTeX Warning: Empty bibliography on input line 83.
";
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].severity, "error");
        assert!(issues[1].message.contains("csquotes"));
    }

    #[test]
    fn keeps_unresolved_references_when_the_run_has_no_errors() {
        let log = "LaTeX Warning: Citation 'otsu1979' on page 2 undefined on input line 8.\n";
        assert_eq!(parse_issues(log).len(), 1);
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
