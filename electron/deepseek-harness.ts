import { createHash } from 'node:crypto';
import type { CompletionOutcome, PetEventType } from '../shared/types';
import { DEEPSEEK_SESSION_PREFIX } from '../shared/agents.ts';

export { DEEPSEEK_SESSION_PREFIX } from '../shared/agents.ts';

/** Three missed five-second snapshots plus delivery time. No state is inferred from log age. */
export const DEEPSEEK_HARNESS_LEASE_MS = 20_000;
const EVENTS = new Set(['snapshot', 'agent/status', 'agent/disposed', 'turn/start', 'turn/end',
  'input/required', 'input/resolved', 'tool/call', 'tool/result']);
const REASONS = new Set(['completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked']);

export type DeepSeekInputKind = 'question' | 'approval';
export interface DeepSeekPendingInput { id: string; kind: DeepSeekInputKind }
export interface DeepSeekActiveTool { id: string; name: string }
/** Identity-only transport from the external Harness plugin; never carries tool arguments or answers. */
export interface DeepSeekHarnessEnvelope {
  version: 1;
  streamId: string;
  sessionId: string;
  sequence: number;
  time: number;
  turn: number;
  event: string;
  origin: 'main' | 'subagent';
  cwd?: string;
  status?: 'running' | 'asking' | 'idle';
  pendingInputs?: DeepSeekPendingInput[];
  activeTools?: DeepSeekActiveTool[];
  turnComplete?: boolean;
  reason?: string;
  errorCode?: string;
  callId?: string;
  kind?: DeepSeekInputKind;
  toolName?: string;
}

export interface DeepSeekHarnessEventInput {
  id: string;
  type: PetEventType;
  sessionId: string;
  turnId: string;
  projectPath?: string;
  project?: string;
  isSubagent?: boolean;
  nativeQuestion?: boolean;
  nativeCallId?: string;
  nativePendingInputIds?: string[];
  nativeTurnTerminal?: boolean;
  outcome?: CompletionOutcome;
  message?: string;
  replayed?: boolean;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const identity = (value: unknown, limit = 100): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= limit &&
  value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Validate before touching lifecycle or tool state. Unknown fields are deliberately discarded. */
export function parseDeepSeekHarnessEnvelope(raw: unknown): DeepSeekHarnessEnvelope | undefined {
  const p = record(raw);
  if (!p || p.version !== 1) return undefined;
  const streamId = identity(p.streamId), sessionId = identity(p.sessionId);
  const event = typeof p.event === 'string' && EVENTS.has(p.event) ? p.event : undefined;
  if (!streamId || !sessionId || !event || !integer(p.sequence) || !integer(p.turn) ||
      typeof p.time !== 'number' || !Number.isFinite(p.time) || p.time < 0 ||
      !Number.isFinite(new Date(p.time).getTime()) || !['main', 'subagent'].includes(p.origin as string)) return undefined;
  if (p.turn === 0 && !['snapshot', 'agent/status', 'agent/disposed'].includes(event)) return undefined;
  const out: DeepSeekHarnessEnvelope = { version: 1, streamId, sessionId, sequence: p.sequence,
    time: p.time, turn: p.turn, event, origin: p.origin as 'main' | 'subagent' };
  const cwd = identity(p.cwd, 1024);
  if (cwd) out.cwd = cwd;
  if (p.reason !== undefined) {
    if (typeof p.reason !== 'string' || !REASONS.has(p.reason)) return undefined;
    out.reason = p.reason;
  }
  const errorCode = identity(p.errorCode, 60);
  if (errorCode) out.errorCode = errorCode;
  if (p.turnComplete !== undefined) {
    if (typeof p.turnComplete !== 'boolean') return undefined;
    out.turnComplete = p.turnComplete;
  }
  if (event === 'snapshot' || event === 'agent/status') {
    if (!['running', 'asking', 'idle'].includes(p.status as string) ||
        !Array.isArray(p.pendingInputs) || p.pendingInputs.length > 256) return undefined;
    out.status = p.status as DeepSeekHarnessEnvelope['status'];
    out.pendingInputs = [];
    const seen = new Set<string>();
    for (const rawInput of p.pendingInputs) {
      const input = record(rawInput), id = identity(input?.id, 120);
      if (!input || !id || !['question', 'approval'].includes(input.kind as string) || seen.has(id)) return undefined;
      seen.add(id);
      out.pendingInputs.push({ id, kind: input.kind as DeepSeekInputKind });
    }
    if (out.status === 'asking' && !out.pendingInputs.length ||
        out.status !== 'asking' && out.pendingInputs.length ||
        out.status === 'idle' && out.turnComplete === false) return undefined;
    if (p.activeTools !== undefined) {
      if (!Array.isArray(p.activeTools) || p.activeTools.length > 256) return undefined;
      out.activeTools = [];
      const tools = new Set<string>();
      for (const rawTool of p.activeTools) {
        const tool = record(rawTool), id = identity(tool?.id, 120), name = identity(tool?.name, 80);
        if (!id || !name || tools.has(id)) return undefined;
        tools.add(id); out.activeTools.push({ id, name });
      }
    }
  }
  if (['input/required', 'input/resolved', 'tool/call', 'tool/result'].includes(event)) {
    const callId = identity(p.callId, 120);
    if (!callId) return undefined;
    out.callId = callId;
  }
  if (event === 'input/required') {
    if (!['question', 'approval'].includes(p.kind as string)) return undefined;
    out.kind = p.kind as DeepSeekInputKind;
  }
  if (event === 'tool/call' || event === 'tool/result') {
    const toolName = identity(p.toolName, 80);
    if (!toolName) return undefined;
    out.toolName = toolName;
  }
  if (event === 'turn/end' && !out.reason) return undefined;
  return out;
}

export function deepSeekProjectName(path?: string): string | undefined {
  return path?.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1);
}
/** Only an explicit native completed reason is success. Cancellation and yielding are distinct. */
export function deepSeekCompletionOutcome(reason?: string, errorCode?: string): CompletionOutcome {
  if (reason === 'error' && (errorCode === 'QUOTA' || errorCode === 'ACCOUNT_QUOTA')) return 'quota_exhausted';
  return reason === 'completed' ? 'success' : reason === 'error' || reason === 'max-tokens' ? 'failed' : 'interrupted';
}

