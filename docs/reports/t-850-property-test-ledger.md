# T-850 bounded property-test ledger

Status: active

Fixed default fast-check configuration: seed `8412026`, 100 cases per property (`tests/lib/fast-check.ts`). No network, wall-clock, or schedule execution.

| Contract / invariant | Cases | Test path | Baseline | Confirmed defect | Regression | Disposition |
|---|---:|---|---|---|---|---|
| Declarative discovery explicit roots preserve order and duplicates | 100 | `tests/lib/declarative-discovery.test.ts` | PASS | None | N/A | Existing property retained |
| TUI overflow cues are empty below threshold and deterministic at/above threshold | 100 | `tests/lib/tui-overflow.property.test.ts` | PASS | None | N/A | Added focused property |
| Goal state valid JSON round-trips without changing canonical fields | 100 | `tests/goal/pi-goal-property.test.ts` | PASS | None | N/A | Added focused property |
| Kanban column projection preserves ordered matching tasks; done view is bounded/reversed | 100 | `tests/kanban/pi-kanban-property.test.ts` | PASS | None | N/A | Added focused property |
| Boost descriptor fingerprint is deterministic and changes when descriptor identity changes | 100 | `tests/boost/pi-boost-descriptor.property.test.ts` | PASS | None | N/A | Added focused property |
| Boost command parser preserves bounded options/prompts and combined-input contract | 100 | `tests/boost/pi-boost-property.test.ts` | PASS | None | N/A | Existing properties retained |
| CoAS safe path/id contracts reject generated traversal/unsafe identifiers | 100 | `tests/coas/pi-coas-paths.property.test.ts` | PASS | None | N/A | Existing properties retained |
| Team model-binding helper prefers explicit models and otherwise uses fallback | 100 | `tests/teams/pi-teams-property.test.ts` | PASS | None | N/A | Added focused property |
| Panopticon identity inference is deterministic for serializable input events | 100 | `tests/panopticon/pi-panopticon-property.test.ts` | PASS | None | N/A | Added focused property |

Baseline means the existing focused suite before T-850 additions. Defects are recorded only if a property fails against current production behavior; otherwise disposition is PASS/no production change.
