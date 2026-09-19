# Sources and maintenance

Reviewed 2026-09-20. Full substantive coverage: all 109 Markdown pages listed by the official [llms.txt index](https://docs.typesafe.ai/llms.txt): 66 SDK pages, 20 concepts/primitives/patterns/demo pages, 18 cookbooks, and 5 API/models/legal/agent-skill/model-limits pages. Repeated documentation-renderer code was excluded from semantic reading. Also reviewed the linked [v1 migration guide](https://docs.typesafe.ai/migrating-to-v1), official [agent skill source](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md), and three linked legal documents. No official ego+Jev implementation was provided by these docs; this browser integration is our composition of the documented APIs.

## Core contracts

- [HTTP API](https://docs.typesafe.ai/api), [models and limits](https://docs.typesafe.ai/models), [state](https://docs.typesafe.ai/concepts/state)
- [Primitives](https://docs.typesafe.ai/primitives), [structured questions](https://docs.typesafe.ai/primitives/advanced), [confidence](https://docs.typesafe.ai/confidence)
- [Known Jev 1.13 failure modes](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
- [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [Python SDK](https://docs.typesafe.ai/sdk/python), [migration](https://docs.typesafe.ai/migrating-to-v1)

## Relevant complete examples

- [Independent parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions): shared state, one request; compare against sequential single calls with concurrency caveat.
- [Function calling](https://docs.typesafe.ai/cookbooks/function_calling): finite handlers/arguments, code-owned execution.
- [Semantic search](https://docs.typesafe.ai/cookbooks/semantic_find): relative Choice plus independent answer-presence judgment.
- [Pre-parsed extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook): deterministic candidate spans, semantic selection, code normalization.
- [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion): shortlist then fetch richer evidence; evaluate relevance of the actual selected candidate, not another candidate.
- [Structure recovery](https://docs.typesafe.ai/cookbooks/autoformat): real data dependencies warrant multiple rounds.
- [Hierarchy](https://docs.typesafe.ai/cookbooks/hierarchical_classification): bounded branching/beam search; its sample uses concurrent independent HTTP calls.
- [Extraction cascade](https://docs.typesafe.ai/cookbooks/sde_cascade): generation → verification → escalation. Validate parse/schema and required fields first; its sample's empty-record path must not be copied as successful verification.
- [RAG passage filtering](https://docs.typesafe.ai/cookbooks/classifying_rag_passages): injection judgments are useful signals, not a security boundary.
- [Noul consistency](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook), [Choice consistency](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook): repeatability experiments are not accuracy guarantees.

## Version and contract notes

At review time the models page documents `jev-latest` and `jev-preview` as aliases for `jev-1.13.0`. The live model list returned aliases; live evaluation returned `jev-1.13.0`. Defaults can move; log actual version. Older cookbooks often use Jev 1.12 and earlier SDK versions.

The advanced/JS docs admit null values in more places than the current HTTP endpoint. Actual probes: null state and null Score entry →422; absent/null instructions, null Noul criteria, one-option Choice, and structured Score entries →200. Quickstart omits Score probabilities in one example; the canonical response and actual live call include them. The helper follows the tested HTTP contract, not every permissive JS declaration.

The helper is intentionally narrower than the official SDK: only documented models/evaluation endpoints, bounded retries, no arbitrary extra request fields or custom service origin. Official `TYPESAFE_BASE_URL` and log settings are not adopted by this helper. It preserves the full browser capability through ego-browser, not full TypeSafe SDK feature parity.

[Legal overview](https://docs.typesafe.ai/legal) documents the data-policy links and enterprise ZDR option. Local browser execution does not imply local model inference or automatic zero retention. Secrets remain outside the skill; only task-relevant state is sent.

For an update, re-read changed canonical pages plus relevant cookbooks and rerun focused contract/integration checks. Do not reread the entire site on every use.

## Community implementations reviewed 2026-09-20

- [Ego's original X post](https://x.com/ego_agent/status/2100970015977804008): a short product-decision timing demonstration. The visible post does not supply executable integration code or enough measurement boundaries to reproduce its claim. It motivates batching, not a general speed guarantee.
- [Browser Use Jev Ultrafast](https://github.com/browser-use/jev-ultrafast), particularly `jev_ultrafast/agent.py`: bounded decisions on observed action candidates, shared-state speculative heads, freshness validation and recording execution before the next observation. Adapted these architectural ideas in `workflow.mjs` with locally bound atomic actions. Did not replace Ego's executor: that MVP has narrower browser coverage. Did not copy its fixed settling delays.
- [Ying-Kai-Liao/jev-browser](https://github.com/Ying-Kai-Liao/jev-browser), especially `NOTES.md`: one observable outcome per stage; improve evidence with counts, checked/value state and progress; bounded loops and explicit unresolved outcomes. Its task-specific `done` thresholds and `likely_done` heuristics are not completion proofs and were not adopted.
- [Retriever AI's original experiment](https://rtrvr.ai/blog/jev-browser-agent-benchmark): locally bound candidate menus, direct Choice for small contexts, independent result inspection, and costly repeated page scoring. Adopted selective context reduction and no universal confidence cutoff. Its four uncontrolled runs do not establish general speed or cost improvements; proposed skill routing is future work, not a demonstrated feature.

Additional X discussions were read directly in the logged-in browser. [A voice-driven browser author](https://x.com/Kavishanx/status/2101369234316271914) describes Jev for action choice alongside separate speech/generation components; [an independent tester](https://x.com/innoiso/status/2101368025731735892) reports misses. These are anecdotal descriptions, not correctness or performance evidence. Only primary implementation details inform the runner; social claims do not set accuracy thresholds.
