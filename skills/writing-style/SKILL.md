---
name: writing-style
description: "Personal grammar and style assistant that learns the user's voice from a corpus of their writing. Use when asked to review writing, check style, analyse prose, build a style profile, or give feedback that sounds like 'you on a better day' rather than generic corrections. Triggers on: 'review my writing', 'does this sound like me?', 'style feedback', 'build my style profile', 'analyse my voice', 'writing sample'."
---

# Writing Style

A voice-preserving writing assistant. It learns **your** style from a corpus of your writing, then reviews new text against that profile — flagging genuine errors while keeping suggestions that sound like *you*.

Design principles (from [background research](references/background.md)):
- **Voice-preserving, not voice-replacing.** Suggestions should sound like you, not generic "good prose."
- **Error ≠ style.** Grammar errors get corrected. Stylistic idiosyncrasies get respected.
- **LLM does the heavy lifting.** Scripts manage files; Claude does the analysis.
- **Local-first.** Writing corpus and profile stay on disk; nothing leaves the machine unless you choose cloud LLM.

---

## Setup

One-time setup:

```bash
# 1. Create your corpus directory (anywhere you like)
mkdir -p ~/writing-corpus

# 2. Make scripts executable
chmod +x skills/writing-style/scripts/analyse-style.sh
chmod +x skills/writing-style/scripts/review-text.sh

# 3. Copy the profile template
cp skills/writing-style/assets/style-profile-template.md \
   skills/writing-style/assets/style-profile.md
```

---

## Workflow

### Phase 1 — Collect Style Samples

Gather **10–20 writing samples** that represent your voice. Good sources:
- Blog posts, essays, long-form notes
- Emails you wrote (export as `.txt`)
- Obsidian / Markdown notes
- Past reports or documentation you own

**Guidelines:**
- Prefer pieces you wrote without heavy editing by others
- Mix of genres (casual, technical, narrative) captures your range
- Minimum ~5,000 words total; 20,000+ gives the best fingerprint
- Plain text or Markdown (`.txt`, `.md`); DOCX first convert with `pandoc -t plain`

Place files in your corpus directory, e.g. `~/writing-corpus/`.

---

### Phase 2 — Build the Style Profile

Run the analysis script to extract stylometric signals and produce a digest:

```bash
skills/writing-style/scripts/analyse-style.sh ~/writing-corpus
```

The script outputs:
1. **Corpus stats** — word count, sentence metrics, punctuation habits, function word frequencies
2. **Sample passages** — 10 representative excerpts (~150 words each)

Then ask Claude to generate the style profile using the **Generate Style Profile** prompt below.
Save the result to `skills/writing-style/assets/style-profile.md`.

---

### Phase 3 — Review Text Against Profile

To review a draft:

```bash
skills/writing-style/scripts/review-text.sh path/to/draft.md
```

The script outputs the draft alongside your style profile, ready for Claude.
Then apply the **Review Text** prompt below.

Claude will return:
- **Errors** — grammar, logic, clarity issues (clear corrections)
- **Style flags** — passages that drift from your voice (with profile-grounded explanation)
- **Suggestions** — rewrites that preserve your rhythm and vocabulary

---

## LLM Prompt Templates

### Generate Style Profile

Use after running `analyse-style.sh`. Paste its output into the `[SCRIPT OUTPUT]` block:

```
You are a writing analyst. Analyse the corpus statistics and sample passages below
and produce a structured style profile for this writer.

The profile must cover:
1. **Sentence rhythm** — typical length, variation, preferred structures
2. **Vocabulary register** — formality level, domain vocabulary, favourite words/phrases
3. **Punctuation habits** — em-dash, semicolon, colon, ellipsis usage patterns
4. **Voice markers** — first-person usage, hedging language, rhetorical moves
5. **Paragraph shape** — typical length, opening/closing sentence patterns
6. **Tone** — humour, directness, warmth, scepticism, etc.
7. **Characteristic constructions** — recurring sentence openers, transitions, clause patterns
8. **What to preserve** — list 5–8 signature traits that must NOT be edited away

Format the output as structured Markdown, suitable for saving as a reference profile.
Be specific and grounded in the data — quote actual phrases and patterns you observe.

[SCRIPT OUTPUT]
{paste analyse-style.sh output here}
```

---

### Review Text Against Profile

Use after running `review-text.sh`. Paste its output into `[REVIEW INPUT]`:

```
You are a personal writing assistant. Your job is to help the writer improve this
passage while keeping it sounding like THEM — not like a generic "good writer".

The writer's style profile is embedded below. When suggesting changes:
- Ground every style suggestion in a specific profile trait
- Never normalise away the writer's idiosyncrasies listed under "What to preserve"
- Separate ERROR corrections (grammar, logic) from STYLE suggestions (optional)
- For each style suggestion, show the original and a profile-consistent alternative
- Flag any passage that drifts significantly from their established voice

Output format:
## Errors (fix these)
## Style flags (optional improvements, grounded in profile)
## Overall impression

[REVIEW INPUT]
{paste review-text.sh output here}
```

---

### Quick Style Check (No Script Needed)

For a quick check without the corpus pipeline, paste 3–5 samples of your writing
followed by a new draft and use this prompt:

```
Here are samples of my writing voice:

[SAMPLES]
{paste 3–5 excerpts of your writing}

[NEW DRAFT]
{paste the text to review}

Review the draft for: (1) errors, (2) passages that don't sound like me based on
the samples above. Keep suggestions voice-preserving — if it's a stylistic choice
I make in the samples, don't touch it. Distinguish errors from style notes.
```

---

## Updating the Profile

Re-run the analysis when your corpus grows significantly (e.g., after adding 5+
new samples). The script appends a timestamp to each run — compare profiles over
time to see how your voice evolves.

```bash
# Add new samples to corpus dir, then:
skills/writing-style/scripts/analyse-style.sh ~/writing-corpus
# Re-run Generate Style Profile prompt → overwrite style-profile.md
```

---

## File Reference

| File | Purpose |
|------|---------|
| `assets/style-profile.md` | Your generated style profile (update as corpus grows) |
| `assets/style-profile-template.md` | Blank template for a new profile |
| `scripts/analyse-style.sh` | Corpus ingestion + stylometric extraction |
| `scripts/review-text.sh` | Prepare text + profile for review |
| `references/background.md` | Research background and architecture notes |

---

## Examples

**Input:** "Does this blog post sound like me?"
→ Run `review-text.sh post.md`, apply Review Text prompt.

**Input:** "Help me build my writing style profile from my Obsidian notes."
→ Copy vault notes to corpus dir, run `analyse-style.sh`, apply Generate Style Profile prompt.

**Input:** "Review this email — keep my usual directness."
→ Quick Style Check prompt with 2–3 past emails as samples + new draft.

**Input:** "This suggestion makes my writing sound too formal."
→ Check `style-profile.md` → "What to preserve" section. Remind Claude to stay within that register.
