import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient,evaluateMany,validateRequest,validateResponse,routeAnswer} from './jev.mjs';
const input={state:'A refund is requested.',questions:{refund:{type:'noul',instructions:'Is a refund requested?'}}};
const body={model:'jev-test',answers:{refund:{type:'noul',noul:0.97}},usage:{input_tokens:12,output_tokens:2}};
const ok = b => new Response(JSON.stringify(b),{status:200,headers:{'x-typesafe-request-id':'request-test'}});
test('mixed request supports structured/null instructions but rejects invalid state and score',()=>{
 validateRequest({state:{a:1},questions:{a:{type:'choice',criteria:{one:null}},b:{type:'noul',instructions:null,criteria:null},c:{type:'score',instructions:{what:'Quality'},criteria:[{label:'bad'},['good']]}}});
 for(const state of [null,15,true]) assert.throws(()=>validateRequest({...input,state}));
 assert.throws(()=>validateRequest({...input,state:{a:NaN}}));
 assert.throws(()=>validateRequest({...input,questions:{q:{type:'score',criteria:[null,'good']}}}));
});
test('missing/extra ids, unknown options and malformed probabilities fail before actions',()=>{
 assert.throws(()=>validateResponse({...body,answers:{}},input.questions));
 assert.throws(()=>validateResponse({...body,answers:{...body.answers,extra:{type:'noul',noul:1}}},input.questions));
 const q={x:{type:'choice',criteria:{a:null,b:null}}};
 for(const a of [{type:'choice',choice:'invented',confidence:1,probabilities:{a:1,b:0}},{type:'choice',choice:'a',confidence:1,probabilities:{a:1,b:1}}]) assert.throws(()=>validateResponse({...body,answers:{x:a}},q));
});
test('fractional score and structured legends preserved',()=>{
 const q={x:{type:'score',criteria:[{label:'bad'},{label:'good'}]}};
 const answer={type:'score',score:0.75,confidence:0.5,probabilities:{0:0.25,1:0.75},legend:{0:{label:'bad'},1:{label:'good'}}};
 assert.equal(validateResponse({...body,answers:{x:answer}},q).answers.x.score,0.75);
});
test('bounded rate-limit retry honors milliseconds header, tracks request id and strips extra fields',async()=>{
 let calls=0;const waits=[];
 const client=createClient({apiKey:'test-secret',sleep:async ms=>waits.push(ms),fetchImpl:async()=>++calls===1?new Response('{}',{status:429,headers:{'retry-after-ms':'9'}}):ok({...body,secret:'ignored',answers:{refund:{...body.answers.refund,unexpected:'ignored'}},usage:{...body.usage,extra:'ignored'}})});
 const result=await client.evaluate(input);
 assert.equal(calls,2);assert.deepEqual(waits,[9]);assert.equal(result.metrics.requestId,'request-test');assert.equal(result.metrics.attempts,2);assert.equal(result.answers.refund.unexpected,undefined);assert.equal(result.usage.extra,undefined);
});
test('auth failures are not retried and do not echo body or key',async()=>{
 let calls=0;const client=createClient({apiKey:'test-secret',fetchImpl:async()=>{calls++;return new Response('test-secret private state',{status:401});}});
 await assert.rejects(client.evaluate(input),e=>e.message.includes('401')&&!e.message.includes('test-secret')&&!e.message.includes('private state'));assert.equal(calls,1);
});
test('network failures retry within bounds and do not leak upstream error',async()=>{
 let calls=0;const client=createClient({apiKey:'test-secret',sleep:async()=>{},fetchImpl:async()=>{calls++;throw new Error('test-secret');}});
 await assert.rejects(client.evaluate(input),e=>!e.message.includes('test-secret'));assert.equal(calls,3);
});
test('server long retry-after stops without premature retry',async()=>{
 let calls=0;const client=createClient({apiKey:'test-secret',fetchImpl:async()=>{calls++;return new Response('{}',{status:529,headers:{'retry-after':'120'}});}});
 await assert.rejects(client.evaluate(input),/per-delay limit/);assert.equal(calls,1);
});
test('batch bounds concurrency and preserves partial failure identities',async()=>{
 let active=0,max=0;
 const result=await evaluateMany(['a','b','c'].map(id=>({id,...input,state:id})),{apiKey:'test-secret',concurrency:2,retries:0,fetchImpl:async(url,options)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return JSON.parse(options.body).state==='b'?new Response('{}',{status:403}):ok(body);}});
 assert.equal(max,2);assert.deepEqual(result.results.map(r=>[r.id,r.ok]),[['a',true],['b',false],['c',true]]);assert.equal(result.metrics.failed,1);
});
test('routing separates yes, no, uncertainty and illustrative confidence gates',()=>{
 assert.deepEqual(routeAnswer({type:'noul',noul:0.5}),{route:'review'});
 assert.deepEqual(routeAnswer({type:'noul',noul:0.01}),{route:'accept',value:false});
 assert.deepEqual(routeAnswer({type:'noul',noul:0.99}),{route:'accept',value:true});
 assert.deepEqual(routeAnswer({type:'choice',choice:'none',confidence:0.5}),{route:'review'});
});

test('unavailable optional usage counters do not discard valid answers',async()=>{
 const result=await createClient({apiKey:'test-secret',fetchImpl:async()=>ok({...body,usage:{input_tokens:null}})}).evaluate(input);
 assert.deepEqual(result.usage,{input_tokens:null,output_tokens:null});
 assert.equal(result.answers.refund.noul,0.97);
});
test('per-request Jev model overrides client default, independently of planner',async()=>{
 let sent;
 const client=createClient({apiKey:'test-secret',model:'jev-default-test',fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return ok(body);}});
 await client.evaluate({...input,model:'jev-pinned-test'});
 assert.equal(sent.model,'jev-pinned-test');
 await client.evaluate(input);
 assert.equal(sent.model,'jev-default-test');
});
