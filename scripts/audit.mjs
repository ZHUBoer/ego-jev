/** Local append-only execution journal. Metadata only; never payloads or credentials. */
import {appendFileSync, mkdirSync, chmodSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const processRunId = randomUUID();
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const logDirectory = () => resolve(process.env.EGO_JEV_LOG_DIR || join(homedir(),'.local','state','ego-jev','logs'));
export const safeModel = value => typeof value === 'string' && /^jev-[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'unrecognized';

export function createAudit({runId=process.env.EGO_JEV_RUN_ID || processRunId, dir=logDirectory()}={}) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(runId)) throw new Error('Invalid audit run id. Use an opaque id, not user content.');
  const path=join(resolve(dir),`${new Date().toISOString().slice(0,10)}-${runId}.jsonl`);
  return {runId,path,write(event,data={}) {
    try {
      mkdirSync(resolve(dir),{recursive:true,mode:0o700});
      chmodSync(resolve(dir),0o700);
      appendFileSync(path,JSON.stringify({...data,version:1,event,eventId:randomUUID(),at:new Date().toISOString(),runId})+'\n',{mode:0o600});
      chmodSync(path,0o600);
    } catch {
      const error=new Error('Jev local audit write failed. Stop and inspect the existing outcome before retrying.');
      error.code='JEV_AUDIT_WRITE_FAILED';throw error;
    }
  }};
}

export function readAudit(path) {
  const events=[];let malformedLines=0;
  for (const line of readFileSync(path,'utf8').split('\n').filter(Boolean)) {
    try {events.push(JSON.parse(line));} catch {malformedLines++;}
  }
  const calls=new Map();
  for (const e of events) {
    if (!e.callId) continue;
    if (!calls.has(e.callId)) calls.set(e.callId,{callId:e.callId,status:'incomplete',attempts:0});
    const c=calls.get(e.callId);
    if (e.event==='call.started') Object.assign(c,{operation:e.operation,transport:e.transport,requestedModel:e.requestedModel,startedAt:e.at,questionCount:e.questionCount});
    if (e.event==='request.attempt') c.attempts++;
    if (e.event==='request.response') Object.assign(c,{httpStatus:e.httpStatus,requestId:e.requestId || c.requestId});
    if (e.event==='call.succeeded') Object.assign(c,{status:'succeeded',model:e.model,apiMs:e.apiMs,usage:e.usage,answers:e.answers});
    if (e.event==='call.failed') Object.assign(c,{status:'failed',phase:e.phase});
  }
  const list=[...calls.values()];
  const live=list.filter(c=>c.operation==='evaluate' && c.transport==='network' && c.status==='succeeded');
  const actions=events.filter(e=>e.event==='action.outcome');
  return {path,runId:events[0]?.runId,summary:{
    liveSuccessfulCalls:live.length,liveQuestions:live.reduce((n,c)=>n+(c.questionCount||0),0),
    failedCalls:list.filter(c=>c.status==='failed').length,incompleteCalls:list.filter(c=>c.status==='incomplete').length,
    injectedCalls:list.filter(c=>c.transport==='injected').length,
    executedActions:actions.filter(e=>e.status==='executed').length,
    uncertainActions:actions.filter(e=>e.status==='uncertain').length,
    pendingActions:events.filter(e=>e.event==='action.attempted'&&!actions.some(a=>a.actionAttemptId===e.actionAttemptId)).length,
    malformedLines,
  },calls:list,events};
}

const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function writeReport(logPath,outputPath) {
  const report=readAudit(logPath);
  const rows=report.calls.map(c=>`<tr><td>${escape(c.startedAt)}</td><td>${escape(c.callId)}</td><td>${escape(c.transport)}</td><td>${escape(c.status)}</td><td>${escape(c.model || c.requestedModel)}</td><td>${c.attempts}</td><td>${escape(c.apiMs)}</td><td>${escape(c.requestId)}</td></tr>`).join('');
  const html=`<!doctype html><meta charset="utf-8"><title>Jev 本地调用记录</title><style>body{font:15px system-ui;margin:36px;color:#172635}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ccd5dd;padding:10px;text-align:left;overflow-wrap:anywhere}pre{background:#f3f6f8;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:26px}</style><h1>Jev 本地调用记录</h1><p>任务编号：${escape(report.runId)}</p><p>真实网络调用成功 ${report.summary.liveSuccessfulCalls} 次；判断 ${report.summary.liveQuestions} 项；失败 ${report.summary.failedCalls} 次；未完成 ${report.summary.incompleteCalls} 次；模拟调用 ${report.summary.injectedCalls} 次。</p><p>动作执行 ${report.summary.executedActions} 次；结果不确定 ${report.summary.uncertainActions} 次；无结束记录 ${report.summary.pendingActions} 次。动作回执不等于任务完成，查看 workflow.finished 中的核验状态。</p><p>这是本机脚本记录，不是服务商签名证明。network 表示默认网络路径，injected 表示替换的测试或自定义请求实现。没有结束记录表示结果未知。已损坏或不完整的日志行：${report.summary.malformedLines}。</p><table><thead><tr><th>开始时间</th><th>调用编号</th><th>来源</th><th>结果</th><th>模型</th><th>尝试次数</th><th>耗时 ms</th><th>服务请求编号</th></tr></thead><tbody>${rows}</tbody></table><details><summary>查看逐条调用与执行记录</summary><pre>${escape(JSON.stringify(report.events,null,2))}</pre></details><p>原始文件：${escape(resolve(logPath))}</p>`;
  writeFileSync(outputPath,html,{mode:0o600});
  return {outputPath:resolve(outputPath),summary:report.summary};
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command,input,output]=process.argv.slice(2);
    if (command==='list') {
      let names=[];try {names=readdirSync(logDirectory()).filter(n=>n.endsWith('.jsonl')).sort().reverse();}catch(e){if(e.code!=='ENOENT')throw e;}
      console.log(JSON.stringify(names.map(n=>{const r=readAudit(join(logDirectory(),n));return {runId:r.runId,path:r.path,...r.summary};}),null,2));
    } else if (command==='show' && input) console.log(JSON.stringify(readAudit(resolve(input)),null,2));
    else if (command==='report' && input && output) console.log(JSON.stringify(writeReport(resolve(input),resolve(output)),null,2));
    else throw new Error('Usage: audit.mjs list | show /absolute/log.jsonl | report /absolute/log.jsonl /absolute/report.html');
  } catch {console.error('Unable to read/write audit report. Usage: audit.mjs list | show LOG | report LOG OUTPUT.html');process.exitCode=1;}
}
