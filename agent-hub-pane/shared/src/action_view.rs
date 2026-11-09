//! Pure presentation-side input state. Intent only; no host mutation or authority reads.
use crate::{
    command::{agent_name, Intent, Origin, Phase, Request},
    frame::{Frame, Freshness},
    ProcessState,
};
#[derive(Clone, Copy, Debug)]
pub enum Input {
    Char(char),
    Enter,
    Escape,
    Backspace,
}
#[derive(Clone, Debug)]
struct Pending {
    id: String,
    epoch: String,
    phase: Phase,
    deadline: u64,
    ready_at: u64,
    cancel_requested: bool,
    rendered: bool,
    target_id: Option<String>,
    focus_version: Option<String>,
}
#[derive(Default)]
pub struct ActionView {
    pub configured: bool,
    pub origin: Option<Origin>,
    pub notice: String,
    pub chosen_lead: Option<String>,
    chosen_incarnation: Option<String>,
    name: Option<String>,
    pending: Option<Pending>,
    sequence: u64,
    blocked: bool,
}
impl ActionView {
    pub fn new(configured: bool, origin: Origin) -> Self {
        Self {
            configured,
            origin: Some(origin),
            ..Self::default()
        }
    }
    pub fn chosen<'a>(&self, frame: &'a Frame) -> Option<&'a crate::Row> {
        let id = self.chosen_lead.as_ref()?;
        frame.rows.iter().find(|r| {
            &r.id == id
                && self.chosen_incarnation.as_deref()
                    == Some(if r.incarnation.is_empty() {
                        r.version.as_str()
                    } else {
                        r.incarnation.as_str()
                    })
        })
    }
    pub fn active(&self) -> bool {
        self.name.is_some() || self.pending.is_some()
    }
    pub fn naming(&self) -> bool {
        self.name.is_some()
    }
    pub fn enabled(&self, frame: &Frame, now: u64) -> bool {
        self.configured
            && self.origin.is_some()
            && !self.blocked
            && frame.freshness(now) == Freshness::Fresh
            && frame.error.is_none()
            && frame.controls.as_ref().is_some_and(|c| !c.inhibited)
    }
    fn request(&mut self, frame: &Frame, intent: Intent, now: u64) -> Request {
        self.sequence = self.sequence.saturating_add(1);
        let origin = self.origin.unwrap();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|t| t.as_nanos())
            .unwrap_or(0);
        Request {
            schema_version: 1,
            id: format!(
                "{:x}-{:x}-{:x}-{:x}",
                origin.plugin_id, origin.client_id, nanos, self.sequence
            ),
            epoch: frame.instance.clone(),
            origin,
            issued_at_ms: now,
            expires_at_ms: now.saturating_add(30000),
            intent,
        }
    }
    fn prepare(&mut self, frame: &Frame, intent: Intent, now: u64) -> Request {
        let target_id = match &intent {
            Intent::PrepareClose { agent_id, .. } | Intent::Focus { agent_id, .. } => {
                Some(agent_id.clone())
            }
            _ => None,
        };
        let focus_version = match &intent {
            Intent::Focus { version, .. } => Some(version.clone()),
            _ => None,
        };
        let request = self.request(frame, intent, now);
        self.pending = Some(Pending {
            id: request.id.clone(),
            epoch: frame.instance.clone(),
            phase: Phase::Pending,
            deadline: request.expires_at_ms,
            ready_at: 0,
            cancel_requested: false,
            rendered: false,
            target_id,
            focus_version,
        });
        self.notice = "Pending native validation; confirmation is not queued".into();
        request
    }
    /// Consume only this view's current native permit. Clearing pending before
    /// SDK dispatch prevents repeated snapshots or callbacks from replaying it.
    pub fn take_focus(
        &mut self,
        frame: &Frame,
        now: u64,
    ) -> Option<(crate::command::FocusPermit, u64)> {
        let pending = self.pending.as_ref()?;
        if pending.cancel_requested || pending.epoch != frame.instance || !self.enabled(frame, now)
        {
            return None;
        }
        let receipt = frame.controls.as_ref()?.receipts.iter().find(|r| {
            r.id == pending.id && Some(r.origin) == self.origin && r.phase == Phase::FocusReady
        })?;
        let permit = receipt.focus.as_ref()?;
        if receipt.expires_at_ms < now
            || receipt.expires_at_ms > now.saturating_add(1500)
            || pending.target_id.as_ref() != Some(&permit.agent_id)
            || pending.focus_version.as_ref() != Some(&permit.version)
            || !frame.rows.iter().any(|r| {
                r.id == permit.agent_id
                    && r.version == permit.version
                    && r.state == ProcessState::Live
            })
        {
            self.pending = None;
            self.notice = "Focus expired or target changed".into();
            return None;
        }
        let result = (permit.clone(), receipt.expires_at_ms);
        self.pending = None;
        Some(result)
    }
    pub fn rendered(&mut self) {
        if let Some(p) = &mut self.pending {
            if p.phase == Phase::AwaitingConfirmation {
                p.rendered = true;
            }
        }
    }
    pub fn failed_submit(&mut self) {
        self.blocked = true;
        self.pending = None;
        self.name = None;
        self.notice = "Command handoff unavailable; inspect before retry".into();
    }
    pub fn receive(&mut self, frame: &Frame, now: u64) -> bool {
        let before = self.notice.clone();
        if let Some(pending) = &mut self.pending {
            if pending.epoch != frame.instance || frame.stopped {
                self.blocked = true;
                self.name = None;
                self.pending = None;
                self.notice = "Owner stopped/changed; check command outcome".into();
                return true;
            }
            if let Some(receipt) = frame.controls.as_ref().and_then(|c| {
                c.receipts
                    .iter()
                    .find(|r| r.id == pending.id && Some(r.origin) == self.origin)
            }) {
                if pending.cancel_requested && receipt.phase == Phase::FocusReady {
                    self.pending = None;
                    self.notice = "Focus cancelled before dispatch".into();
                    return true;
                }
                let outdated =
                    matches!(receipt.phase, Phase::Pending | Phase::AwaitingConfirmation)
                        && (pending.cancel_requested
                            || matches!(
                                pending.phase,
                                Phase::Executing | Phase::Creating | Phase::Deleting
                            ));
                if !outdated {
                    if receipt.phase == Phase::AwaitingConfirmation
                        && pending.phase != Phase::AwaitingConfirmation
                    {
                        pending.ready_at = now;
                        pending.rendered = false;
                    }
                    pending.phase = receipt.phase;
                    if receipt.phase == Phase::AwaitingConfirmation && receipt.expires_at_ms > 0 {
                        pending.deadline = receipt.expires_at_ms;
                    }
                    self.notice = receipt.summary.clone();
                    if matches!(
                        receipt.phase,
                        Phase::Succeeded | Phase::Failed | Phase::Uncertain
                    ) {
                        self.blocked = receipt.phase == Phase::Uncertain;
                        self.pending = None;
                    }
                }
            }
            if self.pending.as_ref().is_some_and(|p| now > p.deadline) {
                let confirming = self
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.phase == Phase::AwaitingConfirmation);
                let focus = self
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.focus_version.is_some());
                self.notice = if confirming {
                    "Confirmation expired"
                } else if focus {
                    "Focus expired; not dispatched"
                } else {
                    "Command result overdue; inspect before retry"
                }
                .into();
                self.blocked = !confirming && !focus;
                self.pending = None;
            }
        }
        before != self.notice
    }
    pub fn hidden(&mut self) {
        // Accepted confirmations are asynchronous and survive navigation. Unconfirmed
        // forms never acquire consent from later input in a different view.
        self.name = None;
        if self.pending.as_ref().is_some_and(|p| {
            matches!(
                p.phase,
                Phase::Pending | Phase::AwaitingConfirmation | Phase::FocusReady
            )
        }) {
            self.pending = None;
            self.notice = "Unconfirmed action cancelled on navigation".into();
        }
    }
    pub fn handle(
        &mut self,
        input: Input,
        frame: &Frame,
        selected: Option<&str>,
        visible: &[String],
        now: u64,
    ) -> Option<Request> {
        if let Some(name) = &mut self.name {
            match input {
                Input::Escape => {
                    self.name = None;
                    self.notice = "New cancelled".into();
                }
                Input::Backspace => {
                    name.pop();
                    self.notice = format!("Name: {name}");
                }
                Input::Char(c) if c.is_ascii_alphanumeric() || "._-".contains(c) => {
                    if name.len() < 64 {
                        name.push(c);
                    }
                    self.notice = format!("Name: {name}");
                }
                Input::Enter => {
                    let name = self.name.take().unwrap();
                    if !self.enabled(frame, now) || !agent_name(&name) {
                        self.notice = "Invalid name or actions unavailable".into();
                        return None;
                    }
                    let lead = if self.chosen_lead.is_some() {
                        self.chosen(frame)
                    } else {
                        let leads = frame.rows.iter().filter(|r| r.lead).collect::<Vec<_>>();
                        if leads.len() == 1 {
                            Some(leads[0])
                        } else {
                            None
                        }
                    };
                    let Some(lead) = lead.filter(|r| r.state == ProcessState::Live) else {
                        self.notice = "Choose a live lead with l first".into();
                        return None;
                    };
                    return Some(self.prepare(
                        frame,
                        Intent::PrepareNew {
                            name,
                            lead_id: lead.id.clone(),
                            version: lead.version.clone(),
                        },
                        now,
                    ));
                }
                _ => {}
            }
            return None;
        }
        if let Some(pending) = self.pending.clone() {
            if matches!(input, Input::Escape | Input::Char('n') | Input::Char('N')) {
                self.notice = "Cancel requested; dispatched work may finish".into();
                if let Some(active) = &mut self.pending {
                    active.cancel_requested = true;
                }
                return Some(self.request(
                    frame,
                    Intent::Cancel {
                        prepared_id: pending.id,
                    },
                    now,
                ));
            }
            if !pending.cancel_requested
                && pending.phase == Phase::AwaitingConfirmation
                && matches!(input, Input::Enter | Input::Char('y') | Input::Char('Y'))
            {
                if !self.enabled(frame, now)
                    || now > pending.deadline
                    || pending
                        .target_id
                        .as_ref()
                        .is_some_and(|id| !visible.contains(id))
                {
                    self.pending = None;
                    self.notice = "Confirmation expired or unavailable".into();
                    return None;
                }
                if !pending.rendered
                    || (matches!(input, Input::Enter) && now.saturating_sub(pending.ready_at) < 300)
                {
                    self.notice = "Wait; press Enter separately to confirm".into();
                    return None;
                }
                let request = self.request(
                    frame,
                    Intent::Confirm {
                        prepared_id: pending.id,
                    },
                    now,
                );
                if let Some(active) = &mut self.pending {
                    active.phase = Phase::Executing;
                    active.deadline = request.expires_at_ms;
                }
                self.notice = "Confirmed; pending native action".into();
                return Some(request);
            }
            self.notice = "Action pending; input is not queued".into();
            return None;
        }
        if !self.enabled(frame, now) {
            self.notice = "Actions disabled, stale or inhibited".into();
            return None;
        }
        match input {
            Input::Char('n') => {
                self.name = Some(String::new());
                self.notice = "Name: ".into();
            }
            Input::Char('l') => {
                if let Some(id) = selected.filter(|id| visible.iter().any(|v| v == id)) {
                    self.chosen_lead = Some(id.into());
                    self.chosen_incarnation = frame.rows.iter().find(|r| r.id == id).map(|r| {
                        if r.incarnation.is_empty() {
                            r.version.clone()
                        } else {
                            r.incarnation.clone()
                        }
                    });
                    self.notice = "Lead selected for this view".into();
                }
            }
            Input::Enter | Input::Char('c') => {
                let Some(row) = selected
                    .filter(|id| visible.iter().any(|v| v == id))
                    .and_then(|id| frame.rows.iter().find(|r| r.id == id))
                else {
                    self.notice = "Selected agent is not visible".into();
                    return None;
                };
                return Some(self.prepare(
                    frame,
                    if matches!(input, Input::Enter) {
                        Intent::Focus {
                            agent_id: row.id.clone(),
                            version: row.version.clone(),
                            pane_pid: 0, // Filled from the permissioned SDK before transport.
                        }
                    } else {
                        Intent::PrepareClose {
                            agent_id: row.id.clone(),
                            version: row.version.clone(),
                        }
                    },
                    now,
                ));
            }
            _ => {}
        }
        None
    }
}
