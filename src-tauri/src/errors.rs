//! What went wrong, in words for the reader: what happened and what to
//! do next. The system's own text ("No such file or directory (os
//! error 2)") only shows where there is no better way to say it.

use std::fmt::Display;
use std::io;

/// Why an action on a file or folder failed, as the end of a sentence
/// that names the action: "the disk is full. Free some space and try
/// again."
pub fn why(e: &io::Error) -> String {
    use io::ErrorKind as Kind;
    const BUSY: &str = "another program is using it. Close it there and try again.";
    let known = match e.kind() {
        Kind::NotFound => "it wasn't found.",
        Kind::PermissionDenied => {
            "permission was denied. Check that you may change this file or folder."
        }
        Kind::AlreadyExists => "something with that name already exists.",
        Kind::StorageFull | Kind::QuotaExceeded => {
            "the disk is full. Free some space and try again."
        }
        Kind::ReadOnlyFilesystem => "the disk is read-only.",
        Kind::InvalidData => "it isn't a text file.",
        Kind::IsADirectory => "it is a folder.",
        Kind::NotADirectory => "part of the path is a file, not a folder.",
        Kind::DirectoryNotEmpty => "the folder isn't empty.",
        Kind::ResourceBusy => BUSY,
        Kind::InvalidFilename => "the name has characters a file name can't have.",
        // Windows: a file another program holds open or has locked.
        _ if cfg!(windows) && matches!(e.raw_os_error(), Some(32 | 33)) => BUSY,
        _ => "",
    };
    if !known.is_empty() {
        return known.to_string();
    }
    system_text(&e.to_string())
}

/// The system's message as the end of a sentence, without its code.
pub fn system_text(raw: &str) -> String {
    let text = match raw.rfind(" (os error ") {
        Some(at) if raw.ends_with(')') => &raw[..at],
        _ => raw,
    };
    let text = text.trim().trim_end_matches('.');
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => format!("{}{}.", first.to_lowercase(), chars.as_str()),
        None => "the system gave no reason.".to_string(),
    }
}

/// The action that failed and why: "Could not save main.tex: the disk
/// is full. Free some space and try again."
pub fn failed(action: impl Display, e: &io::Error) -> String {
    format!("{action}: {}", why(e))
}

/// A service that gave no answer, with what to try.
pub fn no_answer(name: impl Display, timed_out: bool) -> String {
    if timed_out {
        format!("No answer from {name} in time. Try again in a moment.")
    } else {
        format!("Could not reach {name}. Check your internet connection.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_common_causes_in_plain_words() {
        let missing = io::Error::from(io::ErrorKind::NotFound);
        assert_eq!(
            failed("Could not open figure.png", &missing),
            "Could not open figure.png: it wasn't found."
        );
        let full = io::Error::from(io::ErrorKind::StorageFull);
        assert_eq!(why(&full), "the disk is full. Free some space and try again.");
        let binary = io::Error::new(io::ErrorKind::InvalidData, "stream did not contain valid UTF-8");
        assert_eq!(why(&binary), "it isn't a text file.");
    }

    #[test]
    fn keeps_the_systems_text_without_its_code() {
        assert_eq!(
            system_text("Too many open files (os error 24)"),
            "too many open files."
        );
        assert_eq!(system_text("Interrupted."), "interrupted.");
        assert_eq!(system_text(""), "the system gave no reason.");
        let other = io::Error::other("the pipe broke");
        assert_eq!(why(&other), "the pipe broke.");
    }

    #[test]
    fn says_what_to_try_when_a_service_gives_no_answer() {
        assert_eq!(
            no_answer("GitHub", false),
            "Could not reach GitHub. Check your internet connection."
        );
        assert_eq!(
            no_answer("GitHub", true),
            "No answer from GitHub in time. Try again in a moment."
        );
    }
}
