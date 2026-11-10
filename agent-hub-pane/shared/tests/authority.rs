use cap_std::{ambient_authority, fs::Dir};
use pi_shared_hub::{
    authority::{self, Context, Pane},
    command::{Intent, Origin, Request},
    ProcessState, Snapshot,
};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn record(path: &Path, id: &str, extra: Value) {
    let mut value = json!({"id":id,"name":"Lead","pid":42,"startedAt":1000,"heartbeat":1000,"status":"waiting","cwd":"/work","zellij":{"sessionName":"test","paneId":2}});
    value
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    fs::write(
        path.join(format!("{id}.json")),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
}
fn scan(path: &Path) -> Snapshot {
    Snapshot::scan_with_state(
        &Dir::open_ambient_dir(path, ambient_authority()).unwrap(),
        |_, _| ProcessState::Live,
    )
    .unwrap()
}
fn panes() -> Vec<Pane> {
    authority::parse_panes(
        serde_json::to_string(&json!([
         {"id":99,"is_plugin":true,"tab_id":1,"is_focused":true},
         {"id":2,"is_plugin":false,"tab_id":1,"pane_cwd":"/work","is_selectable":true}
        ]))
        .unwrap()
        .as_bytes(),
    )
    .unwrap()
}
fn context() -> Context<'static> {
    Context {
        scope: "Lead",
        session: "test",
        origin: Origin {
            plugin_id: 99,
            client_id: 1,
        },
        require_focus: true,
        now: 1000,
    }
}

