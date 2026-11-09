//! Shared rejection fingerprint for the actual pane cwd. Never a path export.
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
pub fn cwd_hash(value: &Path) -> Option<String> {
    let text = value.to_str()?;
    if !value.is_absolute() || text.len() > 4096 || text.chars().any(char::is_control) {
        return None;
    }
    let mut normalized = PathBuf::from("/");
    for part in value.components() {
        match part {
            Component::RootDir | Component::CurDir => {}
            Component::Normal(v) => normalized.push(v),
            Component::ParentDir => {
                normalized.pop();
            }
            _ => return None,
        }
    }
    Some(format!(
        "{:x}",
        Sha256::digest(normalized.to_str()?.as_bytes())
    ))
}
