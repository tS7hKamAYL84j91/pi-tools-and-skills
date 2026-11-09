//! Native-only single reader and private scoped snapshot publisher.
use crate::frame::{now_ms, scope_directory, Frame, MAX_FRAME_BYTES, SNAPSHOT_FILE};
use crate::{registry_dir, scope_name, ProcessState, Snapshot};
use cap_primitives::fs::FollowSymlinks;
use cap_std::{
    ambient_authority,
    fs::{Dir, DirBuilder, DirBuilderExt, File, MetadataExt, OpenOptions, OpenOptionsExt},
};
use std::collections::BTreeSet;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

pub fn open_directory(path: &Path) -> io::Result<Dir> {
    if !path.is_absolute() {
        return Err(io::Error::other("absolute directory path required"));
    }
    registry_dir(
        Dir::open_ambient_dir("/", ambient_authority())?,
        path.strip_prefix("/")
            .map_err(io::Error::other)?
            .to_str()
            .ok_or_else(|| io::Error::other("UTF-8 path required"))?,
    )
}
fn private(dir: &Dir) -> io::Result<()> {
    let meta = dir.dir_metadata()?;
    // Argument-free OS identity query, never an environment credential lookup.
    let uid = unsafe { libc::geteuid() };
    if meta.mode() & 0o777 != 0o700 || meta.uid() != uid {
        return Err(io::Error::other("directory must be owned and mode 0700"));
    }
    Ok(())
}
fn child_directory(parent: &Dir, name: &str) -> io::Result<Dir> {
    let mut builder = DirBuilder::new();
    builder.mode(0o700);
    match parent.create_dir_with(name, &builder) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e),
    }
    let result = registry_dir(parent.try_clone()?, name)?;
    private(&result)?;
    Ok(result)
}
fn new_file(dir: &Dir, name: &str) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true).mode(0o600);
    options._cap_fs_ext_follow(FollowSymlinks::No);
    options._cap_fs_ext_nonblock(true);
    dir.open_with(name, &options)
}
fn write_new(dir: &Dir, name: &str, bytes: &[u8]) -> io::Result<File> {
    let mut file = new_file(dir, name)?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = dir.remove_file(name);
        return Err(error);
    }
    Ok(file)
}
fn private_file(meta: &cap_std::fs::Metadata) -> bool {
    // Same argument-free OS identity query as the directory ownership check.
    meta.is_file()
        && !meta.is_symlink()
        && meta.mode() & 0o777 == 0o600
        && meta.uid() == unsafe { libc::geteuid() }
}
fn atomic_write(dir: &Dir, bytes: &[u8], generation: u64) -> io::Result<()> {
    if bytes.len() as u64 > MAX_FRAME_BYTES {
        return Err(io::Error::other("view snapshot exceeds byte bound"));
    }
    match dir.symlink_metadata(SNAPSHOT_FILE) {
        Ok(meta) if !private_file(&meta) => return Err(io::Error::other("unsafe snapshot target")),
        Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    let temporary = format!(".snapshot-{}-{generation}.tmp", std::process::id());
    let mut file = new_file(dir, &temporary)?;
    let result = file
        .write_all(bytes)
        .and_then(|_| file.sync_all())
        .and_then(|_| dir.rename(&temporary, dir, SNAPSHOT_FILE));
    drop(file);
    if result.is_err() {
        let _ = dir.remove_file(&temporary);
    }
    result
}

pub struct Publisher {
    root: Dir,
    owner: File,
    scopes: Vec<String>,
    interval_ms: u64,
    generation: u64,
    instance: String,
}
impl Publisher {
    pub fn open(output: &Path, scopes: Vec<String>, interval_ms: u64) -> io::Result<Self> {
        if scopes.is_empty()
            || scopes.len() > 128
            || scopes.iter().any(|s| !scope_name(s))
            || scopes.iter().collect::<BTreeSet<_>>().len() != scopes.len()
            || !(250..=3_600_000).contains(&interval_ms)
        {
            return Err(io::Error::other("invalid scopes/interval"));
        }
        let parent = open_directory(
            output
                .parent()
                .ok_or_else(|| io::Error::other("output parent required"))?,
        )?;
        let leaf = output
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| io::Error::other("output name required"))?;
        let root = child_directory(&parent, leaf)?;
        // Exclusive ownership, never PID/age takeover. Crash leftovers require an
        // operator to choose a fresh output directory or explicitly recover it.
        let owner = write_new(
            &root,
            ".owner",
            format!("pid={}\nstarted={}\n", std::process::id(), now_ms()).as_bytes(),
        )?;
        let publisher = Self {
            root,
            owner,
            scopes,
            interval_ms,
            generation: 0,
            instance: format!(
                "{:x}-{:x}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(io::Error::other)?
                    .as_nanos()
            ),
        };
        match publisher.root.symlink_metadata(".format") {
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                if publisher
                    .root
                    .entries()?
                    .any(|entry| entry.map(|e| e.file_name() != ".owner").unwrap_or(true))
                {
                    return Err(io::Error::other("refusing a non-cache output directory"));
                }
                write_new(&publisher.root, ".format", b"pi-hub-scoped-cache:1\n")?;
            }
            Ok(meta) if private_file(&meta) && meta.len() == 22 => {
                let mut options = OpenOptions::new();
                options.read(true);
                options._cap_fs_ext_follow(FollowSymlinks::No);
                options._cap_fs_ext_nonblock(true);
                let file = publisher.root.open_with(".format", &options)?;
                let meta = file.metadata()?;
                if !private_file(&meta) || meta.len() != 22 {
                    return Err(io::Error::other("unsafe cache marker"));
                }
                let mut bytes = Vec::new();
                file.take(23).read_to_end(&mut bytes)?;
                if bytes != b"pi-hub-scoped-cache:1\n" {
                    return Err(io::Error::other("unrecognized output directory"));
                }
            }
            _ => return Err(io::Error::other("unrecognized output directory")),
        }
        for scope in &publisher.scopes {
            child_directory(&publisher.root, &scope_directory(scope)?)?;
        }
        Ok(publisher)
    }
    pub fn publish(
        &mut self,
        snapshot: &Snapshot,
        error: Option<&str>,
        stopped: bool,
    ) -> io::Result<()> {
        self.publish_controlled(snapshot, error, stopped, None)
    }
    pub fn publish_controlled(
        &mut self,
        snapshot: &Snapshot,
        error: Option<&str>,
        stopped: bool,
        executor: Option<&crate::executor::Executor>,
    ) -> io::Result<()> {
        self.generation = self
            .generation
            .checked_add(1)
            .ok_or_else(|| io::Error::other("generation exhausted"))?;
        let time = now_ms();
        for scope in &self.scopes {
            let frame = Frame {
                schema_version: 2,
                scope: scope.clone(),
                instance: self.instance.clone(),
                generation: self.generation,
                scanned_at_ms: if snapshot.captured_at_ms == 0 {
                    time
                } else {
                    snapshot.captured_at_ms
                },
                interval_ms: self.interval_ms,
                rows: if error.is_some() {
                    vec![]
                } else {
                    snapshot.rows(scope).into_iter().cloned().collect()
                },
                skipped: snapshot.skipped,
                capped: snapshot.capped,
                stopped,
                error: error.map(str::to_owned),
                controls: executor.map(|owner| owner.controls(scope)),
            };
            frame.validate(scope, time)?;
            let bytes = serde_json::to_vec(&frame).map_err(io::Error::other)?;
            if bytes.len() as u64 > MAX_FRAME_BYTES {
                return Err(io::Error::other("view snapshot exceeds byte bound"));
            }
            // One bounded frame at a time; publication is per scope, not a
            // cross-view transaction.
            let directory = registry_dir(self.root.try_clone()?, &scope_directory(scope)?)?;
            private(&directory)?;
            atomic_write(&directory, &bytes, self.generation)?;
        }
        Ok(())
    }
    pub fn instance(&self) -> &str {
        &self.instance
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
}
impl Drop for Publisher {
    fn drop(&mut self) {
        if let (Ok(held), Ok(current)) =
            (self.owner.metadata(), self.root.symlink_metadata(".owner"))
        {
            if current.is_file()
                && !current.is_symlink()
                && held.dev() == current.dev()
                && held.ino() == current.ino()
            {
                let _ = self.root.remove_file(".owner");
            }
        }
    }
}

