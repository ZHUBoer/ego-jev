# API helper

Requires Node.js 20+ (tested on Node 24) and an installed working ego-browser. No npm packages required. The helper deliberately calls the documented HTTP API directly, so it imports inside the ego-browser Node runtime without package-resolution setup. It is not the official SDK.

## Credentials and models

Precedence: `TYPESAFE_API_KEY` → file at `TYPESAFE_API_KEY_FILE` → `~/.config/ego-jev/api-key`.
A file contains only the key and optional final newline. Configure outside the skill directory; never put real keys into examples. `doctor` reports presence, not validity; `models` or an evaluation verifies access.

```bash
node "$SKILL_DIR/scripts/jev.mjs" doctor
node "$SKILL_DIR/scripts/jev.mjs" models
node "$SKILL_DIR/scripts/jev.mjs" evaluate /absolute/request.json
node "$SKILL_DIR/scripts/jev.mjs" batch /absolute/batch.json
```

`model` in a request overrides the client option, then `TYPESAFE_DEFAULT_MODEL`, then `jev-latest`. For repeatable calibrated tasks pin a real version returned by the API. The main model is selected by the user's agent host, independently.

## Single state / many questions

```js
const {evaluate} = await import('/absolute/ego-jev/scripts/jev.mjs');
const result = await evaluate({
  state: {ticket: 'I was charged twice. Please refund the duplicate.'},
  questions: {
    department: {type:'choice', instructions:'Which team should handle `ticket`?',
      criteria:{billing:'Payments and refunds', technical:'Software faults', unknown:'No relevant team'}},
    urgency: {type:'score', instructions:'How explicitly urgent is `ticket`?',
      criteria:['No urgency stated','Urgency indirectly implied','Urgency explicitly stated']},
    refund: {type:'noul', instructions:'Does `ticket` explicitly request a refund?'}
  }
});
console.log(result);
```

Returns `audit: {runId,callId,path,transport}`, `model`, keyed `answers`, `usage`, and local `metrics: {apiMs,attempts,questionCount,requestId?}`. `apiMs` includes fetch/response parsing and retry waits, not credential loading, browser extraction or browser actions. Unavailable token counters are returned as null, never fabricated as zero. No `temperature`, `reasoning_effort`, free-text completion, or OpenAI chat API is involved.

## Independent states

```js
const {evaluateMany} = await import('/absolute/ego-jev/scripts/jev.mjs');
const result = await evaluateMany([
  {id:'ticket-a',state:'Please refund my order.',questions:{refund:{type:'noul',instructions:'Is a refund explicitly requested?'}}},
  {id:'ticket-b',state:'Where is my package?',questions:{refund:{type:'noul',instructions:'Is a refund explicitly requested?'}}}
], {concurrency:4});
```

Returns stable, input-ordered `{id,ok,result}` or `{id,ok:false,error,audit?}` records and total wall time. CLI batch input is `{ "items": [...], "concurrency": 4 }`; partial failure yields exit code 1. Concurrency defaults to 4 and is locally bounded to 1..16. This is several HTTP requests, distinct from many questions in one request. Apply only successful results; surface failed ids and never treat them as negative answers.

## Response interpretation

- Choice: `.choice`, `.probabilities`, `.confidence`. Choice is relative across the supplied options. A winner does not prove any option is relevant.
- Noul: `.noul` is P(yes), not intensity. There is no `.confidence`.
- Score: `.score` is the probability-weighted index in 0..N−1, `.legend` preserves levels, `.probabilities` gives the distribution, `.confidence` summarizes certainty. Avoid rounding unless the application calls for it. Do not use the score as an exact extracted number.
- `routeAnswer(answer,{minConfidence:0.8,yesAt:0.9,noAt:0.1})` returns `{route:'accept',value}` or `{route:'review'}`. Defaults are illustrative local policy, not TypeSafe guarantees. Ranking may need only raw scores; action gates need task-specific validation. An accepted answer does not supply authorization or verify page state.

## Contract and reliability

Fixed service origin: `https://api.typesafe.ai/v1`; redirects rejected. Endpoints: GET `/models`, POST `/systemone`. The helper validates request shapes, answer-id coverage, type correspondence, option membership, probability ranges/sums, score range and legend keys before returning answers. Validation failures throw; do not apply those answers.

Local retry policy: 15-second timeout per attempt, up to two retries; network failures, 408, 429 and 5xx are eligible. Exponential delay with jitter for HTTP errors, honors `retry-after-ms` or `Retry-After` up to 10 seconds; longer values stop and require a later retry. These are this helper's bounds, not the official SDK defaults. A single default evaluation can therefore take over 45 seconds when retries occur. Requests can be billed even when a response times out; no browser actions are retried by this client. Use `timeoutMs` (1..60000) and `retries` (0..3) as client options when warranted.

401/403/422 are not retried. Errors report status without echoing response bodies (validation bodies can contain the input). Missing/invalid credentials or schema errors require correction, not repeated requests. After an uncertain browser mutation, inspect the page before deciding what to do next.

The public docs disagree on null acceptance. Live v1 probes on 2026-09-20 confirmed: null state and null Score levels are rejected (422); omitted/null instructions, null Noul criteria, structured descriptions, and one-option Choice are accepted. The helper follows these observed shapes. Write explicit instructions and useful contrasting options for real tasks even where omission is accepted. Choice has a documented maximum of 255 options; Score uses 2..10 levels. Refresh this evidence after service changes.

## Automatic local records

Every call records its lifecycle, network attempts and typed result summary automatically. Use `runId` and optional `logDir` as client options, or `EGO_JEV_RUN_ID` / `EGO_JEV_LOG_DIR`. Local validation failures have no network attempt; injected test clients are explicitly labeled. Errors after logging starts include `error.audit`. See [reviewing real calls](audit.md) for task grouping, privacy, log failures and HTML export.

## Minimal semantic selection

`choose({goal,evidence,candidates:[{id,description}],model?}, clientOptions?)` calls Jev using the same configured credential and automatic journal. It adds an explicit no-match option and returns `selectedId` (supplied id or null), plus the full normal response and audit metadata. Supply 1..254 unique candidates; `__none__` is reserved. It does not execute an action or apply a universal confidence cutoff. Recheck page state and resolve the selected id through your local map.