#[test]
fn canonical_identity_scope_generation_and_actual_pane_cwd_are_required() {
    let temp = tempfile::tempdir().unwrap();
    record(temp.path(), "id", json!({}));
    let snapshot = scan(temp.path());
    let version = snapshot.canonical[0].version();
    let good = panes();
    assert!(authority::validate(&snapshot, &good, context(), "id", &version).is_ok());
    for patch in [
        json!({"pid":43}),
        json!({"startedAt":1001}),
        json!({"name":"renamed","declared_name":"Lead"}),
        json!({"status":"running"}),
        json!({"namespace":"other"}),
        json!({"cwd":"/else"}),
        json!({"parentId":"parent"}),
        json!({"zellij":{"sessionName":"test","paneId":3}}),
    ] {
        record(temp.path(), "id", patch);
        assert!(authority::validate(&scan(temp.path()), &good, context(), "id", &version).is_err());
    }
    record(temp.path(), "id", json!({}));
    let snapshot = scan(temp.path());
    for change in 0..5 {
        let mut bad = panes();
        match change {
            0 => bad[1].pane_cwd = Some("/else".into()),
            1 => bad[1].tab_id = 2,
            2 => bad[1].is_selectable = Some(false),
            3 => bad[1].is_suppressed = Some(true),
            _ => bad[0].is_focused = false,
        };
        assert!(authority::validate(&snapshot, &bad, context(), "id", &version).is_err());
    }
}
#[test]
fn duplicate_claims_partial_reads_and_stale_observations_fail_closed() {
    let temp = tempfile::tempdir().unwrap();
    record(temp.path(), "id", json!({}));
    let version = scan(temp.path()).canonical[0].version();
    record(
        temp.path(),
        "other",
        json!({"name":"Other","kind":"external"}),
    );
    assert!(authority::validate(&scan(temp.path()), &panes(), context(), "id", &version).is_err());
    fs::remove_file(temp.path().join("other.json")).unwrap();
    fs::write(temp.path().join("invalid.json"), "{").unwrap();
    assert!(authority::validate(&scan(temp.path()), &panes(), context(), "id", &version).is_err());
    fs::remove_file(temp.path().join("invalid.json")).unwrap();
    for heartbeat in [Value::Null, json!(40000), json!(-40000)] {
        record(temp.path(), "id", json!({"heartbeat":heartbeat}));
        assert!(
            authority::validate(&scan(temp.path()), &panes(), context(), "id", &version).is_err()
        );
    }
}
#[test]
fn new_name_checks_all_claims_journal_and_fixed_environment_scrub() {
    let temp = tempfile::tempdir().unwrap();
    record(temp.path(), "id", json!({"spawn_name":"claimed"}));
    assert!(!authority::name_available(temp.path(), "CLAIMED").unwrap());
    assert!(authority::name_available(temp.path(), "unused").unwrap());
    fs::write(
        temp.path().join("namespace-owners.json"),
        r#"{"owners":[{"name":"held"}]}"#,
    )
    .unwrap();
    assert!(!authority::name_available(temp.path(), "held").unwrap());
    let snapshot = scan(temp.path());
    let guard = authority::validate(
        &snapshot,
        &panes(),
        context(),
        "id",
        &snapshot.canonical[0].version(),
    )
    .unwrap();
    let argv = authority::create_argv("test", "lead", "child", &guard, &panes()).unwrap();
    assert!(argv.windows(2).any(|v| v == ["--cwd", "/work"]));
    assert!(argv.windows(2).any(|v| v == ["-u", "MATRIX_ACCESS_TOKEN"]));
    assert!(argv.windows(2).any(|v| v == ["-u", "HUB_SIDEBAR_TOKEN"]));
    assert!(argv
        .windows(2)
        .any(|v| v == ["-u", "PI_CODING_AGENT_SESSION_DIR"]));
    assert!(argv.contains(&"PI_MATRIX_DISABLED=1".into()));
    assert!(!argv.contains(&"--model".into()));
    assert!(!argv.contains(&"sh".into()));
    for bad in ["../escape", "lead", "a;cmd"] {
        assert!(authority::create_argv("test", "lead", bad, &guard, &panes()).is_err());
    }
}
#[test]
fn pane_root_pid_must_own_the_canonical_process() {
    let mut child = std::process::Command::new("sleep")
        .arg("2")
        .spawn()
        .unwrap();
    let descendant =
        pi_shared_hub::authority::process_descends_from(child.id(), std::process::id());
    let self_match = pi_shared_hub::authority::process_descends_from(child.id(), child.id());
    let unrelated = pi_shared_hub::authority::process_descends_from(std::process::id(), child.id());
    child.kill().unwrap();
    child.wait().unwrap();
    assert!(descendant && self_match);
    assert!(!unrelated);
    assert!(!pi_shared_hub::authority::process_descends_from(
        std::process::id(),
        0
    ));
}
#[test]
fn async_binding_allows_navigation_but_never_retargets() {
    let temp = tempfile::tempdir().unwrap();
    record(temp.path(), "id", json!({}));
    let snapshot = scan(temp.path());
    let version = snapshot.canonical[0].version();
    let old = authority::validate(&snapshot, &panes(), context(), "id", &version).unwrap();
    let mut moved_focus = panes();
    moved_focus[0].is_focused = false;
    let mut ctx = context();
    ctx.require_focus = false;
    let current = authority::validate(&snapshot, &moved_focus, ctx, "id", &version).unwrap();
    assert!(authority::binding_matches(&old, &current));
    let mut moved_tab = panes();
    for pane in &mut moved_tab {
        pane.tab_id = 2;
    }
    let current = authority::validate(&snapshot, &moved_tab, context(), "id", &version).unwrap();
    assert!(!authority::binding_matches(&old, &current));
}
#[test]
fn requests_are_bounded_and_bound_to_an_owner_epoch() {
    let request = Request {
        schema_version: 1,
        id: "request-1".into(),
        epoch: "owner-1".into(),
        origin: context().origin,
        issued_at_ms: 1000,
        expires_at_ms: 6000,
        intent: Intent::PrepareClose {
            agent_id: "id".into(),
            version: "a".repeat(64),
        },
    };
    assert!(request.valid("owner-1", 1000));
    assert!(!request.valid("owner-2", 1000));
    assert!(!request.valid("owner-1", 6001));
    let mut future = request.clone();
    future.issued_at_ms = 2001;
    assert!(!future.valid("owner-1", 0));
}
