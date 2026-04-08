---
name: speed-reading
description: Terminal speed-reading tools using RSVP (rapid serial visual presentation, word-by-word display) and bionic reading (bold fixation highlights). Use when reading articles, docs, man pages, or any text faster in the terminal. Includes LLM summarise-then-read workflow.
---

# Speed Reading

Terminal speed-reading via **RSVP** (one word at a time, centred at the Optimal Recognition Point) and **Bionic Reading** (bold the fixation characters of each word so your eye locks on faster).

## Setup

Install recommended tools for the best experience — scripts fall back to built-in Python implementations if they're absent:

```bash
# RSVP (gold standard, Perl, interactive controls):
brew install speedread

# Bionic reading (fast Rust binary):
brew install ismet55555/things/bieye
# or: cargo install bieye  |  snap install bieye

# LLM CLI (for summarise-then-read):
pip install llm
llm keys set anthropic   # or openai, etc.
```

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/speed-read.sh` | RSVP: pipe text in, displays word-by-word at configurable WPM |
| `scripts/bionic.sh` | Bold fixation chars of each word (bionic reading format) |
| `scripts/summarise-then-read.sh` | LLM summarises text, then RSVP-displays the summary |
| `scripts/_rsvp.py` | Python fallback used by speed-read.sh when speedread isn't installed |
| `scripts/_bionic.py` | Python fallback used by bionic.sh when bieye isn't installed |

## Usage

### RSVP

```bash
# Pipe text, default 300 WPM
cat article.txt | scripts/speed-read.sh

# Custom WPM
cat article.txt | scripts/speed-read.sh -w 500

# With speedread installed: [ slow down  ] speed up  space pause+context
```

### Bionic Reading

```bash
# Pipe text (bold fixation chars, rest normal)
cat article.txt | scripts/bionic.sh

# Yellow highlight + dim non-fixation text
cat article.txt | scripts/bionic.sh --color --dim

# Page through long documents
cat article.txt | scripts/bionic.sh | less -R

# Man pages
man git | col -bx | scripts/bionic.sh
```

### Summarise Then Read

```bash
# Summarise a file, then RSVP the summary
scripts/summarise-then-read.sh article.txt

# Pipe stdin
cat long-doc.txt | scripts/summarise-then-read.sh

# Custom WPM and model
scripts/summarise-then-read.sh -w 400 -m claude-3-5-haiku paper.txt
```

## Bionic Algorithm

Uses the **text-vide lookup table** — closest to the official Bionic Reading® API output (MIT licensed reverse-engineering by Gumball12/text-vide):

| Word Length | Chars Bolded |
|-------------|-------------|
| 1           | 1 (all) |
| 2–4         | len − 1 |
| 5–12        | len − 2 |
| 13–16       | len − 3 |
| 17–24       | len − 4 |
| 25–29       | len − 5 |
| 30–35       | len − 6 |
| 36–42       | len − 7 |
| 43+         | len − 8 |

Special cases: numbers and contractions are fully bolded; pure punctuation is passed through unchanged.

## RSVP Algorithm

Words are displayed centred so the **Optimal Recognition Point** (≈30% into the word) lands at the terminal midpoint — the same technique used by `pasky/speedread`. The ORP character is highlighted in bold red to anchor the eye.

## Reference

See [Research Report](references/speed-reading-research.md) for scientific background (fixation/saccade theory, tool inventory, algorithm comparisons).
