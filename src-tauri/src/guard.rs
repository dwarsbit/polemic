//! The project folders backend commands may touch. A project joins
//! when the user opens or creates it (from the recent list, or a
//! folder picked in a native dialog Rust-side); commands handed any
//! other folder are refused, so a script in the webview cannot point
//! file, git, or compile commands at an arbitrary directory.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

fn allowed() -> &'static Mutex<HashSet<PathBuf>> {
    static ALLOWED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    ALLOWED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Admit a canonical project folder.
pub fn allow(dir: &Path) {
    if let Ok(mut set) = allowed().lock() {
        set.insert(dir.to_path_buf());
    }
}

pub fn forget(dir: &Path) {
    if let Ok(mut set) = allowed().lock() {
        set.remove(dir);
    }
}

pub fn is_allowed(dir: &Path) -> bool {
    allowed().lock().map(|set| set.contains(dir)).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admits_only_allowed_folders() {
        let dir = std::env::temp_dir().join(format!("polemic-guard-{}", std::process::id()));
        assert!(!is_allowed(&dir));
        allow(&dir);
        assert!(is_allowed(&dir));
        assert!(!is_allowed(dir.parent().unwrap()));
        forget(&dir);
        assert!(!is_allowed(&dir));
    }
}
