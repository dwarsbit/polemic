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
    /// What TeX was reading when the error occurred, when that is not
    /// the source line itself: the argument or the command it was
    /// expanding (`<argument> \foo`, `\mycmd ->\frrac`). The offending
    /// token ends it.
    pub reading: Option<String>,
}

/// The place of an error that -file-line-error prints: a file of the
/// project, or one outside it (the TeX distribution, a parent folder).
enum Place {
    Project(String, u32),
    Outside,
}

/// Splits `path:12: message` at the first `:<digits>: `.
fn split_file_line(line: &str) -> Option<(&str, u32, &str)> {
    let bytes = line.as_bytes();
    let mut from = 0;
    while let Some(found) = line[from..].find(':') {
        let colon = from + found;
        let digits = bytes[colon + 1..].iter().take_while(|b| b.is_ascii_digit()).count();
        let end = colon + 1 + digits;
        if digits > 0 && colon > 0 && line[end..].starts_with(": ") {
            let n = line[colon + 1..end].parse::<u32>().ok()?;
            return Some((&line[..colon], n, &line[end + 2..]));
        }
        from = colon + 1;
    }
    None
}

/// Whether a path without `./` reads as a file name, not as log prose.
fn reads_as_file_name(path: &str) -> bool {
    let Some(first) = path.chars().next() else {
        return false;
    };
    if first.is_whitespace() || "!(<*\\".contains(first) || context_line_no(path).is_some() {
        return false;
    }
    if path.chars().skip(1).any(|c| "()<>\\\"`'".contains(c)) {
        return false;
    }
    path.rsplit_once('.').is_some_and(|(stem, ext)| {
        !stem.is_empty()
            && (1..=10).contains(&ext.len())
            && ext.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    })
}

/// An error line as -file-line-error prints it:
/// `./chapters/intro.tex:12: Undefined control sequence.` A file TeX found
/// through the main file's folder has no `./` (`demo/frames.tex:45: …`).
/// TeX's closing `==> Fatal error occurred` says nothing and is left out.
fn parse_error_line(line: &str) -> Option<(Place, String)> {
    let (path, line_no, rest) = split_file_line(line)?;
    let message = rest.trim();
    if message.is_empty() || message.starts_with("==>") {
        return None;
    }
    let bytes = path.as_bytes();
    let drive = bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\');
    if path.starts_with('/') || drive || path.starts_with("../") {
        return Some((Place::Outside, message.to_string()));
    }
    if let Some(file) = path.strip_prefix("./") {
        return Some((Place::Project(file.to_string(), line_no), message.to_string()));
    }
    reads_as_file_name(path).then(|| (Place::Project(path.to_string(), line_no), message.to_string()))
}

/// The context line TeX prints after an error: `l.12 ...` with the
/// source line up to the point where the error occurred.
fn context_line_no(detail_line: &str) -> Option<u32> {
    let rest = detail_line.strip_prefix('l')?;
    let rest = rest.strip_prefix('.')?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u32>().ok()
}

fn is_warning_line(line: &str) -> bool {
    (line.starts_with("LaTeX") && line.contains("Warning:"))
        || ((line.starts_with("Package ") || line.starts_with("Class ")) && line.contains(" Warning:"))
}

/// Where the next message starts: TeX's context for an error ends there.
fn starts_message(line: &str) -> bool {
    line.starts_with('!') || split_file_line(line).is_some() || is_warning_line(line)
}

/// The line right after an error, when TeX shows there what it was
/// expanding (`<argument> \foo`, `\mycmd ->\frrac`) rather than the
/// source line or its help text.
fn is_reading(line: &str) -> bool {
    !line.is_empty()
        && context_line_no(line).is_none()
        && !line.starts_with("See the ")
        && !line.starts_with("Type ")
}

/// How far below an error its `l.N` line is looked for: past TeX's
/// help text and the macros it was expanding.
const CONTEXT_REACH: usize = 40;

