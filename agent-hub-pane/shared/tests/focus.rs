use pi_shared_hub::{
    action_view::{ActionView, Input},
    command::{FocusPermit, Origin, Phase, Receipt},
    focus::cwd_hash,
    frame::Frame,
};
use serde_json::json;
use std::path::Path;
fn frame() -> Frame {
    serde_json::from_value(json!({"schemaVersion":2,"scope":"a","instance":"epoch","generation":1,"scannedAtMs":1000,"intervalMs":2000,"rows":[{"id":"agent","name":"a","status":"waiting","model":"fixture","lead":true,"state":"live","version":"a".repeat(64)}],"skipped":0,"capped":false,"stopped":false,"error":null,"controls":{"inhibited":false,"receipts":[]}})).unwrap()
}
fn setup() -> (ActionView, Frame) {
    let origin = Origin {
        plugin_id: 9,
        client_id: 1,
    };
    let mut ui = ActionView::new(true, origin);
    let mut frame = frame();
    let request = ui
        .handle(Input::Enter, &frame, Some("agent"), &["agent".into()], 1000)
        .unwrap();
    frame.controls.as_mut().unwrap().receipts.push(Receipt {
        id: request.id,
        origin,
        phase: Phase::FocusReady,
        summary: "Focus validated".into(),
        expires_at_ms: 2000,
        focus: Some(FocusPermit {
            agent_id: "agent".into(),
            version: "a".repeat(64),
            pane_id: 2,
            pane_pid: 123,
            tab_id: 1,
            floating: false,
            cwd_hash: cwd_hash(Path::new("/work")).unwrap(),
        }),
    });
    (ui, frame)
}
#[test]
fn permits_are_client_bound_expiring_and_consumed_once() {
    let (mut ui, mut frame) = setup();
    frame.controls.as_mut().unwrap().receipts[0]
        .origin
        .client_id = 2;
    assert!(ui.take_focus(&frame, 1100).is_none());
    frame.controls.as_mut().unwrap().receipts[0]
        .origin
        .client_id = 1;
    assert!(ui.take_focus(&frame, 1100).is_some());
    assert!(ui.take_focus(&frame, 1101).is_none());
    let (mut ui, frame) = setup();
    assert!(ui.take_focus(&frame, 2001).is_none());
}
#[test]
fn navigation_cancellation_and_changed_identity_reject_unconsumed_permits() {
    let (mut ui, frame) = setup();
    ui.hidden();
    assert!(ui.take_focus(&frame, 1100).is_none());
    let (mut ui, mut frame) = setup();
    frame.rows[0].version = "b".repeat(64);
    assert!(ui.take_focus(&frame, 1100).is_none());
    let (mut ui, frame) = setup();
    ui.handle(
        Input::Escape,
        &frame,
        Some("agent"),
        &["agent".into()],
        1100,
    );
    ui.receive(&frame, 1200);
    assert!(ui.take_focus(&frame, 1200).is_none());
    assert!(!ui.active());
}
#[test]
fn cwd_fingerprints_are_normalized_and_never_export_paths() {
    assert_eq!(
        cwd_hash(Path::new("/work/a/../b")),
        cwd_hash(Path::new("/work/b"))
    );
    assert_ne!(
        cwd_hash(Path::new("/work/a")),
        cwd_hash(Path::new("/work/b"))
    );
    assert!(cwd_hash(Path::new("relative")).is_none());
    assert!(cwd_hash(Path::new("/work\n")).is_none());
    assert_eq!(cwd_hash(Path::new("/work")).unwrap().len(), 64);
}
