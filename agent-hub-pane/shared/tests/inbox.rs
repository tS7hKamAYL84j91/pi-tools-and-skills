use pi_shared_hub::{
    command::{Intent, Origin, Request},
    frame::{now_ms, scope_directory},
    inbox::Inboxes,
    publisher::Publisher,
};
use std::{
    fs,
    os::unix::fs::{symlink, PermissionsExt},
    path::Path,
};
fn request(id: &str) -> Request {
    Request {
        schema_version: 1,
        id: id.into(),
        epoch: "epoch".into(),
        origin: Origin {
            plugin_id: 9,
            client_id: 1,
        },
        issued_at_ms: now_ms(),
        expires_at_ms: now_ms() + 30000,
        intent: Intent::PrepareClose {
            agent_id: "agent".into(),
            version: "a".repeat(64),
        },
    }
}
fn file(dir: &Path, id: &str) {
    fs::write(
        dir.join(format!("request-{id}.json")),
        serde_json::to_vec(&request(id)).unwrap(),
    )
    .unwrap();
}
#[test]
fn scoped_inbox_consumes_only_valid_bounded_owned_requests() {
    let temp = tempfile::tempdir().unwrap();
    let output = temp.path().join("output");
    let _owner = Publisher::open(&output, vec!["Lead".into()], 2000).unwrap();
    let inboxes = Inboxes::open(&output, &["Lead".into()]).unwrap();
    let dir = output.join(scope_directory("Lead").unwrap()).join("inbox");
    file(&dir, "good");
    fs::write(dir.join("request-invalid.json"), "{").unwrap();
    fs::write(dir.join("request-huge.json"), vec![b' '; 8193]).unwrap();
    let mut forged = serde_json::to_value(request("forged")).unwrap();
    forged["scope"] = serde_json::json!("Other");
    fs::write(
        dir.join("request-forged.json"),
        serde_json::to_vec(&forged).unwrap(),
    )
    .unwrap();
    let mut received = Vec::new();
    assert_eq!(
        inboxes
            .drain(|scope, r| received.push((scope.to_owned(), r.id)))
            .unwrap(),
        1
    );
    assert_eq!(received, [("Lead".into(), "good".into())]);
    assert_eq!(inboxes.drain(|_, _| panic!("replay")).unwrap(), 0);
}
#[test]
fn symlink_fifo_and_hardlink_targets_are_never_read_or_chmodded() {
    let temp = tempfile::tempdir().unwrap();
    let output = temp.path().join("output");
    let _owner = Publisher::open(&output, vec!["a".into()], 2000).unwrap();
    let inboxes = Inboxes::open(&output, &["a".into()]).unwrap();
    let dir = output.join(scope_directory("a").unwrap()).join("inbox");
    let outside = temp.path().join("keep");
    fs::write(&outside, serde_json::to_vec(&request("linked")).unwrap()).unwrap();
    fs::set_permissions(&outside, fs::Permissions::from_mode(0o644)).unwrap();
    let original = fs::read(&outside).unwrap();
    symlink(&outside, dir.join("request-symlink.json")).unwrap();
    fs::hard_link(&outside, dir.join("request-linked.json")).unwrap();
    assert!(std::process::Command::new("/usr/bin/mkfifo")
        .env_clear()
        .arg(dir.join("request-fifo.json"))
        .status()
        .unwrap()
        .success());
    assert_eq!(inboxes.drain(|_, _| panic!("unsafe delivery")).unwrap(), 0);
    assert_eq!(fs::read(&outside).unwrap(), original);
    assert_eq!(
        fs::metadata(&outside).unwrap().permissions().mode() & 0o777,
        0o644
    );
}
#[test]
fn legacy_read_only_configuration_never_enables_commands() {
    use pi_shared_hub::publisher::Config;
    let config = Config::parse(
        [
            "--registry",
            "/registry",
            "--output",
            "/output",
            "--scope",
            "a",
        ]
        .map(str::to_owned),
    )
    .unwrap();
    assert!(!config.actions);
    assert!(config.session.is_none());
    assert!(Config::parse(
        [
            "--registry",
            "/registry",
            "--output",
            "/output",
            "--scope",
            "a",
            "--session",
            "test"
        ]
        .map(str::to_owned)
    )
    .is_err());
    let config = Config::parse(
        [
            "--registry",
            "/registry",
            "--output",
            "/output",
            "--scope",
            "a",
            "--actions",
            "--session",
            "test",
        ]
        .map(str::to_owned),
    )
    .unwrap();
    assert!(config.actions);
    assert_eq!(config.session.as_deref(), Some("test"));
}
