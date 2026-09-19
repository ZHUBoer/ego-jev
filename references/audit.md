# Local call and execution review

Every call through `scripts/jev.mjs` now writes a local JSONL journal automatically, including direct JS imports, CLI calls, batch calls and workflow calls. No extra prompt from the user is needed. `models()` requests are identified separately and do not count as inference.

Default directory: `~/.local/state/ego-jev/logs/`. Files are `<UTC-date>-<run-id>.jsonl`, directories mode 0700 and files 0600. Override with `EGO_JEV_LOG_DIR` or client option `logDir`. Logs remain local and are not bundled with the skill or uploaded by this implementation. They remain until the user removes them; no automatic deletion is performed.

## Associate a task across browser invocations

Set a stable **opaque** `EGO_JEV_RUN_ID`, such as `ego-space-64`, in every invocation for the same browser TaskSpace. Or pass the same `runId` to `evaluate`, `evaluateMany`, `createClient` and `runWorkflow`. Do this internally; do not ask the user to manage identifiers. Without it, each Node process gets a random id and its calls are still logged, but separate invocations are not grouped. Files rotate by UTC date; a task spanning midnight can have two files.

Each call returns `result.audit = {runId, callId, path, transport}`; failures after the journal starts attach it as `error.audit`. Batch errors retain this metadata. `runWorkflow` also returns the journal path and workflow id. Retain these paths for review rather than reconstructing records from prose.

## What is recorded

- Start and end timestamps, unique call id, operation, requested and returned model, question count/types, request fingerprint.
- Every network attempt, HTTP status, sanitized provider request id when supplied, network errors, final failure phase, elapsed API time, token usage when available.
- Compact typed answer summaries: Noul probability, Score value, or Choice option index and confidence. Question and Choice indexes are zero-based in the submitted order. Raw labels, question ids and page contents are omitted.
- For `runWorkflow`: decision selected/delegated/stale/rejected, action intent before execution, action result, and separately the workflow's verification outcome. `callId` connects the chosen action to the API call. Action identities/parameters and completion evidence are represented by hashes, not raw values.

API keys, authorization headers, full page state, goals, instructions, text being entered, raw error/response bodies and screenshots are not logged. Use opaque run identifiers. Hashes allow local equality checks but do not reconstruct the omitted evidence. To review task content, consult the original task's permitted output/artifacts.

## Interpret evidence correctly

- `call.succeeded` with `transport:network` means the default HTTP path returned a schema-valid result. HTTP 200 alone does not count as successful inference.
- `transport:injected` means a custom/test fetch implementation was supplied. Tests cannot inflate the live-call count. A custom workflow evaluator is marked separately in `workflow.started`.
- A successful call does not prove adoption. The built-in workflow automatically links actions to call ids; arbitrary browser code outside it is not automatically intercepted. Missing action records mean **adoption unknown**, not that the result was unused.
- `action.outcome:executed` means the action callback returned. Only a separate `workflow.finished:completed` means its task-specific verifier passed. `uncertain` or missing end events require inspecting the result before retrying.
- The journal is a local execution record, not an immutable or provider-signed attestation. If available, the provider request id can help correlate an upstream record. Absence of a local record does not prove no external/manual API call occurred.
- Logging failures are explicit errors. A failure before a request/action prevents it from starting; a failure afterward cannot undo it. Never replay a mutation just to repair its log. Preserve `error.workflow.attempts` and reconcile the actual result first.

## Review commands

Use absolute paths when running in `ego-browser nodejs` or from another directory:

```sh
node /absolute/ego-jev/scripts/audit.mjs list
node /absolute/ego-jev/scripts/audit.mjs show /absolute/run.jsonl
node /absolute/ego-jev/scripts/audit.mjs report /absolute/run.jsonl /absolute/review.html
```

The report is a standalone HTML file, contains summary counts plus an expandable event list, and makes no external requests. Export a report into the current task's output directory when the user wants to review actual calls. Do not copy the entire historical log directory.

At task completion, give a compact Jev usage line based on this run's records: successful network calls, number of questions and returned version; mention a material fallback or missing execution linkage. Distinguish an actual zero-call task from a log that was not captured. Never backfill historical tasks as real network events from remembered claims.
