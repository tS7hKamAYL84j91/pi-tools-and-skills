---
name: spr-document-compression
description: Compress a document into a Sparse Priming Representation (SPR) — a dense, lossy-but-recoverable priming block an LLM can later expand. Use when asked to summarize/compress/prime a document, chat log, or knowledge block for token-efficient in-context recall, or to decompress/expand an SPR back into prose.
---

# SPR Document Compression

Sparse Priming Representations (SPR) distill a document into a minimal set of
succinct statements, assertions, associations, analogies, and metaphors that
prime an LLM's latent space to reconstruct the original concept. The audience
is another language model, not a human, so optimize for associative recall, not
readability.

Reference: <https://github.com/daveshap/SparsePrimingRepresentations>

## When to use

- Compress: long documents, chat logs, meeting notes, design docs, or knowledge
  blocks into a token-efficient priming representation for storage/retrieval.
- Decompress: rebuild a document from a stored SPR when the full text is needed.

Do not use SPR for: faithful verbatim quotes, exact numbers/contracts, or anything
where lossy reconstruction is unsafe. SPR is lossy by design.

## Workflow

1. **Compress** — render the input as a distilled list of complete, succinct
   sentences capturing concepts, assertions, associations, analogies, and
   metaphors. Capture as much conceptually as possible with as few words as
   possible. The future audience is an LLM.
2. **Store** — keep the SPR (optionally with a one-line title and source ref)
   wherever compact context is needed: KG node metadata, memory entries,
  prompt prefaces.
3. **Decompress** — feed the SPR to an LLM with the decompressor prompt; it
   unpacks and infers the missing detail back into prose.

See [SPR generator and decompressor prompts](references/spr-prompts.md) for the
canonical mission/theory/methodology blocks to use for each direction.

## Output shape

Compressed SPR:

```text
# <title>

<one-line source ref, optional>

- <succinct statement>
- <assertion / association / analogy / metaphor>
- ...
```

Decompressed output: a prose reconstruction in the original document's form,
with inferred detail explicitly reasoned through.

## Examples

**Input (compress):** a 400-word incident postmortem.
**Output:** ~10–20 bullet statements capturing root cause, contributing factors,
blast radius, fix, and follow-ups — no narration.

**Input (decompress):** the SPR bullets above.
**Output:** a reconstructed postmortem paragraph that recovers the same conclusions.

## Guardrails

- SPR is lossy; never use it where exact recall is required (contracts, figures,
  secrets, code).
- Do not inject secrets, credentials, or private data into an SPR.
- Prefer complete sentences; avoid dangling keywords that lose associations.
- Keep the generator/decompressor prompts intact (they encode the methodology).