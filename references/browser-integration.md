# Browser integration patterns

First read the installed ego-browser skill. These patterns extend that API, not a Playwright substitute. All imports below use resolved absolute paths. Keep Jev credentials in the surrounding Node process, never page JavaScript.

## Shared state, many product questions

After inspecting the actual page and grounding its extraction selectors:

```js
const {evaluate, routeAnswer} = await import('/absolute/ego-jev/scripts/jev.mjs');
const task = await taskSpace(EXISTING_NUMERIC_SPACE_ID);
const page = task.page('p1');
const originalUrl = await page.url();
// EXAMPLE selectors only: derive the site's real selectors from observed DOM.
const extract = () => page.evaluate(() => [...document.querySelectorAll('article[data-id]')]
  .map(n => ({id:n.dataset.id, text:n.innerText, price:Number(n.dataset.price)})));
const records = await extract();
if (!records.length || new Set(records.map(r=>r.id)).size !== records.length)
  throw new Error('Missing or duplicate product identities; inspect extraction.');
const questions = Object.fromEntries(records.map((r,i) => [
  `fit_${i}`,
  {type:'noul', instructions:`Does the product described in \`products[${i}].text\` explicitly offer quiet keyboard typing suitable for a shared office?`}
]));
const result = await evaluate({state:{products:records.map(({id,text})=>({id,text}))}, questions});
const selected = records.filter((r,i) => {
  const fit = routeAnswer(result.answers[`fit_${i}`], {yesAt:0.9,noAt:0.1});
  // Exact arithmetic belongs in code; thresholds are local illustrative policy.
  return Number.isFinite(r.price) && r.price < 100 && fit.route==='accept' && fit.value;
});
// Any subsequent browser call observes/enforces task-space ownership.
console.log(await page.snapshot());
if (await page.url() !== originalUrl || JSON.stringify(await extract()) !== JSON.stringify(records))
  throw new Error('Source evidence changed; re-observe and re-evaluate.');
console.log({model:result.model, selected, metrics:result.metrics});
// Continue only with user-authorized actions mapped to grounded local candidates.
```

The fingerprint covers evidence relevant to these product decisions. Real workflows may require additional identity/version checks, especially virtualized rows and forms. Matching URL alone is insufficient. Do not silently reuse a response after data changes. Captured refs can expire; favor verified stable locators or fresh snapshots.

## Bounded action choice

Read the current snapshot first. The main model creates a small local map of meaningful, currently observed actions. If the correct action is already obvious, execute it directly without Jev.

```js
const actions = new Map([
  ['open_orders', {description:'Open the visible Orders navigation link', selector:'loc=role:link[name="Orders"]'}],
  ['open_help', {description:'Open the visible Help navigation link', selector:'loc=role:link[name="Help"]'}],
]);
const result = await evaluate({
  state: {goal:'Find the shipment details for my order', page:observedPageText},
  questions: {
    target:{type:'choice',instructions:'Which offered navigation action serves the goal on this page?',
      criteria:{...Object.fromEntries([...actions].map(([id,a])=>[id,a.description])),none:'No suitable observed action'}},
  }
});
const target = routeAnswer(result.answers.target, {minConfidence:0.8});
if (target.route==='review' || target.value==='none') {
  // Main model reviews the evidence or observes more; no browser click here.
} else {
  const action = actions.get(target.value);
  if (!action) throw new Error('Unknown action id.');
  // Re-observe/revalidate the candidate and current page identity after the API call.
  // Then page.click(action.selector), wait for the expected result, snapshot last.
}
```

The selectors above are illustrative and must exist in the inspected page. Do not fill in selector guesses or execute a model-produced selector. For several related choices, use the [bounded workflow runner](workflows.md) to keep observation, selection, local execution and verification inside one invocation. The runner consumes only supplied action ids and locally bound parameters; it does not execute model-written JavaScript.

## Visual, file and multi-page workflows

Use the original ego-browser methods directly for screenshots, mouse/keyboard, canvas, upload/download events, dialogs and popups. Use Jev internally by default for suitable semantic substeps; the caller does not need to request this routing. Examples:
- Extract an upload's intended category from its filename/metadata using Choice; upload using `setInputFiles` or a pre-armed file chooser.
- Read a downloaded document with the appropriate local tools, then use Jev to classify verified text spans; save the download in the same browser round.
- For a canvas, let the main model inspect the screenshot and operate it. Do not send a screenshot to the text-only Jev endpoint.
- Keep all tabs within the existing TaskSpace, adopt unmanaged tabs, and follow user-control handoff rules even while an inference is pending.

The base skill's methods remain the authority. Once the goal is verified, call and await `task.finish({keep: []})`, or retain only an expressly needed result page.
