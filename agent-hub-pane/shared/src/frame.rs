//! Versioned, non-authoritative scoped presentation snapshots.
use crate::{scope_name, Row, MAX_FILES};
use cap_primitives::fs::FollowSymlinks;
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::{self, Read};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_FRAME_BYTES: u64 = 4 * 1024 * 1024;
pub const SNAPSHOT_FILE: &str = "snapshot.json";

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
pub fn scope_directory(scope: &str) -> io::Result<String> {
    if !scope_name(scope) {
        return Err(io::Error::other("invalid scope"));
    }
    Ok(format!("scope-{:x}", Sha256::digest(scope.as_bytes())))
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame {
    pub schema_version: u32,
    pub scope: String,
    pub instance: String,
    pub generation: u64,
    pub scanned_at_ms: u64,
    pub interval_ms: u64,
    pub rows: Vec<Row>,
    pub skipped: usize,
    pub capped: bool,
    pub stopped: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub controls: Option<crate::command::Controls>,
}
/// Retained across read failures. A new collector instance can restart its counter.
#[derive(Default)]
pub struct Watermark {
    instance: String,
    generation: u64,
}
impl Watermark {
    pub fn accept(&mut self, frame: &Frame) -> io::Result<()> {
        if self.instance == frame.instance && frame.generation < self.generation {
            return Err(io::Error::other("snapshot generation regressed"));
        }
        self.instance = frame.instance.clone();
        self.generation = frame.generation;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Freshness {
    Fresh,
    Stale,
    Stopped,
}
impl Frame {
    pub fn validate(&self, scope: &str, now: u64) -> io::Result<()> {
        if self.schema_version != 2
            || self.scope != scope
            || !scope_name(scope)
            || !scope_name(&self.instance)
            || self.generation == 0
            || self.rows.len() > MAX_FILES
            || self.controls.as_ref().is_some_and(|c| !c.valid())
            || !(250..=3_600_000).contains(&self.interval_ms)
            || self.scanned_at_ms == 0
            || self.scanned_at_ms > now.saturating_add(1000)
            || self
                .error
                .as_ref()
                .is_some_and(|s| s.len() > 128 || !plain(s))
        {
            return Err(io::Error::other("invalid scoped snapshot"));
        }
        let mut ids = BTreeSet::new();
        for row in &self.rows {
            if !scope_name(&row.id)
                || !crate::command::valid_version(&row.version)
                || !ids.insert(&row.id)
                || row.name.len() > 96
                || row.model.len() > 96
                || row.status.len() > 16
                || !plain(&row.name)
                || !plain(&row.model)
                || !plain(&row.status)
            {
                return Err(io::Error::other("invalid snapshot row"));
            }
        }
        Ok(())
    }
    pub fn same_presentation(&self, now: u64, other: &Self, other_now: u64) -> bool {
        self.rows == other.rows
            && self.skipped == other.skipped
            && self.capped == other.capped
            && self.error == other.error
            && self.controls == other.controls
            && self.freshness(now) == other.freshness(other_now)
    }
    pub fn freshness(&self, now: u64) -> Freshness {
        if self.stopped {
            Freshness::Stopped
        } else if now.saturating_sub(self.scanned_at_ms)
            > self.interval_ms.saturating_mul(3).max(5000)
        {
            Freshness::Stale
        } else {
            Freshness::Fresh
        }
    }
}
fn plain(value: &str) -> bool {
    value.bytes().all(|b| b == b' ' || b.is_ascii_graphic())
}

pub fn read_frame(dir: &Dir, scope: &str, now: u64) -> io::Result<Frame> {
    let mut options = OpenOptions::new();
    options.read(true);
    options._cap_fs_ext_follow(FollowSymlinks::No);
    options._cap_fs_ext_nonblock(true);
    let file = dir.open_with(SNAPSHOT_FILE, &options)?;
    let meta = file.metadata()?;
    if !meta.is_file() || meta.len() > MAX_FRAME_BYTES {
        return Err(io::Error::other("snapshot must be a bounded regular file"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_FRAME_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FRAME_BYTES {
        return Err(io::Error::other("snapshot grew beyond bound"));
    }
    let frame: Frame = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
    frame.validate(scope, now)?;
    Ok(frame)
}
