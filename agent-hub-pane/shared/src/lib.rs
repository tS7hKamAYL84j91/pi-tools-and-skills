//! Read-only shared projection. No transcript/mailbox reads or registry writes.
use cap_primitives::fs::{open_dir_nofollow, FollowSymlinks};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
pub mod frame;
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

/// Prototype ASCII fallback: controls/ANSI/non-ASCII cannot become terminal commands.
pub fn text(value: &str, limit: usize) -> String {
    value
        .chars()
        .take(limit)
        .map(|c| {
            if c.is_ascii_graphic() || c == ' ' {
                c
            } else {
                '?'
            }
        })
        .collect()
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

#[derive(Deserialize)]
struct Record {
    id: String,
    name: String,
    pid: u32,
    #[serde(default, rename = "startedAt")]
    started_at: Option<f64>,
    #[serde(default)]
    namespace: Option<String>,
    #[serde(default)]
    declared_name: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    kind: String,
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
    #[serde(skip)]
    anchor: String,
}

#[derive(Default, Debug, Eq, PartialEq)]
pub struct Snapshot {
    groups: BTreeMap<String, Vec<Row>>,
    pub records: usize,
    pub reads: usize,
    pub skipped: usize,
    pub capped: bool,
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
            if row.kind == "external" {
                continue;
            }
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
                    name: text(&row.name, 96),
                    status: text(&row.status, 16),
                    model: text(&row.model, 96),
                    lead,
                    state: state(row.pid, row.started_at),
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
        rows.iter()
            .skip(self.offset)
            .take(capacity)
            .map(|row| {
                let marker = if self.selected.as_ref() == Some(&row.id) {
                    ">"
                } else {
                    " "
                };
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
                let health = match row.state {
                    ProcessState::Live => "",
                    ProcessState::Stale => " [dead]",
                    ProcessState::Unknown => " [?]",
                };
                text(
                    &format!("{marker}{status} {}{health} | {model}", row.name),
                    width,
                )
            })
            .collect()
    }
}
