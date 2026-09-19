import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from './jev.mjs';
import {createAudit,readAudit,writeReport} from './audit.mjs';
import {runWorkflow} from './workflow.mjs';

const dir=()=>mkdtempSync(join(tmpdir(),'ego-jev-audit-'));
const input={state:'private-page-canary',questions:{'private-question-id':{type:'choice',instructions:'private-instruction-canary',criteria:{'private-option':'private-label','other':'other label'}}}};
const body={model:'jev-test',answers:{'private-question-id':{type:'choice',choice:'private-option',probabilities:{'private-option':1,other:0},confidence:1}},usage:{input_tokens:30,output_tokens:5}};
const ok=()=>new Response(JSON.stringify(body),{status:200,headers:{'x-typesafe-request-id':'req-test'}});

test('journal records retry and validated success without payloads, labels, keys or raw errors',async()=>{
  let n=0;const client=createClient({logDir:dir(),runId:'retry-test',apiKey:'credential-canary',sleep:async()=>{},fetchImpl:async()=>++n===1?new Response('private-error-canary',{status:429,headers:{'retry-after-ms':'1'}}):ok()});
  const r=await client.evaluate(input);const report=readAudit(r.audit.path);const raw=readFileSync(r.audit.path,'utf8');
  assert.equal(report.calls[0].attempts,2);assert.equal(report.calls[0].status,'succeeded');assert.equal(report.calls[0].requestId,'req-test');
  assert.equal(report.calls[0].answers[0].choiceIndex,0);assert.equal(report.summary.liveSuccessfulCalls,0);assert.equal(report.summary.injectedCalls,1);
  for(const forbidden of ['credential-canary','private-page-canary','private-instruction-canary','private-option','private-label','private-question-id','private-error-canary'])assert.equal(raw.includes(forbidden),false);
  assert.equal(statSync(r.audit.path).mode&0o777,0o600);
});

test('HTTP, network, invalid response and local validation failures are distinguishable',async()=>{
  for(const [kind,fetchImpl,request,phase,attempts] of [
    ['http',async()=>new Response('secret',{status:401}),input,'request',1],
    ['network',async()=>{throw new Error('secret');},input,'request',1],
    ['invalid-response',async()=>new Response('{}',{status:200}),input,'response_validation',1],
    ['validation',async()=>assert.fail(),{state:null,questions:input.questions},'validation',0],
  ]) {
    const client=createClient({logDir:dir(),runId:kind,apiKey:'secret',retries:0,fetchImpl});
    await assert.rejects(client.evaluate(request),e=>{
      const r=readAudit(e.audit.path);assert.equal(r.summary.failedCalls,1);assert.equal(r.calls[0].phase,phase);assert.equal(r.calls[0].attempts,attempts);assert.equal(r.summary.liveSuccessfulCalls,0);return true;
    });
  }
});

test('concurrent calls keep complete lines and separate call ids in a shared run',async()=>{
  const client=createClient({logDir:dir(),runId:'parallel',apiKey:'test',fetchImpl:async()=>ok()});
  const results=await Promise.all(Array.from({length:20},()=>client.evaluate(input)));
  const r=readAudit(results[0].audit.path);assert.equal(r.calls.length,20);assert.equal(r.summary.malformedLines,0);
  assert.equal(new Set(results.map(x=>x.audit.callId)).size,20);assert.equal(r.calls.every(c=>c.status==='succeeded'),true);
});

test('unwritable audit destination stops before making a network request',async()=>{
  const logDir=join(dir(),'file');writeFileSync(logDir,'occupied');let calls=0;
  const client=createClient({logDir,apiKey:'test',fetchImpl:async()=>{calls++;return ok();}});
  await assert.rejects(client.evaluate(input),e=>e.code==='JEV_AUDIT_WRITE_FAILED');assert.equal(calls,0);
});

test('incomplete requests and truncated journal lines remain unknown instead of successful',()=>{
  const a=createAudit({dir:dir(),runId:'interrupted'});
  a.write('call.started',{callId:'c',operation:'evaluate',transport:'network'});
  a.write('request.attempt',{callId:'c'});a.write('request.response',{callId:'c',httpStatus:200});
  appendFileSync(a.path,'{"incomplete":');
  const r=readAudit(a.path);assert.equal(r.summary.incompleteCalls,1);assert.equal(r.summary.malformedLines,1);assert.equal(r.summary.liveSuccessfulCalls,0);
});

test('workflow joins execution to the API call and logs actual completion separately',async()=>{
  const logDir=dir();let done=false;
  const fakeBody={model:'jev-test',answers:{next:{type:'choice',choice:'save',probabilities:{save:1,delegate:0},confidence:1}},usage:{input_tokens:1,output_tokens:1}};
  const client=createClient({logDir,runId:'joined',apiKey:'test',fetchImpl:async()=>new Response(JSON.stringify(fakeBody),{status:200})});
  const r=await runWorkflow({goal:'private goal',logDir,runId:'joined',evaluate:request=>client.evaluate(request),
    observe:async()=>({fingerprint:String(done),state:{done},actions:[{id:'save',description:'Save',params:{value:'private value'}}]}),
    verify:async()=>({done,evidence:'private receipt'}),isCurrent:async()=>true,execute:async()=>{done=true;},
  });
  const review=readAudit(r.audit.path);const action=review.events.find(e=>e.event==='action.outcome');
  assert.equal(action.callId,review.calls[0].callId);assert.equal(review.summary.executedActions,1);
  assert.equal(review.events.at(-1).status,'completed');assert.equal(review.summary.liveSuccessfulCalls,0);
  const raw=readFileSync(r.audit.path,'utf8');for(const secret of ['private goal','private value','private receipt'])assert.equal(raw.includes(secret),false);
});

test('action failure records uncertainty and report remains standalone with escaped content',async()=>{
  const logDir=dir();let log;
  await assert.rejects(runWorkflow({goal:'save',logDir,runId:'failed-action',
    observe:async()=>({fingerprint:'a',state:{},actions:[{id:'save',description:'Save',params:{}}]}),
    evaluate:async()=>({model:'jev-test',answers:{next:{type:'choice',choice:'save'}}}),
    verify:async()=>({done:false}),isCurrent:async()=>true,execute:async()=>{throw new Error('page secret');},
  }),e=>{log=e.workflow.audit.path;return true;});
  const r=readAudit(log);assert.equal(r.summary.uncertainActions,1);assert.equal(r.summary.executedActions,0);
  createAudit({dir:logDir,runId:'failed-action'}).write('test',{text:'<script>alert(1)</script>'});
  const reportPath=join(logDir,'review.html');writeReport(log,reportPath);
  const html=readFileSync(reportPath,'utf8');assert.equal(html.includes('<script>'),false);assert.equal(html.includes('&lt;script&gt;'),true);assert.equal(html.includes('page secret'),false);
});
