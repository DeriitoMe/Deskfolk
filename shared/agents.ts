import type { EventSource } from './types';
import type { SessionActivities } from './activity';

/**
 * Which coding agent the pet follows. All agents are always tracked in the
 * background; this only decides what is presented (work state, bubbles,
 * celebrations, tool gestures, quota board), so switching back is immediate.
 */
export type FollowAgent = 'all' | AgentName;
export type AgentName = 'codex' | 'claude' | 'deepseek';
export const FOLLOW_AGENTS: FollowAgent[] = ['all', 'deepseek', 'codex', 'claude'];
/** Adapter namespaces keep sessions from different hosts distinct. */
export const CLAUDE_SESSION_PREFIX = 'claude-code:';
export const DEEPSEEK_SESSION_PREFIX = 'deepseek-harness:';

/** Demo/preview events belong to no agent and are always shown. */
export function eventAgent(source: EventSource): AgentName | undefined {
  return source === 'deepseek-harness' ? 'deepseek' :
    source === 'claude-code' ? 'claude' : source === 'demo' ? undefined : 'codex';
}
export function sessionAgent(sessionId: string): AgentName {
  return sessionId.startsWith(DEEPSEEK_SESSION_PREFIX) ? 'deepseek' :
    sessionId.startsWith(CLAUDE_SESSION_PREFIX) ? 'claude' : 'codex';
}
export function follows(choice: FollowAgent, agent: AgentName | undefined): boolean {
  return !agent || choice === 'all' || choice === agent;
}
export function normalizeFollowAgent(value: unknown, fallback: FollowAgent = 'all'): FollowAgent {
  return FOLLOW_AGENTS.includes(value as FollowAgent) ? value as FollowAgent : fallback;
}
/** Sessions whose agent is currently followed; the stored map is untouched. */
export function visibleSessions(sessions: SessionActivities, choice: FollowAgent): SessionActivities {
  if (choice === 'all') return sessions;
  return Object.fromEntries(Object.entries(sessions).filter(([key]) => sessionAgent(key) === choice));
}