interface SessionState {
  streamId: string;
  retired: Set<string>;
  sequence: number;
  turn: number;
  cwd?: string;
  isSubagent: boolean;
  pending: Map<string, DeepSeekInputKind>;
  resolved: Set<string>;
  terminal: boolean;
  outcome?: CompletionOutcome;
  lastSeen: number;
  leaseExpired: boolean;
}

/** Snapshots adopt streams; retired streams, old turns and duplicate transport sequence never mutate a newer task. */
export class DeepSeekHarnessAdapter {
  private sessions = new Map<string, SessionState>();

  translate(raw: unknown, now = Date.now()): DeepSeekHarnessEventInput[] {
    const p = parseDeepSeekHarnessEnvelope(raw);
    if (!p) return [];
    const sessionId = DEEPSEEK_SESSION_PREFIX + p.sessionId;
    let state = this.sessions.get(sessionId);
    const newStream = !state || state.streamId !== p.streamId;
    if (newStream) {
      if (p.event !== 'snapshot' || state?.retired.has(p.streamId) || state && p.turn < state.turn) return [];
      const retired = new Set(state?.retired);
      if (state) retired.add(state.streamId);
      state = { streamId: p.streamId, retired, sequence: -1, turn: p.turn, cwd: p.cwd,
        isSubagent: p.origin === 'subagent', pending: new Map(), resolved: new Set(), terminal: true, lastSeen: now, leaseExpired: false };
      this.sessions.set(sessionId, state);
    }
    if (!state || p.sequence <= state.sequence || p.turn < state.turn ||
        state.isSubagent !== (p.origin === 'subagent')) return [];
    // A transport sequence advances only after all identity checks have passed.
    // In particular an old-turn tool result cannot dismiss this turn's question.
    const newTurn = p.turn > state.turn;
    if (newTurn && !['snapshot', 'agent/status', 'turn/start'].includes(p.event)) return [];
    const wasLeaseExpired = state.leaseExpired;
    state.sequence = p.sequence;
    state.lastSeen = now;
    state.leaseExpired = false;
    if (p.cwd) state.cwd = p.cwd;
    if (newTurn) {
      state.turn = p.turn;
      state.pending.clear();
      state.resolved.clear();
      state.terminal = false;
      state.outcome = undefined;
    }
    const turnId = `turn:${p.turn}`;
    const base = () => ({ sessionId, turnId, projectPath: state!.cwd,
      project: deepSeekProjectName(state!.cwd), isSubagent: state!.isSubagent || undefined });
    // IDs are fixed width: main's 120-character ID limit cannot collapse long
    // opaque session, stream or call identities into the same dedupe key.
    const id = (type: string, callId = '') => 'deepseek:' + createHash('sha256')
      .update(JSON.stringify([p.sessionId, p.streamId, p.sequence, type, callId])).digest('hex');
    const out: DeepSeekHarnessEventInput[] = [];
    const sync = (replayed = true) => out.push({ ...base(), id: id('sync'), type: 'input_sync',
      nativePendingInputIds: [...state!.pending.keys()], nativeTurnTerminal: state!.terminal,
      outcome: state!.outcome, replayed });
    const start = (replayed: boolean) => out.push({ ...base(), id: id('start'), type: 'work_started', replayed });
    const resolve = (callId: string) => {
      state!.resolved.add(callId);
      if (!state!.pending.delete(callId)) return;
      out.push({ ...base(), id: id('resolved', callId), type: 'input_resolved', nativeCallId: callId });
    };
    // Lease cleanup describes a disconnected bridge, not a native turn end.
    // New real evidence may safely resume that same turn before its next poll.
    if (wasLeaseExpired && !newTurn && !['snapshot', 'agent/status', 'agent/disposed'].includes(p.event)) {
      state.terminal = false; state.outcome = undefined;
      start(true); sync();
    }

    switch (p.event) {
      case 'snapshot':
      case 'agent/status': {
        state.pending = new Map(p.pendingInputs!.map(input => [input.id, input.kind]));
        for (const id of state.pending.keys()) state.resolved.delete(id);
        state.terminal = p.turnComplete ?? p.status === 'idle';
        state.outcome = state.terminal && p.reason ? deepSeekCompletionOutcome(p.reason, p.errorCode) : undefined;
        // Always establish the native turn first: the pet may have persisted a
        // different turn before it restarted. The snapshot itself stays silent.
        start(true);
        sync();
        break;
      }
      case 'turn/start':
        // A duplicate native start must not clear a dialog opened in this turn.
        if (!newTurn) break;
        state.pending.clear(); state.resolved.clear(); state.terminal = false; state.outcome = undefined;
        start(false);
        break;
      case 'input/required': {
        if (state.pending.has(p.callId!) || state.resolved.has(p.callId!) ||
            state.terminal && state.outcome && state.outcome !== 'success') break;
        // Native async questions may outlive their requesting turn. Keep the
        // terminal flag so its eventual reply restores idle rather than work.
        state.pending.set(p.callId!, p.kind!);
        out.push({ ...base(), id: id('ask', p.callId), type: 'needs_input', nativeQuestion: true,
          nativeCallId: p.callId, message: p.kind === 'approval'
            ? 'DeepSeek Harness 需要你确认权限' : 'DeepSeek Harness 在等你回答' });
        break;
      }
      case 'input/resolved':
        resolve(p.callId!);
        break;
      case 'turn/end': {
        if (state.terminal) break;
        const outcome = deepSeekCompletionOutcome(p.reason, p.errorCode);
        // Successful async-question turns remain asking until their own reply;
        // cancellations and failures abandon their pending dialogs.
        if (outcome !== 'success') for (const callId of [...state.pending.keys()]) resolve(callId);
        state.terminal = true; state.outcome = outcome;
        out.push({ ...base(), id: id('end'), type: outcome === 'success' ? 'task_complete'
          : outcome === 'interrupted' ? 'interrupted' : 'turn_ended', outcome });
        break;
      }
      case 'agent/disposed':
        state.pending.clear(); state.terminal = true; state.outcome = 'interrupted';
        // Disposal is lifecycle cleanup, never a second completion or failure.
        sync();
        break;
    }
    return out;
  }

  /** A crashed or disconnected Harness process cannot keep the pet working indefinitely. */
  expire(now = Date.now()): DeepSeekHarnessEventInput[] {
    const out: DeepSeekHarnessEventInput[] = [];
    for (const [sessionId, state] of this.sessions) {
      if (state.leaseExpired || now - state.lastSeen <= DEEPSEEK_HARNESS_LEASE_MS) continue;
      if (state.terminal && !state.pending.size) continue;
      state.leaseExpired = true;
      state.pending.clear(); state.terminal = true; state.outcome = 'interrupted';
      out.push({ id: 'deepseek:lease:' + createHash('sha256')
        .update(JSON.stringify([sessionId, state.streamId, state.sequence])).digest('hex'),
      type: 'input_sync', sessionId, turnId: `turn:${state.turn}`, projectPath: state.cwd,
      project: deepSeekProjectName(state.cwd), isSubagent: state.isSubagent || undefined,
      nativePendingInputIds: [], nativeTurnTerminal: true, outcome: 'interrupted', replayed: true });
    }
    return out;
  }
}
