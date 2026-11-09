use pi_shared_hub::{color::decorate, text};

#[test]
fn status_colours_and_selection_are_reset_after_sanitized_text() {
    let lines = vec![
        text("Hub", 20),
        text(">R agent\x1b[2J", 40),
        text(" W helper", 40),
    ];
    let rendered = decorate(&lines);
    assert!(rendered[0].contains("38;2;167;152;215m"));
    assert!(rendered[1].starts_with("\x1b[7m\x1b[38;2;104;183;141m"));
    assert!(!rendered[1].contains("\x1b[2J"));
    assert!(rendered.iter().all(|s| s.ends_with("\x1b[0m")));
}
