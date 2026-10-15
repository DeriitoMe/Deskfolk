import type { PetEvent } from '../shared/types';
import { shouldPresentLifecycleEvent, type SessionActivities, type SessionActivity } from '../shared/activity.ts';

/** Exclude bookkeeping and receipt timestamps that can change on stale events. */
export function sessionPresentationFingerprint(session:SessionActivity|undefined):string {
  if(!session)return 'unknown';
  return JSON.stringify([session.turnId,session.phase,session.terminal,session.terminalOutcome,session.waitingFor,
    [...session.pendingInputIds??[]].sort(),[...session.pendingApprovalIds??[]].sort()]);
}

/** Presentation follows the accepted session transition, not only its aggregate. */
export function shouldPresentAcceptedEvent(event:PetEvent,previous:SessionActivities,next:SessionActivities,
  aggregateChanged:boolean,now:number):boolean {
  if(event.type==='input_sync')return false;
  const key=event.sessionId||(event.source==='demo'?'demo':undefined);
  const before=key?previous[key]:undefined,after=key?next[key]:undefined;
  const sessionChanged=sessionPresentationFingerprint(before)!==sessionPresentationFingerprint(after);
  if(['turn_ended','task_complete','interrupted'].includes(event.type)){
    if(event.replayed===true||event.isSubagent)return false;
    if(event.source==='demo')return true;
    // Standalone verified milestones and explicit previews keep their existing
    // presentation; they cannot rewrite a named native session's task state.
    if(!key)return event.source==='mcp';
    // An older terminal may add endedTurns bookkeeping. It must not animate
    // failure or completion over this session's newer active turn.
    if(before?.turnId&&event.turnId!==before.turnId)return false;
    if(!after||after.isSubagent||!after.terminal||(event.turnId&&event.turnId!==after.turnId))return false;
    // Live appended evidence can be old by the time polling catches up. Its
    // real transition must still be visible without an age-based task guess.
    return sessionChanged;
  }
  return shouldPresentLifecycleEvent(event,aggregateChanged||sessionChanged,now);
}
