use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// A local comment attached to a file, a line, or a text selection.
/// Stored one per file in the project's `.polemic/comments/<id>.json`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub file: String,
    pub category: String,
    pub text: String,
    pub created_at: u64,
    pub resolved: bool,
    /// null: a whole-file comment. Otherwise the anchored text and the
    /// line number at creation time (a hint; the text is the truth).
    pub anchor: Option<CommentAnchor>,
    /// A reply to a suggestion's note: the note's key (author and note
    /// text), so the thread follows the suggestion. Absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    /// Who wrote it on a review page (phase 5a); absent for the
    /// project's own comments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<CommentAuthor>,
    /// The comment this one answers. Absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CommentAuthor {
    pub name: String,
    /// False for a name the reviewer typed: anyone with the link could
    /// have written it.
    pub verified: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommentAnchor {
    pub text: String,
    pub line: u32,
}

/// The comments before one file per comment (read once, then moved).
fn legacy_file(project_dir: &Path) -> PathBuf {
    project_dir.join(".polemic").join("comments.json")
}

/// One file per comment, so two devices adding comments never touch the
/// same file and git merges them without a conflict.
fn comments_dir(project_dir: &Path) -> PathBuf {
    project_dir.join(".polemic").join("comments")
}

/// Comment ids are UUIDs; anything else could escape the folder.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn comment_path(project_dir: &Path, id: &str) -> PathBuf {
    comments_dir(project_dir).join(format!("{id}.json"))
}

/// The ids this app has read or written, per project. A save deletes
/// only files among these: a comment that arrived by a pull since the
/// last read is not the editor's to delete.
static KNOWN: Mutex<Option<HashMap<PathBuf, HashSet<String>>>> = Mutex::new(None);

fn remember(project_dir: &Path, ids: impl IntoIterator<Item = String>) {
    if let Ok(mut known) = KNOWN.lock() {
        known
            .get_or_insert_with(HashMap::new)
            .insert(project_dir.to_path_buf(), ids.into_iter().collect());
    }
}

fn known_ids(project_dir: &Path) -> HashSet<String> {
    KNOWN
        .lock()
        .ok()
        .and_then(|known| known.as_ref()?.get(project_dir).cloned())
        .unwrap_or_default()
}

fn write_one(project_dir: &Path, comment: &Comment) -> Result<(), String> {
    let json = serde_json::to_string_pretty(comment).map_err(|e| e.to_string())?;
    let path = comment_path(project_dir, &comment.id);
    // Unchanged comments are not rewritten (no churn in git).
    if fs::read_to_string(&path).ok().as_deref() == Some(json.as_str()) {
        return Ok(());
    }
    crate::files::write_atomic(&path, json.as_bytes())
        .map_err(|e| format!("failed to write comment: {e}"))
}

/// Move comments.json into one file per comment, once.
fn migrate(project_dir: &Path) {
    let legacy = legacy_file(project_dir);
    let Ok(text) = fs::read_to_string(&legacy) else {
        return;
    };
    let Ok(comments) = serde_json::from_str::<Vec<Comment>>(&text) else {
        // Unreadable (a merge conflict?): leave it for the user.
        return;
    };
    if fs::create_dir_all(comments_dir(project_dir)).is_err() {
        return;
    }
    for comment in comments.iter().filter(|c| valid_id(&c.id)) {
        if write_one(project_dir, comment).is_err() {
            return;
        }
    }
    let _ = fs::remove_file(&legacy);
}

/// The project's comments, oldest first. A file that does not parse (a
/// git conflict in it, say) is skipped and left alone.
pub fn list(project_dir: &Path) -> Vec<Comment> {
    migrate(project_dir);
    let mut comments: Vec<Comment> = fs::read_dir(comments_dir(project_dir))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
                .filter_map(|e| fs::read_to_string(e.path()).ok())
                .filter_map(|text| serde_json::from_str::<Comment>(&text).ok())
                .filter(|c| valid_id(&c.id))
                .collect()
        })
        .unwrap_or_default();
    comments.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
    remember(project_dir, comments.iter().map(|c| c.id.clone()));
    comments
}

/// The ids of the comment files in the project, parsed or not.
pub fn ids_on_disk(project_dir: &Path) -> Vec<String> {
    fs::read_dir(comments_dir(project_dir))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.strip_suffix(".json").map(str::to_string)
                })
                .filter(|id| valid_id(id))
                .collect()
        })
        .unwrap_or_default()
}

