//! Scoped, bounded local intent transport. No paths or arbitrary commands in payloads.
use crate::{
    command::{Request, INBOX, MAX_REQUEST_BYTES},
    registry_dir,
};
use cap_primitives::fs::FollowSymlinks;
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use std::io::{self, Write};

/// WASI creates only a fresh temporary file inside its private preopened scope.
/// Native ingestion tightens its mode using the opened fd before reading it.
pub fn submit(request: &Request) -> io::Result<()> {
    if !crate::scope_name(&request.id) {
        return Err(io::Error::other("invalid request id"));
    }
    let dir = registry_dir(Dir::open_ambient_dir("/host", ambient_authority())?, INBOX)?;
    let bytes = serde_json::to_vec(request).map_err(io::Error::other)?;
    if bytes.len() as u64 > MAX_REQUEST_BYTES {
        return Err(io::Error::other("request too large"));
    }
    let temp = format!(".request-{}.tmp", request.id);
    let final_name = format!("request-{}.json", request.id);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    options._cap_fs_ext_follow(FollowSymlinks::No);
    options._cap_fs_ext_nonblock(true);
    let mut file = dir.open_with(&temp, &options)?;
    let result = file
        .write_all(&bytes)
        .and_then(|_| dir.rename(&temp, &dir, &final_name));
    drop(file);
    if result.is_err() {
        let _ = dir.remove_file(&temp);
    }
    result
}

#[cfg(not(target_os = "wasi"))]
mod native {
    use super::*;
    use crate::frame::scope_directory;
    use cap_std::fs::{DirBuilder, DirBuilderExt, MetadataExt, Permissions, PermissionsExt};
    use std::{io::Read, path::Path};
    pub struct Inboxes {
        dirs: Vec<(String, Dir)>,
    }
    fn private(dir: &Dir) -> io::Result<()> {
        let meta = dir.dir_metadata()?;
        if meta.mode() & 0o777 != 0o700 || meta.uid() != unsafe { libc::geteuid() } {
            return Err(io::Error::other("command directory must be owned0700"));
        }
        Ok(())
    }
    impl Inboxes {
        pub fn open(output: &Path, scopes: &[String]) -> io::Result<Self> {
            let root = crate::publisher::open_directory(output)?;
            private(&root)?;
            let mut dirs = Vec::new();
            for scope in scopes {
                let dir = registry_dir(root.try_clone()?, &scope_directory(scope)?)?;
                private(&dir)?;
                let mut builder = DirBuilder::new();
                builder.mode(0o700);
                match dir.create_dir_with(INBOX, &builder) {
                    Ok(()) => {}
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(e) => return Err(e),
                }
                let inbox = registry_dir(dir, INBOX)?;
                private(&inbox)?;
                dirs.push((scope.clone(), inbox));
            }
            Ok(Self { dirs })
        }
        pub fn drain(&self, mut receive: impl FnMut(&str, Request)) -> io::Result<usize> {
            let mut processed = 0;
            let mut visited = 0;
            for (scope, dir) in &self.dirs {
                private(dir)?;
                for entry in dir.entries()? {
                    visited += 1;
                    if visited > 128 {
                        return Ok(processed);
                    }
                    let entry = entry?;
                    let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                        continue;
                    };
                    let Some(id) = name
                        .strip_prefix("request-")
                        .and_then(|s| s.strip_suffix(".json"))
                    else {
                        continue;
                    };
                    if !crate::scope_name(id) {
                        continue;
                    }
                    let result = (|| -> io::Result<Request> {
                        let mut options = OpenOptions::new();
                        options.read(true);
                        options._cap_fs_ext_follow(FollowSymlinks::No);
                        options._cap_fs_ext_nonblock(true);
                        let file = dir.open_with(&name, &options)?;
                        let meta = file.metadata()?;
                        // WASI has no POSIX mode argument. The surrounding0700 directory prevents
                        // disclosure/access during handoff even with host umask0002.
                        // Only owned, single-link files are accepted. fchmod acts
                        // on this fd, never a raced path or another hardlink target.
                        if !meta.is_file()
                            || meta.nlink() != 1
                            || meta.len() > MAX_REQUEST_BYTES
                            || meta.uid() != unsafe { libc::geteuid() }
                        {
                            return Err(io::Error::other("unsafe command file"));
                        }
                        file.set_permissions(Permissions::from_mode(0o600))?;
                        let mut bytes = Vec::new();
                        file.take(MAX_REQUEST_BYTES + 1).read_to_end(&mut bytes)?;
                        if bytes.len() as u64 > MAX_REQUEST_BYTES {
                            return Err(io::Error::other("command grew beyond bound"));
                        }
                        let request: Request =
                            serde_json::from_slice(&bytes).map_err(io::Error::other)?;
                        if request.id != id {
                            return Err(io::Error::other("command filename mismatch"));
                        }
                        Ok(request)
                    })();
                    // Never follow or delete a directory-as-command; invalid regular/symlink
                    // inbox entries are only unlinked within this explicitly owned inbox.
                    let _ = dir.remove_file(&name);
                    if let Ok(request) = result {
                        receive(scope, request);
                        processed += 1;
                    }
                }
            }
            Ok(processed)
        }
    }
}
#[cfg(not(target_os = "wasi"))]
pub use native::Inboxes;
