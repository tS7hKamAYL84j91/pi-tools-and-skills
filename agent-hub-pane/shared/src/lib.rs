//! Read-only shared projection. No transcript/mailbox reads or registry writes.
use cap_primitives::fs::{open_dir_nofollow, FollowSymlinks};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
pub mod action_view;
#[cfg(not(target_os = "wasi"))]
pub mod authority;
pub mod color;
pub mod command;
#[cfg(not(target_os = "wasi"))]
pub mod executor;
pub mod focus;
pub mod frame;
#[cfg(not(target_os = "wasi"))]
pub mod host;
pub mod inbox;
#[cfg(not(target_os = "wasi"))]
pub mod publisher;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Read};
use std::path::{Component, Path};

pub const MAX_FILES: usize = 4096;
const MAX_RECORD: u64 = 64 * 1024;

pub fn scope_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

/// Bounded printable text, clipped by terminal cells. Controls, bidi overrides
/// and line separators cannot inject terminal commands or reorder the UI.
pub fn text(value: &str, limit: usize) -> String {
    use unicode_width::UnicodeWidthChar;
    let mut cells = 0;
    let mut result = String::new();
    for c in value.chars() {
        let c = if c.is_control()
            || matches!(c,
                '\u{00ad}' | '\u{0600}'..='\u{0605}' | '\u{061c}' | '\u{06dd}' | '\u{070f}' |
                '\u{0890}'..='\u{0891}' | '\u{08e2}' | '\u{180e}' | '\u{200b}'..='\u{200f}' |
                '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}' | '\u{fff9}'..='\u{fffb}' |
                '\u{110bd}' | '\u{110cd}' | '\u{13430}'..='\u{1343f}' | '\u{1bca0}'..='\u{1bca3}' |
                '\u{1d173}'..='\u{1d17a}' | '\u{e0001}' | '\u{e0020}'..='\u{e007f}')
        {
            '?'
        } else {
            c
        };
        let width = c.width().unwrap_or(0);
        if cells + width > limit || result.len() + c.len_utf8() > limit.saturating_mul(4) {
            break;
        }
        cells += width;
        result.push(c);
    }
    result
}

fn field(value: &str, bytes: usize) -> String {
    let mut value = text(value, bytes);
    while value.len() > bytes {
        value.pop();
    }
    value
}

