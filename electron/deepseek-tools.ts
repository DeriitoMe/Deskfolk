import type { ToolGesture } from '../shared/types';
import { DEEPSEEK_SESSION_PREFIX, DEEPSEEK_HARNESS_LEASE_MS, parseDeepSeekHarnessEnvelope } from './deepseek-harness.ts';

export const DEEPSEEK_TOOL_MIN_HOLD_MS = 2400;
export const DEEPSEEK_TOOL_STALE_MS = 10 * 60_000;
/** Native Harness tool identities, including long-lived terminal execution. */
const GESTURES: Readonly<Record<string, ToolGesture>> = {
  bash: 'type', terminal_open: 'type', terminal_send: 'type', edit: 'write', write: 'write',
};
export function deepSeekToolGesture(name: unknown): ToolGesture | undefined {
  return typeof name === 'string' && Object.hasOwn(GESTURES, name) ? GESTURES[name] : undefined;
}

interface Mark { sessionId: string; gesture: ToolGesture; startedAt: number; until: number }
interface Cursor { streamId: string; retired: Set<string>; sequence: number; turn: number; lastSeen: number;
  terminal: boolean; completed: Set<string> }

/** Actual tools/execute events drive gestures; model tool requests awaiting approval never do. */
export class DeepSeekToolTracker {
  private running = new Map<string, Mark>();
  private held = new Map<string, Mark>();
  private sessions = new Map<string, Cursor>();

  observe(raw: unknown, now = Date.now()): boolean {
    const p = parseDeepSeekHarnessEnvelope(raw);
    if (!p || p.origin === 'subagent') return false;
    const sessionId = DEEPSEEK_SESSION_PREFIX + p.sessionId;
    let cursor = this.sessions.get(sessionId);
    let changed = false;
    if (!cursor || cursor.streamId !== p.streamId) {
      if (p.event !== 'snapshot' || cursor?.retired.has(p.streamId) || cursor && p.turn < cursor.turn) return false;
      const retired = new Set(cursor?.retired);
      if (cursor) retired.add(cursor.streamId);
      changed = this.clear(sessionId);
      cursor = { streamId: p.streamId, retired, sequence: -1, turn: p.turn, lastSeen: now,
        terminal: p.status === 'idle' || p.turnComplete === true, completed: new Set() };
      this.sessions.set(sessionId, cursor);
    }
    if (p.sequence <= cursor.sequence || p.turn < cursor.turn) return false;
    const newTurn = p.turn > cursor.turn;
    if (newTurn && !['snapshot', 'agent/status', 'turn/start'].includes(p.event)) return false;
    cursor.sequence = p.sequence; cursor.lastSeen = now;
    if (newTurn) {
      cursor.turn = p.turn; cursor.terminal = false; cursor.completed.clear();
      changed = this.clear(sessionId) || changed;
    }
    if (p.event === 'snapshot' || p.event === 'agent/status') {
      cursor.terminal = p.status === 'idle' || p.turnComplete === true;
      if (p.status !== 'running' || p.turnComplete) return this.clear(sessionId) || changed;
      if (p.activeTools) {
        const existing = new Set(p.activeTools.map(tool => tool.id));
        for (const key of this.running.keys()) {
          if (key.startsWith(sessionId + '\n') && !existing.has(key.slice(sessionId.length + 1))) {
            this.running.delete(key); changed = true;
          }
        }
        for (const tool of p.activeTools) {
          const gesture = deepSeekToolGesture(tool.name), key = sessionId + '\n' + tool.id;
          if (!gesture || this.running.has(key)) continue;
          cursor.completed.delete(tool.id);
          const mark = { sessionId, gesture, startedAt: now, until: now + DEEPSEEK_TOOL_MIN_HOLD_MS };
          this.running.set(key, mark); this.held.set(sessionId, mark); changed = true;
        }
      }
      return changed;
    }
    if (p.event === 'turn/end' || p.event === 'agent/disposed') {
      cursor.terminal = true;
      return this.clear(sessionId) || changed;
    }
    if (p.event !== 'tool/call' && p.event !== 'tool/result') return changed;
    const gesture = deepSeekToolGesture(p.toolName);
    if (!gesture) return changed;
    const key = sessionId + '\n' + p.callId;
    if (p.event === 'tool/call') {
      if (cursor.terminal || cursor.completed.has(p.callId!) || this.running.has(key)) return changed;
      const mark = { sessionId, gesture, startedAt: now, until: now + DEEPSEEK_TOOL_MIN_HOLD_MS };
      this.running.set(key, mark); this.held.set(sessionId, mark);
      return true;
    }
    // Unlike older Claude hooks, Harness installs both execution wrappers.
    // A result alone cannot prove this instance observed a running tool.
    cursor.completed.add(p.callId!);
    return this.running.delete(key) || changed;
  }

  private clear(sessionId: string): boolean {
    let changed = this.held.delete(sessionId);
    for (const [key, mark] of this.running) if (mark.sessionId === sessionId) {
      this.running.delete(key); changed = true;
    }
    return changed;
  }

  current(now: number, isWorking: (sessionId: string) => boolean): ToolGesture | null {
    for (const [sessionId, cursor] of this.sessions) {
      if (now - cursor.lastSeen > DEEPSEEK_HARNESS_LEASE_MS) this.clear(sessionId);
    }
    let best: Mark | undefined;
    for (const [key, mark] of this.running) {
      if (now - mark.startedAt >= DEEPSEEK_TOOL_STALE_MS) { this.running.delete(key); continue; }
      if (isWorking(mark.sessionId) && (!best || mark.startedAt > best.startedAt)) best = mark;
    }
    for (const [sessionId, mark] of this.held) {
      if (mark.until <= now) { this.held.delete(sessionId); continue; }
      if (isWorking(sessionId) && (!best || mark.startedAt > best.startedAt)) best = mark;
    }
    return best?.gesture ?? null;
  }

  nextChangeAt(): number | undefined {
    const liveSessions = new Set([...this.running.values(), ...this.held.values()].map(mark => mark.sessionId));
    const times = [...[...this.held.values()].map(mark => mark.until),
      ...[...this.running.values()].map(mark => mark.startedAt + DEEPSEEK_TOOL_STALE_MS),
      ...[...liveSessions].map(sessionId => this.sessions.get(sessionId)!.lastSeen + DEEPSEEK_HARNESS_LEASE_MS + 1)];
    return times.length ? Math.min(...times) : undefined;
  }
}