fn bounded_text(path: &Path) -> io::Result<String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(64 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 64 * 1024 {
        return Err(io::Error::other("oversized process metadata"));
    }
    String::from_utf8(bytes).map_err(io::Error::other)
}
pub fn boot_seconds() -> Option<u64> {
    bounded_text(Path::new("/proc/stat"))
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("btime ")?.parse().ok())
}
pub fn process_state(pid: u32, started_at: Option<f64>, boot: Option<u64>) -> ProcessState {
    let Some(boot) = boot else {
        return ProcessState::Unknown;
    };
    let stat = match bounded_text(&PathBuf::from(format!("/proc/{pid}/stat"))) {
        Ok(v) => v,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return ProcessState::Stale,
        Err(_) => return ProcessState::Unknown,
    };
    classify_process(&stat, started_at, boot)
}
pub fn classify_process(stat: &str, started_at: Option<f64>, boot: u64) -> ProcessState {
    let Some(end) = stat.rfind(')') else {
        return ProcessState::Unknown;
    };
    let fields: Vec<_> = stat[end + 1..].split_whitespace().collect();
    if fields
        .first()
        .is_some_and(|s| matches!(*s, "Z" | "X" | "x"))
    {
        return ProcessState::Stale;
    }
    let Some(started_at) = started_at.filter(|v| v.is_finite()) else {
        return ProcessState::Unknown;
    };
    let Some(ticks) = fields.get(19).and_then(|s| s.parse::<u64>().ok()) else {
        return ProcessState::Unknown;
    };
    // Linux USER_HZ is 100, matching the existing Node pane's one-sided guard.
    if boot as f64 * 1000.0 + ticks as f64 * 10.0 - started_at > 120_000.0 {
        ProcessState::Stale
    } else {
        ProcessState::Live
    }
}
pub fn ensure_separate(registry: &Path, output: &Path) -> io::Result<()> {
    if registry.starts_with(output) || output.starts_with(registry) {
        return Err(io::Error::other(
            "registry and output must be separate trees",
        ));
    }
    Ok(())
}

