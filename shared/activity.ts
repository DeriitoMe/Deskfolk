import type { PetActivity, PetEvent } from './types';
import { isQuestionReminder } from './reminders.ts';

export interface SessionActivity extends PetActivity {
  sessionId: string;
  turnId?: string;
  projectPath?: string;
  projectId?: string;
  isSubagent?: boolean;
  waitingFor?: 'input' | 'approval';
  endedTurns?: string[];
  terminal?: boolean;
  startedAt?: string;
  nativeTurnId?: string;
  nativeStartedAt?: string;
  nativeProjectPath?: string;
  /** Also true when native metadata explicitly clears the project assignment. */
  nativeProjectIdConfirmed?: boolean;
}
export type SessionActivities = Record<string, SessionActivity>;

/** Directory identity, never a display basename or a chat title. */
export function projectIdentity(path?: string): string | undefined {
  if (!path) return undefined;
  const clean=path.replace(/^\\\\\?\\UNC\\/i,'//').replace(/^\\\\\?\\/, '').replace(/\\/g,'/');
  const drive=/^([a-z]):\//i.exec(clean);
  let prefix:string,rest:string,protectedSegments=0;
  if(drive){prefix=drive[1].toLowerCase()+':/';rest=clean.slice(3).toLowerCase();}
  else if(clean.startsWith('//')){prefix='//';rest=clean.slice(2).toLowerCase();protectedSegments=2;}
  else if(clean.startsWith('/')){prefix='/';rest=clean.slice(1);}
  else return undefined;
  const segments:string[]=[];
  for(const part of rest.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){if(segments.length>protectedSegments)segments.pop();}
    else segments.push(part);
  }
  if(protectedSegments&&segments.length<protectedSegments)return undefined;
  return prefix+segments.join('/');
}
/** Native records correlate every question call; hooks cannot do that. */
export function shouldIgnoreHookQuestion(sessions:SessionActivities,event:PetEvent):boolean {
  return event.source==='hook'&&['needs_input','input_resolved'].includes(event.type)&&
    !!(event.sessionId&&sessions[event.sessionId]?.nativeTurnId);
}
/** Only a confirmed whole-task result may trigger a celebration. */
export function isSuccessfulCompletion(event:PetEvent):boolean {
  return ['turn_ended','task_complete'].includes(event.type)&&event.outcome==='success'&&
    event.replayed!==true&&!event.isSubagent;
}
/** Finishing an async question turn does not finish its still-pending task. */
export function shouldCelebrateCompletion(sessions:SessionActivities,event:PetEvent):boolean {
  if(!isSuccessfulCompletion(event))return false;
  const session=event.sessionId?sessions[event.sessionId]:undefined;
  return !(session?.phase==='asking'&&session.turnId===event.turnId);
}
/** Stable across Stop hooks, native completion records and milestone notices. */
export function successfulCompletionIdentity(event:PetEvent):string {
  const project=projectIdentity(event.projectPath)??event.project??'';
  if(event.sessionId&&event.turnId)return JSON.stringify([project,event.sessionId,event.turnId]);
  if(event.task)return JSON.stringify([project,event.sessionId??'',event.task]);
  return `event:${event.id}`;
}
/** Reconciliation can change one project while the aggregate stays identical. */
export function shouldPresentLifecycleEvent(event:PetEvent,stateChanged:boolean,now:number):boolean {
  if(event.source!=='codex-log')return true;
  if(['turn_ended','task_complete'].includes(event.type)&&event.outcome==='success')return isSuccessfulCompletion(event);
  // A new question call is meaningful even if this session was already asking.
  // The renderer dedupes the call ID so reconciliation cannot renew its deadline.
  if(event.type==='needs_input'&&event.nativeQuestion&&event.nativeCallId&&event.replayed!==true)return true;
  return stateChanged&&now-Date.parse(event.createdAt)<=10_000;
}
export function shouldDeliverPetEvent(event:PetEvent,activity:PetActivity):boolean {
  return event.type!=='work_progress'&&
    (event.type!=='turn_ended'||activity.phase==='idle'||isSuccessfulCompletion(event));
}
/** Loading can outlast a question; show only reminders still pending at flush. */
export function shouldDeliverBufferedEvent(sessions:SessionActivities,event:PetEvent):boolean {
  if(!isQuestionReminder(event)||event.source==='demo')return true;
  const session=event.sessionId?sessions[event.sessionId]:undefined;
  return session?.phase==='asking'&&(!event.turnId||event.turnId===session.turnId);
}
export function updateSessionActivities(previous: SessionActivities, event: PetEvent, _now=Date.now()): SessionActivities {
  const sessions = {...previous};
  // Anonymous tool notifications cannot establish a task identity. V41 could
  // leave a synthetic "codex" worker running after the real turn was aborted.
  if(sessions.codex?.phase==='working')delete sessions.codex;
  if(!event.sessionId && event.source!=='demo')return sessions;
  const key=event.sessionId || (event.source==='demo'?'demo':'codex');
  let current=sessions[key];
  const nativeStart=event.source==='codex-log'&&event.type==='work_started';
  const nativeContext=event.source==='codex-log'&&event.type==='work_progress';
  // Omitted metadata means unknown; an explicit undefined means unassigned.
  const projectIdIncluded=Object.prototype.hasOwnProperty.call(event,'projectId');
  const incomingProjectId=event.projectId?.trim()||undefined;
  if(current && event.turnId===current.turnId){
    const path=projectIdentity(event.projectPath);
    const acceptProjectId=projectIdIncluded&&(nativeContext||
      (nativeStart&&!current.nativeProjectIdConfirmed)||
      (event.source!=='codex-log'&&!current.nativeProjectIdConfirmed));
    // turn_context is the current directory. A delayed hook or replayed header
    // must not move an already confirmed turn back to an earlier directory.
    const keepNative=(event.source==='hook'||nativeStart)&&current.nativeProjectPath;
    current={...current,projectPath:keepNative?current.nativeProjectPath:path??current.projectPath,
      projectId:acceptProjectId?incomingProjectId:current.projectId,
      nativeProjectIdConfirmed:acceptProjectId&&(nativeStart||nativeContext)?true:current.nativeProjectIdConfirmed,
      nativeProjectPath:nativeContext?path??current.nativeProjectPath:current.nativeProjectPath,
      isSubagent:event.source==='codex-log'?event.isSubagent??current.isSubagent:current.isSubagent??event.isSubagent};
    sessions[key]=current;
  }
  // A turn context establishes directory metadata, not tool execution or an
  // approval result. Preserve the activity phase while accepting its identity.
  if(nativeContext)return sessions;
  const ended=current?.endedTurns ?? [];
  const terminal=['turn_ended','interrupted','task_complete'].includes(event.type);
  const different=!!(current?.turnId && event.turnId && current.turnId!==event.turnId);
  if(shouldIgnoreHookQuestion(sessions,event))return sessions;
  if(event.source==='hook'&&current?.nativeTurnId){
    // Hook timestamps describe delivery, not native turn order. They can enrich
    // the matching turn but cannot replace one established by native records.
    if(different||event.type==='work_started'||(terminal&&!event.turnId)){
      if(different&&terminal)sessions[key]={...current,endedTurns:[...new Set([...ended,event.turnId!])].slice(-64)};
      return sessions;
    }
  }
  // Record old terminal events without stopping a newer running turn.
  if(different && event.type!=='work_started') {
    if(terminal) sessions[key]={...current!,endedTurns:[...new Set([...ended,event.turnId!])].slice(-64)};
    return sessions;
  }
  if(nativeStart&&event.turnId===current?.turnId){
    const alreadyNative=current?.nativeTurnId===event.turnId;
    current={...current!,nativeTurnId:event.turnId,nativeStartedAt:current?.nativeStartedAt??event.createdAt};
    sessions[key]=current;
    if(alreadyNative)return sessions;
  }
  if(!terminal && event.turnId && ended.includes(event.turnId) && event.type!=='input_resolved') return sessions;
  if(event.type==='work_started'){
    const started=nativeStart?current?.nativeStartedAt:current?.startedAt;
    if(started&&Date.parse(event.createdAt)<Date.parse(started))return sessions;
    // A hook may have already reported this same native turn. Attach its
    // identity without replaying the start over a newer question/progress.
    if(nativeStart&&current?.turnId===event.turnId&&current.startedAt&&Date.parse(event.createdAt)<Date.parse(current.startedAt))return sessions;
  }
  let phase=current?.phase ?? 'idle',waitingFor=current?.waitingFor;
  let finished=current?.terminal ?? false;
  switch(event.type){
    case 'work_started': phase='working';waitingFor=undefined;finished=false;break;
    case 'work_progress':
      if(!current || finished || waitingFor==='input') return sessions;
      phase='working';waitingFor=undefined;break;
    case 'needs_input': phase='asking';waitingFor='input';break;
    case 'approval_needed':phase='asking';waitingFor=waitingFor==='input'?'input':'approval';break;
    case 'input_resolved':
      if(!current)return sessions;
      phase=finished?'idle':'working';waitingFor=undefined;break;
    case 'turn_ended':if(phase!=='asking')phase='idle';finished=true;break;
    case 'task_complete':
      if(phase!=='asking'||(event.outcome&&event.outcome!=='success')){phase='idle';waitingFor=undefined;}
      finished=true;break;
    case 'interrupted':phase='idle';waitingFor=undefined;finished=true;break;
    default:return sessions;
  }
  if(key!=='codex' && event.type==='work_started')delete sessions.codex;
  sessions[key]={phase,sessionId:key,turnId:event.turnId??current?.turnId,waitingFor,terminal:finished,
    endedTurns:terminal&&event.turnId?[...new Set([...ended,event.turnId])].slice(-64):ended,
    projectPath:current?.turnId===event.turnId?current?.projectPath??projectIdentity(event.projectPath):projectIdentity(event.projectPath)??current?.projectPath,
    projectId:current&&current.turnId===event.turnId?current.projectId:projectIdIncluded?incomingProjectId:current?.projectId,
    isSubagent:event.source==='codex-log'?event.isSubagent??current?.isSubagent:current?.isSubagent??event.isSubagent,
    nativeTurnId:nativeStart?event.turnId:current?.nativeTurnId,
    nativeStartedAt:nativeStart?event.createdAt:current?.nativeStartedAt,
    nativeProjectPath:nativeStart&&different?undefined:current?.nativeProjectPath,
    nativeProjectIdConfirmed:nativeStart&&different?projectIdIncluded:nativeStart&&projectIdIncluded?true:current?.nativeProjectIdConfirmed,
    startedAt:event.type==='work_started'?event.createdAt:current?.startedAt,updatedAt:event.createdAt};
  return sessions;
}
export function dominantActivity(sessions:SessionActivities):PetActivity {
  const active=Object.values(sessions).filter(x=>x.phase!=='idle'&&!x.isSubagent);
  const projects=new Set(active.filter(x=>x.phase==='working').flatMap(x=>
    x.projectId?[`project:${x.projectId}`]:x.projectPath?[`directory:${x.projectPath}`]:[]));
  active.sort((a,b)=>(b.phase==='asking'?2:1)-(a.phase==='asking'?2:1)||Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  const value=active[0]??{phase:'idle' as const,updatedAt:new Date().toISOString()};
  return {...value,workingProjectCount:projects.size,fullPower:value.phase==='working'&&projects.size>=2};
}
