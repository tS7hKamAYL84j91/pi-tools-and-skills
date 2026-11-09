// Fixed scoped presentation; optional intents go only to the native command owner.
use cap_std::{ambient_authority, fs::Dir};
use pi_shared_hub::{
    action_view::{ActionView, Input},
    command::Origin,
    frame::{now_ms, read_frame, Frame, Freshness, Watermark},
    scope_name, text, View,
};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};
use zellij_tile::prelude::*;

#[derive(Default)]
struct ScopedView {
    scope: String,
    source: Option<Dir>,
    frame: Option<Frame>,
    view: View,
    watermark: Watermark,
    error: Option<String>,
    visible: bool,
    timer_armed: bool,
    next_poll: Option<Instant>,
    now: u64,
    actions: ActionView,
    visible_ids: Vec<String>,
    row_start: usize,
    no_color: bool,
    focus_requested: bool,
    focus_granted: bool,
    panes: Option<PaneManifest>,
}
register_plugin!(ScopedView);
impl ScopedView {
    fn reload(&mut self) -> bool {
        let old_now = self.now;
        self.now = now_ms();
        if !scope_name(&self.scope) {
            return false;
        }
        if self.source.is_none() {
            self.source = Dir::open_ambient_dir("/host", ambient_authority()).ok();
        }
        let previous = self.frame.take();
        let old_error = self.error.clone();
        match self.source.as_ref().map(|dir| {
            read_frame(dir, &self.scope, self.now).and_then(|frame| {
                self.watermark.accept(&frame)?;
                Ok(frame)
            })
        }) {
            Some(Ok(frame)) => {
                self.frame = Some(frame);
                self.error = None;
            }
            Some(Err(error)) => {
                self.frame = None;
                self.error = Some(format!("Snapshot error: {:?}", error.kind()));
            }
            None => {
                self.frame = None;
                self.error = Some("Scope directory unavailable".into());
            }
        }
        let command_changed = if let Some(frame) = &self.frame {
            self.actions.receive(frame, self.now)
        } else {
            self.actions.hidden();
            false
        };
        let focused = self.finish_focus();
        focused
            || command_changed
            || old_error != self.error
            || match (previous.as_ref(), self.frame.as_ref()) {
                (Some(old), Some(new)) => !old.same_presentation(old_now, new, self.now),
                (None, None) => false,
                _ => true,
            }
    }
    fn finish_focus(&mut self) -> bool {
        if !self.visible || !self.focus_granted {
            return false;
        }
        let Some(frame) = self.frame.as_ref() else {
            return false;
        };
        let Some((permit, deadline)) = self.actions.take_focus(frame, now_ms()) else {
            return false;
        };
        let origin = self.actions.origin.unwrap();
        let own = (permit.tab_id as usize, PaneId::Plugin(origin.plugin_id));
        let result = (|| -> Result<(), &'static str> {
            if get_focused_pane_info().ok() != Some(own) {
                return Err("Focus cancelled: client navigated");
            }
            let pane_id = PaneId::Terminal(permit.pane_id);
            // PaneUpdate is position-indexed, unlike GetFocusedPaneInfo's stable
            // ID (verified against the pinned 0.44.1 server implementation).
            let tab = get_tab_info(permit.tab_id as usize).ok_or("Focus tab disappeared")?;
            let panes = self
                .panes
                .as_ref()
                .and_then(|m| m.panes.get(&tab.position))
                .ok_or("Focus pane membership unavailable")?;
            if !panes.iter().any(|p| !p.is_plugin && p.id == permit.pane_id)
                || !panes
                    .iter()
                    .any(|p| p.is_plugin && p.id == origin.plugin_id)
            {
                return Err("Focus target moved to another tab");
            }
            let target = get_pane_info(pane_id).ok_or("Focus target disappeared")?;
            if target.exited
                || target.is_suppressed
                || !target.is_selectable
                || target.is_floating != permit.floating
            {
                return Err("Focus target changed");
            }
            let cwd = get_pane_cwd(pane_id).map_err(|_| "Focus cwd unavailable")?;
            if pi_shared_hub::focus::cwd_hash(&cwd).as_deref() != Some(permit.cwd_hash.as_str()) {
                return Err("Focus cwd changed");
            }
            if get_pane_pid(pane_id)
                .ok()
                .and_then(|p| u32::try_from(p).ok())
                != Some(permit.pane_pid)
            {
                return Err("Focus pane process changed");
            }
            // Recheck this client's origin AFTER all synchronous metadata calls.
            if now_ms() > deadline || get_focused_pane_info().ok() != Some(own) {
                return Err("Focus expired or client navigated");
            }
            focus_pane_with_id(pane_id, false, false);
            if get_focused_pane_info().ok() != Some((permit.tab_id as usize, pane_id)) {
                return Err("Focus receipt missing; no retry");
            }
            Ok(())
        })();
        self.actions.notice = match result {
            Ok(()) => "Focused: client-local receipt verified".into(),
            Err(error) => error.into(),
        };
        true
    }
    fn submit(&mut self, input: Input) {
        if matches!(input, Input::Enter) && !self.actions.active() && !self.focus_granted {
            self.actions.notice = "Focus disabled: opt in and approve Zellij permissions".into();
            return;
        }
        let focus_pid = if matches!(input, Input::Enter) && !self.actions.active() {
            let pane = self
                .frame
                .as_ref()
                .and_then(|f| {
                    f.rows
                        .iter()
                        .find(|r| Some(&r.id) == self.view.selected.as_ref())
                })
                .and_then(|r| r.pane_id);
            let pid = pane
                .and_then(|id| get_pane_pid(PaneId::Terminal(id)).ok())
                .and_then(|pid| u32::try_from(pid).ok())
                .filter(|pid| *pid > 0);
            if pid.is_none() {
                self.actions.notice = "Focus pane process unavailable".into();
                return;
            }
            pid
        } else {
            None
        };
        if let Some(frame) = self.frame.as_ref() {
            if let Some(mut request) = self.actions.handle(
                input,
                frame,
                self.view.selected.as_deref(),
                &self.visible_ids,
                now_ms(),
            ) {
                if let pi_shared_hub::command::Intent::Focus { pane_pid, .. } = &mut request.intent
                {
                    *pane_pid = focus_pid.unwrap_or(0);
                }
                if pi_shared_hub::inbox::submit(&request).is_err() {
                    self.actions.failed_submit();
                } else {
                    // Old early timers are ignored, avoiding a second perpetual
                    // timer chain after an input-driven wakeup.
                    self.next_poll = Some(Instant::now() + Duration::from_millis(50));
                    self.timer_armed = true;
                    set_timeout(0.05);
                }
            }
        }
    }
    fn arm(&mut self) {
        if self.visible && !self.timer_armed {
            self.timer_armed = true;
            let delay = if self.actions.active() { 0.25 } else { 2.0 };
            self.next_poll = Some(Instant::now() + Duration::from_secs_f64(delay));
            set_timeout(delay);
        }
    }
}
impl ZellijPlugin for ScopedView {
    fn load(&mut self, configuration: BTreeMap<String, String>) {
        self.scope = configuration.get("scope").cloned().unwrap_or_default();
        self.no_color = configuration.get("no_color").is_some_and(|v| v == "true");
        self.focus_requested = configuration.get("focus").is_some_and(|v| v == "true")
            && configuration.get("actions").is_some_and(|v| v == "true");
        if !scope_name(&self.scope) {
            self.error = Some("Explicit valid scope required".into());
            return;
        }
        let ids = get_plugin_ids();
        if ids.initial_cwd.file_name().and_then(|v| v.to_str())
            != pi_shared_hub::frame::scope_directory(&self.scope)
                .ok()
                .as_deref()
        {
            self.error = Some("Mount this scope's directory".into());
            return;
        }
        self.actions = ActionView::new(
            configuration.get("actions").is_some_and(|v| v == "true"),
            Origin {
                plugin_id: ids.plugin_id,
                client_id: ids.client_id,
            },
        );
        // Default views remain permissionless. Focus is a separate explicit opt-in;
        // ordinary Zellij prompts, never cache edits or native CLI fallback.
        subscribe(&[
            EventType::Visible,
            EventType::Timer,
            EventType::Key,
            EventType::Mouse,
            EventType::PermissionRequestResult,
        ]);
        if self.focus_requested {
            request_permission(&[
                PermissionType::ReadApplicationState,
                PermissionType::ChangeApplicationState,
            ]);
        }
        self.visible = true;
        self.reload();
        self.arm();
    }
    fn update(&mut self, event: Event) -> bool {
        match event {
            Event::PaneUpdate(panes) if self.focus_granted => {
                if panes.panes.values().map(Vec::len).sum::<usize>() <= pi_shared_hub::MAX_FILES {
                    self.panes = Some(panes);
                } else {
                    self.panes = None;
                }
                false
            }
            Event::PermissionRequestResult(status) => {
                self.focus_granted = self.focus_requested && status == PermissionStatus::Granted;
                if self.focus_granted {
                    subscribe(&[EventType::PaneUpdate]);
                }
                if !self.focus_granted {
                    self.actions.notice =
                        "Focus permission denied; other controls unchanged".into();
                }
                true
            }
            Event::Visible(visible) => {
                self.visible = visible;
                if !visible {
                    self.actions.hidden();
                }
                if visible {
                    self.reload();
                    self.arm();
                }
                true
            }
            Event::Timer(_) => {
                if self
                    .next_poll
                    .is_some_and(|due| Instant::now() + Duration::from_millis(5) < due)
                {
                    return false;
                }
                self.timer_armed = false;
                if self.visible {
                    let changed = self.reload();
                    self.arm();
                    changed
                } else {
                    false
                }
            }
            Event::Key(key)
                if (key.bare_key == BareKey::Char('q')
                    && key.has_no_modifiers()
                    && !self.actions.naming())
                    || (key.bare_key == BareKey::Char('c')
                        && key.has_modifiers(&[KeyModifier::Ctrl])) =>
            {
                close_self();
                false
            }
            Event::Key(key) if key.has_no_modifiers() => {
                let action_key = match key.bare_key {
                    BareKey::Enter => Some(Input::Enter),
                    BareKey::Esc => Some(Input::Escape),
                    BareKey::Backspace => Some(Input::Backspace),
                    BareKey::Char(c) if self.actions.naming() || "nclyYN".contains(c) => {
                        Some(Input::Char(c))
                    }
                    _ => None,
                };
                if self.actions.configured {
                    if let Some(input) = action_key {
                        self.submit(input);
                        return true;
                    }
                }
                if key.bare_key == BareKey::Char('r') {
                    return self.reload();
                }
                let delta = match key.bare_key {
                    BareKey::Char('j') | BareKey::Down => 1,
                    BareKey::Char('k') | BareKey::Up => -1,
                    _ => return false,
                };
                if let Some(frame) = self.frame.as_ref() {
                    self.actions.hidden();
                    self.view.step(
                        &pi_shared_hub::ordered(
                            &frame.rows,
                            self.actions.chosen(frame).map(|r| r.id.as_str()),
                        ),
                        delta,
                    );
                    true
                } else {
                    false
                }
            }
            Event::Mouse(Mouse::LeftClick(line, _)) if line >= 0 => {
                if let Some(id) = (line as usize)
                    .checked_sub(self.row_start)
                    .and_then(|index| self.view.line_ids.get(index))
                    .cloned()
                {
                    let modal = self.actions.active();
                    self.actions.hidden();
                    self.view.selected = Some(id);
                    if !modal && self.focus_granted {
                        self.submit(Input::Enter);
                    }
                    true
                } else {
                    false
                }
            }
            _ => false,
        }
    }
    fn render(&mut self, rows: usize, cols: usize) {
        let controls =
            self.actions.configured && self.frame.as_ref().is_some_and(|f| f.controls.is_some());
        let mut lines = vec![format!(
            "Hub: {}{}",
            self.scope,
            if controls { "" } else { " (read-only)" }
        )];
        if self.actions.chosen_lead.is_some() {
            let name = self
                .frame
                .as_ref()
                .and_then(|f| self.actions.chosen(f))
                .map(|r| r.name.as_str())
                .unwrap_or("unavailable");
            lines[0] = format!("Hub: {} lead: {name}", self.scope);
        } else if let Some(frame) = self.frame.as_ref() {
            let leads = frame.rows.iter().filter(|r| r.lead).collect::<Vec<_>>();
            let state = match leads.as_slice() {
                [] => "unavailable",
                [lead] => match lead.state {
                    pi_shared_hub::ProcessState::Live => "resolved",
                    pi_shared_hub::ProcessState::Stale => "unavailable",
                    _ => "unknown",
                },
                _ => "ambiguous",
            };
            if state != "resolved" {
                lines[0].push_str(&format!(" ({state})"));
            }
        }
        self.visible_ids.clear();
        self.view.line_ids.clear();
        if !self.actions.notice.is_empty() {
            lines.push(self.actions.notice.clone());
        }
        if let Some(error) = self.error.as_ref() {
            lines.push(error.clone());
        } else if let Some(frame) = self.frame.as_ref() {
            let freshness = frame.freshness(self.now);
            if freshness != Freshness::Fresh {
                lines.push(
                    match freshness {
                        Freshness::Stopped => "INDEXER STOPPED - cached data",
                        _ => "STALE SNAPSHOT - cached data",
                    }
                    .into(),
                );
            }
            if let Some(error) = frame.error.as_ref() {
                lines.push(error.clone());
            } else {
                if frame.skipped > 0 || frame.capped {
                    lines.push(format!(
                        "Partial: skipped {}{}",
                        frame.skipped,
                        if frame.capped { " / capped" } else { "" }
                    ));
                }
                let capacity = rows.saturating_sub(lines.len() + 2);
                self.row_start = lines.len();
                lines.extend(self.view.render(
                    &pi_shared_hub::ordered(
                        &frame.rows,
                        self.actions.chosen(frame).map(|r| r.id.as_str()),
                    ),
                    capacity,
                    cols,
                ));
                self.visible_ids = self.view.line_ids.clone();
                if frame.rows.is_empty() {
                    lines.push("No agents in this scope".into());
                }
            }
            lines.push(format!("{} agents", frame.rows.len()));
        }
        lines.push(
            if controls {
                if cols >= 36 {
                    "n new c close l lead | j/k q quit"
                } else {
                    "n+ c- l:lead q:quit"
                }
            } else {
                "j/k select | r reload view q:quit"
            }
            .into(),
        );
        if rows > 1 && !self.actions.notice.is_empty() {
            self.actions.rendered();
        }
        // Sanitize and clip before adding styling; registry values never become
        // terminal control sequences. Explicit resets prevent colour bleed.
        let plain = lines
            .into_iter()
            .take(rows)
            .map(|line| text(&line, cols))
            .collect::<Vec<_>>();
        print!(
            "{}",
            if self.no_color {
                plain
            } else {
                pi_shared_hub::color::decorate(&plain)
            }
            .join("\r\n")
        );
    }
}
