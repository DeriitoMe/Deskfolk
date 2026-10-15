import type {PetEvent,PetPreferences,ProjectDashboardData} from './types';
import {dominantActivity,pendingNativeInputIds,projectIdentity,type SessionActivities,type SessionActivity} from './activity.ts';
type ProjectState=ProjectDashboardData['projects'][number]['state'];
export function dashboardEventLabel(event:PetEvent):string {
  if(event.outcome==='failed')return '任务失败';if(event.outcome==='quota_exhausted')return '额度耗尽';
  return {work_started:'开始工作',work_progress:'状态已同步',approval_needed:'等待授权',approval_resolved:'授权等待已解除',needs_input:'等待回答',input_resolved:'问题已处理',input_sync:'状态已同步',turn_ended:event.outcome==='success'?'成功完成':'本轮停止',interrupted:'暂停／停止',task_complete:'任务完成',stage_complete:'阶段完成',info:'通知'}[event.type];
}
function state(session:SessionActivity,last?:PetEvent):ProjectState {
  if(session.phase==='asking'&&pendingNativeInputIds(session).length)return 'asking';
  if(session.phase==='working')return 'working';
  if(last?.turnId&&last.turnId!==session.turnId)last=undefined;
  const outcome=session.terminalOutcome??last?.outcome;
  if(outcome==='failed')return 'failed';if(outcome==='quota_exhausted')return 'quota_exhausted';
  if(outcome==='interrupted'||last?.type==='interrupted')return 'paused';
  if(outcome==='success')return 'completed';
  return 'idle';
}
export function projectDashboard(sessions:SessionActivities,history:PetEvent[],options:{
  preferences:PetPreferences;bridgeReady:boolean;monitor:ProjectDashboardData['monitor'];
  projectName?:(id:string)=>string|undefined;now?:string;
}):ProjectDashboardData {
  const rank:Record<ProjectState,number>={asking:8,approval:7,working:6,quota_exhausted:5,failed:4,paused:3,completed:2,idle:1};
  const projects=new Map<string,ProjectDashboardData['projects'][number]>();let pendingRequestCount=0;
  for(const session of Object.values(sessions)){
    if(session.isSubagent||session.sessionId==='demo')continue;
    const path=projectIdentity(session.projectPath),key=session.projectId?`project:${session.projectId}`:path?`directory:${path}`:`unknown:${session.sessionId}`;
    const last=history.find(e=>e.sessionId===session.sessionId&&(!e.turnId||e.turnId===session.turnId)&&!e.isSubagent&&e.source!=='demo');
    const currentState=state(session,last),parts=path?.split('/').filter(Boolean);
    const name=(session.projectId&&options.projectName?.(session.projectId))||last?.project||parts?.at(-1)||'未归属项目';
    const item=projects.get(key)??{key,name,path:session.projectPath,state:currentState,sessionCount:0,workingSessionCount:0,lastEventAt:session.updatedAt,lastEventLabel:last?dashboardEventLabel(last):'等待状态同步'};
    item.sessionCount++;if(session.phase==='working')item.workingSessionCount++;
    if(session.phase==='asking')pendingRequestCount+=pendingNativeInputIds(session).length;
    const active=(s:ProjectState)=>['working','asking','approval'].includes(s);
    if((active(currentState)&&rank[currentState]>rank[item.state])||
      (!active(currentState)&&!active(item.state)&&Date.parse(session.updatedAt)>=Date.parse(item.lastEventAt)))item.state=currentState;
    if(Date.parse(session.updatedAt)>Date.parse(item.lastEventAt)){item.lastEventAt=session.updatedAt;item.lastEventLabel=last?dashboardEventLabel(last):'状态已同步';}
    projects.set(key,item);
  }
  return {capturedAt:options.now??new Date().toISOString(),bridgeReady:options.bridgeReady,monitor:options.monitor,
    approvalSupport:'native-questions-only',
    workingProjectCount:dominantActivity(Object.fromEntries(Object.entries(sessions).map(([id,session])=>[id,{...session,projectPath:projectIdentity(session.projectPath)}]))).workingProjectCount??0,pendingRequestCount,
    projects:[...projects.values()].sort((a,b)=>rank[b.state]-rank[a.state]||Date.parse(b.lastEventAt)-Date.parse(a.lastEventAt)),
    recentEvents:history.filter(e=>!e.isSubagent&&e.source!=='demo'&&!e.replayed&&e.type!=='input_sync').slice(0,20).map(e=>({id:e.id,project:e.project,label:dashboardEventLabel(e),createdAt:e.createdAt})),preferences:{...options.preferences}};
}
