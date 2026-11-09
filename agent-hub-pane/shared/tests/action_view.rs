use pi_shared_hub::{
    action_view::{ActionView, Input},
    command::{Controls, Intent, Origin, Phase, Receipt},
    frame::Frame,
};
use serde_json::json;
fn frame() -> Frame {
    serde_json::from_value(json!({"schemaVersion":2,"scope":"a","instance":"epoch","generation":1,"scannedAtMs":1000,"intervalMs":2000,"rows":[{"id":"agent","name":"a","status":"waiting","model":"fixture","lead":true,"state":"live","version":"a".repeat(64)}],"skipped":0,"capped":false,"stopped":false,"error":null,"controls":{"inhibited":false,"receipts":[]}})).unwrap()
}
fn ui() -> ActionView {
    ActionView::new(
        true,
        Origin {
            plugin_id: 9,
            client_id: 1,
        },
    )
}
fn call(
    ui: &mut ActionView,
    key: Input,
    frame: &Frame,
    now: u64,
) -> Option<pi_shared_hub::command::Request> {
    ui.handle(key, frame, Some("agent"), &["agent".into()], now)
}
fn armed(frame: &mut Frame, id: &str) {
    frame.controls = Some(Controls {
        inhibited: false,
        receipts: vec![Receipt {
            id: id.into(),
            origin: Origin {
                plugin_id: 9,
                client_id: 1,
            },
            phase: Phase::AwaitingConfirmation,
            summary: "Close Y/n".into(),
            expires_at_ms: 6000,
            focus: None,
        }],
    });
}
#[test]
fn close_requires_native_prepare_and_separate_confirmation_not_queued_keys() {
    let mut ui = ui();
    let mut frame = frame();
    let request = call(&mut ui, Input::Char('c'), &frame, 1000).unwrap();
    assert!(matches!(request.intent, Intent::PrepareClose { .. }));
    assert!(call(&mut ui, Input::Char('y'), &frame, 1001).is_none());
    armed(&mut frame, &request.id);
    ui.receive(&frame, 1100);
    ui.rendered();
    assert!(call(&mut ui, Input::Enter, &frame, 1101).is_none());
    let confirmed = call(&mut ui, Input::Enter, &frame, 1401).unwrap();
    assert!(matches!(confirmed.intent, Intent::Confirm { .. }));
    // Old read-side receipt cannot roll local confirmation back to armed.
    ui.receive(&frame, 1500);
    assert!(call(&mut ui, Input::Char('y'), &frame, 1501).is_none());
    ui.receive(&frame, 32000);
    assert!(!ui.enabled(&frame, 32000));
    assert!(ui.notice.contains("overdue"));
}
#[test]
fn cancellation_and_navigation_revoke_unconfirmed_forms() {
    let mut ui = ui();
    let mut frame = frame();
    let request = call(&mut ui, Input::Char('c'), &frame, 1000).unwrap();
    armed(&mut frame, &request.id);
    ui.receive(&frame, 1100);
    assert!(matches!(
        call(&mut ui, Input::Char('n'), &frame, 1101)
            .unwrap()
            .intent,
        Intent::Cancel { .. }
    ));
    ui.receive(&frame, 1200);
    assert!(call(&mut ui, Input::Char('y'), &frame, 1201).is_none());
    ui.hidden();
    assert!(!ui.active());
}
#[test]
fn new_uses_name_entry_and_does_not_silently_replace_a_missing_chosen_lead() {
    let mut ui = ui();
    let frame = frame();
    call(&mut ui, Input::Char('n'), &frame, 1000);
    for c in "child".chars() {
        assert!(call(&mut ui, Input::Char(c), &frame, 1001).is_none());
    }
    assert!(matches!(
        call(&mut ui, Input::Enter, &frame, 1002).unwrap().intent,
        Intent::PrepareNew { .. }
    ));
    let mut other = ActionView::new(true, ui.origin.unwrap());
    other.chosen_lead = Some("gone".into());
    call(&mut other, Input::Char('n'), &frame, 1000);
    for c in "child".chars() {
        call(&mut other, Input::Char(c), &frame, 1001);
    }
    assert!(call(&mut other, Input::Enter, &frame, 1002).is_none());
    assert!(other.notice.contains("live lead"));
}
#[test]
fn local_lead_choice_does_not_transfer_to_restarted_process() {
    let mut ui = ui();
    let mut frame = frame();
    frame.rows[0].incarnation = "a".repeat(64);
    call(&mut ui, Input::Char('l'), &frame, 1000);
    frame.rows[0].incarnation = "b".repeat(64);
    call(&mut ui, Input::Char('n'), &frame, 1001);
    for c in "child".chars() {
        call(&mut ui, Input::Char(c), &frame, 1002);
    }
    assert!(call(&mut ui, Input::Enter, &frame, 1003).is_none());
    assert!(ui.notice.contains("live lead"));
}
#[test]
fn stale_and_read_only_frames_never_submit_mutations() {
    let mut ui = ui();
    let mut frame = frame();
    assert!(call(&mut ui, Input::Char('c'), &frame, 8000).is_none());
    frame.controls = None;
    assert!(call(&mut ui, Input::Char('c'), &frame, 1000).is_none());
}
