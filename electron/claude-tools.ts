/**
 * Claude Code tool gestures, kept beside (not inside) the work-state reducer.
 *
 * Only the tool name and its opaque tool_use_id are read from the forwarded
 * hook payload. A gesture shows while the tool runs and for at least
 * CLAUDE_TOOL_MIN_HOLD_MS after it started, so a 50 ms edit is still visible
 * and rapid tool chains do not flicker between poses.
 *
 * Without a PreToolUse hook for these tools (older installs), PostToolUse
 * alone still produces a short gesture after the tool finished.
 */
import type {ToolGesture} from '../shared/types';
export type ClaudeToolGesture = ToolGesture;
export const CLAUDE_TOOL_MIN_HOLD_MS = 2400;
/** A missing PostToolUse (crash, Esc) must not pin a gesture forever. */
export const CLAUDE_TOOL_STALE_MS = 10 * 60_000;

const GESTURES: Record<string, ClaudeToolGesture> = {
  Bash: 'type', PowerShell: 'type',
  Edit: 'write', Write: 'write', MultiEdit: 'write', NotebookEdit: 'write',
};
/** Tool names whose PreToolUse the installer subscribes to. */
export const CLAUDE_GESTURE_TOOLS = Object.keys(GESTURES);

export function claudeToolGesture(toolName: unknown): ClaudeToolGesture | undefined {
  return typeof toolName === 'string' ? GESTURES[toolName] : undefined;
}

const ENDING = new Set(['PostToolUse', 'PostToolUseFailure', 'PermissionDenied']);
const CLEARING = new Set(['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']);

interface Mark { sessionId: string; gesture: ClaudeToolGesture; startedAt: number; until: number }

const text = (value: unknown, limit: number) =>
  typeof value === 'string' && value ? value.slice(0, limit) : undefined;

export class ClaudeToolTracker {
  /** Running tools by session + tool_use_id. */
  private running = new Map<string, Mark>();
  /** Most recent gesture per session, held for the minimum display time. */
  private held = new Map<string, Mark>();
  private prefix: string;
  constructor(prefix = 'claude-code:') { this.prefix = prefix; }

  /** Returns true when the payload could change the current gesture. */
  observe(raw: unknown, now: number): boolean {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const payload = raw as Record<string, unknown>;
    const hook = text(payload.hook_event_name, 60), native = text(payload.session_id, 100);
    if (!hook || !native) return false;
    const sessionId = this.prefix + native;
    if (CLEARING.has(hook) || (hook === 'Notification' && payload.notification_type === 'idle_prompt')) {
      return this.clear(sessionId);
    }
    const gesture = claudeToolGesture(payload.tool_name);
    if (!gesture) return false;
    const callId = text(payload.tool_use_id, 100);
    const key = `${sessionId}\n${callId ?? gesture}`;
    if (hook === 'PreToolUse') {
      const mark = { sessionId, gesture, startedAt: now, until: now + CLAUDE_TOOL_MIN_HOLD_MS };
      this.running.set(key, mark); this.held.set(sessionId, mark);
      return true;
    }
    if (!ENDING.has(hook)) return false;
    const started = this.running.get(key);
    this.running.delete(key);
    // Older installs only see the end of a tool: show it briefly afterwards.
    if (!started) this.held.set(sessionId, { sessionId, gesture, startedAt: now, until: now + CLAUDE_TOOL_MIN_HOLD_MS });
    return true;
  }

  private clear(sessionId: string): boolean {
    let changed = this.held.delete(sessionId);
    for (const [key, mark] of this.running) if (mark.sessionId === sessionId) { this.running.delete(key); changed = true; }
    return changed;
  }

  /** The newest gesture of a session that is still really working. */
  current(now: number, isWorking: (sessionId: string) => boolean): ClaudeToolGesture | null {
    let best: Mark | undefined;
    for (const [key, mark] of this.running) {
      if (now - mark.startedAt > CLAUDE_TOOL_STALE_MS) { this.running.delete(key); continue; }
      if (isWorking(mark.sessionId) && (!best || mark.startedAt > best.startedAt)) best = mark;
    }
    for (const [sessionId, mark] of this.held) {
      if (mark.until <= now) { this.held.delete(sessionId); continue; }
      if (isWorking(sessionId) && (!best || mark.startedAt > best.startedAt)) best = mark;
    }
    return best?.gesture ?? null;
  }

  /** When the next hold or stale limit expires, for a re-evaluation timer. */
  nextChangeAt(): number | undefined {
    const times = [...[...this.held.values()].map(mark => mark.until),
      ...[...this.running.values()].map(mark => mark.startedAt + CLAUDE_TOOL_STALE_MS)];
    return times.length ? Math.min(...times) : undefined;
  }
}
