use pi_shared_hub::{
    command::{Intent, Origin, Phase, Request},
    executor::Executor,
    frame::now_ms,
    publisher::scan_registry,
};
use serde_json::json;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
fn fixture() -> (tempfile::TempDir, PathBuf, String) {
    let temp = tempfile::tempdir().unwrap();
    let registry = temp.path().join("registry");
    fs::create_dir(&registry).unwrap();
    fs::set_permissions(&registry, fs::Permissions::from_mode(0o700)).unwrap();
    let now = now_ms();
    let record = json!({"id":"agent","name":"Lead","pid":std::process::id(),"startedAt":now,"heartbeat":now,"status":"waiting","cwd":"/work","zellij":{"sessionName":"test","paneId":2}});
    fs::write(
        registry.join("agent.json"),
        serde_json::to_vec(&record).unwrap(),
    )
    .unwrap();
    let executable = temp.path().join("host");
    let root = serde_json::to_string(temp.path().to_str().unwrap()).unwrap();
    fs::write(&executable,format!(r#"#!/usr/bin/python3
import json,sys,time
from pathlib import Path
root=Path({root}); action=sys.argv[4]
with (root/'calls').open('a') as f:f.write(action+'\n')
if action=='list-panes':
 if (root/'slow').exists():time.sleep(.3)
 p=[dict(id=99,is_plugin=True,tab_id=1,is_focused=True)]
 if not (root/'closed').exists():p.append(dict(id=2,is_plugin=False,tab_id=1,pane_cwd='/work',is_selectable=True))
 print(json.dumps(p))
elif action=='list-tabs':print(json.dumps([dict(tab_id=1,are_floating_panes_visible=False)]))
elif action=='close-pane':
 (root/'closed').touch();(root/'registry/agent.json').unlink()
 if (root/'uncertain').exists():time.sleep(2)
else:raise SystemExit(2)
"#)).unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    (temp, registry, executable.to_str().unwrap().into())
}
fn request(id: &str, intent: Intent) -> Request {
    Request {
        schema_version: 1,
        id: id.into(),
        epoch: "epoch".into(),
        origin: Origin {
            plugin_id: 99,
            client_id: 1,
        },
        issued_at_ms: now_ms(),
        expires_at_ms: now_ms() + 30000,
        intent,
    }
}
fn await_phase(executor: &Executor, phase: Phase) {
    let deadline = Instant::now() + Duration::from_secs(7);
    loop {
        let controls = executor.controls("Lead");
        if controls
            .receipts
            .iter()
            .any(|r| r.id == "prepare" && r.phase == phase)
        {
            return;
        }
        assert!(Instant::now() < deadline, "missing {phase:?}: {controls:?}");
        thread::sleep(Duration::from_millis(10));
    }
}
fn prepare(executor: &mut Executor, registry: &Path) {
    let version = scan_registry(registry).unwrap().canonical[0].version();
    assert!(executor.submit(
        "Lead",
        request(
            "prepare",
            Intent::PrepareClose {
                agent_id: "agent".into(),
                version
            }
        )
    ));
    await_phase(executor, Phase::AwaitingConfirmation);
}

#[test]
fn focus_only_prepares_a_native_validation_permit_never_dispatches_cli_focus() {
    let (temp, registry, host) = fixture();
    let mut executor = Executor::start(registry.clone(), "test".into(), "epoch".into(), host);
    let version = scan_registry(&registry).unwrap().canonical[0].version();
    assert!(executor.submit(
        "Lead",
        request(
            "prepare",
            Intent::Focus {
                agent_id: "agent".into(),
                version,
                pane_pid: std::process::id(),
            }
        )
    ));
    await_phase(&executor, Phase::FocusReady);
    let controls = executor.controls("Lead");
    let permit = controls.receipts[0].focus.as_ref().unwrap();
    assert_eq!(permit.pane_id, 2);
    assert_eq!(permit.tab_id, 1);
    assert_eq!(
        permit.cwd_hash,
        pi_shared_hub::focus::cwd_hash(Path::new("/work")).unwrap()
    );
    assert!(!fs::read_to_string(temp.path().join("calls"))
        .unwrap()
        .contains("focus"));
    assert!(!temp.path().join("closed").exists());
    executor.shutdown();
}
#[test]
fn requires_separate_confirmation_verifies_unregister_and_refuses_replay() {
    let (temp, registry, host) = fixture();
    let mut executor = Executor::start(registry.clone(), "test".into(), "epoch".into(), host);
    prepare(&mut executor, &registry);
    assert!(!temp.path().join("closed").exists());
    let confirmed = request(
        "confirm",
        Intent::Confirm {
            prepared_id: "prepare".into(),
        },
    );
    assert!(executor.submit("Lead", confirmed.clone()));
    let mut changed_payload = confirmed.clone();
    changed_payload.intent = Intent::PrepareClose {
        agent_id: "different".into(),
        version: "b".repeat(64),
    };
    assert!(!executor.submit("Lead", changed_payload));
    assert!(!executor.submit(
        "Lead",
        request(
            "another-confirm",
            Intent::Confirm {
                prepared_id: "prepare".into()
            }
        )
    ));
    assert!(!executor.submit("Lead", confirmed));
    await_phase(&executor, Phase::Succeeded);
    assert!(temp.path().join("closed").exists());
    assert_eq!(
        fs::read_to_string(temp.path().join("calls"))
            .unwrap()
            .lines()
            .filter(|l| *l == "close-pane")
            .count(),
        1
    );
    executor.shutdown();
}
#[test]
fn changed_canonical_identity_during_host_wait_revokes_approval() {
    let (temp, registry, host) = fixture();
    let mut executor = Executor::start(registry.clone(), "test".into(), "epoch".into(), host);
    prepare(&mut executor, &registry);
    fs::write(temp.path().join("slow"), "").unwrap();
    executor.submit(
        "Lead",
        request(
            "confirm",
            Intent::Confirm {
                prepared_id: "prepare".into(),
            },
        ),
    );
    thread::sleep(Duration::from_millis(80));
    let file = registry.join("agent.json");
    let mut row: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    row["status"] = json!("running");
    fs::write(file, serde_json::to_vec(&row).unwrap()).unwrap();
    await_phase(&executor, Phase::Failed);
    assert!(!temp.path().join("closed").exists());
    executor.shutdown();
}
#[test]
fn cancellation_before_dispatch_is_not_replayed() {
    let (temp, registry, host) = fixture();
    let mut executor = Executor::start(registry.clone(), "test".into(), "epoch".into(), host);
    prepare(&mut executor, &registry);
    fs::write(temp.path().join("slow"), "").unwrap();
    executor.submit(
        "Lead",
        request(
            "confirm",
            Intent::Confirm {
                prepared_id: "prepare".into(),
            },
        ),
    );
    thread::sleep(Duration::from_millis(80));
    assert!(executor.submit(
        "Lead",
        request(
            "cancel",
            Intent::Cancel {
                prepared_id: "prepare".into()
            }
        )
    ));
    await_phase(&executor, Phase::Failed);
    assert!(!temp.path().join("closed").exists());
    executor.shutdown();
}
#[test]
fn dispatched_timeout_is_uncertain_and_inhibits_further_mutations() {
    let (temp, registry, host) = fixture();
    let mut executor = Executor::start(registry.clone(), "test".into(), "epoch".into(), host);
    prepare(&mut executor, &registry);
    fs::write(temp.path().join("uncertain"), "").unwrap();
    executor.submit(
        "Lead",
        request(
            "confirm",
            Intent::Confirm {
                prepared_id: "prepare".into(),
            },
        ),
    );
    await_phase(&executor, Phase::Uncertain);
    assert!(executor.controls("Lead").inhibited);
    assert!(!executor.submit(
        "Lead",
        request(
            "later",
            Intent::PrepareClose {
                agent_id: "agent".into(),
                version: "a".repeat(64)
            }
        )
    ));
    assert_eq!(
        fs::read_to_string(temp.path().join("calls"))
            .unwrap()
            .lines()
            .filter(|l| *l == "close-pane")
            .count(),
        1
    );
    executor.shutdown();
}
