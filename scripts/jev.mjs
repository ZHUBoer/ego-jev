#!/usr/bin/env node
/** Small dependency-free TypeSafe client; browser actions stay in ego-browser. */
import { readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {createAudit, digest, safeModel} from './audit.mjs';

const ENDPOINT = 'https://api.typesafe.ai/v1';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const unit = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
const description = x => typeof x === 'string' || object(x) || Array.isArray(x);
const fail = message => { throw new Error(message); };
const sameKeys = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k));
const credentialPath = () => process.env.TYPESAFE_API_KEY_FILE || join(homedir(), '.config', 'ego-jev', 'api-key');

function assertJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (!Array.isArray(value) && (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) fail('Use JSON values only.');
  if (seen.has(value)) fail('JSON values cannot contain cycles.');
  seen.add(value);
  for (const v of Array.isArray(value) ? value : Object.values(value)) assertJson(v, seen);
  seen.delete(value);
}

export function validateRequest(input) {
  if (!object(input)) fail('Request must be a JSON object.');
  if (!description(input.state)) fail('state must be a string, object, or array.');
  if (!object(input.questions) || !Object.keys(input.questions).length) fail('questions must be a nonempty object.');
  if (input.model !== undefined && (typeof input.model !== 'string' || !input.model.trim())) fail('model must be a nonempty string.');
  for (const [id, q] of Object.entries(input.questions)) {
    if (!id || !object(q) || (q.instructions !== undefined && q.instructions !== null && !description(q.instructions))) fail('Each question needs an id and a valid optional instructions field.');
    if (q.type === 'choice') {
      if (!object(q.criteria) || Object.keys(q.criteria).length < 1 || Object.keys(q.criteria).length > 255 || !Object.values(q.criteria).every(x => x === null || description(x))) fail('Choice needs 1..255 criteria; normally include a no-match option.');
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10 || !q.criteria.every(description)) fail('Score needs 2..10 ordered non-null descriptions.');
    } else if (q.type === 'noul') {
      if (q.criteria !== undefined && q.criteria !== null && (!object(q.criteria) || Object.keys(q.criteria).some(k => !['true', 'false'].includes(k)) || !Object.values(q.criteria).every(x => x === null || description(x)))) fail('Noul criteria must contain only true/false descriptions.');
    } else fail('Supported question types: choice, score, noul.');
  }
  assertJson(input.state);
  for (const q of Object.values(input.questions)) {
    if (q.instructions !== undefined) assertJson(q.instructions);
    if (q.criteria !== undefined) assertJson(q.criteria);
  }
  return input;
}

export function validateResponse(body, questions) {
  if (!object(body) || typeof body.model !== 'string' || !object(body.answers) || !sameKeys(body.answers, questions)) fail('Invalid Jev response: model or answer ids.');
  for (const [id, q] of Object.entries(questions)) {
    const a = body.answers[id];
    if (!object(a) || a.type !== q.type) fail('Invalid Jev response: answer type.');
    if (q.type === 'noul') {
      if (!unit(a.noul)) fail('Invalid Jev response: noul must be 0..1.');
      continue;
    }
    if (!unit(a.confidence)) fail('Invalid Jev response: confidence must be 0..1.');
    const levels = q.type === 'choice' ? q.criteria : Object.fromEntries(q.criteria.map((_, i) => [String(i), true]));
    if (!object(a.probabilities) || !sameKeys(a.probabilities, levels) || !Object.values(a.probabilities).every(unit) || Math.abs(Object.values(a.probabilities).reduce((x,y)=>x+y,0)-1) > 0.02) fail('Invalid Jev response: probability distribution.');
    if (q.type === 'choice' && (typeof a.choice !== 'string' || !Object.hasOwn(q.criteria,a.choice))) fail('Invalid Jev response: choice outside supplied options.');
    if (q.type === 'score' && (!Number.isFinite(a.score) || a.score < 0 || a.score > q.criteria.length-1 || !object(a.legend) || !sameKeys(a.legend,levels))) fail('Invalid Jev response: score or legend.');
  }
  if (!object(body.usage) || !['input_tokens','output_tokens'].every(k => body.usage[k] == null || (Number.isInteger(body.usage[k]) && body.usage[k] >= 0))) fail('Invalid Jev response: usage counts.');
  return body;
}

export async function doctor() {
  let filePresent = false;
  try { await access(credentialPath()); filePresent = true; } catch {}
  return { node: process.versions.node, endpoint: ENDPOINT, model: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || 'jev-latest', credentialConfigured: Boolean(process.env.TYPESAFE_API_KEY?.trim()) || filePresent, credentialSource: process.env.TYPESAFE_API_KEY?.trim() ? 'environment' : filePresent ? 'local file' : 'missing', networkChecked: false };
}

