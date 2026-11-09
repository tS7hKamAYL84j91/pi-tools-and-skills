//! Colour only already-sanitized presentation lines; never parse untrusted ANSI.
pub fn decorate(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            let colour = if index == 0 {
                "167;152;215"
            } else {
                match line.as_bytes().get(1) {
                    Some(b'R') if line.starts_with(['>', ' ']) => "104;183;141",
                    Some(b'W') if line.starts_with(['>', ' ']) => "167;152;215",
                    Some(b'B' | b'S') if line.starts_with(['>', ' ']) => "205;154;34",
                    Some(b'X') if line.starts_with(['>', ' ']) => "234;127;129",
                    Some(b'D') if line.starts_with(['>', ' ']) => "126;136;142",
                    _ => "157;165;169",
                }
            };
            let selected = line.starts_with('>');
            format!(
                "{}\x1b[38;2;{}m{}\x1b[0m",
                if selected { "\x1b[7m" } else { "" },
                colour,
                line
            )
        })
        .collect()
}
