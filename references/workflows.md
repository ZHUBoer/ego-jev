# Continuous browser subflows

Use `scripts/workflow.mjs` for a short semantic subgoal whose page structure and action types are understood. Run the whole bounded loop in one `ego-browser nodejs` invocation. Keep the user's overall goal and TaskSpace; split internal stages by one observable outcome each. The user should not have to describe these stages.

For an exact URL, known click, or already planned form sequence, use Ego directly. For repeated independent row judgments, use the shared-state `evaluate()` pattern. For unfamiliar layouts, vision, generation, new popups, or recovery, return to the agent and use the original Ego capabilities. Do not reduce browser functionality to this helper's menu.

## Runner contract

`runWorkflow({goal, observe, verify, isCurrent, execute, ...options})`:

- `observe({remainingMs})` returns JSON `{fingerprint, state, actions}`. Capture relevant page evidence and available actions together. The fingerprint must reflect page identity, control identities, relevant values, progress and completion/error state; exclude unrelated animations, clocks and random data. Include scroll progress when repeated scrolling is useful. URL alone is insufficient.
- Each action is `{id, description, params}` with a stable id, meaningful semantic description and **fully bound JSON parameters**. Include the operation, exact text/value and target identity in params. The runner makes an immutable copy. The local executor uses this action's parameters; it must not recompute a different value after the decision. Only offer actions within the user's authorized goal. Avoid menus containing unnecessary destructive or unrelated actions.
- `verify(observation)` returns `{done:false}` or `{done:true,evidence:'observed result'}`. Check actual task-specific output, identity and required fields with code where possible. A click receipt, absence of an error, Jev score, or `delegate` cannot establish success. If the outcome needs visual or semantic inspection that this verifier cannot establish, return to the agent instead of inventing a boolean.
- `isCurrent(observation, action, {remainingMs})` checks browser ownership and relevant evidence **after** inference. Return `false` for changed evidence; the runner discards the decision and observes again. Throw on lost control, inactive space or errors; never turn those into `false` and retry them.
- `execute(action, {remainingMs})` uses documented Ego methods and awaits the expected result. Bound waits using `remainingMs`. Do not blindly retry an action after timeout or replace a failed operation with a different one.

Options: `maxActions:8`, `maxDecisions:12`, `maxRounds:16`, `timeoutMs:45000`, optional Jev `model`, optional `acceptChoice(answer, action, observation)` and `previousAttempts`; `runId` / `logDir` configure [automatic local records](audit.md). The loop issues one Choice request per semantic decision with a `delegate` option and no model-owned `done` action. API retries are disabled inside this loop; failures return control to the agent. A deadline prevents scheduling new work but does not forcibly cancel an in-flight browser callback.

Results: `completed`, `needs_context`, `needs_review`, `stuck`, or `budget_exhausted`; includes reason/evidence, trace, metrics and opaque `attempts`. Only `completed` means the supplied verifier passed. Callback errors propagate with `error.workflow`; action failures are marked `action_uncertain`. Execution is recorded before observing the next page so a failed observation cannot erase a mutation.

Preserve returned `attempts`, including `error.workflow.attempts`, when continuing the **same subgoal** in another invocation. Pass them as `previousAttempts`. Inspect the live result before deciding how to proceed after any mutation error; do not immediately restart the loop. Attempt hashes prevent replay of the same relevant state/action/params, including cycles. They do not provide cross-process transactions or website idempotency. Do not reuse a receipt from an earlier task as proof of a new requested mutation.

## Integration example

First inspect the real page with a snapshot and ground its selectors/structure. The selectors below describe an example application, not a generic website driver. `read()` extracts all evidence for the decision in one browser evaluation; local code may first remove exact nonmatches and out-of-budget rows. Keep label, identity, price, variant and action together.

```js
const {runWorkflow} = await import('/absolute/ego-jev/scripts/workflow.mjs');
const task = await taskSpace(EXISTING_NUMERIC_SPACE_ID);
const page = task.page('p1');
const read = () => page.evaluate(() => ({
  url:location.href,
  stage:document.querySelector('main').dataset.stage,
  text:document.querySelector('main').innerText,
  receipt:document.querySelector('#receipt')?.textContent || '',
  controls:[...document.querySelectorAll('button[data-action]')]
    .filter(n=>!n.disabled && n.getClientRects().length)
    .map(n=>({id:n.dataset.action, text:n.textContent.trim()})),
}));
const result = await runWorkflow({
  goal:'Save the wireless quiet keyboard as my office pick',
  observe:async()=>{
    const state=await read();
    return {fingerprint:JSON.stringify(state), state, actions:state.controls.map(c=>({
      id:c.id, description:c.text,
      params:{operation:'click', selector:`button[data-action=${JSON.stringify(c.id)}]`, previousStage:state.stage},
    }))};
  },
  // Use task-specific receipt/identity checks, grounded in the actual application.
  verify:async o=>({done:o.state.stage==='saved' &&
    o.state.receipt==='Office pick saved: Quiet Wireless Keyboard', evidence:o.state.receipt}),
  isCurrent:async o=>JSON.stringify(await read())===o.fingerprint,
  execute:async(a,{remainingMs})=>{
    await page.click(a.params.selector);
    // Here every offered click changes stage. Use the real site's expected outcome.
    await page.waitForFunction(stage=>document.querySelector('main').dataset.stage!==stage,
      a.params.previousStage,{timeout:Math.min(5000,remainingMs)});
  },
});
console.log(result);
console.log(await page.snapshot()); // Last output supplies the next round's ground truth.
// Agent inspects result. Finish TaskSpace only when the overall user's goal is complete.
```

Every read/action above uses the existing Ego runtime's ownership checks. Add task-specific state freshness and target uniqueness to the adapter. A fingerprint cannot make a browser read and later click transactional; verify the outcome and use the site's own idempotency mechanisms when available.

## Context and acceptance policy

- Small page/menu: direct Choice. Do not add Score or a semantic completion call after every action when deterministic evidence suffices.
- Large page/menu: remove irrelevant controls with exact local rules; group only controls with the same effect and bound values. If still too large, preserve whole cards/forms/conversations, batch independent region scores once, then choose among the relevant candidates. Keep errors and completion evidence even if a region scores poorly. The helper returns `needs_context` above 254 actions plus `delegate`; it never silently truncates.
- Confidence is not an action-success probability. Several valid alternatives can split the distribution. The runner has no universal confidence cutoff: use only appropriate candidates, freshness and outcome verification; supply a calibrated `acceptChoice` policy where the task requires it. The earlier `routeAnswer` defaults are optional examples, not a global requirement.
- Cache only when goal, question, candidate parameters, region and relevant surrounding evidence match. Invalidate for new errors, user edits, stage changes or completion. The runner deliberately does not cache semantic decisions across changing pages.
- Log API time, question/candidate count, returned model, usage and actual outcome. Compare total browser-task time, including capture, waits and recovery, before claiming an improvement. One local fixture is integration evidence, not a community benchmark reproduction.

The runner now persists call-linked selection and execution events automatically, not only its returned `trace`. Share an opaque run id across invocations. Completion summaries should use the persisted call counts, and distinguish execution from the verifier passing.