async function loadKey() {
  const environmentKey = process.env.TYPESAFE_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  try {
    const key = (await readFile(credentialPath(),'utf8')).trim();
    if (key) return key;
  } catch {}
  fail('Jev credential missing: set TYPESAFE_API_KEY or TYPESAFE_API_KEY_FILE, or configure ~/.config/ego-jev/api-key.');
}

export function createClient({ fetchImpl = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r,ms)), timeoutMs = 15000, retries = 2, apiKey, model = process.env.TYPESAFE_DEFAULT_MODEL?.trim() || 'jev-latest', runId, logDir } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(retries) || retries < 0 || retries > 3) fail('Invalid timeout/retry bounds.');
  const audit = createAudit({runId,dir:logDir});
  const transport = fetchImpl === globalThis.fetch ? 'network' : 'injected';
  async function request(path, input, callId) {
    const key = apiKey || await loadKey();
    const started = performance.now();
    let attempts = 0;
    while (true) {
      attempts++;
      audit.write('request.attempt',{callId,attempt:attempts});
      let response;
      let raw;
      try {
        response = await fetchImpl(ENDPOINT + path, {
          method: input ? 'POST' : 'GET',
          headers: { Authorization: `Bearer ${key}`, ...(input ? {'Content-Type':'application/json'} : {}) },
          ...(input ? {body:JSON.stringify(input)} : {}),
          signal: AbortSignal.timeout(timeoutMs), redirect:'error',
        });
        raw = await response.text();
      } catch {
        audit.write('request.network_error',{callId,attempt:attempts});
        if (attempts <= retries) { await sleep(300 * 2**(attempts-1)); continue; }
        // Do not print upstream errors: they can contain request headers or state.
        fail('Jev network request failed or timed out; no browser action was executed by this client.');
      }
      const rawId = response.headers.get('x-typesafe-request-id');
      const requestId = rawId && /^[a-zA-Z0-9_.:-]{1,200}$/.test(rawId) ? rawId : undefined;
      audit.write('request.response',{callId,attempt:attempts,httpStatus:response.status,requestId});
      if (!response.ok) {
        if ((response.status === 408 || response.status === 429 || response.status >= 500) && attempts <= retries) {
          const retryAfter = response.headers.get('retry-after');
          const retryMs = response.headers.get('retry-after-ms');
          const delay = retryMs !== null && /^\d+(\.\d+)?$/.test(retryMs) ? Number(retryMs) : retryAfter === null ? NaN : (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter)*1000 : Date.parse(retryAfter)-Date.now());
          const waitMs = Number.isFinite(delay) ? Math.max(0,delay) : 300 * 2**(attempts-1) + Math.random()*150;
          if (waitMs > 10000) fail(`Jev HTTP ${response.status}: retry-after exceeds this client's 10-second per-delay limit; retry later.`);
          await sleep(waitMs);
          continue;
        }
        fail(`Jev HTTP ${response.status}; ${response.status===401?'check the configured credential':response.status===422?'check state and question schema':'request unsuccessful'}.`);
      }
      let body;
      try { body = JSON.parse(raw); } catch { fail('Jev returned non-JSON data.'); }
      return { body, metrics: { requestId, apiMs: Math.round((performance.now()-started)*100)/100, attempts } };
    }
  }
  async function recorded(operation, input) {
    const callId=randomUUID();
    const receipt={runId:audit.runId,callId,path:audit.path,transport};
    let phase='validation';
    audit.write('call.started',{callId,operation,transport,requestedModel:safeModel(input?.model || model),questionCount:object(input?.questions)?Object.keys(input.questions).length:0});
    try {
      let payload;
      if(operation==='evaluate') {
        validateRequest(input);
        payload={state:input.state,model:input.model || model,questions:input.questions};
        audit.write('call.input',{callId,payloadHash:digest(payload),questionTypes:Object.values(input.questions).map(q=>q.type)});
      }
      phase='request';
      const {body,metrics}=await request(operation==='evaluate'?'/systemone':'/models',payload,callId);
      phase='response_validation';
      if(operation==='models') {
        if (!object(body) || !Array.isArray(body.models)) fail('Invalid Jev models response.');
        audit.write('call.succeeded',{callId,...metrics});
        return {models:body.models,metrics,audit:receipt};
      }
      validateResponse(body,payload.questions);
      const answers = Object.fromEntries(Object.entries(body.answers).map(([id,a]) => [id, a.type === 'noul' ? {type:a.type,noul:a.noul} : a.type === 'choice' ? {type:a.type,choice:a.choice,probabilities:a.probabilities,confidence:a.confidence} : {type:a.type,score:a.score,probabilities:a.probabilities,legend:a.legend,confidence:a.confidence}]));
      const usage={input_tokens:body.usage.input_tokens ?? null,output_tokens:body.usage.output_tokens ?? null};
      // Ordinal references avoid persisting arbitrary question ids, labels or field values.
      const summaries=Object.entries(payload.questions).map(([id,q],questionIndex)=>{
        const a=answers[id];
        return {questionIndex,type:a.type,...(a.type==='noul'?{noul:a.noul}:a.type==='score'?{score:a.score,confidence:a.confidence}:{choiceIndex:Object.keys(q.criteria).indexOf(a.choice),confidence:a.confidence,probability:a.probabilities[a.choice]})};
      });
      audit.write('call.succeeded',{callId,model:safeModel(body.model),...metrics,usage,answers:summaries});
      return {model:body.model,answers,usage,metrics:{...metrics,questionCount:Object.keys(payload.questions).length},audit:receipt};
    } catch(error) {
      // No upstream error message, payload, key or response body is written.
      if(error.code!=='JEV_AUDIT_WRITE_FAILED') audit.write('call.failed',{callId,phase});
      error.audit=receipt;throw error;
    }
  }
  return {evaluate:input=>recorded('evaluate',input),models:()=>recorded('models')};
}

