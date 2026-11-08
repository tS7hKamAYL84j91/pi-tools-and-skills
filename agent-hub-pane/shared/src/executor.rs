//! One serial native command executor. No retries and no canonical registry writes.
use crate::{
    authority::{self, Context, Guard, Pane},
    command::{Controls, Intent, Origin, Phase, Receipt, Request, MAX_RECEIPTS},
    frame::now_ms,
    host::Host,
    publisher::scan_registry,
    text,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

type Key = (String, String);
#[derive(Default)]
struct Shared {
    controls: BTreeMap<String, Controls>,
    cancel: BTreeMap<Key, (Origin, Arc<AtomicBool>)>,
    inhibited: bool,
    notify: Option<thread::Thread>,
}
impl Shared {
    fn receipt(
        &mut self,
        scope: &str,
        id: &str,
        origin: Origin,
        phase: Phase,
        summary: &str,
        expires: u64,
    ) {
        let controls = self.controls.entry(scope.into()).or_default();
        if let Some(old) = controls.receipts.iter_mut().find(|r| r.id == id) {
            *old = Receipt {
                id: id.into(),
                origin,
                phase,
                summary: text(summary, 160),
                expires_at_ms: expires,
            };
        } else {
            if controls.receipts.len() >= MAX_RECEIPTS {
                controls.receipts.remove(0);
            }
            controls.receipts.push(Receipt {
                id: id.into(),
                origin,
                phase,
                summary: text(summary, 160),
                expires_at_ms: expires,
            });
        }
        if matches!(phase, Phase::Succeeded | Phase::Failed | Phase::Uncertain) {
            self.cancel.remove(&(scope.into(), id.into()));
        }
        if phase == Phase::Uncertain {
            self.inhibited = true;
        }
        if let Some(thread) = &self.notify {
            thread.unpark();
        }
    }
}
struct Job {
    scope: String,
    request: Request,
    cancel: Arc<AtomicBool>,
}
struct Prepared {
    guard: Guard,
    name: Option<String>,
    expires: u64,
    cancel: Arc<AtomicBool>,
}
pub struct Executor {
    tx: Option<SyncSender<Job>>,
    state: Arc<Mutex<Shared>>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    epoch: String,
    seen: BTreeMap<Key, u64>,
    confirmed: BTreeSet<Key>,
}
impl Executor {
    pub fn start(registry: PathBuf, session: String, epoch: String, executable: String) -> Self {
        let (tx, rx) = mpsc::sync_channel::<Job>(8);
        let state = Arc::new(Mutex::new(Shared::default()));
        let stop = Arc::new(AtomicBool::new(false));
        let worker_state = state.clone();
        let worker_stop = stop.clone();
        let worker = thread::spawn(move || {
            let host = Host {
                executable,
                session,
                stop: worker_stop.clone(),
            };
            let mut prepared: BTreeMap<Key, Prepared> = BTreeMap::new();
            loop {
                if worker_stop.load(Ordering::Relaxed) {
                    break;
                }
                let time = now_ms();
                let expired = prepared
                    .iter()
                    .filter(|(_, p)| p.expires < time || p.cancel.load(Ordering::Relaxed))
                    .map(|(k, _)| k.clone())
                    .collect::<Vec<_>>();
                for key in expired {
                    if let Some(p) = prepared.remove(&key) {
                        worker_state.lock().unwrap().receipt(
                            &key.0,
                            &key.1,
                            p.guard.origin,
                            Phase::Failed,
                            "Confirmation cancelled or expired",
                            0,
                        );
                    }
                }
                let job = match rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(job) => job,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(_) => break,
                };
                handle(&host, &registry, &worker_state, &mut prepared, job);
            }
        });
        Self {
            tx: Some(tx),
            state,
            stop,
            worker: Some(worker),
            epoch,
            seen: BTreeMap::new(),
            confirmed: BTreeSet::new(),
        }
    }
    pub fn notify_on_change(&self, thread: thread::Thread) {
        self.state.lock().unwrap().notify = Some(thread);
    }
    pub fn controls(&self, scope: &str) -> Controls {
        let state = self.state.lock().unwrap();
        let mut controls = state.controls.get(scope).cloned().unwrap_or_default();
        controls.inhibited = state.inhibited;
        controls
    }
    pub fn submit(&mut self, scope: &str, request: Request) -> bool {
        let now = now_ms();
        if !request.valid(&self.epoch, now) {
            return false;
        }
        // Retain IDs for this owner epoch; never replay an old ID with a fresh timestamp.
        let key = (scope.into(), request.id.clone());
        if self.seen.contains_key(&key) || self.seen.len() >= 4096 {
            return false;
        }
        self.seen.insert(key, request.expires_at_ms);
        let root = (scope.into(), request.root_id().to_owned());
        let mut state = self.state.lock().unwrap();
        if let Intent::Cancel { .. } = request.intent {
            if let Some((origin, cancel)) = state.cancel.get(&root) {
                if *origin == request.origin {
                    cancel.store(true, Ordering::Relaxed);
                    return true;
                }
            }
            return false;
        }
        if state.inhibited {
            state.receipt(
                scope,
                request.root_id(),
                request.origin,
                Phase::Failed,
                "Commands inhibited after uncertain outcome",
                0,
            );
            return false;
        }
        let cancel = if let Intent::Confirm { .. } = request.intent {
            let Some((origin, cancel)) = state.cancel.get(&root) else {
                return false;
            };
            if *origin != request.origin || !self.confirmed.insert(root.clone()) {
                return false;
            }
            cancel.clone()
        } else {
            let cancel = Arc::new(AtomicBool::new(false));
            state
                .cancel
                .insert(root.clone(), (request.origin, cancel.clone()));
            state.receipt(
                scope,
                request.root_id(),
                request.origin,
                Phase::Pending,
                "Pending native validation",
                request.expires_at_ms,
            );
            cancel
        };
        let id = request.root_id().to_owned();
        let origin = request.origin;
        drop(state);
        if self.tx.as_ref().is_some_and(|tx| {
            tx.try_send(Job {
                scope: scope.into(),
                request,
                cancel,
            })
            .is_ok()
        }) {
            true
        } else {
            self.state.lock().unwrap().receipt(
                scope,
                &id,
                origin,
                Phase::Failed,
                "Command queue full or stopped; not dispatched",
                0,
            );
            false
        }
    }
    pub fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.tx.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
impl Drop for Executor {
    fn drop(&mut self) {
        self.shutdown();
    }
}
fn report(
    state: &Arc<Mutex<Shared>>,
    scope: &str,
    id: &str,
    origin: Origin,
    phase: Phase,
    message: &str,
    expires: u64,
) {
    state
        .lock()
        .unwrap()
        .receipt(scope, id, origin, phase, message, expires);
}
fn panes(host: &Host, origin: Origin, focus: bool) -> Result<Vec<Pane>, String> {
    let mut panes = authority::parse_panes(&host.query(&["list-panes", "--json", "--all"])?)?;
    if focus {
        let tabs: serde_json::Value =
            serde_json::from_slice(&host.query(&["list-tabs", "--json"])?)
                .map_err(|_| "Invalid tab metadata")?;
        let tabs = tabs
            .as_array()
            .filter(|t| t.len() <= 4096)
            .ok_or("Invalid tab metadata")?;
        let own = panes
            .iter_mut()
            .find(|p| p.is_plugin && p.id == origin.plugin_id)
            .ok_or("Origin view disappeared")?;
        let matches = tabs
            .iter()
            .filter(|t| t.get("tab_id").and_then(|n| n.as_u64()) == Some(own.tab_id as u64))
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err("Ambiguous tab metadata".into());
        }
        let visible = matches[0]
            .get("are_floating_panes_visible")
            .and_then(|v| v.as_bool())
            .ok_or("Unknown input layer")?;
        own.is_focused = own.is_focused && own.is_floating == visible;
    }
    Ok(panes)
}
fn preflight(
    host: &Host,
    registry: &std::path::Path,
    job: &Job,
    id: &str,
    version: &str,
    focus: bool,
) -> Result<(Guard, Vec<Pane>), String> {
    let panes = panes(host, job.request.origin, focus)?;
    // Canonical authority is intentionally read AFTER the host metadata awaits.
    let snapshot = scan_registry(registry).map_err(|_| "Canonical registry unavailable")?;
    if job.cancel.load(Ordering::Relaxed)
        || host.stop.load(Ordering::Relaxed)
        || now_ms() > job.request.expires_at_ms
    {
        return Err("Command cancelled or expired".into());
    }
    let guard = authority::validate(
        &snapshot,
        &panes,
        Context {
            scope: &job.scope,
            session: &host.session,
            origin: job.request.origin,
            require_focus: focus,
            now: now_ms(),
        },
        id,
        version,
    )?;
    Ok((guard, panes))
}
fn handle(
    host: &Host,
    registry: &std::path::Path,
    state: &Arc<Mutex<Shared>>,
    prepared: &mut BTreeMap<Key, Prepared>,
    job: Job,
) {
    let id = job.request.root_id().to_owned();
    let origin = job.request.origin;
    let fail = |message: &str| report(state, &job.scope, &id, origin, Phase::Failed, message, 0);
    if job.cancel.load(Ordering::Relaxed)
        || now_ms() > job.request.expires_at_ms
        || state.lock().unwrap().inhibited
    {
        fail("Command cancelled, expired or inhibited");
        return;
    }
    match &job.request.intent {
        Intent::PrepareClose { agent_id, version }
        | Intent::PrepareNew {
            lead_id: agent_id,
            version,
            ..
        } => {
            if prepared.len() >= 32 {
                fail("Too many pending confirmations");
                return;
            }
            let (guard, _) = match preflight(host, registry, &job, agent_id, version, true) {
                Ok(v) => v,
                Err(e) => {
                    fail(&e);
                    return;
                }
            };
            let name = if let Intent::PrepareNew { name, .. } = &job.request.intent {
                if !crate::command::namespace(&job.scope.to_ascii_lowercase())
                    || !authority::name_available(registry, name).unwrap_or(false)
                {
                    fail("Name unavailable, invalid scope or incomplete registry");
                    return;
                }
                Some(name.clone())
            } else {
                None
            };
            let expires = now_ms() + if name.is_some() { 10000 } else { 5000 };
            let summary = if let Some(name) = &name {
                format!("Default model? Y/n {name}")
            } else {
                format!(
                    "Close #{} [{}] Y/n {}",
                    guard.target_pane,
                    text(&guard.record.status, 16),
                    text(&guard.record.name, 64)
                )
            };
            prepared.insert(
                (job.scope.clone(), id.clone()),
                Prepared {
                    guard,
                    name,
                    expires,
                    cancel: job.cancel.clone(),
                },
            );
            report(
                state,
                &job.scope,
                &id,
                origin,
                Phase::AwaitingConfirmation,
                &summary,
                expires,
            );
        }
        Intent::Confirm { .. } => {
            let Some(armed) = prepared.remove(&(job.scope.clone(), id.clone())) else {
                fail("Confirmation unavailable or already consumed");
                return;
            };
            if armed.guard.origin != origin
                || armed.expires < now_ms()
                || armed.cancel.load(Ordering::Relaxed)
            {
                fail("Confirmation cancelled or expired");
                return;
            }
            report(
                state,
                &job.scope,
                &id,
                origin,
                Phase::Executing,
                "Revalidating confirmed intent",
                armed.expires,
            );
            let (guard, panes) = match preflight(
                host,
                registry,
                &job,
                &armed.guard.record.id,
                &armed.guard.version,
                false,
            ) {
                Ok(v) => v,
                Err(e) => {
                    fail(&e);
                    return;
                }
            };
            if !authority::binding_matches(&armed.guard, &guard) || now_ms() > armed.expires {
                fail("Confirmed target changed or expired");
                return;
            }
            let argv = if let Some(name) = &armed.name {
                if !authority::name_available(registry, name).unwrap_or(false) {
                    fail("Name unavailable or registry incomplete");
                    return;
                }
                match authority::create_argv(
                    &host.session,
                    &job.scope.to_ascii_lowercase(),
                    name,
                    &guard,
                    &panes,
                ) {
                    Ok(v) => v,
                    Err(e) => {
                        fail(&e);
                        return;
                    }
                }
            } else {
                authority::close_argv(&host.session, &guard)
            };
            if job.cancel.load(Ordering::Relaxed)
                || host.stop.load(Ordering::Relaxed)
                || now_ms() > armed.expires
            {
                fail("Command cancelled or expired before dispatch");
                return;
            }
            let phase = if armed.name.is_some() {
                Phase::Creating
            } else {
                Phase::Deleting
            };
            report(
                state,
                &job.scope,
                &id,
                origin,
                phase,
                "Dispatched; awaiting verified receipt",
                0,
            );
            let output = match host.run(&argv, Duration::from_secs(1)) {
                Ok(v) => v,
                Err(crate::host::CallFailure::NotStarted) => {
                    fail("Host command did not start; no mutation dispatched");
                    return;
                }
                Err(crate::host::CallFailure::MayHaveRun) => {
                    report(
                        state,
                        &job.scope,
                        &id,
                        origin,
                        Phase::Uncertain,
                        "Host outcome uncertain; inspect panes, no retry",
                        0,
                    );
                    return;
                }
            };
            let target = if armed.name.is_some() {
                let reply = String::from_utf8(output).unwrap_or_default();
                let parsed = reply.trim().strip_prefix("terminal_").and_then(|s| {
                    if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) {
                        s.parse::<u32>().ok()
                    } else {
                        None
                    }
                });
                let Some(target) = parsed else {
                    report(
                        state,
                        &job.scope,
                        &id,
                        origin,
                        Phase::Uncertain,
                        "Create receipt missing; inspect panes, no retry",
                        0,
                    );
                    return;
                };
                target
            } else {
                guard.target_pane
            };
            let deadline = Instant::now() + Duration::from_secs(20);
            loop {
                if host.stop.load(Ordering::Relaxed) {
                    report(
                        state,
                        &job.scope,
                        &id,
                        origin,
                        Phase::Uncertain,
                        "Owner stopped after dispatch; inspect panes",
                        0,
                    );
                    return;
                }
                let observed = (|| -> Result<bool, String> {
                    let current = panes_for_receipt(host)?;
                    let snapshot = scan_registry(registry).map_err(|_| "Registry unavailable")?;
                    if snapshot.skipped > 0 || snapshot.capped {
                        return Ok(false);
                    }
                    if let Some(name) = &armed.name {
                        let matches = current
                            .iter()
                            .filter(|p| !p.is_plugin && p.id == target)
                            .collect::<Vec<_>>();
                        if matches.len() != 1
                            || matches[0].tab_id != guard.own_tab
                            || !matches[0].is_floating
                            || matches[0].exited
                        {
                            return Ok(false);
                        }
                        let records = snapshot
                            .canonical
                            .iter()
                            .filter(|r| {
                                r.name == *name
                                    && r.namespace.as_deref()
                                        == Some(job.scope.to_ascii_lowercase().as_str())
                                    && r.zellij.get("sessionName").and_then(|v| v.as_str())
                                        == Some(host.session.as_str())
                                    && r.zellij.get("paneId").and_then(|v| v.as_u64())
                                        == Some(target as u64)
                            })
                            .collect::<Vec<_>>();
                        Ok(records.len() == 1
                            && snapshot.rows(&job.scope).iter().any(|r| {
                                r.id == records[0].id && r.state == crate::ProcessState::Live
                            }))
                    } else {
                        Ok(!current.iter().any(|p| !p.is_plugin && p.id == target)
                            && !snapshot.canonical.iter().any(|r| r.id == guard.record.id))
                    }
                })();
                if observed == Ok(true) {
                    report(
                        state,
                        &job.scope,
                        &id,
                        origin,
                        Phase::Succeeded,
                        if armed.name.is_some() {
                            "Active: live registration verified"
                        } else {
                            "Removed: pane absent and agent unregistered"
                        },
                        0,
                    );
                    return;
                }
                if Instant::now() >= deadline || observed.is_err() {
                    report(
                        state,
                        &job.scope,
                        &id,
                        origin,
                        Phase::Uncertain,
                        "Receipt incomplete; inspect panes, no retry",
                        0,
                    );
                    return;
                }
                thread::sleep(Duration::from_secs(2));
            }
        }
        Intent::Focus { .. } => fail("Focus routing requires an explicit client-safe host path"),
        Intent::Cancel { .. } => {}
    }
}
fn panes_for_receipt(host: &Host) -> Result<Vec<Pane>, String> {
    authority::parse_panes(&host.query(&["list-panes", "--json", "--all"])?)
}
