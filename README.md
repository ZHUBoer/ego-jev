# ego-jev

Browser automation skill for AI agents: **Ego Lite** for observation and action, **Jev** (TypeSafe) for typed semantic judgments.

An agent keeps the goal and the plan. Ego Lite drives a real Chromium browser — snapshots, DOM actions, keyboard/mouse, tabs, uploads/downloads, screenshots. Jev answers bounded semantic questions over a compact page state: selection, classification, per-item relevance, evidence checks. Exact work — prices, counts, sorting, matching — stays in local code.

## Why split it this way

| Work | Owner |
| --- | --- |
| Understand the goal, explore unfamiliar flows, write text/code | Agent |
| Observe and operate the browser, enforce waits, map candidates to actions | Ego Lite + local code |
| Finite semantic selection, classification, per-item relevance/quality, evidence checks | Jev |
| Prices, arithmetic, counts, sorting, date comparison, exact matching | Local code |
| Screenshots, canvas, images, visual quality | Agent vision + Ego Lite |

The speedup comes from fewer planner turns and batched judgments — not from routing every click through an API call. A known click needs no inference.

## Layout

```
SKILL.md                        Agent-facing contract and workflow
references/
  client.md                     Jev HTTP helper: credentials, schemas, batching, errors
  decision-design.md            How to write atomic questions and read typed answers
  workflows.md                  Bounded continuous subflow runner
  browser-integration.md        Ego Lite integration examples
  audit.md                      Local call journal: fields, limits, HTML export
  sources.md                    Source notes
scripts/
  jev.mjs                       Dependency-free TypeSafe client (evaluate / evaluateMany)
  workflow.mjs                  runWorkflow: observe → decide → execute → verify loop
  audit.mjs                     Append-only local JSONL journal + list/show/report
  *.test.mjs                    Test suites
examples/
  triage.json                   Example request: Choice + Score + Noul in one call
```

## Requirements

- Node.js 20+ (tested on Node 24)
- A working [Ego Lite](https://github.com/ZHUBoer) / `ego-browser` installation
- A TypeSafe API key

No npm packages are required — the helper calls the documented HTTP API directly, so it imports cleanly inside the `ego-browser` Node runtime.

## Install

```sh
git clone git@github.com:ZHUBoer/ego-jev.git ~/.agents/skills/ego-jev
```

The skill is loaded from a skills directory such as `~/.agents/skills/` or `~/.codex/skills/`.

## Credentials

The helper reads `TYPESAFE_API_KEY`, then `TYPESAFE_API_KEY_FILE`, then `~/.config/ego-jev/api-key`:

```sh
mkdir -p ~/.config/ego-jev
printf '%s' 'YOUR_KEY' > ~/.config/ego-jev/api-key
chmod 600 ~/.config/ego-jev/api-key
```

Keep the key outside the skill directory. Run Jev from Node — never inside `page.evaluate()` or `page.fetch()`, so credentials never enter page code.

## Asking several questions about one page state

One request, many independent typed questions. Question **ids are not visible** to Jev, so put the full judgment in `instructions`.

```js
const {evaluate} = await import('/absolute/path/ego-jev/scripts/jev.mjs');

const result = await evaluate({
  state: {ticket: 'I was charged twice. Please refund the duplicate.'},
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which team should handle `ticket`?',
      criteria: {
        billing: 'Payments and refunds',
        technical: 'Software faults',
        unknown: 'No relevant team',
      },
    },
    urgency: {
      type: 'score',
      instructions: 'How explicitly urgent is `ticket`?',
      criteria: ['No urgency stated', 'Urgency indirectly implied', 'Urgency explicitly stated'],
    },
    refund: {type: 'noul', instructions: 'Does `ticket` explicitly request a refund?'},
  },
});
console.log(result.answers, result.model, result.metrics);
```

Returns `audit`, `model`, keyed `answers`, `usage` and `metrics: {apiMs, attempts, questionCount, requestId?}`.

Answer types behave differently, and mixing them up is the usual source of bugs:

- **Choice** — `.choice`, `.probabilities`, `.confidence`. Relative across the options you supplied; a winner does not prove any option is *relevant*.
- **Noul** — `.noul` is P(yes), not intensity. There is no `.confidence`.
- **Score** — `.score` is a probability-weighted index in `0..N-1`, with `.legend` preserving levels. Not an extracted number.

Optional local policy helper: `routeAnswer(answer, {minConfidence, yesAt, noAt})` returns `{route:'accept', value}` or `{route:'review'}`. Its defaults are illustrative, not guarantees.

## Independent states in parallel

```js
const {evaluateMany} = await import('/absolute/path/ego-jev/scripts/jev.mjs');
const results = await evaluateMany([
  {id: 'a', state: 'Please refund my order.', questions: {refund: {type: 'noul', instructions: 'Is a refund explicitly requested?'}}},
  {id: 'b', state: 'Where is my package?',   questions: {refund: {type: 'noul', instructions: 'Is a refund explicitly requested?'}}},
], {concurrency: 4});
```

Returns input-ordered `{id, ok, result}` or `{id, ok:false, error, audit?}` records. Apply only successful results and surface failed ids — never treat a failure as a negative answer.

## Bounded subflows

`runWorkflow` runs a short semantic subgoal inside one browser invocation: it observes, decides, executes with fully bound parameters, and requires a task-specific verifier to pass. Stale decisions are discarded, repeated state/action cycles are detected.

```js
const {runWorkflow} = await import('/absolute/path/ego-jev/scripts/workflow.mjs');
const result = await runWorkflow({
  goal: 'Save the quiet keyboard as my office pick',
  observe: async () => ({fingerprint, state, actions}),
  verify:  async o => ({done: /* real verified outcome */ false, evidence}),
  isCurrent: async o => /* evidence still current after inference */ true,
  execute: async (action, {remainingMs}) => { /* documented Ego methods */ },
});
```

Terminal results: `completed`, `needs_context`, `needs_review`, `stuck`, `budget_exhausted`. Only `completed` means the verifier passed — an action receipt or a Jev answer is never proof of success. Preserve returned `attempts` and pass them as `previousAttempts` when continuing the same subgoal.

## CLI

```sh
node scripts/jev.mjs doctor                       # credential presence (not validity)
node scripts/jev.mjs models                       # available Jev versions
node scripts/jev.mjs evaluate examples/triage.json
node scripts/jev.mjs batch batch.json             # {"items":[...], "concurrency":4}
```

## Local call journal

Every call appends a local JSONL record under `~/.local/state/ego-jev/logs/` (directory `0700`, files `0600`), grouped by an opaque `EGO_JEV_RUN_ID`:

```sh
node scripts/audit.mjs list
node scripts/audit.mjs show   /absolute/run.jsonl
node scripts/audit.mjs report /absolute/run.jsonl /absolute/review.html
```

The journal stores metadata only — no API keys, no authorization headers, no page contents, no entered text. It stays local and is never uploaded. Treat it as a local execution record, not a provider-signed attestation.

## Tests

```sh
node --test scripts/*.test.mjs
```

Test clients inject a fetch implementation and are labeled `transport: injected`, so tests never inflate the live-call count.

## License

MIT — see [LICENSE](LICENSE).