pub fn registry_dir(mut dir: Dir, relative: &str) -> io::Result<Dir> {
    let path = Path::new(relative);
    if relative.is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "relative registry path required",
        ));
    }
    // WASI has no descriptor dup; transfer ownership while walking instead.
    for component in path.components() {
        let parent = dir.into_std_file();
        dir = Dir::from_std_file(open_dir_nofollow(
            &parent,
            Path::new(component.as_os_str()),
        )?);
    }
    Ok(dir)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Record {
    pub id: String,
    pub name: String,
    pub pid: u32,
    #[serde(default, rename = "startedAt")]
    pub started_at: Option<f64>,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub declared_name: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub spawn_name: Option<String>,
    #[serde(default)]
    pub heartbeat: Option<f64>,
    #[serde(default)]
    pub cwd: String,
    #[serde(default, rename = "parentId")]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub zellij: serde_json::Value,
}
impl Record {
    /// Rejection fingerprint only. Actual authorization always rereads canonical data.
    pub fn version(&self) -> String {
        use sha2::{Digest, Sha256};
        let identity = serde_json::json!([
            self.id,
            self.pid,
            self.started_at,
            self.name,
            self.status,
            self.namespace,
            self.declared_name,
            self.cwd,
            self.parent_id,
            self.zellij
        ]);
        format!("{:x}", Sha256::digest(identity.to_string().as_bytes()))
    }
    pub fn belongs_to(&self, scope: &str) -> bool {
        if let Some(namespace) = &self.namespace {
            namespace == &scope.to_ascii_lowercase()
        } else {
            self.declared_name.as_deref().unwrap_or(&self.name) == scope
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcessState {
    Live,
    Stale,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub id: String,
    pub name: String,
    pub status: String,
    pub model: String,
    pub lead: bool,
    pub state: ProcessState,
    pub version: String,
    #[serde(default)]
    pub incarnation: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub age: String,
    #[serde(default)]
    pub pane_id: Option<u32>,
    #[serde(skip)]
    anchor: String,
}

#[derive(Default, Debug)]
pub struct Snapshot {
    groups: BTreeMap<String, Vec<Row>>,
    pub records: usize,
    pub reads: usize,
    pub skipped: usize,
    pub capped: bool,
    pub captured_at_ms: u64,
    /// Native authority input only; never serialized into presentation frames.
    pub canonical: Vec<Record>,
}

impl Snapshot {
    pub fn scan(dir: &Dir) -> io::Result<Self> {
        Self::scan_with_state(dir, |_, _| ProcessState::Unknown)
    }

    pub fn scan_with_state(
        dir: &Dir,
        mut state: impl FnMut(u32, Option<f64>) -> ProcessState,
    ) -> io::Result<Self> {
        let mut snapshot = Self::default();
        let mut seen = BTreeSet::new();
        for (i, entry) in dir.entries()?.enumerate() {
            if i == MAX_FILES {
                snapshot.capped = true;
                break;
            }
            let entry = entry?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if name.starts_with('.') || name == "namespace-owners.json" || !name.ends_with(".json")
            {
                continue;
            }
            // Directory iteration under concurrent replacement need not be a
            // transaction. Do not reread or emit a canonical filename twice.
            if !seen.insert(name.clone()) {
                continue;
            }
            let mut options = OpenOptions::new();
            options.read(true);
            // The public extension hooks avoid cap-fs-ext's unsupported WASI
            // metadata adapter, while retaining kernel no-follow/nonblocking opens.
            options._cap_fs_ext_follow(FollowSymlinks::No);
            options._cap_fs_ext_nonblock(true);
            let row = (|| -> io::Result<Record> {
                let file = dir.open_with(&name, &options)?;
                let meta = file.metadata()?;
                if !meta.is_file() || meta.len() > MAX_RECORD {
                    return Err(io::Error::other("not a bounded regular record"));
                }
                let mut bytes = Vec::new();
                file.take(MAX_RECORD + 1).read_to_end(&mut bytes)?;
                if bytes.len() as u64 > MAX_RECORD {
                    return Err(io::Error::other("record grew beyond bound"));
                }
                snapshot.reads += 1;
                serde_json::from_slice(&bytes).map_err(io::Error::other)
            })();
            let Ok(row) = row else {
                snapshot.skipped += 1;
                continue;
            };
            if row.pid == 0 || !scope_name(&row.id) || name != format!("{}.json", row.id) {
                snapshot.skipped += 1;
                continue;
            }
            snapshot.canonical.push(row.clone());
            if row.kind == "external" {
                continue;
            }
            let version = row.version();
            let incarnation = {
                use sha2::{Digest, Sha256};
                format!(
                    "{:x}",
                    Sha256::digest(
                        serde_json::json!([row.id, row.pid, row.started_at])
                            .to_string()
                            .as_bytes()
                    )
                )
            };
            let age = age(row.started_at, crate::frame::now_ms());
            let parent_id = row.parent_id.clone().filter(|id| scope_name(id));
            let pane_id = row
                .zellij
                .get("paneId")
                .and_then(|v| v.as_u64())
                .and_then(|n| u32::try_from(n).ok());
            let lead = row.namespace.is_none();
            let anchor = if lead {
                row.declared_name.unwrap_or_else(|| row.name.clone())
            } else {
                row.namespace.unwrap()
            };
            if !scope_name(&anchor) || (!lead && anchor != anchor.to_lowercase()) {
                snapshot.skipped += 1;
                continue;
            }
            snapshot
                .groups
                .entry(anchor.to_lowercase())
                .or_default()
                .push(Row {
                    id: row.id,
                    name: field(&row.name, 96),
                    status: field(&row.status, 16),
                    model: field(&row.model, 96),
                    lead,
                    state: state(row.pid, row.started_at),
                    version,
                    incarnation,
                    parent_id,
                    age,
                    pane_id,
                    anchor,
                });
            snapshot.records += 1;
        }
        for rows in snapshot.groups.values_mut() {
            rows.sort_by(|a, b| {
                b.lead
                    .cmp(&a.lead)
                    .then(a.name.cmp(&b.name))
                    .then(a.id.cmp(&b.id))
            });
        }
        snapshot.captured_at_ms = crate::frame::now_ms();
        Ok(snapshot)
    }

    /// Only the indexed scope bucket is visited; never rescan A for each tab.
    pub fn rows(&self, scope: &str) -> Vec<&Row> {
        self.groups
            .get(&scope.to_lowercase())
            .into_iter()
            .flatten()
            .filter(|row| !row.lead || row.anchor == scope)
            .collect()
    }
}

#[derive(Default, Debug)]
pub struct View {
    pub selected: Option<String>,
    pub offset: usize,
    /// One ID per displayed line, including a wrapped details line.
    pub line_ids: Vec<String>,
}
impl View {
    pub fn step(&mut self, rows: &[&Row], delta: isize) {
        if rows.is_empty() {
            self.selected = None;
            self.offset = 0;
            return;
        }
        let current = self
            .selected
            .as_ref()
            .and_then(|id| rows.iter().position(|r| &r.id == id))
            .unwrap_or(0);
        let index = current.saturating_add_signed(delta).min(rows.len() - 1);
        self.selected = Some(rows[index].id.clone());
    }
    pub fn render(&mut self, rows: &[&Row], capacity: usize, width: usize) -> Vec<String> {
        if self.selected.is_none() {
            self.selected = rows.first().map(|r| r.id.clone());
        }
        if let Some(index) = self
            .selected
            .as_ref()
            .and_then(|id| rows.iter().position(|r| &r.id == id))
        {
            if index < self.offset {
                self.offset = index;
            }
            if capacity > 0 && index >= self.offset + capacity {
                self.offset = index + 1 - capacity;
            }
        }
        self.offset = self.offset.min(rows.len().saturating_sub(1));
        let selected = self
            .selected
            .as_ref()
            .and_then(|id| rows.iter().position(|r| &r.id == id));
        if let Some(selected) = selected {
            while self.offset < selected
                && rows[self.offset..=selected]
                    .iter()
                    .map(|r| row_lines(r, width).len())
                    .sum::<usize>()
                    > capacity
            {
                self.offset += 1;
            }
        }
        self.line_ids.clear();
        let mut lines = Vec::new();
        for row in rows.iter().skip(self.offset) {
            let row_lines = row_lines(row, width);
            if lines.len() + row_lines.len() > capacity {
                break;
            }
            for line in row_lines {
                self.line_ids.push(row.id.clone());
                let marker = if self.selected.as_ref() == Some(&row.id) {
                    ">"
                } else {
                    " "
                };
                lines.push(text(&format!("{marker}{line}"), width));
            }
        }
        lines
    }
}

/// Stable grouping, including orphan/cyclic children exactly once. Local lead
/// designation changes presentation only, never the canonical registry.
pub fn ordered<'a>(rows: &'a [Row], chosen: Option<&str>) -> Vec<&'a Row> {
    let mut result = Vec::new();
    let mut seen = BTreeSet::new();
    let roots = chosen
        .and_then(|id| rows.iter().find(|r| r.id == id))
        .into_iter()
        .chain(rows.iter().filter(|r| r.parent_id.is_none()));
    for root in roots {
        if seen.insert(&root.id) {
            result.push(root);
        }
        for child in rows
            .iter()
            .filter(|r| r.parent_id.as_deref() == Some(&root.id))
        {
            if seen.insert(&child.id) {
                result.push(child);
            }
        }
    }
    for row in rows {
        if seen.insert(&row.id) {
            result.push(row);
        }
    }
    result
}

pub fn age(started: Option<f64>, now: u64) -> String {
    let Some(started) = started.filter(|s| s.is_finite() && *s > 0.0) else {
        return String::new();
    };
    let seconds = (now.saturating_sub(started as u64) as f64 / 1000.0).round() as u64;
    if seconds < 60 {
        return "<1m".into();
    }
    let minutes = (seconds as f64 / 60.0).round() as u64;
    if minutes < 60 {
        format!("{minutes}m")
    } else {
        format!("{}h", (minutes as f64 / 60.0).round() as u64)
    }
}

fn row_lines(row: &Row, width: usize) -> Vec<String> {
    let status = match row.status.as_str() {
        "running" => "R",
        "waiting" => "W",
        "blocked" => "B",
        "stalled" => "S",
        "terminated" => "X",
        "done" => "D",
        _ => "?",
    };
    let model = row.model.rsplit('/').next().unwrap_or("");
    let model = model
        .strip_suffix(":cloud")
        .or_else(|| model.strip_suffix(":latest"))
        .unwrap_or(model);
    let health = match row.state {
        ProcessState::Live => "",
        ProcessState::Stale => " [dead]",
        ProcessState::Unknown => " [?]",
    };
    let indent = if row.parent_id.is_some() { "  + " } else { "" };
    let title = format!("{status} {indent}{}{health}", row.name);
    let mut details = row.status.clone();
    if !model.is_empty() {
        details.push_str(&format!(" | {model}"));
    }
    if !row.age.is_empty() {
        details.push_str(&format!(" | up {}", row.age));
    }
    let single = format!("{title} | {details}");
    if unicode_width::UnicodeWidthStr::width(single.as_str()) < width || width < 16 {
        vec![text(&single, width.saturating_sub(1))]
    } else {
        vec![
            text(&title, width.saturating_sub(1)),
            text(&format!("  {indent}{details}"), width.saturating_sub(1)),
        ]
    }
}
