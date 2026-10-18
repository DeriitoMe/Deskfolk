import type { PetEvent } from '../shared/types';
import { hasNativeInputIdentity, isNativeLifecycleSource, isNativeQuestionReminder, isNativeRequestId } from '../shared/reminders.ts';

interface CurrentTurnQuestions {
  turnId: string;
  pending: Set<string>;
  resolved: Set<string>;
}

/** Questions seen in this pet process; completed historical turns stay in history. */
export class CurrentQuestionLedger {
  private sessions = new Map<string, CurrentTurnQuestions>();

  private turn(sessionId: string, turnId: string): CurrentTurnQuestions {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const current = { turnId, pending: new Set<string>(), resolved: new Set<string>() };
    this.sessions.set(sessionId, current);
    return current;
  }

  /** Called after the state reducer and reminder checks accept an event. */
  accepted(event: PetEvent): void {
    if (!isNativeLifecycleSource(event.source) || event.isSubagent ||
        !isNativeRequestId(event.sessionId) || !isNativeRequestId(event.turnId)) return;
    if (event.type === 'work_started') {
      if (this.sessions.get(event.sessionId)?.turnId !== event.turnId) {
        this.sessions.set(event.sessionId, {
          turnId: event.turnId, pending: new Set<string>(), resolved: new Set<string>(),
        });
      }
      return;
    }
    if (event.replayed === true) return;
    const question = isNativeQuestionReminder(event);
    const reply = event.type === 'input_resolved' && hasNativeInputIdentity(event);
    if (!question && !reply) return;
    const current = this.turn(event.sessionId, event.turnId);
    if (current.turnId !== event.turnId) return;
    const callId = event.nativeCallId!;
    if (reply) {
      current.pending.delete(callId);
      current.resolved.add(callId);
    } else if (!current.resolved.has(callId)) {
      current.pending.add(callId);
    }
  }

  /** Active native turns can restore pending questions; ended turns need current evidence. */
  filterSnapshot(event: PetEvent): PetEvent {
    if (event.type !== 'input_sync' || !['codex-log','deepseek-harness'].includes(event.source) || event.isSubagent ||
        !isNativeRequestId(event.sessionId) || !isNativeRequestId(event.turnId) ||
        !Array.isArray(event.nativePendingInputIds) || typeof event.nativeTurnTerminal !== 'boolean') {
      return event;
    }
    const current = this.turn(event.sessionId, event.turnId);
    // The main reducer rejects this older turn as well. It must not erase the
    // current process's evidence for the newer turn while doing so.
    if (current.turnId !== event.turnId) return event;
    const nativeIds = [...new Set(event.nativePendingInputIds.filter(isNativeRequestId))];
    // Harness sends a current, ordered projection of answerable calls. Local
    // lease cleanup can temporarily hide one without resolving it in Harness.
    if(event.source==='deepseek-harness'){
      current.pending=new Set(nativeIds);
      for(const id of nativeIds)current.resolved.delete(id);
      return {...event,nativePendingInputIds:nativeIds};
    }
    const pending = nativeIds.filter(id => !current.resolved.has(id) &&
      (!event.nativeTurnTerminal || current.pending.has(id)));
    for (const id of current.pending) {
      if (!pending.includes(id)) current.resolved.add(id);
    }
    current.pending = new Set(pending);
    return { ...event, nativePendingInputIds: pending };
  }
}