#[derive(Debug)]
pub struct Config {
    pub registry: PathBuf,
    pub output: PathBuf,
    pub scopes: Vec<String>,
    pub interval_ms: u64,
    pub prepare: bool,
    pub actions: bool,
    pub session: Option<String>,
}
impl Config {
    pub fn parse(args: impl IntoIterator<Item = String>) -> io::Result<Self> {
        let mut args = args.into_iter();
        let mut registry = None;
        let mut output = None;
        let mut scopes = Vec::new();
        let mut interval = 2000;
        let mut interval_set = false;
        let mut prepare = false;
        let mut actions = false;
        let mut session = None;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--registry" if registry.is_none() => registry = args.next().map(PathBuf::from),
                "--output" if output.is_none() => output = args.next().map(PathBuf::from),
                "--scope" => scopes.push(
                    args.next()
                        .ok_or_else(|| io::Error::other("missing scope"))?,
                ),
                "--interval-ms" if !interval_set => {
                    interval = args
                        .next()
                        .ok_or_else(|| io::Error::other("missing interval"))?
                        .parse()
                        .map_err(io::Error::other)?;
                    interval_set = true;
                }
                "--prepare" if !prepare => prepare = true,
                "--actions" if !actions => actions = true,
                "--session" if session.is_none() => session = args.next(),
                _ => return Err(io::Error::other("invalid or duplicate option")),
            }
        }
        let registry = registry.ok_or_else(|| io::Error::other("--registry required"))?;
        let output = output.ok_or_else(|| io::Error::other("--output required"))?;
        ensure_separate(&registry, &output)?;
        if actions && session.is_none() {
            session = std::env::var("ZELLIJ_SESSION_NAME").ok();
        }
        if actions && session.as_deref().is_none_or(|s| !scope_name(s)) {
            return Err(io::Error::other(
                "actions require an explicit valid Zellij session",
            ));
        }
        if !actions && session.is_some() {
            return Err(io::Error::other("--session requires --actions"));
        }
        Ok(Self {
            registry,
            output,
            scopes,
            interval_ms: interval,
            prepare,
            actions,
            session,
        })
    }
}