/// The error's context block: the `l.N` line that follows it, before
/// the next message, plus up to three indented continuations. Returns
/// the block and the index of the first unconsumed line.
fn detail_from(lines: &[&str], start: usize) -> (Vec<String>, usize) {
    let mut ctx_at = None;
    for (i, line) in lines.iter().enumerate().skip(start).take(CONTEXT_REACH) {
        if context_line_no(line).is_some() {
            ctx_at = Some(i);
            break;
        }
        if starts_message(line) {
            break;
        }
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

/// A file of the project, as TeX names it: `./intro.tex`, or without
/// `./` when TeX found it through the main file's folder. Files of the
/// TeX distribution have absolute paths; build/ holds TeX's own output.
fn is_project_file(token: &str) -> bool {
    let bytes = token.as_bytes();
    let drive = bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\');
    if token.starts_with('/') || drive || token.starts_with("../") {
        return false;
    }
    let file = token.strip_prefix("./").unwrap_or(token);
    !file.starts_with("build/") && !file.contains("://")
}

/// The files TeX has open, read from the `(./chapters/intro.tex` and
/// `)` it prints while compiling. Parentheses that open no file (a
/// message's "(or package)") are counted so their `)` closes nothing.
struct FileStack {
    /// Each open file, and whether it is a project file rather than
    /// one from the TeX distribution.
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

    /// The innermost project file TeX has open: the one that loaded the
    /// package TeX is reading.
    fn innermost_project_file(&self) -> Option<String> {
        self.open.iter().rev().find(|(_, project)| *project).map(|(file, _)| file.clone())
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
                        let file = token.strip_prefix("./").unwrap_or(token).to_string();
                        self.open.push((file, is_project_file(token)));
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

/// The lines a message continues on: `(pkg)   …` and indented lines,
/// as LaTeX and its packages print them. Returns the text to append and
/// the index of the first unconsumed line.
fn continuation(lines: &[&str], start: usize) -> (String, usize) {
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
            None if line.starts_with(' ') && !line.trim().is_empty() => line.trim(),
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

/// Why TeX stopped, for an "Emergency stop" that no error explains: the
/// notice an engine test prints just before it (`* XeTeX is required to
/// compile this document.`), or TeX's own `*** (job aborted, …)` after it.
fn stop_reason(lines: &[&str], at: usize) -> Option<String> {
    for line in lines[at.saturating_sub(8)..at].iter().rev() {
        let notice = line.trim_start().strip_prefix("* ").filter(|text| {
            text.strip_suffix(" is required to compile this document.").is_some_and(|what| !what.is_empty())
        });
        if let Some(notice) = notice {
            return Some(notice.to_string());
        }
    }
    for line in lines.iter().skip(at + 1).take(7) {
        let aborted = line
            .strip_prefix("*** (")
            .and_then(|rest| rest.strip_suffix(')'))
            .filter(|reason| reason.len() > "job aborted, ".len() && reason.starts_with("job aborted, "));
        if let Some(aborted) = aborted {
            return Some(format!("Emergency stop ({aborted})."));
        }
    }
    None
}

pub fn parse_issues(log_text: &str) -> Vec<CompileIssue> {
    let lines: Vec<&str> = log_text.lines().map(|l| l.trim_end()).collect();
    let mut issues: Vec<CompileIssue> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut files = FileStack::new();
    // The index of the last error, if it has no place yet.
    let mut unplaced: Option<usize> = None;
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.is_empty() {
            i += 1;
            continue;
        }
        let error = |file: Option<String>, line: Option<u32>, message: String| CompileIssue {
            severity: "error".into(),
            file,
            line,
            message,
            detail: Vec::new(),
            hint: None,
            reading: None,
        };
        let mut issue = None;
        let mut next = i + 1;
        // The l.N line after an error in a package counts that package's lines.
        let mut in_package = false;
        // A `!` line: an error that names no place of its own.
        let bare = line.strip_prefix('!').map(str::trim).filter(|rest| !rest.starts_with("==>"));
        if let Some((place, message)) = parse_error_line(line) {
            let (more, consumed) = continuation(&lines, next);
            next = consumed;
            let message = format!("{message}{more}");
            issue = Some(match place {
                Place::Project(file, line_no) => error(Some(file), Some(line_no), message),
                Place::Outside => {
                    in_package = true;
                    error(files.innermost_project_file(), None, message)
                }
            });
        } else if let Some(rest) = bare {
            let (more, consumed) = continuation(&lines, next);
            next = consumed;
            // No place of its own: it is in the file TeX is reading.
            in_package = files.in_package_file();
            issue = Some(error(files.innermost_project_file(), None, format!("{rest}{more}")));
        } else if is_warning_line(line) {
            let (more, consumed) = continuation(&lines, next);
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
            reading: None,
            });
        }
        if let Some(mut found) = issue.take_if(|issue| issue.severity == "error") {
            let first = lines.get(next).copied().unwrap_or("");
            let (detail, consumed) = detail_from(&lines, next);
            // A package's own source is no context for the document.
            if !detail.is_empty() && !in_package {
                if found.line.is_none() {
                    found.line = context_line_no(&detail[0]);
                }
                found.detail = detail;
                if is_reading(first) {
                    found.reading = Some(first.to_string());
                }
            }
            next = consumed.max(next);
            found.hint = error_hint(&found.message);
            let mut keep = true;
            if found.message.starts_with("Emergency stop") {
                if issues.iter().any(|earlier| earlier.severity == "error") {
                    // TeX gave up: the errors before it say why. One without a
                    // place (a file LaTeX could not find) is where TeX stopped.
                    if let (Some(at), Some(_)) = (unplaced, found.line) {
                        issues[at].file = found.file.clone();
                        issues[at].line = found.line;
                        issues[at].detail = found.detail.clone();
                    }
                    keep = false;
                } else if let Some(reason) = stop_reason(&lines, i) {
                    found.message = reason;
                }
            }
            unplaced = None;
            if keep {
                issue = Some(found);
            }
        }
        if let Some(issue) = issue {
            // The same message at the same place, again (a font that
            // is missing on every page), says nothing new; one without
            // a line has no place, so the file does not count.
            let file = issue.line.and(issue.file.clone());
            let key = (issue.severity.clone(), file, issue.line, issue.message.clone());
            if seen.insert(key) {
                if bare.is_some() && issue.severity == "error" && issue.line.is_none() {
                    unplaced = Some(issues.len());
                }
                issues.push(issue);
            }
        }
        for consumed in &lines[i..next] {
            files.read(consumed);
        }
        i = next;
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

/// The rules latexmk lists under "Collected error summary" when it gives
/// up, as (rule, what it says): `bibtex build/main: Bibtex errors: See
/// file 'build/main.blg'`, `cusdep glo gls build/main: Command for … gave
/// return code 512`.
fn failed_rules(latexmk_output: &str) -> Vec<(String, String)> {
    let mut rules = Vec::new();
    let mut in_summary = false;
    for line in latexmk_output.lines() {
        if line.starts_with("Collected error summary") {
            in_summary = true;
        } else if in_summary && line.starts_with("  ") {
            if let Some(at) = line.find(": ").filter(|at| *at > 0) {
                rules.push((line[..at].trim().to_lowercase(), line[at + 2..].to_string()));
            }
        } else if !line.trim().is_empty() {
            in_summary = false;
        }
    }
    rules
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
    for (rule, _) in failed_rules(latexmk_output) {
        if rule.starts_with("biber") {
            return Some(BibTool::Biber);
        }
        if rule.starts_with("bibtex") {
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
                    // friends, or a message with `---line 5 of file
                    // refs.bib` after it, on the same line or the next.
                    let located = line
                        .find("---line ")
                        .filter(|_| !line.starts_with("Warning--") && !line.starts_with("while executing"));
                    if let Some(at) = located {
                        let mut parts = line[at + "---line ".len()..].splitn(2, " of file ");
                        let line_no = parts.next().and_then(|n| n.trim().parse::<u32>().ok());
                        let file = parts.next().map(str::trim);
                        let message = if at > 0 {
                            &line[..at]
                        } else {
                            i.checked_sub(1).map_or("", |prev| lines[prev])
                        };
                        if let (Some(n), Some(file), false) = (line_no, file, message.trim().is_empty()) {
                            // A place in the .aux file is TeX's own output, not the project's.
                            let outside = file.starts_with('/') || file.ends_with(".aux");
                            let location = (!outside).then(|| (file.to_string(), n));
                            reasons.push((message.trim().to_string(), location));
                        }
                    } else if let Some(rest) = line.strip_prefix("A bad cross reference---") {
                        let rest = format!("{rest} {}", lines.get(i + 1).copied().unwrap_or(""));
                        reasons.push((format!("A bad cross reference: {}", rest.trim()), None));
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
    if lower.starts_with("repeated entry") {
        return "Two entries in the .bib file have the same key. Rename or remove one of them.".into();
    }
    if lower.starts_with("a bad cross reference") {
        return "The crossref field names an entry that is not in the .bib file.".into();
    }
    if lower.contains("syntax error")
        || lower.contains("bibtex subsystem")
        || lower.starts_with("i was expecting")
    {
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
        reading: None,
    })
}

/// The tool behind a latexmk rule that is not TeX or the bibliography,
/// and what it builds: ("makeglossaries", "the glossary").
fn other_tool(rule: &str) -> Option<(&'static str, &'static str)> {
    let mut words = rule.split_whitespace();
    match (words.next(), words.next()) {
        (Some("cusdep"), Some("glo" | "acn")) => Some(("makeglossaries", "the glossary")),
        (Some("cusdep"), Some("nlo")) => Some(("makeindex", "the nomenclature")),
        (Some("makeindex"), _) => Some(("makeindex", "the index")),
        _ => None,
    }
}

/// A latexmk run that failed outside TeX and the bibliography: a
/// glossary or index tool that stopped, or a document that never settles.
/// Like bibliography failures, these never reach the LaTeX .log.
pub fn parse_run_failure(latexmk_output: &str) -> Option<CompileIssue> {
    let failure = |message: String, hint: String| CompileIssue {
        severity: "error".into(),
        file: None,
        line: None,
        message,
        detail: Vec::new(),
        hint: Some(hint),
        reading: None,
    };
    for (rule, _) in failed_rules(latexmk_output) {
        if let Some((tool, built)) = other_tool(&rule) {
            return Some(failure(
                format!("{tool} failed, so {built} was not built"),
                format!("The compile log has the full output of {tool}."),
            ));
        }
    }
    let never_settles = latexmk_output.lines().any(|line| {
        line.strip_prefix("Latexmk: Maximum runs of ").is_some_and(|rest| {
            rest.split_once(' ').is_some_and(|(rule, after)| !rule.is_empty() && after.starts_with("reached"))
        })
    });
    never_settles.then(|| {
        failure(
            "The document kept changing between runs, so the compile stopped".into(),
            "Something changes on every run, such as a reference that moves to another page each time. \
             The compile log shows what changed."
                .into(),
        )
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
        if issue.hint.is_none() && issue.message.contains("fontspec Error: The font \"") {
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
    fn reports_errors_raised_inside_packages() {
        let log = "(./main.tex\nLaTeX2e <2025-11-01>\n(/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty\n/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty:100: Fatal Package fontspec Error: The fontspec package requires either XeTeX or\n(fontspec)                      LuaTeX.\n\nType <return> to continue.\n ...                                              \n                                                  \nl.100 \\msg_fatal:nn {fontspec} {cannot-use-pdftex}\n\n/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty:100:  ==> Fatal error occurred, no output PDF file produced!\n";
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].severity, "error");
        assert_eq!(issues[0].file.as_deref(), Some("main.tex"));
        assert_eq!(issues[0].line, None);
        assert!(issues[0].message.starts_with("Fatal Package fontspec Error: The fontspec package requires either XeTeX or"));
        assert!(issues[0].message.contains("LuaTeX."));
    }

    #[test]
    fn reports_package_errors_on_windows_paths() {
        let log = "C:/texlive/2026/texmf-dist/tex/latex/eolang/eolang.sty:162: I can't write on file `_eolang/paper-phi.pl'.\n";
        let issues = parse_issues(log);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].file, None);
        assert_eq!(issues[0].message, "I can't write on file `_eolang/paper-phi.pl'.");
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

    #[test]
    fn reads_errors_in_files_named_without_dot_slash() {
        let issues = parse_issues("(./demo/trigon_demo.tex (demo/frames.tex\ndemo/frames.tex:45: Package pdftex.def Error: File `shots/layout.jpg' not found: using draft setting.\n\nSee the pdftex.def package documentation for explanation.\nType  H <return>  for immediate help.\n ...                                              \n                                                  \nl.45 ...width]{shots/layout.jpg}}\n                                 \nLaTeX Warning: Float too large for page by 3.0pt on input line 50.\n))\n");
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].severity, "error");
        assert_eq!(issues[0].file.as_deref(), Some("demo/frames.tex"));
        assert_eq!(issues[0].line, Some(45));
        // The context is found past TeX's help text.
        assert_eq!(issues[0].detail[0], "l.45 ...width]{shots/layout.jpg}}");
        assert_eq!(issues[1].file.as_deref(), Some("demo/frames.tex"));
        assert_eq!(issues[1].line, Some(50));
    }

    #[test]
    fn places_a_missing_file_where_tex_stopped() {
        let issues = parse_issues("(./doc/main.tex\n\n! LaTeX Error: File `dtklogos.sty' not found.\n\nType X to quit or <RETURN> to proceed,\nor enter new name. (Default extension: sty)\n\nEnter file name: \n./doc/main.tex:11: Emergency stop.\n<read *> \n         \nl.11 \\usepackage\n                [table]{xcolor}^^M\n*** (cannot \\read from terminal in nonstop modes)\n\n!  ==> Fatal error occurred, no output PDF file produced!\n");
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].message, "LaTeX Error: File `dtklogos.sty' not found.");
        assert_eq!(issues[0].file.as_deref(), Some("doc/main.tex"));
        assert_eq!(issues[0].line, Some(11));
        assert_eq!(issues[0].detail[0], "l.11 \\usepackage");
    }

    #[test]
    fn says_why_tex_stopped_when_no_error_does() {
        let notice = parse_issues("(./thesis.cls\n\n ********************************************\n * XeTeX is required to compile this document.\n * Sorry!\n ********************************************\n\n./thesis.cls:67: Emergency stop.\n<read *> \n         \nl.67 \\RequireXeTeX\n                  \n*** (cannot \\read from terminal in nonstop modes)\n");
        assert_eq!(notice.len(), 1);
        assert_eq!(notice[0].message, "XeTeX is required to compile this document.");
        assert_eq!(notice[0].file.as_deref(), Some("thesis.cls"));
        assert_eq!(notice[0].line, Some(67));
        let aborted = parse_issues("(./main.tex)\n! Emergency stop.\n<*> main.tex\n            \n*** (job aborted, no legal \\end found)\n");
        assert_eq!(aborted.len(), 1);
        assert_eq!(aborted[0].message, "Emergency stop (job aborted, no legal \\end found).");
    }

    #[test]
    fn drops_an_emergency_stop_that_follows_an_error() {
        let issues = parse_issues("./main.tex:5: Undefined control sequence.\nl.5 \\foo\n        \n! Emergency stop.\n<*> main.tex\n            \n*** (job aborted, no legal \\end found)\n");
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].message, "Undefined control sequence.");
        assert_eq!(issues[0].line, Some(5));
    }

    #[test]
    fn keeps_a_packages_own_source_out_of_the_context() {
        let mut issues = parse_issues("(./main.tex\nLaTeX2e <2025-11-01>\n(/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty\n/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty:100: Fatal Package fontspec Error: The fontspec package requires either XeTeX or\n(fontspec)                      LuaTeX.\n\nType <return> to continue.\n ...                                              \n                                                  \nl.100 \\msg_fatal:nn {fontspec} {cannot-use-pdftex}\n\n/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty:100:  ==> Fatal error occurred, no output PDF file produced!\n");
        add_font_hints(&mut issues);
        assert!(issues[0].detail.is_empty());
        // The hint is for a font that is missing, not for the wrong engine.
        assert_eq!(issues[0].hint, None);
    }

    #[test]
    fn does_not_take_log_prose_for_an_error() {
        assert!(parse_issues("<recently read> x.y:3: z\nl.4 a.tex:12: b\nsee (table) 1.tex:3: x\n").is_empty());
    }

    #[test]
    fn finds_the_failed_tool_in_latexmks_error_summary() {
        let issue = parse_bib_tool_failure("Latexmk: Errors, so I did not complete making targets\nCollected error summary (may duplicate other messages):\n  bibtex build/main: Bibtex errors: See file 'build/main.blg'\n\nLatexmk: Missing bbl file 'build/main.bbl' in following:\n No file main.bbl.\n", Some("This is BibTeX, Version 0.99d\nRepeated entry---line 1506 of file references.bib\n : @inproceedings{hutter2011sequential\n :                                    ,\nI'm skipping whatever remains of this entry\n")).unwrap();
        assert_eq!(issue.message, "BibTeX failed: Repeated entry");
        assert_eq!(issue.file.as_deref(), Some("references.bib"));
        assert_eq!(issue.line, Some(1506));
        assert!(issue.hint.unwrap().contains("same key"));
    }

    #[test]
    fn reports_a_failed_glossary_run() {
        let issue = parse_run_failure("Collected error summary (may duplicate other messages):\n  cusdep glo gls build/main: Command for 'cusdep glo gls build/main' gave return code 65280\n").unwrap();
        assert_eq!(issue.severity, "error");
        assert_eq!(issue.message, "makeglossaries failed, so the glossary was not built");
        assert!(issue.hint.unwrap().contains("makeglossaries"));
    }

    #[test]
    fn reports_a_document_that_never_settles() {
        let issue = parse_run_failure("Latexmk: Maximum runs of pdflatex reached without getting stable files\n").unwrap();
        assert!(issue.message.starts_with("The document kept changing"));
    }

    #[test]
    fn leaves_texs_own_errors_to_the_log() {
        assert!(parse_run_failure("Collected error summary (may duplicate other messages):\n  pdflatex: Command for 'pdflatex' gave return code 1\n      Refer to 'build/main.log' and/or above output for details\n").is_none());
    }

    #[test]
    fn keeps_the_macro_tex_was_expanding() {
        let issues = parse_issues("./main.tex:7: Undefined control sequence.\n\\mycmd ->\\undefinedthing \n                         \nl.7 \\mycmd\n          \n");
        assert_eq!(issues[0].reading.as_deref(), Some("\\mycmd ->\\undefinedthing"));
        assert_eq!(issues[0].detail[0], "l.7 \\mycmd");
    }

    #[test]
    fn keeps_the_argument_tex_was_reading() {
        let issues = parse_issues("./main.tex:9: Undefined control sequence.\n<argument> \\foo \n                 bar\nl.9 \\section{\\foo bar}\n");
        assert_eq!(issues[0].reading.as_deref(), Some("<argument> \\foo"));
    }

    #[test]
    fn keeps_nothing_when_the_error_is_on_the_source_line_itself() {
        let issues = parse_issues("./main.tex:3: Undefined control sequence.\nl.3 \\frrac\n          {a}{b}\n");
        assert_eq!(issues[0].reading, None);
    }

    #[test]
    fn joins_the_indented_rest_of_an_error_message() {
        let issues = parse_issues("./main.tex:5: LaTeX Error: Command \\vec already defined.\n               Or name \\end... illegal, see p.192 of the manual.\n\nSee the LaTeX manual or LaTeX Companion for explanation.\nType  H <return>  for immediate help.\n ...                                              \n                                                  \nl.5 \\newcommand{\\vec}\n");
        assert_eq!(issues[0].message, "LaTeX Error: Command \\vec already defined. Or name \\end... illegal, see p.192 of the manual.");
        assert_eq!(issues[0].reading, None);
        assert_eq!(issues[0].detail[0], "l.5 \\newcommand{\\vec}");
    }
}
