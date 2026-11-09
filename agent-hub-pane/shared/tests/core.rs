use cap_std::{ambient_authority, fs::Dir};
use pi_shared_hub::{registry_dir, scope_name, text, Snapshot, View, MAX_FILES};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

fn record(root: &Path, id: &str, extra: Value) {
    let mut value = json!({"id":id,"name":id,"pid":42,"status":"waiting","model":"fixture/one"});
    value
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    fs::write(
        root.join(format!("{id}.json")),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
}
fn open(root: &Path) -> Dir {
    Dir::open_ambient_dir(root, ambient_authority()).unwrap()
}

#[test]
fn strict_scope_index_does_not_broaden_by_prefix_name_or_cwd() {
    let temp = tempfile::tempdir().unwrap();
    record(
        temp.path(),
        "root",
        json!({"name":"renamed", "declared_name":"Lead"}),
    );
    record(temp.path(), "helper", json!({"namespace":"lead"}));
    record(temp.path(), "wrong-case", json!({"namespace":"Lead"}));
    record(
        temp.path(),
        "lookalike",
        json!({"name":"Lead-other", "cwd":"/same"}),
    );
    record(
        temp.path(),
        "alias",
        json!({"name":"Lead", "declared_name":"different"}),
    );
    record(
        temp.path(),
        "external",
        json!({"namespace":"lead", "kind":"external"}),
    );
    let cache = Snapshot::scan(&open(temp.path())).unwrap();
    assert_eq!(
        cache
            .rows("Lead")
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["root", "helper"]
    );
    assert_eq!(
        cache
            .rows("lead")
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["helper"]
    );
    assert!(cache.rows("unknown").is_empty());
}

#[test]
fn tab_projection_reuses_cache_until_one_explicit_refresh() {
    let temp = tempfile::tempdir().unwrap();
    for group in ["a", "b", "c"] {
        record(temp.path(), group, json!({}));
    }
    let dir = open(temp.path());
    let cache = Snapshot::scan(&dir).unwrap();
    assert_eq!(cache.reads, 3);
    record(temp.path(), "b", json!({"model":"fixture/two"}));
    for _ in 0..100 {
        for group in ["a", "b", "c"] {
            assert_eq!(cache.rows(group)[0].model, "fixture/one");
        }
    }
    assert_eq!(cache.reads, 3);
    let refreshed = Snapshot::scan(&dir).unwrap();
    assert_eq!(refreshed.reads, 3);
    assert_eq!(refreshed.rows("b")[0].model, "fixture/two");
}

#[test]
fn independent_view_state_keeps_selection_and_scroll_without_transferring_missing_ids() {
    let temp = tempfile::tempdir().unwrap();
    for i in 0..6 {
        record(temp.path(), &format!("a{i}"), json!({"namespace":"a"}));
    }
    record(temp.path(), "b", json!({}));
    let cache = Snapshot::scan(&open(temp.path())).unwrap();
    let a = cache.rows("a");
    let mut first = View::default();
    let mut second = View::default();
    first.step(&a, 4);
    let lines = first.render(&a, 2, 12);
    assert_eq!(lines.len(), 2);
    assert!(lines[1].starts_with(">W a4"));
    assert!(lines.iter().all(|s| s.len() <= 12));
    second.render(&cache.rows("b"), 2, 30);
    assert_eq!(second.selected.as_deref(), Some("b"));
    assert_eq!(first.selected.as_deref(), Some("a4"));
    let remaining = a.into_iter().filter(|r| r.id != "a4").collect::<Vec<_>>();
    assert!(!first
        .render(&remaining, 2, 30)
        .iter()
        .any(|line| line.starts_with('>')));
    assert_eq!(first.selected.as_deref(), Some("a4"));
}

#[test]
fn rejects_malformed_oversized_private_and_mismatched_records() {
    let temp = tempfile::tempdir().unwrap();
    record(temp.path(), "good", json!({}));
    record(temp.path(), "mismatch", json!({"id":"other"}));
    record(temp.path(), "zero", json!({"pid":0}));
    fs::write(temp.path().join("bad.json"), "{").unwrap();
    fs::write(temp.path().join("huge.json"), vec![b' '; 65537]).unwrap();
    fs::write(temp.path().join(".private.json"), "not a record").unwrap();
    fs::write(temp.path().join("namespace-owners.json"), "not a record").unwrap();
    fs::create_dir(temp.path().join("directory.json")).unwrap();
    let cache = Snapshot::scan(&open(temp.path())).unwrap();
    assert_eq!(cache.records, 1);
    assert_eq!(cache.reads, 4); // only bounded regular, non-private candidates
    assert_eq!(cache.skipped, 5);
}

#[cfg(unix)]
#[test]
fn confines_directory_components_and_refuses_symlink_or_fifo_records() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("agents")).unwrap();
    record(&temp.path().join("agents"), "good", json!({}));
    record(temp.path(), "outside", json!({"namespace":"good"}));
    symlink(
        temp.path().join("outside.json"),
        temp.path().join("agents/outside.json"),
    )
    .unwrap();
    symlink("agents", temp.path().join("redirect")).unwrap();
    let status = std::process::Command::new("/usr/bin/mkfifo")
        .env_clear()
        .arg(temp.path().join("agents/fifo.json"))
        .status()
        .unwrap();
    assert!(status.success());
    for path in [
        "../agents",
        "/agents",
        "redirect",
        "agents/../../elsewhere",
        "",
    ] {
        assert!(registry_dir(open(temp.path()), path).is_err());
    }
    let dir = registry_dir(open(temp.path()), "agents").unwrap();
    let cache = Snapshot::scan(&dir).unwrap();
    assert_eq!(cache.records, 1);
    assert_eq!(cache.reads, 1);
    assert_eq!(cache.skipped, 2);
}

#[test]
fn bounds_directory_work_and_safe_rendering() {
    let temp = tempfile::tempdir().unwrap();
    for i in 0..=MAX_FILES {
        record(temp.path(), &format!("a{i}"), json!({"namespace":"a"}));
    }
    let cache = Snapshot::scan(&open(temp.path())).unwrap();
    assert!(cache.capped);
    assert_eq!(cache.reads, MAX_FILES);
    assert_eq!(cache.records, MAX_FILES);
    let safe = text("\u{1b}[31mname\n\u{202e}模型", 12);
    assert!(safe.chars().all(|c| !c.is_control() && c != '\u{202e}'));
    assert!(unicode_width::UnicodeWidthStr::width(safe.as_str()) <= 12);
    assert_eq!(text("模型", 3), "模");
    assert_eq!(text("e\u{301}x", 2), "e\u{301}x");
    for value in ["", "../scope", "a/b", "x\ny"] {
        assert!(!scope_name(value));
    }
}
