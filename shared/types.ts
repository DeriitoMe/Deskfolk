import type {CodexQuotaSnapshot} from './quota';
import type {FollowAgent} from './agents';

export type PetEventType =
  | "work_started"
  | "work_progress"
  | "approval_needed"
  | "approval_resolved"
  | "turn_ended"
  | "interrupted"
  | "stage_complete"
  | "task_complete"
  | "needs_input"
  | "input_resolved"
  | "input_sync"
  | "info";

export type EventSource = "hook" | "mcp" | "demo" | "codex-log" | "claude-code" | "deepseek-harness";
export type PetModel = "flat-chibi" | "hires-soft";
export type CompletionOutcome = "success" | "interrupted" | "failed" | "quota_exhausted";

export type ActivityPhase = "idle" | "working" | "asking";
/** Native agent tool gesture: typing for commands, writing for file edits. */
export type ToolGesture = "type" | "write";
export interface PetActivity {
  phase: ActivityPhase;
  sessionId?: string;
  updatedAt: string;
  workingProjectCount?: number;
  fullPower?: boolean;
  /** Activity-push presentation context; historical reconciliation is silent. */
  replayed?: boolean;
}

export interface PetEvent {
  id: string;
  source: EventSource;
  type: PetEventType;
  project?: string;
  projectPath?: string;
  /** Stable Codex sidebar project ID; display names and paths are not IDs. */
  projectId?: string;
  isSubagent?: boolean;
  task?: string;
  stage?: string;
  message?: string;
  createdAt: string;
  read: boolean;
  sessionId?: string;
  turnId?: string;
  questionId?: string;
  nativeQuestion?: boolean;
  nativeApproval?: boolean;
  nativeCallId?: string;
  /** Internal native-log reconciliation; never a user-facing notification. */
  nativePendingInputIds?: string[];
  nativeTurnTerminal?: boolean;
  /** A clean native completion or an explicitly verified task milestone. */
  outcome?: CompletionOutcome;
  /** Initial log catch-up; never replay a historical celebration. */
  replayed?: boolean;
}

export interface PetQuestion {
  id: string;
  title: string;
  options: string[];
  project: string;
  sessionId: string;
  turnId?: string;
  status: 'pending' | 'answered' | 'consumed' | 'cancelled' | 'expired';
  answer?: string;
  reason?: string;
  createdAt: number;
  lastPollAt: number;
  expiresAt: number;
}

export interface PetPreferences {
  model: PetModel;
  scale: number;
  idleDance: boolean;
  reducedMotion: boolean;
  bubbleSeconds: number;
  startWithCodex: boolean;
  /** Claude Code SessionStart hook may launch the pet when it is closed. */
  startWithClaudeCode: boolean;
  /** Which agent drives work state, bubbles and the quota board. */
  followAgent: FollowAgent;
  doNotDisturb: boolean;
  notificationsEnabled: boolean;
}

export interface ProjectDashboardData {
  capturedAt: string;
  bridgeReady: boolean;
  monitor: {
    state: 'starting' | 'watching' | 'unavailable' | 'disabled';
    lastPollAt: string | null;
    lastEventAt: string | null;
    observedSessions: number;
    discoveryPending: number;
  };
  approvalSupport: 'hook-ready' | 'not-observed' | 'native-questions-only';
  workingProjectCount: number;
  pendingRequestCount: number;
  projects: Array<{
    key: string; name: string; path?: string;
    state: 'working' | 'asking' | 'approval' | 'paused' | 'failed' | 'quota_exhausted' | 'completed' | 'idle';
    sessionCount: number; workingSessionCount: number;
    lastEventAt: string; lastEventLabel: string;
  }>;
  recentEvents: Array<{id: string; project?: string; label: string; createdAt: string}>;
  preferences: PetPreferences;
}

/** Connection summary shown in the settings card. */
export interface AgentConnections {
  codex: { state: 'starting' | 'watching' | 'unavailable' | 'disabled'; lastEventAt: string | null };
  claude: { hooksInstalled: boolean; lastEventAt: string | null };
  deepseek: { pluginInstalled: boolean; lastEventAt: string | null };
}

export interface PetBootstrap {
  preferences: PetPreferences;
  history: PetEvent[];
  bridgeReady: boolean;
  lastHookEventAt: string | null;
  lastMcpEventAt: string | null;
  activity: PetActivity;
  pendingReminder?: PetEvent;
  quota?: CodexQuotaSnapshot;
  agents?: AgentConnections;

}

export interface PetLayout { width:number;height:number;anchorX:number;anchorY:number;visible:{x:number;y:number;width:number;height:number};overlay:boolean; }
export interface PetBridge {
  onCursor(callback:(point:{x:number;y:number})=>void):()=>void;
  setLayout(layout:PetLayout):void;
  onViewport(callback:(viewport:{left:number;width:number})=>void):()=>void;
  getBootstrap(): Promise<PetBootstrap>;
  getProjects(): Promise<ProjectDashboardData>;
  getQuota(): Promise<CodexQuotaSnapshot>;
  refreshQuota(): Promise<CodexQuotaSnapshot>;
  onQuota(callback: (quota: CodexQuotaSnapshot) => void): () => void;
  onProjects(callback: (data: ProjectDashboardData) => void): () => void;
  /** Install onEvent first, then flush events accepted during document startup. */
  rendererReady(): Promise<{ok:boolean;delivered:number}>;
  savePreferences(patch: Partial<PetPreferences>): Promise<PetPreferences>;
  markRead(id: string): Promise<void>;
  sendTest(type: PetEventType): Promise<void>;
  openSettings(): void;
  openCodex(): Promise<{ok:boolean;error?:string}>;
  onTransform(callback: () => void): () => void;
  setMouseIgnored(ignored: boolean): void;
  moveWindow(dx: number, dy: number): void;
  onEvent(callback: (event: PetEvent) => void): () => void;
  onPreferences(callback: (preferences: PetPreferences) => void): () => void;
  onActivity(callback: (activity: PetActivity) => void): () => void;
  onTool(callback: (gesture: ToolGesture | null) => void): () => void;
}

declare global {
  interface Window {
    petBridge: PetBridge;
  }
}
