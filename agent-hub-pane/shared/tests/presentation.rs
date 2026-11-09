use pi_shared_hub::{age, ordered, Row, View};
use serde_json::json;
fn row(id: &str, parent: Option<&str>) -> Row {
    serde_json::from_value(json!({"id":id,"name":id,"status":"waiting","model":"provider/fixture:cloud","lead":false,"state":"live","version":"a".repeat(64),"parent_id":parent,"age":"2m"})).unwrap()
}
#[test]
fn wrapped_rows_page_by_lines_and_keep_both_mouse_targets() {
    let rows = [
        row("first-agent", None),
        row("second-agent", None),
        row("third-agent", None),
    ];
    let refs = rows.iter().collect::<Vec<_>>();
    let mut view = View::default();
    view.step(&refs, 1);
    let lines = view.render(&refs, 2, 26);
    assert_eq!(view.offset, 1);
    assert_eq!(view.line_ids, ["second-agent", "second-agent"]);
    assert!(lines[0].starts_with(">W second-agent"));
    assert!(lines[1].starts_with(">  waiting | fixture"));
    assert!(lines
        .iter()
        .all(|line| line.len() <= 26 && !line.contains(":cloud")));
    assert!(
        view.render(&refs, 1, 26).is_empty(),
        "do not show a partial row"
    );
}
#[test]
fn narrow_rows_use_single_line_and_missing_selection_never_transfers() {
    let rows = [row("first", None), row("second", None)];
    let refs = rows.iter().collect::<Vec<_>>();
    let mut view = View::default();
    assert_eq!(view.render(&refs, 2, 12).len(), 2);
    view.selected = Some("gone".into());
    assert!(!view.render(&refs, 2, 12).iter().any(|s| s.starts_with('>')));
}
#[test]
fn parent_groups_local_lead_and_orphans_are_present_once() {
    let rows = vec![
        row("a", None),
        row("b", None),
        row("child", Some("b")),
        row("orphan", Some("missing")),
        row("cycle", Some("cycle")),
    ];
    let ids = |chosen| {
        ordered(&rows, chosen)
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>()
    };
    assert_eq!(ids(None), ["a", "b", "child", "orphan", "cycle"]);
    assert_eq!(ids(Some("b")), ["b", "child", "a", "orphan", "cycle"]);
}
#[test]
fn unicode_names_are_preserved_and_clipped_by_cells() {
    let mut row = row("agent", None);
    row.name = "模型 e\u{301}".into();
    let mut view = View::default();
    let lines = view.render(&[&row], 2, 20);
    assert!(lines[0].contains("模型 e\u{301}"));
    assert!(lines
        .iter()
        .all(|line| unicode_width::UnicodeWidthStr::width(line.as_str()) <= 20));
}
#[test]
fn uptime_is_minute_granularity_and_invalid_times_are_absent() {
    assert_eq!(age(Some(1000.0), 2000), "<1m");
    assert_eq!(age(Some(1000.0), 46000), "<1m");
    assert_eq!(age(Some(1000.0), 61000), "1m");
    assert_eq!(age(Some(1000.0), 121000), "2m");
    assert_eq!(age(Some(1000.0), 7201000), "2h");
    assert_eq!(age(None, 2000), "");
    assert_eq!(age(Some(f64::NAN), 2000), "");
}