export const evaluate = (input,options) => createClient(options).evaluate(input);
export const models = options => createClient(options).models();

/** Independent states, bounded concurrency, stable ids, explicit partial failures. */
export async function evaluateMany(items, {concurrency = 4, ...clientOptions} = {}) {
  if (!Array.isArray(items) || !items.length || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) fail('Use nonempty items and concurrency 1..16.');
  const ids = new Set();
  for (const item of items) {
    if (!object(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail('Every batch item needs a unique nonempty string id.');
    ids.add(item.id); validateRequest(item);
  }
  const client = createClient(clientOptions);
  const results = new Array(items.length);
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while (next < items.length) {
      const i = next++; const {id,...input} = items[i];
      try { results[i] = {id,ok:true,result:await client.evaluate(input)}; }
      catch (error) { results[i] = {id,ok:false,error:error.message,audit:error.audit}; }
    }
  }));
  return {results,metrics:{wallMs:Math.round((performance.now()-started)*100)/100,concurrency,succeeded:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length}};
}

/** An application routing aid, never permission to perform an action. */
export function routeAnswer(answer, {minConfidence=0.8,yesAt=0.9,noAt=0.1} = {}) {
  if (![minConfidence,yesAt,noAt].every(unit) || noAt >= yesAt) fail('Invalid routing thresholds.');
  if (answer?.type === 'noul' && unit(answer.noul)) return answer.noul >= yesAt ? {route:'accept',value:true} : answer.noul <= noAt ? {route:'accept',value:false} : {route:'review'};
  if (['choice','score'].includes(answer?.type) && unit(answer.confidence) && answer.confidence >= minConfidence) return {route:'accept',value:answer.type==='choice'?answer.choice:answer.score};
  return {route:'review'};
}

async function main() {
  const [command,file,...extra] = process.argv.slice(2);
  if (extra.length) fail('Unexpected arguments.');
  let result;
  if (command === 'doctor' && !file) result = await doctor();
  else if (command === 'models' && !file) result = await models();
  else if (['evaluate','batch'].includes(command) && file) {
    const input = JSON.parse(await readFile(resolve(file),'utf8'));
    result = command==='evaluate' ? await evaluate(input) : await evaluateMany(input.items,{concurrency:input.concurrency ?? 4});
    if (command==='batch' && result.metrics.failed) process.exitCode = 1;
  } else if (!command || command === '--help') {
    console.log('Usage: node jev.mjs doctor | models | evaluate /absolute/request.json | batch /absolute/batch.json\nCredential: TYPESAFE_API_KEY, then TYPESAFE_API_KEY_FILE, then ~/.config/ego-jev/api-key.\nModel: request.model, then TYPESAFE_DEFAULT_MODEL, then jev-latest. No planner model is selected here.');
    return;
  } else fail('Usage: jev.mjs doctor | models | evaluate FILE | batch FILE');
  console.log(JSON.stringify(result,null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
