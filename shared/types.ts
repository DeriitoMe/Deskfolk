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
