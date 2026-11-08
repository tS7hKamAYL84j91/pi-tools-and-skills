// Fixed scoped presentation only. No registry reads or Zellij state/mutation rights.
use cap_std::{ambient_authority, fs::Dir};
use pi_shared_hub::{
    frame::{now_ms, read_frame, Frame, Freshness, Watermark},
    scope_name, text, View,
};
use std::collections::BTreeMap;
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
    now: u64,
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
        old_error != self.error
            || match (previous.as_ref(), self.frame.as_ref()) {
                (Some(old), Some(new)) => !old.same_presentation(old_now, new, self.now),
                (None, None) => false,
                _ => true,
            }
    }
    fn arm(&mut self) {
        if self.visible && !self.timer_armed {
            self.timer_armed = true;
            set_timeout(2.0);
        }
    }
}
impl ZellijPlugin for ScopedView {
    fn load(&mut self, configuration: BTreeMap<String, String>) {
        self.scope = configuration.get("scope").cloned().unwrap_or_default();
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
        // These are local presentation events. No permission request, global tab
        // scan, session update, command, message, network or file-write API.
        subscribe(&[EventType::Visible, EventType::Timer, EventType::Key]);
        self.visible = true;
        self.reload();
        self.arm();
    }
    fn update(&mut self, event: Event) -> bool {
        match event {
            Event::Visible(visible) => {
                self.visible = visible;
                if visible {
                    self.reload();
                    self.arm();
                }
                true
            }
            Event::Timer(_) => {
                self.timer_armed = false;
                if self.visible {
                    let changed = self.reload();
                    self.arm();
                    changed
                } else {
                    false
                }
            }
            Event::Key(key) if key.has_no_modifiers() => {
                if key.bare_key == BareKey::Char('r') {
                    return self.reload();
                }
                let delta = match key.bare_key {
                    BareKey::Char('j') | BareKey::Down => 1,
                    BareKey::Char('k') | BareKey::Up => -1,
                    _ => return false,
                };
                if let Some(frame) = self.frame.as_ref() {
                    self.view
                        .step(&frame.rows.iter().collect::<Vec<_>>(), delta);
                    true
                } else {
                    false
                }
            }
            _ => false,
        }
    }
    fn render(&mut self, rows: usize, cols: usize) {
        let mut lines = vec![format!("Hub: {} (read-only)", self.scope)];
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
                lines.extend(self.view.render(
                    &frame.rows.iter().collect::<Vec<_>>(),
                    capacity,
                    cols,
                ));
                if frame.rows.is_empty() {
                    lines.push("No agents in this scope".into());
                }
            }
            lines.push(format!("{} agents", frame.rows.len()));
        }
        lines.push("j/k select | r reload view".into());
        // A trailing newline at full height scrolls the header/staleness banner
        // out of Zellij's plugin grid. Emit one bounded frame without it.
        print!(
            "{}",
            lines
                .into_iter()
                .take(rows)
                .map(|line| text(&line, cols))
                .collect::<Vec<_>>()
                .join("\r\n")
        );
    }
}
