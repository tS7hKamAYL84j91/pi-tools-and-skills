//! Bounded intent/receipt protocol. These are not canonical agent records.
use crate::{scope_name, text};
use serde::{Deserialize, Serialize};

pub const MAX_REQUEST_BYTES: u64 = 8192;
pub const MAX_RECEIPTS: usize = 32;
pub const INBOX: &str = "inbox";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Origin {
    pub plugin_id: u32,
    pub client_id: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Intent {
    PrepareClose {
        agent_id: String,
        version: String,
    },
    PrepareNew {
        name: String,
        lead_id: String,
        version: String,
    },
    Confirm {
        prepared_id: String,
    },
    Cancel {
        prepared_id: String,
    },
    Focus {
        agent_id: String,
        version: String,
        pane_pid: u32,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: u32,
    pub id: String,
    pub epoch: String,
    pub origin: Origin,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub intent: Intent,
}
impl Request {
    pub fn valid(&self, epoch: &str, now: u64) -> bool {
        if self.schema_version != 1
            || !scope_name(&self.id)
            || self.epoch != epoch
            || self.origin.client_id == 0
            || self.issued_at_ms > now.saturating_add(1000)
            || self.expires_at_ms < now
            || self.expires_at_ms <= self.issued_at_ms
            || self.expires_at_ms.saturating_sub(self.issued_at_ms) > 30_000
        {
            return false;
        }
        match &self.intent {
            Intent::PrepareClose { agent_id, version } => {
                scope_name(agent_id) && valid_version(version)
            }
            Intent::Focus {
                agent_id,
                version,
                pane_pid,
            } => scope_name(agent_id) && valid_version(version) && *pane_pid > 0,
            Intent::PrepareNew {
                name,
                lead_id,
                version,
            } => agent_name(name) && scope_name(lead_id) && valid_version(version),
            Intent::Confirm { prepared_id } | Intent::Cancel { prepared_id } => {
                scope_name(prepared_id)
            }
        }
    }
    pub fn root_id(&self) -> &str {
        match &self.intent {
            Intent::Confirm { prepared_id } | Intent::Cancel { prepared_id } => prepared_id,
            _ => &self.id,
        }
    }
}
pub fn valid_version(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn agent_name(value: &str) -> bool {
    scope_name(value) && value.len() <= 64 && !value.contains("..")
}
pub fn namespace(value: &str) -> bool {
    agent_name(value)
        && value == value.to_ascii_lowercase()
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Pending,
    AwaitingConfirmation,
    FocusReady,
    Executing,
    Creating,
    Deleting,
    Succeeded,
    Failed,
    Uncertain,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub id: String,
    pub origin: Origin,
    pub phase: Phase,
    pub summary: String,
    pub expires_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<FocusPermit>,
}
/// Short-lived native validation result, consumable once by the requesting view.
/// No canonical cwd or session path is exported.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusPermit {
    pub agent_id: String,
    pub version: String,
    pub pane_id: u32,
    pub pane_pid: u32,
    pub tab_id: u32,
    pub floating: bool,
    pub cwd_hash: String,
}
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Controls {
    pub inhibited: bool,
    pub receipts: Vec<Receipt>,
}
impl Controls {
    pub fn valid(&self) -> bool {
        self.receipts.len() <= MAX_RECEIPTS
            && self.receipts.iter().all(|r| {
                scope_name(&r.id)
                    && r.origin.client_id > 0
                    && r.summary.len() <= 640
                    && text(&r.summary, 160) == r.summary
                    && r.focus.as_ref().is_none_or(|p| {
                        r.phase == Phase::FocusReady
                            && scope_name(&p.agent_id)
                            && valid_version(&p.version)
                            && valid_version(&p.cwd_hash)
                            && p.pane_pid > 0
                    })
                    && (r.phase != Phase::FocusReady || r.focus.is_some())
            })
    }
}
