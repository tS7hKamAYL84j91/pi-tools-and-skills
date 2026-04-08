# FEP × Coaching Concept Mapping

Synthesis of the Free Energy Principle (FEP) formal framework and its direct
analogues in coaching practice. The Problem Crystalliser skill uses this mapping
to ground its two-phase epistemic → pragmatic questioning loop in a principled
theoretical foundation.

---

## Core Equation

```
G(π) = epistemic value (−InfoGain) + pragmatic value (−alignment with C)
```

A vague incoming request maximises free energy (high surprise, high uncertainty).
A crystallised problem statement minimises free energy (low surprise, prediction fits observation).

---

## Concept Mapping Table

| FEP Formal Concept | Definition (FEP) | Coaching Analogue | Coaching Implementation |
|--------------------|------------------|-------------------|------------------------|
| **Free energy F** | Upper bound on surprise; divergence between the agent's model and the world | Problem entropy | The degree of fuzziness in the presenting request; how many problem structures could explain the words used |
| **Generative model p(s,o)** | The agent's internal model of how hidden states cause observations | Mental model / problem frame | The coachee's implicit theory of their situation — often wrong, almost always incomplete at session start |
| **Approximate posterior q(s)** | Belief distribution over hidden states inferred to minimise F | Active hypothesis set | The coach's working distribution over possible real problem types (interpersonal, structural, cognitive, skill gap, polarity…) |
| **Epistemic value / InfoGain** | Expected reduction in uncertainty about hidden states; −𝔻KL[q‖p] | Exploration value of a question | How much a question is expected to collapse ambiguity about the true problem; drives Phase 1 question selection |
| **Pragmatic value** | Expected alignment with preferred outcomes C; −𝔻KL[p(o\|π)‖C(o)] | Convergence pull toward the brief | How much a question or action moves the session toward a concrete, owned, action-pointing problem statement |
| **Preferred outcomes C** | Distribution over observations the agent is designed (or trained) to occupy | Crystallised brief | The target state: specific, owned, action-pointing, bounded problem statement that the coachee recognises |
| **Prediction error** | Observed − predicted; mismatch signal that drives model update | Surprise in a coachee's answer | An answer that introduces a new dimension signals high prediction error → increase epistemic weight, keep exploring |
| **Policy π** | Sequence of actions selected to minimise expected G | Question selection strategy | Which question to ask next; early session: InfoGain maximising (epistemic); late session: alignment maximising (pragmatic) |
| **Perceptual inference** | Updating q(s) to reduce F given fixed policy | Active listening + re-framing | Updating the working problem hypothesis as the coachee speaks |
| **Active inference** | Selecting π to minimise expected future F | Steering the session | Choosing questions that will most reduce uncertainty (Phase 1) or most rapidly converge on the preferred state (Phase 2) |
| **Phase transition: epistemic → pragmatic** | Shift when InfoGain gain is low relative to remaining divergence from C | Transition from exploration to convergence | Three signals: saturation of "And what else?", dominance of one problem frame, affect shift from venting to reflection |
| **Precision weighting** | Relative confidence assigned to sensory channels vs priors | Credibility assessment | How much weight to give what the coachee *says* (observation) vs what the coach *infers* from affect and hesitation (prior update) |
| **Model complexity penalty** | Occam factor; preference for simpler generative models | Parsimony in problem framing | Prefer the simplest problem framing that accounts for all observations — do not proliferate causes |
| **Allostasis / expected free energy** | Minimising *future* surprise, not just present | Preventing recurrence | Crystallised brief should address root cause, not just presenting symptom (Phase 2 miracle question) |

---

## Phase Mapping

| Session Phase | FEP Regime | Dominant Term in G(π) | Coach Behaviour |
|---------------|------------|----------------------|-----------------|
| **Phase 1 — Epistemic** | High uncertainty; q(s) is diffuse | Epistemic value (−InfoGain) | Maximise information gain per question: "And what else?", exception-finding, specificity probes |
| **Transition** | q(s) converging; InfoGain plateau | Roughly balanced | Detect saturation, dominance, affect shift; confirm ≥3 epistemic passes run |
| **Phase 2 — Pragmatic** | q(s) peaked; model converged | Pragmatic value (−alignment with C) | Collapse to the preferred state: convergence, miracle question, ownership, crystallisation check |
| **Backtrack** | New answer increases F | Epistemic value spikes again | Return to Phase 1: "That's interesting — let's explore that a little more." |

---

## Stopping Criterion (FEP View)

The session ends when `G(π) ≈ 0`:

- **Epistemic component ≈ 0:** q(s) is tight; no new dimensions emerge from additional questions
- **Pragmatic component ≈ 0:** The crystallised brief aligns with C; the coachee signals felt recognition ("yes, *that's* it")

All five stopping criteria in the SKILL.md correspond to bringing different terms of G to near-zero:

| Stopping criterion | FEP explanation |
|--------------------|-----------------|
| Specific | Reduces remaining state space; tightens q(s) |
| Owned | Ensures the policy (coachee's actions) is actually available |
| Action-pointing | Connects preferred state C to executable actions |
| Bounded | Constrains scope → finite policy horizon → computable G |
| Recognised | Affective signal that prediction error has dropped to near-zero |

---

## Research References

- Friston, K. (2010). The free-energy principle: a unified brain theory? *Nature Reviews Neuroscience*, 11(2), 127–138.
- Friston, K., et al. (2017). Active inference and epistemic value. *Cognitive Neuroscience*, 6(4), 187–224.
- Parr, T., & Friston, K. (2019). Generalised free energy and active inference. *Biological Cybernetics*, 113(5–6), 495–513.
- Coaching analogue first articulated for this skill from FEP literature synthesis, April 2026.
