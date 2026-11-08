//! Native action preflight. Projection fields never grant authority.
use crate::{
    command::{agent_name, namespace, Origin},
    publisher::open_directory,
    ProcessState, Record, Snapshot, MAX_FILES,
};
use cap_primitives::fs::FollowSymlinks;
use cap_std::fs::OpenOptions;
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    io::{self, Read},
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize)]
pub struct Pane {
    pub id: u32,
    pub is_plugin: bool,
    pub tab_id: u32,
    #[serde(default)]
    pub is_focused: bool,
    #[serde(default)]
    pub is_floating: bool,
    #[serde(default)]
    pub exited: bool,
    #[serde(default)]
    pub is_selectable: Option<bool>,
    #[serde(default)]
    pub is_suppressed: Option<bool>,
    #[serde(default)]
    pub pane_cwd: Option<String>,
}
pub fn parse_panes(bytes: &[u8]) -> Result<Vec<Pane>, String> {
    if bytes.len() > 512 * 1024 {
        return Err("Host metadata exceeds bound".into());
    }
    let panes: Vec<Pane> = serde_json::from_slice(bytes).map_err(|_| "Invalid host metadata")?;
    let mut ids = BTreeSet::new();
    if panes.len() > MAX_FILES || panes.iter().any(|p| !ids.insert((p.is_plugin, p.id))) {
        return Err("Ambiguous host metadata".into());
    }
    Ok(panes)
}
#[derive(Clone, Debug)]
pub struct Guard {
    pub record: Record,
    pub version: String,
    pub own_tab: u32,
    pub origin: Origin,
    pub target_pane: u32,
}
fn claim(record: &Record) -> Option<(&str, u32)> {
    Some((
        record.zellij.get("sessionName")?.as_str()?,
        u32::try_from(record.zellij.get("paneId")?.as_u64()?).ok()?,
    ))
}
fn normalized(path: &str) -> Option<PathBuf> {
    if !Path::new(path).is_absolute() || path.len() > 4096 || path.chars().any(char::is_control) {
        return None;
    }
    let mut result = PathBuf::from("/");
    for component in Path::new(path).components() {
        match component {
            Component::RootDir | Component::CurDir => {}
            Component::Normal(v) => result.push(v),
            Component::ParentDir => {
                result.pop();
            }
            _ => return None,
        }
    }
    Some(result)
}
pub struct Context<'a> {
    pub scope: &'a str,
    pub session: &'a str,
    pub origin: Origin,
    pub require_focus: bool,
    pub now: u64,
}
/// Caller must obtain full host metadata, then reread canonical state, in that order.
pub fn validate(
    snapshot: &Snapshot,
    panes: &[Pane],
    context: Context<'_>,
    id: &str,
    version: &str,
) -> Result<Guard, String> {
    let Context {
        scope,
        session,
        origin,
        require_focus,
        now,
    } = context;
    if snapshot.skipped > 0 || snapshot.capped {
        return Err("Incomplete canonical registry; action refused".into());
    }
    let own = panes
        .iter()
        .find(|p| p.is_plugin && p.id == origin.plugin_id)
        .ok_or("Originating view disappeared")?;
    if own.exited
        || own.is_selectable == Some(false)
        || own.is_suppressed == Some(true)
        || (require_focus && !own.is_focused)
    {
        return Err("Originating view is unavailable".into());
    }
    let record = snapshot
        .canonical
        .iter()
        .find(|r| r.id == id && r.kind != "external" && r.belongs_to(scope))
        .ok_or("Agent left this scope")?;
    if record.version() != version {
        return Err("Agent identity or state changed".into());
    }
    let row = snapshot
        .rows(scope)
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("Agent unavailable")?;
    if row.state != ProcessState::Live
        || record.status == "terminated"
        || record.parent_id.is_some()
    {
        return Err("Agent has no verified live terminal".into());
    }
    let heartbeat = record
        .heartbeat
        .filter(|n| n.is_finite())
        .ok_or("Agent observation is stale")?;
    let age = now as f64 - heartbeat;
    if !(0.0..=30_000.0).contains(&age) {
        return Err("Agent observation is stale".into());
    }
    let (target_session, target_pane) = claim(record).ok_or("Invalid agent pane metadata")?;
    if target_session != session {
        return Err("No pane in this session".into());
    }
    if snapshot
        .canonical
        .iter()
        .filter(|r| claim(r) == Some((target_session, target_pane)))
        .count()
        != 1
    {
        return Err("Ambiguous agent pane claim".into());
    }
    let target = panes
        .iter()
        .find(|p| !p.is_plugin && p.id == target_pane)
        .ok_or("Agent pane disappeared")?;
    if target.tab_id != own.tab_id {
        return Err("No agent pane in this tab".into());
    }
    if target.exited || target.is_selectable == Some(false) || target.is_suppressed == Some(true) {
        return Err("Agent pane unavailable".into());
    }
    let expected = normalized(&record.cwd).ok_or("Invalid canonical cwd")?;
    if target.pane_cwd.as_deref().and_then(normalized) != Some(expected) {
        return Err("Actual pane cwd changed".into());
    }
    Ok(Guard {
        record: record.clone(),
        version: version.into(),
        own_tab: own.tab_id,
        origin,
        target_pane,
    })
}
pub fn binding_matches(old: &Guard, current: &Guard) -> bool {
    old.own_tab == current.own_tab
        && old.origin == current.origin
        && old.target_pane == current.target_pane
        && old.version == current.version
}
pub fn name_available(registry: &Path, name: &str) -> io::Result<bool> {
    let dir = open_directory(registry)?;
    for (i, entry) in dir.entries()?.enumerate() {
        if i == MAX_FILES {
            return Ok(false);
        }
        let entry = entry?;
        let Some(file) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !file.ends_with(".json") {
            continue;
        }
        // Unknown private claims fail closed without reading private data.
        if file.starts_with('.') {
            return Ok(false);
        }
        let mut options = OpenOptions::new();
        options.read(true);
        options._cap_fs_ext_follow(FollowSymlinks::No);
        options._cap_fs_ext_nonblock(true);
        let source = dir.open_with(&file, &options)?;
        let meta = source.metadata()?;
        if !meta.is_file() || meta.len() > 65536 {
            return Ok(false);
        }
        let mut bytes = Vec::new();
        source.take(65537).read_to_end(&mut bytes)?;
        if bytes.len() > 65536 {
            return Ok(false);
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
        if file == "namespace-owners.json" {
            let Some(owners) = value.get("owners").and_then(|v| v.as_array()) else {
                return Ok(false);
            };
            if owners.iter().any(|o| {
                o.get("name")
                    .and_then(|v| v.as_str())
                    .is_some_and(|n| n.eq_ignore_ascii_case(name))
            }) {
                return Ok(false);
            }
        } else {
            let Some(id) = value.get("id").and_then(|v| v.as_str()) else {
                return Ok(false);
            };
            if file != format!("{id}.json")
                || value
                    .get("pid")
                    .and_then(|v| v.as_u64())
                    .is_none_or(|p| p == 0)
            {
                return Ok(false);
            }
            if ["name", "declared_name", "spawn_name", "namespace"]
                .iter()
                .any(|k| {
                    value
                        .get(*k)
                        .and_then(|v| v.as_str())
                        .is_some_and(|n| n.eq_ignore_ascii_case(name))
                })
            {
                return Ok(false);
            }
        }
    }
    Ok(true)
}
pub fn create_argv(
    session: &str,
    scope: &str,
    name: &str,
    guard: &Guard,
    panes: &[Pane],
) -> Result<Vec<String>, String> {
    if !agent_name(name) || !namespace(scope) {
        return Err("Invalid agent name or namespace".into());
    }
    if name.eq_ignore_ascii_case(scope) {
        return Err("Name already in use".into());
    }
    if panes
        .iter()
        .filter(|p| !p.is_plugin && p.tab_id == guard.own_tab)
        .count()
        >= 32
    {
        return Err("Tab pane limit reached".into());
    }
    let mut args = vec![
        "--session".into(),
        session.into(),
        "action".into(),
        "new-pane".into(),
        "--tab-id".into(),
        guard.own_tab.to_string(),
        "--floating".into(),
        "--cwd".into(),
        guard.record.cwd.clone(),
        "--name".into(),
        name.into(),
        "--".into(),
        "env".into(),
    ];
    for key in [
        "MATRIX_ACCESS_TOKEN",
        "MATRIX_BOT_TOKEN",
        "MATRIX_BOT_PASSWORD",
        "MATRIX_RECOVERY_PASSPHRASE",
        "PI_PANOPTICON_PARENT_ID",
        "PI_CODING_AGENT_SESSION_DIR",
    ] {
        args.extend(["-u".into(), key.into()]);
    }
    args.extend([
        "PI_MATRIX_DISABLED=1".into(),
        format!("PI_PANOPTICON_NAMESPACE={scope}"),
        format!("PI_PANOPTICON_SPAWN_NAME={name}"),
        "pi".into(),
        "--name".into(),
        name.into(),
    ]);
    Ok(args)
}
pub fn close_argv(session: &str, guard: &Guard) -> Vec<String> {
    vec![
        "--session".into(),
        session.into(),
        "action".into(),
        "close-pane".into(),
        "--pane-id".into(),
        format!("terminal_{}", guard.target_pane),
    ]
}
