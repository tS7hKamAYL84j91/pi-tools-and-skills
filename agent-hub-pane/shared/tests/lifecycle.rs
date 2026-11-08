use pi_shared_hub::frame::{Frame, Watermark};
use serde_json::json;
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
    time::Duration,
};

#[test]
fn watermark_survives_errors_and_allows_a_new_collector_epoch() {
    let mut frame:Frame=serde_json::from_value(json!({"schemaVersion":2,"scope":"a","instance":"collector-1","generation":2,"scannedAtMs":10000,"intervalMs":2000,"rows":[],"skipped":0,"capped":false,"stopped":false,"error":null})).unwrap();
    let mut watermark = Watermark::default();
    watermark.accept(&frame).unwrap();
    frame.generation = 1;
    assert!(watermark.accept(&frame).is_err());
    assert!(watermark.accept(&frame).is_err());
    frame.instance = "collector-2".into();
    watermark.accept(&frame).unwrap();
}

#[test]
fn canonical_directory_replacement_and_namespace_move_are_seen_next_scan() {
    use pi_shared_hub::publisher::scan_registry;
    let temp = tempfile::tempdir().unwrap();
    let registry = temp.path().join("registry");
    let setup = || {
        fs::create_dir(&registry).unwrap();
        fs::set_permissions(&registry, fs::Permissions::from_mode(0o700)).unwrap();
    };
    setup();
    let record = |namespace: &str| {
        fs::write(
            registry.join("helper.json"),
            serde_json::to_vec(
                &json!({"id":"helper","name":"helper","pid":42,"namespace":namespace}),
            )
            .unwrap(),
        )
        .unwrap()
    };
    record("a");
    assert_eq!(scan_registry(&registry).unwrap().rows("a").len(), 1);
    fs::rename(&registry, temp.path().join("old")).unwrap();
    setup();
    record("b");
    let snapshot = scan_registry(&registry).unwrap();
    assert!(snapshot.rows("a").is_empty());
    assert_eq!(snapshot.rows("b").len(), 1);
    fs::remove_file(registry.join("helper.json")).unwrap();
    assert_eq!(scan_registry(&registry).unwrap().records, 0);
    fs::set_permissions(&registry, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(scan_registry(&registry).is_err());
}

#[test]
fn eof_and_q_release_owner_while_crash_refuses_implicit_takeover() {
    let temp = tempfile::tempdir().unwrap();
    let registry = temp.path().join("registry");
    fs::create_dir(&registry).unwrap();
    fs::set_permissions(&registry, fs::Permissions::from_mode(0o700)).unwrap();
    let output = temp.path().join("views");
    let run = || {
        Command::new(env!("CARGO_BIN_EXE_pi-hub-index"))
            .args([
                "--registry",
                registry.to_str().unwrap(),
                "--output",
                output.to_str().unwrap(),
                "--scope",
                "a",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    };
    let wait = |child: &mut std::process::Child| {
        for _ in 0..100 {
            if let Some(status) = child.try_wait().unwrap() {
                return status;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        child.kill().unwrap();
        panic!("collector did not stop");
    };
    let mut first = run();
    drop(first.stdin.take());
    assert!(wait(&mut first).success());
    assert!(!output.join(".owner").exists());
    let mut second = run();
    second.stdin.as_mut().unwrap().write_all(b"q\n").unwrap();
    assert!(wait(&mut second).success());
    assert!(!output.join(".owner").exists());
    let mut third = run();
    for _ in 0..100 {
        if output.join(".owner").exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(output.join(".owner").exists());
    third.kill().unwrap();
    third.wait().unwrap();
    assert!(output.join(".owner").exists());
    let mut fourth = run();
    assert!(!wait(&mut fourth).success());
    assert!(output.join(".owner").exists());
}
