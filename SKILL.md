---
name: ego-jev
description: Use Ego Lite for browser tasks, including opening websites, signing in, filling forms, clicking, screenshots, extraction, uploads/downloads, and web app testing, QA, and debugging. Provides the same user-facing workflow and complete browser capabilities as ego-browser, with Jev enabled internally for semantic judgments. Use when the user asks for ego-jev or browser automation with integrated Jev decisions; users only need to describe the browser task.
---

# ego-jev

Complete browser tasks with the same inputs, interaction, and results as ego-browser. Jev is an internal decision mechanism, enabled by default for suitable semantic judgments. The user describes the browser task; the agent handles observation, decisions, execution, and verification.

## User-facing contract

- Accept the same browser requests as ego-browser: ordinary navigation, signed-in workflows, forms, screenshots, extraction, multi-page work, files, rich editors, and testing. Do not limit this skill to product filtering or batch tasks.
- Preserve the existing browser, login state, TaskSpace behavior, supported actions, user handoff, and completion conventions. Reuse the installed ego-browser skill as the complete execution layer.
- Do not ask the user to choose a model, split work between components, request batching, or explicitly enable Jev. Use the configured credential and integrate Jev automatically where semantic selection, classification, scoring, or verification is needed. Actually call the helper for those judgments; do not label an ordinary agent judgment as a Jev result.
- Keep detailed internal routing out of ordinary progress updates. Report the requested browser outcome and material blockers, plus a concise Jev usage summary derived from the local journal at completion. Explain the internal mechanism when asked, diagnosing it, or reporting a fallback that materially affects the outcome or requested acceleration.
- Keep exact operations and calculations in code; handle vision, generation, complex planning, and uncertain cases with the agent's existing capabilities. Known clicks do not need inference. This preserves the complete workflow while applying Jev where it helps.
- If Jev is unavailable, use the existing browser workflow when it can fulfill the task reliably. Do not introduce another permission step merely for internal fallback. If the user explicitly requires Jev-only execution or a Jev measurement, report that requirement as blocked instead of substituting silently. Service unavailability does not itself mean the browser task is impossible.

## Internal mechanism

The agent maintains the goal and plan, ego-browser observes and acts, and Jev supplies typed judgments. Browser and orchestration run locally; Jev inference uses the configured TypeSafe API. This is an agent workflow integration: the skill calls the helper when needed; it does not patch or intercept every ego-browser API method.

## Start

1. Read the installed **ego-browser SKILL.md** before operating the browser. Resolve it from the available-skills entry; common locations are `~/.agents/skills/ego-browser/SKILL.md` and `~/.codex/skills/ego-browser/SKILL.md`. That skill is a required dependency and supplies the complete browser API, installation, and recovery workflow. Do not invent a reduced browser API or launch another browser.
2. Use `ego-browser nodejs` and one TaskSpace for the user's whole goal. Reuse its numeric id and Page labels across rounds. All ego-browser capabilities remain available: snapshots, navigation, DOM actions, keyboard/mouse, screenshots, tabs/popups/dialogs, uploads/downloads, waits, evaluate/fetch/CDP, handoff and completion.
3. Resolve this skill's directory to an absolute path, called `SKILL_DIR` in shell examples. `ego-browser nodejs` starts a fresh process with a different working directory; import helpers and save files using **absolute paths**.
4. Set an opaque `EGO_JEV_RUN_ID` such as `ego-space-<numeric-id>` for every invocation in the same TaskSpace (or pass `runId` to the helpers). Calls are logged automatically; a stable id groups them for review. See [local call records](references/audit.md).
5. Start with the requested browser work. Use the configured Jev helper directly at the first suitable semantic judgment. Run `doctor` only during setup or to diagnose a credential problem; use `models` only when selecting or diagnosing a Jev version. Do not add routine setup commands or configuration questions to ordinary tasks.

## Internal task routing

| Work | Owner |
| --- | --- |
| Understand the goal, explore unfamiliar workflows, reason across steps, write text/code | Agent |
| Observe and operate the browser, enforce waits, map verified candidates to actual actions | ego-browser + local code |
| Finite semantic selection, classification, per-item relevance/quality, evidence checks | Jev by default |
| Prices, arithmetic, counts, sorting, date comparisons, exact matching | Local code |
| Screenshots, canvas, images, visual quality | Agent vision + ego-browser |

Do not call Jev for an obvious known click or exact lookup. Do not turn every browser action into an API round trip. The useful speedup comes from fewer planner turns and batched judgments, while executing known sequences together. Keep one observable outcome per internal stage and retain a valid plan until the stage changes or execution needs repair.

For an understood multi-step semantic subgoal, use the [continuous workflow runner](references/workflows.md) in one browser invocation. It binds actions to current evidence, discards stale choices, detects repeated state/action cycles, and requires an actual outcome check. For known sequences use Ego directly; for independent judgments use a shared-state batch. These are internal choices, not extra steps for the user.

