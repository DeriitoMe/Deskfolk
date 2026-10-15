import type {PetEvent,PetPreferences} from './types';
import {FEEDBACK_SECONDS} from './companion-feedback.ts';
export type FeedbackKind='failed'|'paused'|'quota';
export function remindersEnabled(preferences:Pick<PetPreferences,'doNotDisturb'|'notificationsEnabled'>|null):boolean {
  return !preferences?.doNotDisturb&&preferences?.notificationsEnabled!==false;
}
export function feedbackKind(event:PetEvent):FeedbackKind|undefined {
  if(event.replayed||event.isSubagent||!['interrupted','task_complete','turn_ended'].includes(event.type))return;
  if(event.outcome==='failed')return 'failed';
  if(event.outcome==='quota_exhausted')return 'quota';
  if(event.type==='interrupted'||event.outcome==='interrupted')return 'paused';
}
export class OutcomeFeedbackQueue {
  private seen=new Set<string>();
  private pending:Array<{event:PetEvent;kind:FeedbackKind}>=[];
  enqueue(event:PetEvent):boolean {
    const kind=feedbackKind(event);if(!kind)return false;
    const key=event.sessionId&&event.turnId?`${event.sessionId}|${event.turnId}|${kind}`:event.id;
    if(this.seen.has(key))return false;this.seen.add(key);
    if(this.seen.size>512)this.seen.delete(this.seen.values().next().value!);
    this.pending.push({event,kind});if(this.pending.length>8)this.pending.shift();return true;
  }
  takeNext(){return this.pending.shift();}
  clear(){this.pending=[];}
  clearSession(sessionId?:string){if(sessionId)this.pending=this.pending.filter(item=>item.event.sessionId!==sessionId);}
}
export function feedbackDuration(kind:FeedbackKind){return FEEDBACK_SECONDS[kind]*1000;}
