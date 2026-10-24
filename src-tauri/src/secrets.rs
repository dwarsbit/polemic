//! API keys (the AI provider's, Zotero cloud keys) live in the OS
//! credential store — the macOS Keychain, Windows Credential Manager,
//! the Secret Service on Linux — not in settings.json. In memory the
//! settings still carry them, so the rest of the app is unchanged;
//! only what reaches the disk differs. All keys share one credential
//! (a JSON map), so removed sources leave nothing behind. When no
//! credential store is available, the keys stay in settings.json
//! (mode 0600), as before.

use std::collections::BTreeMap;
use std::sync::Mutex;

use crate::settings::Settings;

pub type Secrets = BTreeMap<String, String>;

const AI: &str = "ai";

fn source_key(id: &str) -> String {
    format!("source:{id}")
}

fn take(value: &mut Option<String>) -> Option<String> {
    value.take().filter(|v| !v.is_empty())
}

/// Split the keys out of a settings copy: (what goes to disk, the keys).
pub fn extract(settings: &Settings) -> (Settings, Secrets) {
    let mut disk = settings.clone();
    let mut secrets = Secrets::new();
    if let Some(ai) = disk.ai.as_mut() {
        if let Some(key) = take(&mut ai.api_key) {
            secrets.insert(AI.into(), key);
        }
    }
    for source in disk.sources.iter_mut() {
        if let Some(key) = take(&mut source.api_key) {
            secrets.insert(source_key(&source.id), key);
        }
    }
    (disk, secrets)
}

/// Fill keys the settings lack from the store's map. Keys still in the
/// file (written before the move, or with no store available) win.
pub fn inject(settings: &mut Settings, secrets: &Secrets) {
    if let Some(ai) = settings.ai.as_mut() {
        if ai.api_key.as_deref().unwrap_or("").is_empty() {
            ai.api_key = secrets.get(AI).cloned();
        }
    }
    for source in settings.sources.iter_mut() {
        if source.api_key.as_deref().unwrap_or("").is_empty() {
            if let Some(key) = secrets.get(&source_key(&source.id)) {
                source.api_key = Some(key.clone());
            }
        }
    }
}

/// Does the settings file still hold keys in plain text?
pub fn has_plaintext(settings: &Settings) -> bool {
    !extract(settings).1.is_empty()
}

/// Where the key map is kept.
pub trait Store: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

pub struct OsStore;

impl OsStore {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new("polemic", "api-keys").map_err(|e| e.to_string())
    }
}

impl Store for OsStore {
    fn get(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, value: &str) -> Result<(), String> {
        Self::entry()?.set_password(value).map_err(|e| e.to_string())
    }

    fn delete(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Keys through the store, with the last value written remembered so
/// the frequent settings saves (layout, zoom) never touch the store.
pub struct Vault<S: Store> {
    store: S,
    last: Mutex<Option<Secrets>>,
    /// Set after a failed write: the store is missing this session.
    unavailable: std::sync::atomic::AtomicBool,
}

impl<S: Store> Vault<S> {
    pub const fn new(store: S) -> Self {
        Vault {
            store,
            last: Mutex::new(None),
            unavailable: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// The stored key map; empty when none is stored or the store is
    /// unavailable.
    pub fn load(&self) -> Secrets {
        let secrets: Secrets = self
            .store
            .get()
            .ok()
            .flatten()
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();
        if let Ok(mut last) = self.last.lock() {
            *last = Some(secrets.clone());
        }
        secrets
    }

    /// The settings to write to disk: keys removed when the store took
    /// them, left in place when it could not.
    pub fn persist(&self, settings: &Settings) -> Settings {
        use std::sync::atomic::Ordering;
        if self.unavailable.load(Ordering::Relaxed) {
            return settings.clone();
        }
        let (disk, secrets) = extract(settings);
        let Ok(mut last) = self.last.lock() else {
            return settings.clone();
        };
        if last.as_ref() == Some(&secrets) {
            return disk;
        }
        let stored = if secrets.is_empty() {
            self.store.delete()
        } else {
            serde_json::to_string(&secrets)
                .map_err(|e| e.to_string())
                .and_then(|json| self.store.set(&json))
        };
        match stored {
            Ok(()) => {
                *last = Some(secrets);
                disk
            }
            Err(e) => {
                self.unavailable.store(true, Ordering::Relaxed);
                eprintln!("polemic: credential store unavailable, keeping API keys in settings.json: {e}");
                settings.clone()
            }
        }
    }
}

pub static VAULT: Vault<OsStore> = Vault::new(OsStore);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{AiSettings, SourceDef};

    #[derive(Default)]
    struct MemoryStore {
        value: Mutex<Option<String>>,
        writes: Mutex<u32>,
        broken: bool,
    }

    impl Store for MemoryStore {
        fn get(&self) -> Result<Option<String>, String> {
            if self.broken {
                return Err("no store".into());
            }
            Ok(self.value.lock().unwrap().clone())
        }
        fn set(&self, value: &str) -> Result<(), String> {
            if self.broken {
                return Err("no store".into());
            }
            *self.writes.lock().unwrap() += 1;
            *self.value.lock().unwrap() = Some(value.into());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            if self.broken {
                return Err("no store".into());
            }
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    fn with_keys() -> Settings {
        Settings {
            ai: Some(AiSettings {
                base_url: Some("https://api.example.com/v1".into()),
                api_key: Some("sk-ai".into()),
                model: Some("m".into()),
            }),
            sources: vec![SourceDef {
                id: "z1".into(),
                kind: "zotero-cloud".into(),
                enabled: true,
                name: None,
                path: None,
                user_id: Some("42".into()),
                api_key: Some("zot-key".into()),
            }],
            ..Settings::default()
        }
    }

    #[test]
    fn keys_leave_the_file_and_come_back() {
        let vault = Vault::new(MemoryStore::default());
        let settings = with_keys();
        let disk = vault.persist(&settings);
        assert!(!has_plaintext(&disk));
        let json = serde_json::to_string(&disk).unwrap();
        assert!(!json.contains("sk-ai") && !json.contains("zot-key"));

        let mut loaded = disk.clone();
        inject(&mut loaded, &vault.load());
        assert_eq!(loaded.ai.unwrap().api_key.as_deref(), Some("sk-ai"));
        assert_eq!(loaded.sources[0].api_key.as_deref(), Some("zot-key"));
    }

    #[test]
    fn unchanged_keys_skip_the_store() {
        let vault = Vault::new(MemoryStore::default());
        let mut settings = with_keys();
        vault.persist(&settings);
        settings.preview_zoom = Some(1.5);
        vault.persist(&settings);
        assert_eq!(*vault.store.writes.lock().unwrap(), 1);
        // Removing every key clears the credential.
        settings.ai = None;
        settings.sources.clear();
        vault.persist(&settings);
        assert!(vault.store.value.lock().unwrap().is_none());
    }

    #[test]
    fn keeps_keys_in_the_file_without_a_store() {
        let vault = Vault::new(MemoryStore { broken: true, ..Default::default() });
        let disk = vault.persist(&with_keys());
        assert!(has_plaintext(&disk));
        assert!(vault.load().is_empty());
    }
}
