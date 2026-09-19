import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflow} from './workflow.mjs';

const action = {id:'next', description:'Advance to the next stage', params:{selector:'#next', value:'exact'}};
const observation = stage => ({fingerprint:String(stage), state:{stage}, actions:[action]});
const choice = (id='next', confidence=0.98) => ({model:'test', answers:{next:{type:'choice', choice:id, confidence, probabilities:{[id]:confidence}}}, metrics:{apiMs:1}, usage:{input_tokens:10,output_tokens:2}});
const base = () => ({goal:'Finish the fixture', observe:async()=>observation(0), verify:async()=>({done:false}), isCurrent:async()=>true, execute:async()=>{}, evaluate:async()=>choice()});

test('several decisions run continuously and only observed evidence completes', async()=>{
  let stage=0, calls=0;
  const r=await runWorkflow({...base(), observe:async()=>observation(stage),
    verify:async o=>({done:o.state.stage===3, evidence:stage===3?'Receipt 123 visible':''}),
    evaluate:async(input,options)=>{ calls++; assert.equal(options.retries,0); assert.equal(Object.hasOwn(input.questions.next.criteria,'done'),false); return choice(); },
    execute:async a=>{ assert.equal(a.params.value,'exact'); assert.ok(Object.isFrozen(a.params)); stage++; },
  });
  assert.equal(r.status,'completed'); assert.equal(calls,3); assert.equal(r.metrics.actions,3);
  assert.equal(r.trace.every(t=>t.status==='executed'),true);
});

test('unchanged page/action is never clicked twice, including a resumed run', async()=>{
  let mutations=0;
  const options={...base(),execute:async()=>{mutations++;}};
  const r=await runWorkflow(options);
  assert.equal(r.status,'stuck'); assert.equal(mutations,1);
  const resumed=await runWorkflow({...options, previousAttempts:r.attempts});
  assert.equal(resumed.status,'stuck'); assert.equal(mutations,1);
});

test('changing scroll progress allows the same action again; cyclic state does not',async()=>{
  let position=0;
  const r=await runWorkflow({...base(), observe:async()=>observation(position), execute:async()=>{position=(position+1)%2;}});
  assert.equal(r.status,'stuck'); assert.equal(r.metrics.actions,2);
});

test('stale decisions are discarded and re-observation supplies new bound params',async()=>{
  let stage=0, calls=0, executed=[];
  const r=await runWorkflow({...base(),
    observe:async()=>({...observation(stage), actions:[{...action,params:{value:stage}}]}),
    isCurrent:async()=>{if(stage===0){stage=1;return false;} return true;},
    evaluate:async()=>{calls++;return choice();},
    execute:async a=>{executed.push(a.params.value);stage=2;},
    verify:async()=>({done:stage===2,evidence:'stage two'}),
  });
  assert.equal(r.status,'completed'); assert.deepEqual(executed,[1]); assert.equal(calls,2); assert.equal(r.trace[0].status,'stale');
});

test('action timeout stops immediately and preserves consumed intent',async()=>{
  let observations=0, mutations=0;
  await assert.rejects(runWorkflow({...base(),observe:async()=>{observations++;return observation(0);},execute:async()=>{mutations++;throw new Error('timeout');}}),e=>{
    assert.equal(e.message,'timeout'); assert.equal(e.workflow.status,'action_uncertain');
    assert.equal(e.workflow.attempts.length,1); assert.equal(e.workflow.trace[0].status,'uncertain');return true;
  });
  assert.equal(observations,1); assert.equal(mutations,1);
});

test('failed post-action observation retains executed action and propagates control stop',async()=>{
  let reads=0;
  await assert.rejects(runWorkflow({...base(),observe:async()=>{if(reads++)throw new Error('User controlling');return observation(0);}}),e=>{
    assert.equal(e.message,'User controlling'); assert.equal(e.workflow.attempts.length,1); assert.equal(e.workflow.trace[0].status,'executed');return true;
  });
});

test('control loss after inference propagates without executing or claiming completion',async()=>{
  let mutations=0;
  await assert.rejects(runWorkflow({...base(), isCurrent:async()=>{throw new Error('Inactive space');},execute:async()=>{mutations++;}}),/Inactive space/);
  assert.equal(mutations,0);
});

test('delegate and excessive menus return to agent without mutation or truncation',async()=>{
  let calls=0;
  const oversized=await runWorkflow({...base(),observe:async()=>({...observation(0),actions:Array.from({length:255},(_,i)=>({...action,id:'a'+i}))}), evaluate:async()=>{calls++;return choice();}});
  assert.equal(oversized.reason,'too_many_candidates');assert.equal(calls,0);
  const delegated=await runWorkflow({...base(),evaluate:async()=>choice('delegate'),execute:async()=>assert.fail('must not execute')});
  assert.equal(delegated.status,'needs_review');
});

test('no universal confidence cutoff; a task may supply its own acceptance policy',async()=>{
  let changed=false;
  const options={...base(), evaluate:async()=>choice('next',0.22), execute:async()=>{changed=true;},verify:async()=>({done:changed,evidence:'actual result'})};
  assert.equal((await runWorkflow(options)).status,'completed');
  changed=false;
  assert.equal((await runWorkflow({...options,acceptChoice:async a=>a.confidence>=0.9})).reason,'acceptance_policy');
  assert.equal(changed,false);
});

test('completion at the action budget is verified; remaining unmet goals stop',async()=>{
  let stage=0;
  const options={...base(),maxActions:1,observe:async()=>observation(stage),execute:async()=>{stage++;}};
  assert.equal((await runWorkflow(options)).reason,'actions');
  stage=0;
  const r=await runWorkflow({...options,verify:async()=>({done:stage===1,evidence:'receipt'})});
  assert.equal(r.status,'completed');assert.equal(r.metrics.actions,1);
});

test('wrong choices and evidence-free completion never execute',async()=>{
  await assert.rejects(runWorkflow({...base(),evaluate:async()=>choice('invented'),execute:async()=>assert.fail()}),/outside/);
  await assert.rejects(runWorkflow({...base(),verify:async()=>({done:true})}),/observable evidence/);
  await assert.rejects(runWorkflow({...base(),verify:async()=>({done:0.99})}),/boolean/);
});

test('stale pages exhaust finite decision budget without executing',async()=>{
  const r=await runWorkflow({...base(),maxDecisions:2,isCurrent:async()=>false,execute:async()=>assert.fail()});
  assert.equal(r.reason,'decisions');assert.equal(r.metrics.decisions,2);assert.equal(r.metrics.actions,0);
});

test('time budget rechecked after asynchronous freshness checks',async()=>{
  const r=await runWorkflow({...base(),timeoutMs:5,isCurrent:async()=>{await new Promise(r=>setTimeout(r,15));return true;},execute:async()=>assert.fail()});
  assert.equal(r.reason,'time');assert.equal(r.metrics.actions,0);
});
