export type PetEventType =
  | "work_started"
  | "work_progress"
  | "approval_needed"
  | "turn_ended"
  | "interrupted"
  | "stage_complete"
  | "task_complete"
  | "needs_input"
  | "input_resolved"
  | "info";

export type EventSource = "hook" | "mcp" | "demo" | "codex-log";
export type PetModel = "flat-chibi" | "hires-soft";
export type CompletionOutcome = "success" | "interrupted" | "failed" | "quota_exhausted";

export type ActivityPhase = "idle" | "working" | "asking";
export interface PetActivity {
  phase: ActivityPhase;
  sessionId?: string;
  updatedAt: string;
  workingProjectCount?: number;
  fullPower?: boolean;
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
  nativeCallId?: string;
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
}

export interface PetBootstrap {
  preferences: PetPreferences;
  history: PetEvent[];
  bridgeReady: boolean;
  lastHookEventAt: string | null;
  lastMcpEventAt: string | null;
  activity: PetActivity;

}

export interface PetLayout { width:number;height:number;anchorX:number;anchorY:number;visible:{x:number;y:number;width:number;height:number};overlay:boolean; }
export interface PetBridge {
  onCursor(callback:(point:{x:number;y:number})=>void):()=>void;
  setLayout(layout:PetLayout):void;
  onViewport(callback:(viewport:{left:number;width:number})=>void):()=>void;
  getBootstrap(): Promise<PetBootstrap>;
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
}

declare global {
  interface Window {
    petBridge: PetBridge;
  }
}