Start with local extraction and a compact action menu. Do not score an entire page before every click. Reduce context only when needed, keep cards/forms and completion evidence together, and group equivalent controls. Many valid candidates can lower confidence; do not apply an arbitrary global confidence cutoff.

## Observe → decide → execute → verify

1. Observe the cheapest sufficient page state, usually a snapshot. For repeated cards/rows, inspect the real structure, then extract only relevant visible text and stable identities using `page.evaluate()`. Do not send the entire DOM or unrelated conversation by default.
2. Keep a local candidate map: stable item/action id → observed text/evidence → actual locator/URL. Jev selects among provided ids; local code owns the executable action. Include `none`/`unknown` when there may be no match, or pair a relative Choice with a separate relevance Noul. Never execute code or selectors supplied by the remote model.
3. Build atomic questions. Put the complete judgment and relevant state path in `instructions`; **question ids are not visible to Jev**. Use criteria to define boundaries. See [decision design](references/decision-design.md).
4. Ask independent questions over the same compact state in one `evaluate()` call. They cannot use each other's answers. State any speculative premise explicitly and consume only the applicable branch. If a decision determines the next evidence/options, use another round. Independent large states can use `evaluateMany()` with bounded concurrency instead of one bloated state.
5. Interpret validated typed answers. Ranking, existence, preference, and action eligibility are different questions. Use the application-appropriate rule; examples of thresholds are not universal correctness guarantees. `routeAnswer()` is an optional policy helper with illustrative defaults. Review uncertain cases with the agent or gather missing evidence; do not reflexively ask the user when the agent can resolve them.
6. Before an action after an API wait, ensure the page is still under agent control and that the source evidence/candidate still matches. If state changed, discard the decision and re-observe. Use fresh snapshots before unfamiliar targets; raw refs are not durable ids.
7. Execute using documented ego-browser methods, wait for the expected result, and observe the resulting UI. A Jev answer or browser action receipt is not proof that the user's task succeeded.

Use [continuous subflows](references/workflows.md) for the bounded runner and recovery contract. Use [browser integration examples](references/browser-integration.md) for imports, freshness checks, batched product decisions, and local action mapping. Use [API helper](references/client.md) for credentials, commands, schemas, batching, and errors.

## Browser lifecycle and complete capability

Follow the loaded ego-browser instructions without shortening their scope:
- Semantic selectors and snapshots for DOM; screenshot + mouse/keyboard for visual pages.
- Register popup/download/file-chooser waits before the trigger; save downloads before the script ends.
- Handle dialogs explicitly; adopt unmanaged pages before operating them.
- Stop on user control, inactive/unassigned spaces, or denied control. Do not create another space or bypass handoff. Resume only under the original ego-browser rules.
- Browser error recovery stays in the same TaskSpace. Do not retry a browser mutation merely because an API or tool timed out.
- On success, call and await `task.finish({keep: []})` exactly once, except keep only necessary result pages when requested/needed. Do not finish while waiting for user control or on an unresolved error.

The installed ego-browser remains the authority for every browser capability. Jev augments semantic decisions without narrowing task scope. Follow the user-facing contract for internal fallback and report any material effect on the result; do not claim Jev was used when it was not.

## Credentials and data

The helper reads `TYPESAFE_API_KEY`, then `TYPESAFE_API_KEY_FILE`, then `~/.config/ego-jev/api-key`. Keep the file outside the distributable skill with permissions 0600. Run Jev from Node, never inside `page.evaluate()` or `page.fetch()`; credentials must not enter page code. Do not echo keys, headers, or credential contents. Submit only the fields needed for the task.

Set the Jev version per request with `model`, or through `TYPESAFE_DEFAULT_MODEL`; otherwise `jev-latest` is used. Keep model selection internal unless the user asks to configure it. Record the returned version for calibrated workloads.

## Verification and reporting

All helper calls automatically append local records under `~/.local/state/ego-jev/logs/`. The workflow runner links decisions and actions to call ids. Read [audit and review](references/audit.md) for fields, limitations and exporting an HTML report. Do not infer actual Jev use from skill loading or prose. Report successful network calls separately from injected tests, failures and incomplete records; action execution separately from verified task completion. Log errors require inspecting the actual outcome before any retry.

Verify decisions on representative data and verify the resulting browser behavior. Report model errors separately from missing evidence, stale page data, client errors, and service failures. For timing, distinguish extraction, API wall time (including retries), browser execution, and full task time; keep the question count, input state and model version. Never label fixture results as Amazon results or promise the timing from a social post.

Read [Jev semantics and limits](references/decision-design.md) when defining questions and [source notes](references/sources.md) when updating this skill. Official docs are live; recheck contracts/models before upgrades. The documentation was reviewed on 2026-09-20; actual HTTP probes resolve known discrepancies in the SDK docs.
