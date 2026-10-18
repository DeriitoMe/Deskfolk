import { randomUUID } from 'node:crypto';
import type { CompletionOutcome, PetEventType } from '../shared/types';

/**
 * Claude Code adapter.
 *
 * Claude Code has no local rollout log comparable to Codex JSONL; its official
 * hook events are the host's own lifecycle API, so they establish work here.
 * The forwarding script only sends the identity fields read below, never
 * prompts, assistant text, tool input or transcript contents.
 *
 * Mapping:
 * - UserPromptSubmit (main agent)        → work_started for a new turn
 * - PreToolUse AskUserQuestion           → needs_input (native question)
 * - Notification permission/elicitation  → needs_input (native dialog)
 * - PostToolUse/Failure, PermissionDenied,
 *   ElicitationResult                    → input_resolved for open dialogs
 * - Stop (main agent)                    → task_complete, success
 * - StopFailure                          → turn_ended, failed / quota_exhausted
 * - Notification idle_prompt while a turn
 *   is still running with nothing pending → interrupted (Esc does not fire Stop)
 * - SessionEnd while running             → interrupted
 */
export { CLAUDE_SESSION_PREFIX } from '../shared/agents.ts';
import { CLAUDE_SESSION_PREFIX } from '../shared/agents.ts';

const QUESTION_NOTIFICATIONS = new Set([
  'permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input',
]);
const QUOTA_FAILURES = new Set(['rate_limit', 'billing_error']);
const RESOLVING_EVENTS = new Set([
  'PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'ElicitationResult',
]);

export type ClaudeEventInput = {
  id: string;
  type: PetEventType;
  sessionId: string;
  turnId: string;
  projectPath?: string;
  project?: string;
  nativeQuestion?: boolean;
  nativeCallId?: string;
  outcome?: CompletionOutcome;
  message?: string;
};

interface ClaudeSessionState {
  turnId?: string;
  running: boolean;
  pending: Set<string>;
  cwd?: string;
  sequence: number;
}

const text = (value: unknown, limit = 200): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return clean ? Array.from(clean).slice(0, limit).join('') : undefined;
};

export function claudeProjectName(path?: string): string | undefined {
  if (!path) return undefined;
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1);
}

/** StopFailure's error category; read defensively across hook schema revisions. */
export function claudeFailureType(payload: Record<string, unknown>): string | undefined {
  const error = payload.error;
  const nested = error && typeof error === 'object' ? (error as Record<string, unknown>).type : undefined;
  return text(payload.error_type) ?? text(nested) ?? text(error) ?? text(payload.matcher);
}

export class ClaudeCodeAdapter {
  private sessions = new Map<string, ClaudeSessionState>();
  private makeId: () => string;
  constructor(makeId: () => string = randomUUID) { this.makeId = makeId; }

  private state(sessionId: string): ClaudeSessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { running: false, pending: new Set(), sequence: 0 };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  /** Translate one forwarded hook payload into zero or more pet event inputs. */
  translate(raw: unknown): ClaudeEventInput[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const payload = raw as Record<string, unknown>;
    const hook = text(payload.hook_event_name, 60);
    const nativeSession = text(payload.session_id, 100);
    if (!hook || !nativeSession) return [];
    const sessionId = CLAUDE_SESSION_PREFIX + nativeSession;
    const state = this.state(sessionId);
    const cwd = text(payload.cwd, 1024);
    if (cwd) state.cwd = cwd;
    // Subagent turns are part of the parent turn; they never start or end it.
    const subagent = !!text(payload.agent_id);
    const promptId = text(payload.prompt_id, 100);
    const base = () => ({ sessionId, turnId: state.turnId!, projectPath: state.cwd,
      project: claudeProjectName(state.cwd) });
    const out: ClaudeEventInput[] = [];
    const resolveAll = () => {
      if (!state.turnId) { state.pending.clear(); return; }
      for (const callId of state.pending) {
        out.push({ ...base(), id: `claude-code:resolved:${nativeSession}:${callId}`,
          type: 'input_resolved', nativeCallId: callId });
      }
      state.pending.clear();
    };
    const ask = (callId: string, message: string) => {
      if (!state.turnId) {
        // The pet started mid-turn: adopt the host's turn identity.
        state.turnId = promptId ?? `turn:${this.makeId()}`;
        state.running = true;
      }
      if (state.pending.has(callId)) return;
      state.pending.add(callId);
      out.push({ ...base(), id: `claude-code:ask:${nativeSession}:${callId}`, type: 'needs_input',
        nativeQuestion: true, nativeCallId: callId, message });
    };
    const finish = (type: PetEventType, outcome: CompletionOutcome) => {
      if (!state.turnId) return;
      resolveAll();
      if (promptId && promptId !== state.turnId) {
        // A delayed end for an older prompt; the reducer only records it.
        out.push({ ...base(), turnId: promptId, id: `claude-code:end:${nativeSession}:${promptId}`, type, outcome });
        return;
      }
      state.running = false;
      out.push({ ...base(), id: `claude-code:end:${nativeSession}:${state.turnId}`, type, outcome });
    };

    switch (hook) {
      case 'UserPromptSubmit': {
        if (subagent) break;
        resolveAll();
        state.turnId = promptId ?? `turn:${this.makeId()}`;
        state.running = true;
        out.push({ ...base(), id: `claude-code:start:${nativeSession}:${state.turnId}`, type: 'work_started' });
        break;
      }
      case 'PreToolUse': {
        if (text(payload.tool_name) !== 'AskUserQuestion') break;
        const callId = text(payload.tool_use_id, 100) ?? `ask:${++state.sequence}`;
        ask(callId, 'Claude Code 在等你回答');
        break;
      }
      case 'Notification': {
        const kind = text(payload.notification_type, 60);
        if (kind && QUESTION_NOTIFICATIONS.has(kind)) {
          // One open dialog at a time is shown by Claude Code; do not stack a
          // permission notice on top of an AskUserQuestion already pending.
          if (state.pending.size) break;
          ask(`${kind}:${++state.sequence}`, kind === 'permission_prompt'
            ? 'Claude Code 需要你确认权限' : 'Claude Code 在等你回答');
        } else if (kind === 'idle_prompt' && state.running && !state.pending.size) {
          finish('interrupted', 'interrupted');
        }
        break;
      }
      case 'Stop': {
        if (subagent) break;
        finish('task_complete', 'success');
        break;
      }
      case 'StopFailure': {
        if (subagent) break;
        const failure = claudeFailureType(payload);
        finish('turn_ended', failure && QUOTA_FAILURES.has(failure) ? 'quota_exhausted' : 'failed');
        break;
      }
      case 'SessionEnd': {
        if (state.running) finish('interrupted', 'interrupted');
        this.sessions.delete(sessionId);
        break;
      }
      default:
        if (RESOLVING_EVENTS.has(hook) && state.pending.size) resolveAll();
    }
    return out;
  }
}
