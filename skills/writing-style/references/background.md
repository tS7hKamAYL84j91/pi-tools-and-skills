# Background: Style Analysis and Voice-Preserving Writing Assistance

Research and design notes underpinning the `writing-style` skill.

---

## 1. The Core Problem

Generic writing assistants (Grammarly, standard LLM prompts) optimise toward a
statistical average of "good prose." They correct idiosyncrasies — sentence
fragments, unconventional punctuation, informal contractions in technical writing —
that may be intentional signatures of the writer's voice.

The goal here is different: build an assistant that can tell the difference between
**error** (unintentional deviation from the writer's standards) and **style**
(intentional deviation from generic norms). That requires first learning what the
writer's standards actually are.

---

## 2. Style Fingerprinting Dimensions

Stylometry (computational style analysis) identifies writing via a basket of
measurable signals. The dimensions most useful for voice-preserving review:

### 2.1 Lexical features
- **Function word frequencies** — articles, prepositions, conjunctions ("the", "in",
  "and") are largely unconscious and highly stable across topics. Top-100 function
  word frequencies are one of the strongest authorship signals.
- **Type-token ratio (TTR)** — vocabulary richness: unique words / total words.
- **Average word length** — Latinate vs. Anglo-Saxon preference.
- **Hapax legomena density** — fraction of words used only once; correlates with
  inventiveness vs. precision.

### 2.2 Syntactic features
- **Mean sentence length (MSL)** and its standard deviation — rhythm signature.
- **Sentence-length distribution** — bimodal (short+long mix) vs. uniform.
- **Clause complexity** — subordination depth, participial phrase frequency.
- **Sentence opener distribution** — noun phrase, adverbial, conjunctive, etc.

### 2.3 Punctuation and orthographic features
- **Punctuation mark frequencies** — em-dash, semicolon, colon, ellipsis per 1,000
  words each carry a distinctive signal.
- **Comma rate** — high comma rate often signals long, clause-heavy sentences.
- **Parenthesis vs. em-dash preference** — choice between these is a strong
  individual marker.

### 2.4 Discourse / rhetorical features
- **Paragraph length distribution**
- **Transition device fingerprint** — "however", "but", "yet", "although", "that
  said", etc. each writer has a preference distribution.
- **Hedging rate** — frequency of epistemic modals ("might", "could", "seems",
  "arguably") vs. assertive constructions.
- **Rhetorical question frequency**

### 2.5 Semantic register
- **Domain vocabulary clusters** — recurring domain terms reveal topical home
  territory and shared-assumption level with the assumed reader.
- **Formality score** — can be approximated by Latinate-root word ratio or by
  explicit formality classifiers.

---

## 3. RAG-for-Style: The Retrieval Approach

Classic RAG (Retrieval-Augmented Generation) fetches relevant *knowledge* at query
time. "RAG-for-style" adapts the pattern to fetch **voice calibration material**:

```
Query (new draft)
      │
      ▼
Retrieve stylistically similar excerpts from the writer's corpus
      │                        (embedding similarity or BM25 on style features)
      ▼
Inject: [style profile] + [retrieved excerpts] + [draft]
      │
      ▼
LLM → voice-grounded review
```

### Why retrieval instead of just the profile?

The style profile is a *summary* — it compresses. Concrete excerpts provide
**in-context examples** that are far more powerful calibration anchors for the LLM
than abstract descriptions. The combination (profile + examples) outperforms either
alone.

### Practical implementation (current approach)

This skill uses a simplified static version: `analyse-style.sh` extracts corpus
stats and a representative sample of 10 excerpts, which together act as the
retrieval payload. For larger corpora (>100k words) a proper vector store (e.g.
ChromaDB) with style-aware chunking would improve excerpt quality.

---

## 4. How LLMs Learn Personal Voice

### 4.1 In-context learning (what this skill uses)

LLMs are few-shot learners. Providing 3–10 representative excerpts of a writer's
voice in the system prompt or context window is sufficient for the model to:

- Identify recurring patterns (sentence length, preferred conjunctions, etc.)
- Distinguish intentional idiosyncrasies from random variation
- Generate suggestions that match the style distribution of the samples

**Limitations:** in-context calibration degrades at the tails — very unusual
constructions that appear only once in the sample may be treated as errors. The
"What to Preserve" section of the style profile compensates by explicitly labelling
the most unusual markers as intentional.

### 4.2 Fine-tuning (out of scope, noted for completeness)

Fine-tuning a small model on a writer's corpus can produce a style-matching
capability baked into the weights. Advantages: lower inference cost, no context
window pressure. Disadvantages: requires significant corpus (>100k words to be
effective), compute cost, and the model can't "explain" its style decisions.
Not recommended for personal use cases.

### 4.3 Structured style profile as a "style grammar"

The style profile functions as a formal specification of the writer's grammar —
where "grammar" includes idiosyncratic rules the standard grammar explicitly
forbids. By declaring rules explicitly (e.g., "em-dash preferred over parentheses"),
the profile shifts the LLM from statistical averaging toward rule-following, which
is a different and more reliable mode of operation for style-consistency tasks.

---

## 5. Error vs. Style: The Core Distinction

The hardest problem in voice-preserving review is deciding whether a deviation is:

| Class | Definition | Example |
|-------|-----------|---------|
| **Error** | Violates the writer's own standards | Comma splice the writer uses only rarely, but here appears to be accidental mid-draft |
| **Style** | Intentional violation of generic convention | Em-dash where a period would be "correct"; sentence fragment for emphasis |
| **Drift** | Departure from the writer's style toward a different style | Writer is normally direct; this passage is suddenly passive-voice-heavy |

**Heuristics for distinguishing:**

1. **Frequency in corpus** — if the pattern appears 20× in past writing, it's style.
   If it appears 0×, it's suspicious.
2. **Local coherence** — does the "error" serve a local rhetorical purpose (emphasis,
   rhythm, irony)? Style tends to be purposeful.
3. **Profile coverage** — patterns listed in "What to Preserve" are always style
   regardless of corpus frequency.
4. **Explicit annotation** — the user can annotate the style profile: "I know I
   overuse semicolons; flag them."

---

## 6. Evolving Voice

Voice is not static. A 2024 corpus and a 2019 corpus of the same writer may show
measurable drift — increased sentence complexity, vocabulary expansion, changed
hedging patterns. Implications for this skill:

- **Date your corpus samples.** Recent writing should be weighted more heavily than
  old writing when building a current profile.
- **Version your profiles.** `style-profile-YYYY-MM.md` lets you compare voice
  evolution over time.
- **Re-run quarterly** if you write regularly. Six months of new writing can shift
  the baseline enough to matter.

---

## 7. Key References

- Mosteller & Wallace (1964) — foundational authorship attribution via function word
  frequencies (Federalist Papers study).
- Burrows (1987) — "Delta" method for stylometry; showed top-30 function words
  capture authorship at >90% accuracy.
- Koppel et al. (2009) — "Computational methods in authorship attribution." *JASIST*.
  Survey of stylometric techniques.
- Argamon & Juola (2011) — overview of writing style analysis for computational
  linguistics.
- Ippolito et al. (2020) — "Toward Document-Level Paraphrase Generation with Sentence
  Fusion." Demonstrates how LLMs can be steered toward style-consistent generation.
- Min et al. (2022) — "Rethinking the Role of Demonstrations" — shows in-context
  examples provide distributional calibration more than factual content, which
  directly supports the "corpus excerpts as calibration" approach.

---

*This file is background reference for the skill designer and advanced users.
For usage instructions, see [SKILL.md](../SKILL.md).*