/// Writes comments that came from elsewhere (a review page), each only
/// if its file is not there yet; returns the ids written. They are not
/// remembered as read, so a save from an older list leaves them alone.
pub fn add_new(project_dir: &Path, comments: &[Comment]) -> Result<Vec<String>, String> {
    migrate(project_dir);
    let mut written = Vec::new();
    for comment in comments.iter().filter(|c| valid_id(&c.id)) {
        if comment_path(project_dir, &comment.id).exists() {
            continue;
        }
        fs::create_dir_all(comments_dir(project_dir))
            .map_err(|e| format!("failed to create .polemic/comments: {e}"))?;
        write_one(project_dir, comment)?;
        written.push(comment.id.clone());
    }
    Ok(written)
}

/// Write the editor's list: each comment to its file, and the files of
/// comments it removed deleted.
pub fn save(project_dir: &Path, comments: &[Comment]) -> Result<(), String> {
    if let Some(bad) = comments.iter().find(|c| !valid_id(&c.id)) {
        return Err(format!("invalid comment id: {}", bad.id));
    }
    // A list() first moves any comments.json still there.
    migrate(project_dir);
    fs::create_dir_all(comments_dir(project_dir))
        .map_err(|e| format!("failed to create .polemic/comments: {e}"))?;
    for comment in comments {
        write_one(project_dir, comment)?;
    }
    let kept: HashSet<&str> = comments.iter().map(|c| c.id.as_str()).collect();
    for id in known_ids(project_dir) {
        if !kept.contains(id.as_str()) {
            match fs::remove_file(comment_path(project_dir, &id)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("failed to delete comment: {e}")),
            }
        }
    }
    remember(project_dir, comments.iter().map(|c| c.id.clone()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_comments_without_a_suggestion_and_keeps_one() {
        let old = r#"[{"id":"a","file":"main.tex","category":"change","text":"Hi",
            "createdAt":1,"resolved":false,"anchor":null}]"#;
        let comments: Vec<Comment> = serde_json::from_str(old).unwrap();
        assert_eq!(comments[0].suggestion, None);
        let json = serde_json::to_string(&comments).unwrap();
        assert!(!json.contains("suggestion"));

        let reply = r#"[{"id":"b","file":"main.tex","category":"change","text":"Yes",
            "createdAt":2,"resolved":false,"anchor":null,"suggestion":"LG\u0000Why?"}]"#;
        let comments: Vec<Comment> = serde_json::from_str(reply).unwrap();
        assert_eq!(comments[0].suggestion.as_deref(), Some("LG\u{0}Why?"));
        let back: Vec<Comment> =
            serde_json::from_str(&serde_json::to_string(&comments).unwrap()).unwrap();
        assert_eq!(back[0].suggestion, comments[0].suggestion);
    }

    fn temp_project(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("polemic-comments-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn comment(id: &str, created_at: u64, text: &str) -> Comment {
        Comment {
            id: id.into(),
            file: "main.tex".into(),
            category: "change".into(),
            text: text.into(),
            created_at,
            resolved: false,
            anchor: None,
            suggestion: None,
            author: None,
            reply_to: None,
        }
    }

    fn files(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(comments_dir(dir))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn moves_comments_json_into_one_file_each() {
        let dir = temp_project("migrate");
        fs::create_dir_all(dir.join(".polemic")).unwrap();
        let old = serde_json::to_string(&vec![comment("b", 2, "second"), comment("a", 1, "first")]).unwrap();
        fs::write(legacy_file(&dir), old).unwrap();

        let comments = list(&dir);
        assert_eq!(comments.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(), ["first", "second"]);
        assert_eq!(files(&dir), ["a.json", "b.json"]);
        assert!(!legacy_file(&dir).exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn saves_each_comment_and_deletes_only_removed_ones() {
        let dir = temp_project("save");
        assert!(list(&dir).is_empty());
        save(&dir, &[comment("a", 1, "one"), comment("b", 2, "two")]).unwrap();
        assert_eq!(files(&dir), ["a.json", "b.json"]);

        // A pull brings a comment from another device after the last read.
        fs::write(comment_path(&dir, "c"), serde_json::to_string(&comment("c", 3, "theirs")).unwrap()).unwrap();
        // The editor removes "a" and edits "b", knowing nothing of "c".
        save(&dir, &[comment("b", 2, "two, edited")]).unwrap();
        assert_eq!(files(&dir), ["b.json", "c.json"]);
        let texts: Vec<String> = list(&dir).into_iter().map(|c| c.text).collect();
        assert_eq!(texts, ["two, edited", "theirs"]);

        // Once read, "c" can be removed like any other.
        save(&dir, &[comment("b", 2, "two, edited")]).unwrap();
        assert_eq!(files(&dir), ["b.json"]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn skips_unreadable_files_and_refuses_unsafe_ids() {
        let dir = temp_project("bad");
        save(&dir, &[comment("a", 1, "one")]).unwrap();
        fs::write(comments_dir(&dir).join("x.json"), "<<<<<<< HEAD\n{}\n").unwrap();
        assert_eq!(list(&dir).len(), 1);
        save(&dir, &[]).unwrap();
        // The conflicted file is the user's to resolve, not to delete.
        assert_eq!(files(&dir), ["x.json"]);
        assert!(save(&dir, &[comment("../evil", 1, "x")]).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unchanged_comments_are_not_rewritten() {
        let dir = temp_project("churn");
        save(&dir, &[comment("a", 1, "one")]).unwrap();
        let path = comment_path(&dir, "a");
        let before = fs::metadata(&path).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        save(&dir, &[comment("a", 1, "one")]).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), before);
        let _ = fs::remove_dir_all(dir);
    }

    /// What the review page writes (JSON.stringify(comment, null, 2)).
    const FROM_REVIEW: &str = r#"{
  "id": "r1",
  "file": "main.tex",
  "category": "question",
  "text": "Which world?",
  "createdAt": 5,
  "resolved": false,
  "anchor": {
    "text": "Hello, world.",
    "line": 3
  },
  "author": {
    "name": "Gina Guest",
    "verified": false
  },
  "replyTo": "a"
}"#;

    #[test]
    fn keeps_a_review_comment_byte_for_byte() {
        let comment: Comment = serde_json::from_str(FROM_REVIEW).unwrap();
        assert_eq!(
            comment.author,
            Some(CommentAuthor {
                name: "Gina Guest".into(),
                verified: false
            })
        );
        assert_eq!(comment.reply_to.as_deref(), Some("a"));
        assert_eq!(serde_json::to_string_pretty(&comment).unwrap(), FROM_REVIEW);
        // The project's own comments gain no keys.
        let own = serde_json::to_string(&comment_with_id("b")).unwrap();
        assert!(!own.contains("author") && !own.contains("replyTo"));
    }

    fn comment_with_id(id: &str) -> Comment {
        comment(id, 1, "one")
    }

    #[test]
    fn adds_new_comments_without_touching_existing_ones() {
        let dir = temp_project("add-new");
        save(&dir, &[comment("a", 1, "mine")]).unwrap();
        let review: Comment = serde_json::from_str(FROM_REVIEW).unwrap();
        let clash = comment("a", 9, "not mine");
        let bad = comment("../x", 9, "escape");
        let written = add_new(&dir, &[review.clone(), clash, bad]).unwrap();
        assert_eq!(written, ["r1"]);
        assert_eq!(files(&dir), ["a.json", "r1.json"]);
        assert_eq!(list(&dir)[0].text, "mine");
        assert_eq!(
            fs::read_to_string(comment_path(&dir, "r1")).unwrap(),
            FROM_REVIEW
        );
        let mut ids = ids_on_disk(&dir);
        ids.sort();
        assert_eq!(ids, ["a", "r1"]);
        assert!(add_new(&dir, &[review]).unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_save_from_an_older_list_keeps_added_comments() {
        let dir = temp_project("add-new-save");
        save(&dir, &[comment("a", 1, "one")]).unwrap();
        list(&dir);
        add_new(&dir, &[serde_json::from_str(FROM_REVIEW).unwrap()]).unwrap();
        // The editor's list was read before the pull.
        save(&dir, &[comment("a", 1, "one, edited")]).unwrap();
        assert_eq!(files(&dir), ["a.json", "r1.json"]);
        let _ = fs::remove_dir_all(dir);
    }
}