/// Reopen the canonical pathname each poll; never keep reading a replaced directory.
pub fn scan_registry(path: &Path) -> io::Result<Snapshot> {
    let directory = open_directory(path)?;
    private(&directory)?;
    let identity = directory.dir_metadata()?;
    let boot = boot_seconds();
    let snapshot =
        Snapshot::scan_with_state(&directory, |pid, start| process_state(pid, start, boot))?;
    let current = open_directory(path)?;
    private(&current)?;
    let current = current.dir_metadata()?;
    if identity.dev() != current.dev() || identity.ino() != current.ino() {
        return Err(io::Error::other("registry directory changed during scan"));
    }
    Ok(snapshot)
}

pub fn run(config: Config) -> io::Result<()> {
    let registry = open_directory(&config.registry)?;
    private(&registry)?;
    if let Ok(output) = open_directory(&config.output) {
        let (a, b) = (registry.dir_metadata()?, output.dir_metadata()?);
        if a.dev() == b.dev() && a.ino() == b.ino() {
            return Err(io::Error::other(
                "registry and output alias the same directory",
            ));
        }
    }
    let mut publisher = Publisher::open(&config.output, config.scopes, config.interval_ms)?;
    let inboxes = if config.actions {
        Some(crate::inbox::Inboxes::open(
            &config.output,
            &publisher.scopes,
        )?)
    } else {
        None
    };
    if config.prepare {
        let scopes=publisher.scopes.iter().map(|scope|Ok(serde_json::json!({"scope":scope,"directory":config.output.join(scope_directory(scope)?)}))).collect::<io::Result<Vec<_>>>()?;
        println!(
            "{}",
            serde_json::json!({"schemaVersion":1,"scopes":scopes,"registryReads":0})
        );
        return Ok(());
    }
    let mut executor = config.session.map(|session| {
        crate::executor::Executor::start(
            config.registry.clone(),
            session,
            publisher.instance().to_owned(),
            "zellij".into(),
        )
    });
    if let Some(owner) = &executor {
        owner.notify_on_change(std::thread::current());
    }
    let stopping = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_input = stopping.clone();
    let parent = std::thread::current();
    std::thread::spawn(move || {
        let mut input = io::stdin().lock();
        let mut bytes = [0u8; 256];
        let mut line = Vec::new();
        let mut overflow = false;
        loop {
            match input.read(&mut bytes) {
                Ok(0) | Err(_) => {
                    stop_input.store(true, std::sync::atomic::Ordering::Relaxed);
                    parent.unpark();
                    break;
                }
                Ok(n) => {
                    for byte in &bytes[..n] {
                        if *byte == b'\n' {
                            if !overflow && line == b"q" {
                                stop_input.store(true, std::sync::atomic::Ordering::Relaxed);
                                parent.unpark();
                                return;
                            }
                            line.clear();
                            overflow = false;
                        } else if *byte != b'\r' {
                            if line.len() < 16 {
                                line.push(*byte);
                            } else {
                                overflow = true;
                            }
                        }
                    }
                }
            }
        }
    });
    let mut total_reads = 0;
    let mut scans = 0;
    let mut snapshot = Snapshot::default();
    let mut error = None;
    let mut next_scan = std::time::Instant::now();
    loop {
        if stopping.load(std::sync::atomic::Ordering::Relaxed) {
            if let Some(owner) = &mut executor {
                owner.shutdown();
            }
            publisher.publish_controlled(&snapshot, error, true, executor.as_ref())?;
            println!("Indexer stopped");
            break;
        }
        if std::time::Instant::now() >= next_scan {
            (snapshot, error) = match scan_registry(&config.registry) {
                Ok(snapshot) => (snapshot, None),
                Err(_) => (
                    Snapshot {
                        captured_at_ms: now_ms(),
                        ..Snapshot::default()
                    },
                    Some("Registry unavailable"),
                ),
            };
            total_reads += snapshot.reads;
            scans += 1;
            if let (Some(inboxes), Some(owner)) = (&inboxes, &mut executor) {
                inboxes.drain(|scope, request| {
                    owner.submit(scope, request);
                })?;
            }
            println!(
                "scan={} reads={} records={} | q Enter stops",
                scans, total_reads, snapshot.records
            );
            next_scan =
                std::time::Instant::now() + std::time::Duration::from_millis(config.interval_ms);
        }
        // Command changes can wake publication without another global scan.
        // The frame retains the last actual canonical capture timestamp.
        publisher.publish_controlled(&snapshot, error, false, executor.as_ref())?;
        std::thread::park_timeout(next_scan.saturating_duration_since(std::time::Instant::now()));
    }
    Ok(())
}
