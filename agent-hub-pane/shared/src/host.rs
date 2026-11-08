//! Bounded native host calls. No shell, raw stderr logging or unbounded pipe joins.
use std::{
    io::Read,
    os::fd::AsRawFd,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CallFailure {
    NotStarted,
    MayHaveRun,
}

pub struct Host {
    pub executable: String,
    pub session: String,
    pub stop: Arc<AtomicBool>,
}
impl Host {
    pub fn query(&self, action: &[&str]) -> Result<Vec<u8>, String> {
        let mut args = vec!["--session".into(), self.session.clone(), "action".into()];
        args.extend(action.iter().map(|v| (*v).into()));
        self.run(&args, Duration::from_secs(3))
            .map_err(|_| "Host metadata unavailable".into())
    }
    /// A failure after this call is dispatched must be treated as uncertain for mutations.
    pub fn run(&self, args: &[String], timeout: Duration) -> Result<Vec<u8>, CallFailure> {
        if self.stop.load(Ordering::Relaxed) {
            return Err(CallFailure::NotStarted);
        }
        let mut child = Command::new(&self.executable)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| CallFailure::NotStarted)?;
        let Some(mut stdout) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CallFailure::MayHaveRun);
        };
        let fd = stdout.as_raw_fd();
        // Only this child's owned pipe descriptor is changed. No borrowed process
        // descriptors, session fds, env credentials or shell parsing are involved.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CallFailure::MayHaveRun);
        }
        let deadline = Instant::now() + timeout;
        let mut result = Vec::new();
        let mut exited = None;
        let mut eof = false;
        loop {
            let mut bytes = [0u8; 8192];
            match stdout.read(&mut bytes) {
                Ok(0) => eof = true,
                Ok(n) => result.extend_from_slice(&bytes[..n]),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(CallFailure::MayHaveRun);
                }
            }
            if result.len() > 512 * 1024
                || Instant::now() >= deadline
                || self.stop.load(Ordering::Relaxed)
            {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CallFailure::MayHaveRun);
            }
            if exited.is_none() {
                match child.try_wait() {
                    Ok(status) => exited = status,
                    Err(_) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(CallFailure::MayHaveRun);
                    }
                }
            }
            if let Some(status) = exited {
                if eof {
                    return if status.success() {
                        Ok(result)
                    } else {
                        Err(CallFailure::MayHaveRun)
                    };
                }
            }
            thread::sleep(Duration::from_millis(5));
        }
    }
}
