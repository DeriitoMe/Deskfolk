import type { CompletionOutcome, PetActivity, PetEvent, PetEventType } from './types';
import { hasNativeInputIdentity, isNativeQuestionReminder, isNativeRequestId, isQuestionReminder } from './reminders.ts';

export interface SessionActivity extends PetActivity {
  sessionId: string;
  turnId?: string;
  projectPath?: string;
  projectId?: string;
  isSubagent?: boolean;
  waitingFor?: 'input' | 'approval';
  /** Per-turn opaque identities; one reply cannot dismiss other requests. */
  pendingInputIds?: string[];
  pendingApprovalIds?: string[];
  resolvedInputIds?: string[];
  terminalOutcome?: CompletionOutcome;
  lastEventType?: PetEventType;
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

/** IDs retained here must belong to the current native turn, never a placeholder. */
export function pendingNativeInputIds(session?: SessionActivity): string[] {
  if(!session || session.isSubagent || session.sessionId==='demo' ||
    !isNativeRequestId(session.sessionId) || !isNativeRequestId(session.turnId) ||
    session.nativeTurnId!==session.turnId)return [];
  return [...new Set((session.pendingInputIds??[]).filter(id=>isNativeRequestId(id)&&
    !session.resolvedInputIds?.includes(id)))];
}
/** Migrate pet state only; native logs later reconcile the surviving opaque IDs. */
export function sanitizeStoredActivities(previous: SessionActivities): SessionActivities {
  return Object.fromEntries(Object.entries(previous).map(([key,session])=>{
    const inputs=pendingNativeInputIds(session);
    const phase=session.phase==='asking'&&!inputs.length||session.sessionId==='demo'?'idle':session.phase;
    return [key,{...session,phase,waitingFor:phase==='asking'&&inputs.length?'input':undefined,
      pendingInputIds:inputs,pendingApprovalIds:[],
      resolvedInputIds:[...new Set((session.resolvedInputIds??[]).filter(isNativeRequestId))]}];
  }));
}

/** Hooks can enrich a known native turn; its lifecycle establishes work. */
export function isUnconfirmedHookWork(sessions: SessionActivities, event: PetEvent): boolean {
  if(event.source!=='hook'||!['work_started','work_progress'].includes(event.type))return false;
  const session=event.sessionId?sessions[event.sessionId]:undefined;
  return !event.turnId||session?.nativeTurnId!==event.turnId;
}

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
  return !(session?.phase==='asking'&&session.turnId===event.turnId&&pendingNativeInputIds(session).length);
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
  if(event.type==='input_sync')return false;
  if(['needs_input','approval_needed'].includes(event.type))return isQuestionReminder(event)&&event.replayed!==true;
  if(event.source!=='codex-log')return true;
  if(['turn_ended','task_complete'].includes(event.type)&&event.outcome==='success')return isSuccessfulCompletion(event);
  // A new question call is meaningful even if this session was already asking.
  // The renderer dedupes the call ID so reconciliation cannot renew its deadline.
  return stateChanged&&now-Date.parse(event.createdAt)<=10_000;
}
export function shouldDeliverPetEvent(event:PetEvent,activity:PetActivity):boolean {
  return event.type!=='work_progress'&&event.type!=='input_sync'&&
    (!['needs_input','approval_needed'].includes(event.type)||isQuestionReminder(event))&&
    (event.type!=='turn_ended'||activity.phase==='idle'||isSuccessfulCompletion(event)||
      !!event.outcome&&['interrupted','failed','quota_exhausted'].includes(event.outcome));
}
/** Loading can outlast a question; show only reminders still pending at flush. */
export function shouldDeliverBufferedEvent(sessions:SessionActivities,event:PetEvent):boolean {
  if(event.type==='input_sync')return false;
  if(!['needs_input','approval_needed'].includes(event.type))return true;
  if(event.source==='demo')return isQuestionReminder(event);
  if(!isNativeQuestionReminder(event))return false;
  const session=event.sessionId?sessions[event.sessionId]:undefined;
  return session?.phase==='asking'&&event.turnId===session.turnId&&
    pendingNativeInputIds(session).includes(event.nativeCallId!);
}
export function updateSessionActivities(previous: SessionActivities, event: PetEvent, _now=Date.now()): SessionActivities {
  const sessions = {...previous};
  if(event.source==='demo')return sessions;
  if(event.type==='approval_needed'||event.type==='approval_resolved')return sessions;
  if(event.type==='needs_input'&&!isNativeQuestionReminder(event))return sessions;
  if(event.type==='input_resolved'&&!hasNativeInputIdentity(event))return sessions;
  const inputSync=event.type==='input_sync';
  if(inputSync&&(event.source!=='codex-log'||event.isSubagent||!isNativeRequestId(event.sessionId)||
    !isNativeRequestId(event.turnId)||!Array.isArray(event.nativePendingInputIds)||
    typeof event.nativeTurnTerminal!=='boolean'))return sessions;
  // Anonymous tool notifications cannot establish a task identity. V41 could
  // leave a synthetic "codex" worker running after the real turn was aborted.
  if(sessions.codex?.phase==='working')delete sessions.codex;
  if(!event.sessionId)return sessions;
  const key=event.sessionId;
  let current=sessions[key];
  if((event.type==='needs_input'||event.type==='input_resolved'||inputSync)&&current?.isSubagent)return sessions;
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
  if(!terminal && event.turnId && ended.includes(event.turnId) && event.type!=='input_resolved'&&!inputSync) return sessions;
  if(event.type==='work_started'){
    const started=nativeStart?current?.nativeStartedAt:current?.startedAt;
    if(started&&Date.parse(event.createdAt)<Date.parse(started))return sessions;
    // A hook may have already reported this same native turn. Attach its
    // identity without replaying the start over a newer question/progress.
    if(nativeStart&&current?.turnId===event.turnId&&current.startedAt&&Date.parse(event.createdAt)<Date.parse(current.startedAt))return sessions;
    if(current?.turnId===event.turnId&&current.startedAt)return sessions;
  }
  let phase=current?.phase ?? 'idle',waitingFor=current?.waitingFor;
  let finished=current?.terminal ?? false;
  let inputs=pendingNativeInputIds(current);
  let resolvedInputs=[...(current?.resolvedInputIds??[])];
  const requestId=event.nativeCallId!;
  const add=(values:string[],value:string)=>[...new Set([...values,value])];
  const restore=()=>{waitingFor=inputs.length?'input':undefined;phase=waitingFor?'asking':finished?'idle':'working';};
  switch(event.type){
    case 'work_started': phase='working';waitingFor=undefined;finished=false;inputs=[];resolvedInputs=[];break;
    case 'work_progress':
      if(!current || finished || inputs.length) return sessions;
      phase='working';waitingFor=undefined;break;
    case 'needs_input':
      if(resolvedInputs.includes(requestId))return sessions;
      inputs=add(inputs,requestId);restore();break;
    case 'input_resolved':
      if(!current)return sessions;
      inputs=inputs.filter(id=>id!==requestId);resolvedInputs=add(resolvedInputs,requestId).slice(-256);restore();break;
    case 'input_sync':
      const nativeInputs=[...new Set(event.nativePendingInputIds!.filter(isNativeRequestId))];
      // The complete native snapshot takes precedence over older cached replies.
      resolvedInputs=[...new Set([...resolvedInputs,...inputs.filter(id=>!nativeInputs.includes(id))])]
        .filter(id=>!nativeInputs.includes(id)).slice(-256);
      inputs=nativeInputs;
      finished=event.nativeTurnTerminal!;restore();break;
    case 'turn_ended':
      finished=true;
      if(event.outcome&&event.outcome!=='success')inputs=[];
      restore();break;
    case 'task_complete':
      finished=true;
      if(event.outcome&&event.outcome!=='success')inputs=[];
      restore();break;
    case 'interrupted':phase='idle';waitingFor=undefined;finished=true;inputs=[];break;
    default:return sessions;
  }
  if(key!=='codex' && event.type==='work_started')delete sessions.codex;
  sessions[key]={phase,sessionId:key,turnId:event.turnId??current?.turnId,waitingFor,terminal:finished,
    pendingInputIds:inputs,pendingApprovalIds:[],resolvedInputIds:resolvedInputs,
    terminalOutcome:inputSync?(finished?event.outcome??current?.terminalOutcome:undefined):terminal?event.outcome??current?.terminalOutcome:event.type==='work_started'?undefined:current?.terminalOutcome,
    lastEventType:inputSync?current?.lastEventType:event.type,
    endedTurns:inputSync?(finished?[...new Set([...ended,event.turnId!])].slice(-64):ended.filter(id=>id!==event.turnId)):terminal&&event.turnId?[...new Set([...ended,event.turnId])].slice(-64):ended,
    projectPath:current?.turnId===event.turnId?current?.projectPath??projectIdentity(event.projectPath):projectIdentity(event.projectPath)??current?.projectPath,
    projectId:current&&current.turnId===event.turnId?current.projectId:projectIdIncluded?incomingProjectId:current?.projectId,
    isSubagent:event.source==='codex-log'?event.isSubagent??current?.isSubagent:current?.isSubagent??event.isSubagent,
    nativeTurnId:nativeStart||inputSync||event.type==='needs_input'||event.type==='input_resolved'?event.turnId:current?.nativeTurnId,
    nativeStartedAt:nativeStart?event.createdAt:current?.nativeStartedAt,
    nativeProjectPath:nativeStart&&different?undefined:current?.nativeProjectPath,
    nativeProjectIdConfirmed:nativeStart&&different?projectIdIncluded:nativeStart&&projectIdIncluded?true:current?.nativeProjectIdConfirmed,
    startedAt:event.type==='work_started'?event.createdAt:current?.startedAt,updatedAt:event.createdAt};
  return sessions;
}
export function dominantActivity(sessions:SessionActivities):PetActivity {
  const active=Object.values(sessions).filter(x=>x.phase!=='idle'&&!x.isSubagent&&x.sessionId!=='demo'&&
    (x.phase!=='asking'||pendingNativeInputIds(x).length));
  const projects=new Set(active.filter(x=>x.phase==='working').flatMap(x=>
    x.projectId?[`project:${x.projectId}`]:x.projectPath?[`directory:${x.projectPath}`]:[]));
  active.sort((a,b)=>(b.phase==='asking'?2:1)-(a.phase==='asking'?2:1)||Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  const value=active[0]??{phase:'idle' as const,updatedAt:new Date().toISOString()};
  return {...value,workingProjectCount:projects.size,fullPower:value.phase==='working'&&projects.size>=2};
}
