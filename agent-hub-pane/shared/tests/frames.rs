use cap_std::{ambient_authority, fs::Dir};
use pi_shared_hub::{
    frame::{read_frame, scope_directory, Frame, Freshness, MAX_FRAME_BYTES},
    publisher::{classify_process, ensure_separate, Publisher},
    ProcessState, Snapshot,
};
use serde_json::json;
use std::{fs, path::Path};

fn frame(scope: &str) -> Frame {
    serde_json::from_value(json!({"schemaVersion":1,"scope":scope,"instance":"test-1","generation":1,"scannedAtMs":10000,"intervalMs":2000,"rows":[],"skipped":0,"capped":false,"stopped":false,"error":null})).unwrap()
}
fn open(path: &Path) -> Dir {
    Dir::open_ambient_dir(path, ambient_authority()).unwrap()
}

#[test]
fn strict_scope_freshness_and_schema_validation() {
    let value = frame("scope");
    assert!(value.validate("scope", 10000).is_ok());
    assert!(value.validate("other", 10000).is_err());
    assert!(value.validate("scope", 8000).is_err());
    assert_eq!(value.freshness(16000), Freshness::Fresh);
    assert_eq!(value.freshness(16001), Freshness::Stale);
    let mut refreshed = value.clone();
    refreshed.generation += 1;
    refreshed.scanned_at_ms += 2000;
    assert!(value.same_presentation(10000, &refreshed, 12000));
    assert!(!value.same_presentation(10000, &value, 16001));
    let mut stopped = value.clone();
    stopped.stopped = true;
    assert_eq!(stopped.freshness(10000), Freshness::Stopped);
    for bad in [
        json!({"schemaVersion":2}),
        json!({"generation":0}),
        json!({"intervalMs":0}),
    ] {
        let mut raw = serde_json::to_value(&value).unwrap();
        raw.as_object_mut()
            .unwrap()
            .extend(bad.as_object().unwrap().clone());
        assert!(serde_json::from_value::<Frame>(raw)
            .unwrap()
            .validate("scope", 10000)
            .is_err());
    }
    let mut raw = serde_json::to_value(&value).unwrap();
    raw["rows"] = json!([{"id":"a","name":"\u{1b}[31m", "model":"fixture", "status":"waiting", "lead":true,"state":"live"}]);
    assert!(serde_json::from_value::<Frame>(raw.clone())
        .unwrap()
        .validate("scope", 10000)
        .is_err());
    raw["rows"][0]["name"] = json!("safe");
    let duplicate = raw["rows"][0].clone();
    raw["rows"].as_array_mut().unwrap().push(duplicate);
    assert!(serde_json::from_value::<Frame>(raw)
        .unwrap()
        .validate("scope", 10000)
        .is_err());
}

#[test]
fn one_publisher_private_outputs_and_global_scan_to_scoped_frames() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let registry = temp.path().join("registry");
    fs::create_dir(&registry).unwrap();
    for scope in ["a", "b"] {
        fs::write(
            registry.join(format!("{scope}.json")),
            serde_json::to_vec(
                &json!({"id":scope,"name":scope,"pid":42,"status":"waiting","model":"fixture/one"}),
            )
            .unwrap(),
        )
        .unwrap();
    }
    let snapshot = Snapshot::scan(&open(&registry)).unwrap();
    assert_eq!(snapshot.reads, 2);
    let output = temp.path().join("views");
    let mut writer = Publisher::open(&output, vec!["a".into(), "b".into()], 2000).unwrap();
    assert!(Publisher::open(&output, vec!["a".into()], 2000).is_err());
    assert_eq!(
        fs::metadata(&output).unwrap().permissions().mode() & 0o777,
        0o700
    );
    writer.publish(&snapshot, None, false).unwrap();
    for scope in ["a", "b"] {
        let directory = output.join(scope_directory(scope).unwrap());
        let file = directory.join("snapshot.json");
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let value = read_frame(&open(&directory), scope, pi_shared_hub::frame::now_ms()).unwrap();
        assert_eq!(value.rows.len(), 1);
        assert_eq!(value.rows[0].id, scope);
    }
    writer.publish(&snapshot, None, true).unwrap();
    assert!(
        read_frame(
            &open(&output.join(scope_directory("a").unwrap())),
            "a",
            pi_shared_hub::frame::now_ms()
        )
        .unwrap()
        .stopped
    );
    drop(writer);
    assert!(!output.join(".owner").exists());
    let _reopened = Publisher::open(&output, vec!["a".into()], 2000).unwrap();
}

#[test]
fn refuses_unknown_output_state_and_nested_registry() {
    let temp = tempfile::tempdir().unwrap();
    let output = temp.path().join("output");
    fs::create_dir(&output).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&output, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(output.join("keep.txt"), "keep").unwrap();
    assert!(Publisher::open(&output, vec!["scope".into()], 2000).is_err());
    assert_eq!(fs::read_to_string(output.join("keep.txt")).unwrap(), "keep");
    assert!(!output.join(".owner").exists());
    assert!(ensure_separate(Path::new("/registry"), Path::new("/registry/views")).is_err());
    assert!(ensure_separate(Path::new("/views/registry"), Path::new("/views")).is_err());
    assert!(scope_directory("../escape").is_err());
}

#[test]
fn refuses_snapshot_symlinks_oversize_and_atomic_target_poisoning() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let output = temp.path().join("output");
    let mut writer = Publisher::open(&output, vec!["scope".into()], 2000).unwrap();
    let directory = output.join(scope_directory("scope").unwrap());
    let external = temp.path().join("untouched");
    fs::write(&external, "keep").unwrap();
    symlink(&external, directory.join("snapshot.json")).unwrap();
    assert!(read_frame(&open(&directory), "scope", 10000).is_err());
    assert!(writer.publish(&Snapshot::default(), None, false).is_err());
    assert_eq!(fs::read_to_string(&external).unwrap(), "keep");
    fs::remove_file(directory.join("snapshot.json")).unwrap();
    let file = fs::File::create(directory.join("snapshot.json")).unwrap();
    file.set_len(MAX_FRAME_BYTES + 1).unwrap();
    assert!(read_frame(&open(&directory), "scope", 10000).is_err());
}

#[test]
fn process_generation_check_matches_node_contract() {
    let mut fields = vec!["0"; 20];
    fields[0] = "S";
    fields[19] = "100";
    let stat = format!("42 (name ) with spaces) {}", fields.join(" "));
    assert_eq!(
        classify_process(&stat, Some(1_001_000.0), 1000),
        ProcessState::Live
    );
    assert_eq!(
        classify_process(&stat, Some(1.0), 1000),
        ProcessState::Stale
    );
    assert_eq!(classify_process(&stat, None, 1000), ProcessState::Unknown);
    assert_eq!(
        classify_process(&stat, Some(1_601_000.0), 1000),
        ProcessState::Live
    );
    assert_eq!(
        classify_process(&stat.replace(") S ", ") Z "), Some(1_001_000.0), 1000),
        ProcessState::Stale
    );
}
