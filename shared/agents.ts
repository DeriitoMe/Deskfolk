import type { EventSource } from './types';
import type { SessionActivities } from './activity';

/**
 * Which coding agent the pet follows. Both agents are always tracked in the
 * background; this only decides what is presented (work state, bubbles,
 * celebrations, tool gestures, quota board), so switching back is immediate.
 */
export type FollowAgent = 'all' | 'codex' | 'claude';
export type AgentName = 'codex' | 'claude';
export const FOLLOW_AGENTS: FollowAgent[] = ['all', 'codex', 'claude'];
/** Session keys of Claude Code sessions; every other key belongs to Codex. */
export const CLAUDE_SESSION_PREFIX = 'claude-code:';

/** Demo/preview events belong to no agent and are always shown. */
export function eventAgent(source: EventSource): AgentName | undefined {
  return source === 'claude-code' ? 'claude' : source === 'demo' ? undefined : 'codex';
}
export function sessionAgent(sessionId: string): AgentName {
  return sessionId.startsWith(CLAUDE_SESSION_PREFIX) ? 'claude' : 'codex';
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
