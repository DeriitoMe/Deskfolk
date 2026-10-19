import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from "electron";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AgentConnections,
  EventSource,
  PetLayout,
  PetBootstrap,
  PetActivity,
  PetEvent,
  PetEventType,
  PetPreferences,
  PetModel,
  ToolGesture,
  CompletionOutcome,
  ProjectDashboardData,
} from "../shared/types";
import { dominantActivity, isSuccessfulCompletion, isUnconfirmedHookWork, sanitizeStoredActivities, shouldCelebrateCompletion, shouldDeliverBufferedEvent, shouldDeliverPetEvent, shouldIgnoreHookQuestion, successfulCompletionIdentity, updateSessionActivities, type SessionActivities } from "../shared/activity";
import { activateCodex } from './codex-window';
import { isQuestionReminder } from '../shared/reminders';
import { CodexLifecycleObserver } from './codex-lifecycle';
import { presentationPolicy } from '../shared/runtime-policy';
import { syncCodexStartup } from './codex-startup';
import { RendererEventQueue } from './renderer-events';
import {shouldPresentAcceptedEvent} from './event-presentation';
import {CurrentQuestionLedger} from './current-questions';
import {projectDashboard} from '../shared/project-dashboard';
import {CodexQuotaMonitor} from './codex-quota';
import {parseClaudeQuota,selectQuota,unknownClaudeQuota,unknownCodexQuota,unknownDeepSeekQuota,type CodexQuotaSnapshot} from '../shared/quota';
import {ClaudeCodeAdapter} from './claude-code';
import {ClaudeToolTracker} from './claude-tools';
import {DeepSeekHarnessAdapter,parseDeepSeekHarnessEnvelope} from './deepseek-harness';
import {DeepSeekToolTracker} from './deepseek-tools';
import {DEFAULT_FOLLOW_AGENT,eventAgent,follows,normalizeFollowAgent,visibleSessions,type AgentName} from '../shared/agents';

const APP_NAME = "Deskfolk";
// Keep the existing data directory and bridge identifier during the branding update.
const APP_DIR_NAME = "liquid-glass-pet";
const ICON_DIRECTORY = join(__dirname, '../../assets/icons');
const APPLICATION_ICON = join(ICON_DIRECTORY, 'deskfolk.ico');
const ALLOWED_TYPES = new Set<PetEventType>([
  "work_started",
  "work_progress",
  "approval_needed",
  "approval_resolved",
  "turn_ended",
  "interrupted",
  "stage_complete",
  "task_complete",
  "needs_input",
  "input_resolved",
  "info",
]);
const DEFAULT_PREFERENCES: PetPreferences = {
  model: "flat-chibi",
  scale: 1,
  idleDance: true,
  reducedMotion: false,
  bubbleSeconds: 8,
  startWithCodex: true,
  startWithClaudeCode: true,
  followAgent: DEFAULT_FOLLOW_AGENT,
  doNotDisturb: false,
  notificationsEnabled: true,
};

app.setName(APP_NAME);
app.setPath("userData", process.env.PET_USER_DATA || join(app.getPath("appData"), APP_DIR_NAME));

const userDataPath = app.getPath("userData");
const preferencesPath = join(userDataPath, "preferences.json");
const historyPath = join(userDataPath, "history.json");
const bridgePath = join(userDataPath, "bridge.json");
const activityPath = join(userDataPath, "activity.json");
const claudeQuotaPath = join(userDataPath, "claude-quota.json");

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let projectsWindow: BrowserWindow | null = null;
const rendererEvents=new RendererEventQueue(event=>mainWindow?.webContents.send('pet:event',event));
/** Aggregate of the followed agent(s); every session is still tracked. */
function currentActivity() { return dominantActivity(visibleSessions(sessionActivities,preferences.followAgent)); }
function currentProjects():ProjectDashboardData {
  return projectDashboard(sessionActivities,history,{preferences,bridgeReady:!!bridgeServer?.listening,
    monitor:lifecycle?.getHealth()??{state:process.env.PET_TEST_MODE==='1'?'disabled':'starting',lastPollAt:null,lastEventAt:null,observedSessions:0,discoveryPending:0},
    projectName:id=>lifecycle?.getProjectName(id)});
}
function sendProjects(){if(projectsWindow&&!projectsWindow.isDestroyed())projectsWindow.webContents.send('pet:projects',currentProjects());}
let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let bridgeServer: Server | null = null;
let accessToken = "";
let preferences = { ...DEFAULT_PREFERENCES };
let preferenceSaveQueue: Promise<PetPreferences | void> = Promise.resolve();
let history: PetEvent[] = [];
let sessionActivities: SessionActivities = {};
const successfulCompletions=new Set<string>();
const currentQuestions=new CurrentQuestionLedger();
let lifecycle: CodexLifecycleObserver | undefined;
let quotaMonitor: CodexQuotaMonitor | undefined;
const claudeCode=new ClaudeCodeAdapter();
/** Typing/writing gestures for Claude Code tools; separate from work state. */
const claudeTools=new ClaudeToolTracker();
const deepSeekHarness=new DeepSeekHarnessAdapter();
const deepSeekTools=new DeepSeekToolTracker();
let deepSeekLeaseTimer:ReturnType<typeof setInterval>|undefined;
let sentTool:ToolGesture|null=null;let toolTimer:ReturnType<typeof setTimeout>|undefined;
function sendTool(force=false){
  const now=Date.now(),isWorking=(id:string)=>sessionActivities[id]?.phase==='working';
  const follow=preferences.followAgent;
  const gesture=follow==='claude'?claudeTools.current(now,isWorking):follow==='deepseek'?deepSeekTools.current(now,isWorking):null;
  clearTimeout(toolTimer);toolTimer=undefined;
  const deadlines=[claudeTools.nextChangeAt(),deepSeekTools.nextChangeAt()].filter((value):value is number=>value!==undefined);
  const next=deadlines.length?Math.min(...deadlines):undefined;
  if(next!==undefined)toolTimer=setTimeout(()=>sendTool(),Math.max(50,next-now+10));
  if(gesture===sentTool&&!force)return;
  sentTool=gesture;mainWindow?.webContents.send('pet:tool',gesture);
}
/** Last Claude Code five-hour reading from its status line; null until seen. */
let claudeQuota: CodexQuotaSnapshot | null = null;
/** Which agent started work most recently; only primes the Claude quota placeholder. */
let lastAgent: AgentName | undefined;
function quotaSnapshot(): CodexQuotaSnapshot {
  const codex=quotaMonitor?.snapshot()??unknownCodexQuota();
  const follow=preferences.followAgent;
  if(follow==='deepseek')return unknownDeepSeekQuota();
  return selectQuota(codex,follow==='claude'?claudeQuota??unknownClaudeQuota():claudeQuota,follow==='claude');
}
function sendQuota(){mainWindow?.webContents.send('pet:quota',quotaSnapshot());}
function noteAgent(agent:AgentName){
  if(lastAgent===agent)return;
  lastAgent=agent;
  if(agent==='claude'&&!claudeQuota)claudeQuota=unknownClaudeQuota();
  sendQuota();
}
const knownSessions=new Set<string>();
let isQuitting = false;
let lastHookEventAt: string | null = null;
/** Last valid Claude Code hook payload, shown as the connection status. */
let lastClaudeEventAt: string | null = null;
let lastDeepSeekEventAt: string | null = null;
let lastMcpEventAt: string | null = null;
let lastDedupSignature = "";
let lastDedupAt = 0;
let dragPosition: { x: number; y: number } | null = null;
let mouseIgnored = true;
let petLayout: PetLayout | null = null;
let layoutAnchorWorld: {x:number;y:number} | null = null;
let layoutPositionTimer:ReturnType<typeof setTimeout>|undefined;
let layoutPositionTarget:{x:number;y:number}|undefined;
function sendViewport(){
 if(!mainWindow||mainWindow.isDestroyed())return;
 const b=mainWindow.getBounds(),area=screen.getDisplayMatching(b).workArea;
 const left=Math.max(0,area.x-b.x),right=Math.min(b.width,area.x+area.width-b.x);
 mainWindow.webContents.send('pet:viewport',{left,width:Math.max(0,right-left)});
}
let positionSaveTimer: ReturnType<typeof setTimeout> | undefined;

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  mkdirSync(userDataPath, { recursive: true });
  const contents = JSON.stringify(value, null, 2);
  const temporaryPath = filePath + "." + process.pid + "." + randomUUID() + ".tmp";
  writeFileSync(temporaryPath, contents, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    renameSync(temporaryPath, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || !["EXDEV", "EPERM", "EACCES", "EEXIST", "EBUSY"].includes(code ?? "")) {
      throw error;
    }
    writeFileSync(filePath, contents, { encoding: "utf8", mode: 0o600 });
    try {
      unlinkSync(temporaryPath);
    } catch (cleanupError) {
      console.warn("Deskfolk could not remove a temporary JSON file:", cleanupError);
    }
  }
}

function sanitizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return result ? Array.from(result).slice(0, maxLength).join("") : undefined;
}

function normalizePreferences(input: Partial<PetPreferences>): PetPreferences {
  const allowedModels: PetModel[] = ["flat-chibi", "hires-soft"];
  const model = presentationPolicy.qOnly ? 'flat-chibi' : allowedModels.includes(input.model as PetModel)
    ? (input.model as PetModel)
    : preferences.model;
  const minScale = model === "flat-chibi" ? 0.7 : 0.82;
  const maxScale = model === "flat-chibi" ? 1.6 : 1.3;
  const selectedScale = typeof input.scale === "number" && Number.isFinite(input.scale)
    ? input.scale : preferences.scale;
  const scale = Math.min(maxScale, Math.max(minScale, selectedScale));
  const bubbleSeconds = typeof input.bubbleSeconds === "number"
    ? Math.min(15, Math.max(5, Math.round(input.bubbleSeconds)))
    : preferences.bubbleSeconds;
  return {
    model,
    scale,
    idleDance: typeof input.idleDance === "boolean" ? input.idleDance : preferences.idleDance,
    reducedMotion: typeof input.reducedMotion === "boolean"
      ? input.reducedMotion
      : preferences.reducedMotion,
    bubbleSeconds,
    startWithCodex:typeof input.startWithCodex==='boolean'?input.startWithCodex:preferences.startWithCodex,
    startWithClaudeCode:typeof input.startWithClaudeCode==='boolean'?input.startWithClaudeCode:preferences.startWithClaudeCode,
    followAgent:normalizeFollowAgent(input.followAgent,preferences.followAgent),
    doNotDisturb:typeof input.doNotDisturb==='boolean'?input.doNotDisturb:preferences.doNotDisturb,
    notificationsEnabled:typeof input.notificationsEnabled==='boolean'?input.notificationsEnabled:preferences.notificationsEnabled,
  };
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function makeEvent(input: Record<string, unknown>, source: EventSource): PetEvent | null {
  const type = input.type;
  if (typeof type !== "string" || (!ALLOWED_TYPES.has(type as PetEventType) && !(source==='deepseek-harness'&&type==='input_sync'))) return null;
  const outcomes:CompletionOutcome[]=['success','interrupted','failed','quota_exhausted'];
  const error=input.error as {codex_error_info?:unknown}|undefined;
  const outcome:CompletionOutcome|undefined=error?(error.codex_error_info==='usage_limit_exceeded'?'quota_exhausted':'failed'):
    outcomes.includes(input.outcome as CompletionOutcome)?input.outcome as CompletionOutcome:
    type==='interrupted'?'interrupted':type==='task_complete'&&(source==='mcp'||source==='demo')?'success':undefined;
  // Existing installed hooks already embed tool_use_id in their event ID.
  // Read it before trimming the ID, so their native reconciliation shares the
  // same reminder deadline without requiring a plugin reinstall.
  const legacyCallId=source==='hook'&&['needs_input','input_resolved'].includes(type)&&
    typeof input.id==='string'&&input.id.startsWith('hook:'+type+':')?input.id.split(':').at(-1):undefined;
  return {
    id: sanitizeText(input.id, 120) ?? randomUUID(),
    source,
    type: type as PetEventType,
    project: sanitizeText(input.project, 80),
    projectPath: sanitizeText(input.projectPath, 1024),
    isSubagent: input.isSubagent === true || input.is_subagent === true ? true : undefined,
    task: sanitizeText(input.task, 100),
    stage: sanitizeText(input.stage, 80),
    message: sanitizeText(input.message, 240),
    sessionId: sanitizeText(input.sessionId, 120),
    turnId: sanitizeText(input.turnId, 120),
    questionId: sanitizeText(input.questionId, 120),
    nativeQuestion: input.nativeQuestion === true,
    nativeApproval: input.nativeApproval === true,
    nativeCallId: sanitizeText(input.nativeCallId??legacyCallId, 120),
    nativePendingInputIds:source==='deepseek-harness'&&Array.isArray(input.nativePendingInputIds)
      ?input.nativePendingInputIds.map(id=>sanitizeText(id,120)).filter((id):id is string=>!!id):undefined,
    nativeTurnTerminal:source==='deepseek-harness'&&typeof input.nativeTurnTerminal==='boolean'?input.nativeTurnTerminal:undefined,
    outcome,
    replayed: input.replayed === true,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

function eventSignature(event: PetEvent): string {
  return [event.type, event.sessionId, event.turnId, event.questionId, event.nativeCallId, event.outcome, event.project ?? "", event.stage ?? "", event.message ?? ""].join("|");
}

function acceptEvent(event: PetEvent): void {
  if(event.source!=='deepseek-harness'&&event.source!=='claude-code')lifecycle?.track(event.sessionId);
  // A prompt hook may use an auxiliary session ID that has no native rollout.
  // Track it for discovery, and let actual task_started evidence activate work.
  if(isUnconfirmedHookWork(sessionActivities,event))return;
  if (['needs_input','approval_needed'].includes(event.type) && !isQuestionReminder(event)) return;
  // Startup question/reply replay is represented by the complete native
  // snapshot. Intermediate historical calls cannot confirm a current prompt.
  if(event.replayed&&['needs_input','input_resolved'].includes(event.type))return;
  if(shouldIgnoreHookQuestion(sessionActivities,event))return;
  event=currentQuestions.filterSnapshot(event);
  const session=event.sessionId?sessionActivities[event.sessionId]:undefined;
  if(isSuccessfulCompletion(event)&&session&&(!event.turnId||event.turnId===session.turnId)){
    // A verified MCP milestone may omit turn_id; attach the known native turn
    // so its eventual clean completion cannot trigger a second celebration.
    event={...event,turnId:event.turnId??session.turnId,
      projectPath:session.nativeProjectPath??event.projectPath??session.projectPath,
      isSubagent:session.isSubagent??event.isSubagent};
  }
  const now = Date.now();
  if (event.source === "hook" && event.type !== "work_progress" &&
      history.some((item) => item.id === event.id)) return;
  const signature = eventSignature(event);
  if (event.source !== "hook" && event.source !== 'codex-log' && signature === lastDedupSignature && now - lastDedupAt < 12_000) return;
  lastDedupSignature = signature;
  lastDedupAt = now;
  if (event.source === "hook") lastHookEventAt = event.createdAt;
  if (event.source === "mcp") lastMcpEventAt = event.createdAt;
  if (event.type === 'work_started' && !event.replayed && !event.isSubagent) {
    if (event.source === 'claude-code') noteAgent('claude');
    else if (event.source === 'deepseek-harness') noteAgent('deepseek');
    else if (event.source === 'codex-log') noteAgent('codex');
  }
  const success=shouldCelebrateCompletion(sessionActivities,event);
  const ownPendingCompletion=isSuccessfulCompletion(event)&&!success;
  const before=currentActivity();
  const beforeSessions=sessionActivities;
  if (!event.questionId) sessionActivities = updateSessionActivities(sessionActivities, event, now);
  const fingerprint=(a:PetActivity)=>JSON.stringify([a.phase,a.sessionId,a.workingProjectCount,a.fullPower]);
  const stateChanged=fingerprint(before)!==fingerprint(currentActivity());
  const acceptedSession=event.sessionId?sessionActivities[event.sessionId]:undefined;
  if(acceptedSession?.turnId===event.turnId&&
    (!isQuestionReminder(event)||shouldDeliverBufferedEvent(sessionActivities,event)))currentQuestions.accepted(event);
  sendProjects();
  // An agent the user does not follow keeps its tracked state for an instant
  // switch back, but produces no bubble, celebration or history entry.
  if(!follows(preferences.followAgent,eventAgent(event.source))){
    writeJsonAtomically(activityPath,sessionActivities);
    if(stateChanged)mainWindow?.webContents.send('pet:activity',{...currentActivity(),replayed:event.replayed===true});
    return;
  }
  // A native ledger snapshot reconciles stored state; it is never a message.
  // Delayed/rejected questions also must not create a bubble or history entry.
  if(event.type==='input_sync'||(isQuestionReminder(event)&&!shouldDeliverBufferedEvent(sessionActivities,event))){
    writeJsonAtomically(activityPath,sessionActivities);
    if(stateChanged)mainWindow?.webContents.send('pet:activity',{...currentActivity(),replayed:event.replayed===true});
    return;
  }
  const completionKey=success?successfulCompletionIdentity(event):undefined;
  const duplicateCompletion=!!completionKey&&successfulCompletions.has(completionKey);
  // Log reconciliation does not replay historical messages or duplicate hooks.
  if(ownPendingCompletion||!shouldPresentAcceptedEvent(event,beforeSessions,sessionActivities,stateChanged,now)||duplicateCompletion) {
    writeJsonAtomically(activityPath,sessionActivities);
    if(stateChanged)mainWindow?.webContents.send('pet:activity',{...currentActivity(),replayed:event.replayed===true});
    return;
  }
  if(completionKey)successfulCompletions.add(completionKey);
  writeJsonAtomically(activityPath, sessionActivities);
  if (event.type !== "work_progress") {
    history = [event, ...history.filter((item) => item.id !== event.id)].slice(0, 20);
    writeJsonAtomically(historyPath, history);
  }
  sendProjects();
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Send aggregate state first: one session ending must not hide another's question.
    mainWindow.webContents.send("pet:activity", {...currentActivity(),replayed:event.replayed===true});
    if (shouldDeliverPetEvent(event,currentActivity())&&shouldDeliverBufferedEvent(sessionActivities,event)) rendererEvents.deliver(event);
    mainWindow.showInactive();
  } else if(shouldDeliverPetEvent(event,currentActivity())&&shouldDeliverBufferedEvent(sessionActivities,event)) {
    rendererEvents.deliver(event);
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (event.type !== "work_progress") settingsWindow.webContents.send("pet:event", event);
  }

}

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleBridgeRequest(
  request: IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  if (
    request.socket.remoteAddress !== "127.0.0.1" &&
    request.socket.remoteAddress !== "::ffff:127.0.0.1"
  ) {
    sendJson(response, 403, { ok: false, error: "Loopback clients only" });
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, app: APP_DIR_NAME });
    return;
  }
  const suppliedToken = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeCompare(suppliedToken, accessToken)) {
    sendJson(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }
  try {
    if (url.pathname === '/questions' || url.pathname.startsWith('/questions/')) {
      sendJson(response,410,{ok:false,error:'Pet answering has been removed. Use the native Codex question panel.'}); return;
    }
    if (request.method === 'POST' && url.pathname === '/deepseek-harness') {
      const payload=JSON.parse(await readRequestBody(request)) as unknown;
      const envelope=parseDeepSeekHarnessEnvelope(payload);
      if(!envelope){sendJson(response,400,{ok:false,error:'Unsupported Harness envelope'});return;}
      const events=deepSeekHarness.translate(envelope).map(input=>makeEvent({...input},'deepseek-harness'))
        .filter((event):event is PetEvent=>!!event);
      lastDeepSeekEventAt=new Date().toISOString();
      for(const event of events)acceptEvent(event);
      deepSeekTools.observe(envelope,Date.now());
      sendTool();sendQuota();
      sendJson(response,202,{ok:true,accepted:events.length});return;
    }
    if (request.method === 'POST' && url.pathname === '/claude-code') {
      // Official Claude Code hook payload, forwarded by plugins/deskfolk-claude-code.
      const payload = JSON.parse(await readRequestBody(request)) as unknown;
      if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).session_id === 'string') lastClaudeEventAt = new Date().toISOString();
      const events = claudeCode.translate(payload).map(input => makeEvent({...input}, 'claude-code'))
        .filter((event): event is PetEvent => !!event);
      for (const event of events) acceptEvent(event);
      claudeTools.observe(payload, Date.now());
      // Re-evaluate even without a tool change: the session may now be asking.
      sendTool();
      sendJson(response, 202, { ok: true, accepted: events.length }); return;
    }
    if (request.method === 'POST' && url.pathname === '/claude-code/status') {
      const payload = JSON.parse(await readRequestBody(request)) as unknown;
      const parsed = parseClaudeQuota(payload, new Date().toISOString());
      // Absence of the window (API key, before first reply) keeps the last
      // genuine reading until its reset; it never becomes 0%.
      if (parsed) {
        claudeQuota = parsed;
        writeJsonAtomically(claudeQuotaPath, parsed);
        sendQuota();
      } else if (!claudeQuota) {
        claudeQuota = unknownClaudeQuota();
      }
      sendJson(response, 202, { ok: true, available: !!parsed }); return;
    }
    if (request.method !== 'POST' || url.pathname !== '/notify') {
      sendJson(response, 404, { ok: false, error: 'Not found' }); return;
    }
    const input = JSON.parse(await readRequestBody(request)) as Record<string, unknown>;
    const source = input.source === "hook" ? "hook" : "mcp";
    const event = makeEvent(input, source);
    if (!event) {
      sendJson(response, 400, { ok: false, error: "Unsupported event type" });
      return;
    }
    acceptEvent(event);
    sendJson(response, 202, { ok: true, eventId: event.id });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

async function startBridge(): Promise<void> {
  accessToken = randomBytes(32).toString("hex");
  bridgeServer = createServer((request, response) => {
    void handleBridgeRequest(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    bridgeServer?.once("error", reject);
    bridgeServer?.listen(0, "127.0.0.1", resolve);
  });
  const address = bridgeServer.address();
  if (!address || typeof address === "string") throw new Error("Could not start local pet bridge");
  writeJsonAtomically(bridgePath, {
    port: address.port,
    token: accessToken,
    updatedAt: new Date().toISOString(),
  });
}

function loadPreferences(): void {
  preferences = normalizePreferences(readJson<Partial<PetPreferences>>(preferencesPath, {}));
  history = readJson<PetEvent[]>(historyPath, []).filter(event=>
    !['needs_input','approval_needed'].includes(event.type)||isQuestionReminder(event)).slice(0, 20);
  for(const event of history)if(isSuccessfulCompletion(event))successfulCompletions.add(successfulCompletionIdentity(event));
  sessionActivities = updateSessionActivities(sanitizeStoredActivities(readJson<SessionActivities>(activityPath, {})), {
    id: "startup-prune", source: "demo", type: "info", createdAt: new Date().toISOString(), read: true,
  });
  for(const id of Object.keys(sessionActivities))knownSessions.add(id);
  // Preserve project metadata and opaque question IDs, but quarantine cached
  // activity until the complete native snapshot confirms its current state.
  sessionActivities = Object.fromEntries(Object.entries(sessionActivities).map(([id,s])=>
    [id,s.phase!=='idle'?{...s,phase:'idle' as const}:s]));
  writeJsonAtomically(activityPath,sessionActivities);
  writeJsonAtomically(historyPath,history);
  lastHookEventAt = history.find((event) => event.source === "hook")?.createdAt ?? null;
  lastMcpEventAt = history.find((event) => event.source === "mcp")?.createdAt ?? null;
  lastClaudeEventAt = history.find((event) => event.source === "claude-code")?.createdAt ?? null;
  lastDeepSeekEventAt = history.find((event) => event.source === 'deepseek-harness')?.createdAt ?? null;
}

/** Deskfolk hooks present in the user's Claude Code settings (read-only check). */
function claudeHooksInstalled(): boolean {
  const file=join(process.env.CLAUDE_CONFIG_DIR||join(app.getPath('home'),'.claude'),'settings.json');
  try { return readFileSync(file,'utf8').includes('deskfolk-claude-code'); } catch { return false; }
}
function agentConnections(): AgentConnections {
  const health=lifecycle?.getHealth();
  return {
    codex:{state:health?.state??(process.env.PET_TEST_MODE==='1'?'disabled':'starting'),
      lastEventAt:health?.lastEventAt??history.find(event=>event.source==='codex-log')?.createdAt??null},
    claude:{hooksInstalled:claudeHooksInstalled(),lastEventAt:lastClaudeEventAt},
    deepseek:{pluginInstalled:!!lastDeepSeekEventAt,lastEventAt:lastDeepSeekEventAt},
  };
}

function rendererUrl(query = ""): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL + query;
  }
  return pathToFileURL(join(__dirname, "../renderer/index.html")).toString() + query;
}

function clampPosition(x: number, y: number): { x: number; y: number } {
  // PointerEvent.screenX/Y can be fractional under Windows display scaling.
  // Electron's native Point/Rectangle arguments require signed integer DIPs.
  x = Math.max(-2147483648, Math.min(2147483647, Math.round(x)));
  y = Math.max(-2147483648, Math.min(2147483647, Math.round(y)));
  const bounds = mainWindow?.getBounds();
  if (!bounds) return { x, y };
  const v=petLayout?.visible ?? {x:0,y:0,width:bounds.width,height:bounds.height};
  const display = screen.getDisplayMatching({x:Math.round(x+v.x),y:Math.round(y+v.y),width:Math.max(1,Math.round(v.width)),height:Math.max(1,Math.round(v.height))});
  const area = display.workArea;
  return {
    x: Math.round(Math.min(area.x+area.width-v.x-v.width,Math.max(area.x-v.x,x))),
    y: Math.round(Math.min(area.y+area.height-v.y-v.height,Math.max(area.y-v.y,y))),
  };
}

function savePosition(): void {
  clearTimeout(positionSaveTimer);
  positionSaveTimer = undefined;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  writeJsonAtomically(join(userDataPath, "position.json"), { x, y,
    ...(petLayout?{footX:x+petLayout.anchorX,footY:y+petLayout.anchorY}:{}) });
}

function fitVisiblePosition():void {
  if(!mainWindow||mainWindow.isDestroyed())return;
  const b=mainWindow.getBounds(),safe=clampPosition(b.x,b.y);
  if(Math.abs(safe.x-b.x)<=1&&Math.abs(safe.y-b.y)<=1)return;
  if(layoutPositionTarget?.x===safe.x&&layoutPositionTarget?.y===safe.y)return;
  clearTimeout(layoutPositionTimer);layoutPositionTarget=safe;
  const started=Date.now();
  const step=()=>{
    if(!mainWindow||mainWindow.isDestroyed())return;
    const u=Math.min(1,(Date.now()-started)/160),ease=u*u*(3-2*u);
    mainWindow.setPosition(Math.round(b.x+(safe.x-b.x)*ease),Math.round(b.y+(safe.y-b.y)*ease));
    if(u<1)layoutPositionTimer=setTimeout(step,16);else{layoutPositionTarget=undefined;layoutPositionTimer=undefined;}
  };step();
}

function showPet(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (process.env.PET_TEST_MODE === '1') return;
  const [currentX, currentY] = mainWindow.getPosition();
  const position = clampPosition(currentX, currentY);
  mainWindow.setPosition(position.x, position.y);
  mainWindow.showInactive();
  mainWindow.setAlwaysOnTop(true, "floating");
}

/** Mint title bar: the page draws the title, Windows keeps its caption buttons. */
const LIGHT_TITLE_BAR = { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#f3f6ef', symbolColor: '#4b6142', height: 40 } };

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  mainWindow?.setAlwaysOnTop(false);
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 400,
    minHeight: 620,
    title: `${APP_NAME} 设置`,
    icon: APPLICATION_ICON,
    backgroundColor: "#f3f6ef",
    autoHideMenuBar: true,
    ...LIGHT_TITLE_BAR,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void settingsWindow.loadURL(rendererUrl("?settings=1"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
    showPet();
  });
}

function openCodex(): void { void activateCodex(); }

function openProjects():void {
  if(projectsWindow&&!projectsWindow.isDestroyed()){projectsWindow.show();projectsWindow.focus();return;}
  projectsWindow=new BrowserWindow({width:760,height:800,minWidth:620,minHeight:600,title:'Deskfolk · 当前项目',icon:APPLICATION_ICON,backgroundColor:'#f3f6ef',autoHideMenuBar:true,...LIGHT_TITLE_BAR,
    webPreferences:{preload:join(__dirname,'../preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  void projectsWindow.loadURL(rendererUrl('?projects=1'));
  const timer=setInterval(sendProjects,1000);timer.unref();
  projectsWindow.on('closed',()=>{clearInterval(timer);projectsWindow=null;});
}

async function createTray(): Promise<void> {
  // 16 DIP base image; nativeImage loads the accompanying DPI representations.
  let icon = nativeImage.createFromPath(join(ICON_DIRECTORY, 'tray.png'));
  if (icon.isEmpty()) icon = await app.getFileIcon(process.execPath, { size: "small" });
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else showPet();
  });
  const buildTrayMenu = () => Menu.buildFromTemplate([
      { label: "显示桌宠", click: showPet },
      { label: "当前项目", click: openProjects },
      { label: "设置", click: openSettings },
      { label: '打开 Codex', click: openCodex },
      { label: presentationPolicy.transformation ? '转身 · 华丽形态预览' : '旋转变身（暂时停用）', enabled:presentationPolicy.transformation, click: () => {if(presentationPolicy.transformation)mainWindow?.webContents.send('pet:transform');} },
      { type: "separator" },
      {label:'勿扰模式',type:'checkbox',checked:preferences.doNotDisturb,click:item=>{
        preferences={...preferences,doNotDisturb:item.checked};writeJsonAtomically(preferencesPath,preferences);
        for(const w of [mainWindow,settingsWindow,projectsWindow])w?.webContents.send('pet:preferences',preferences);sendProjects();
      }},
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
  if (process.platform === 'win32') {
    // Use the tray's native popup explicitly; don't also attach an automatic
    // context menu or Windows may open two menus for the same right click.
    tray.on('right-click', () => {
      if (!tray || tray.isDestroyed()) return;
      trayMenu = buildTrayMenu();
      tray.popUpContextMenu(trayMenu);
    });
  } else {
    trayMenu = buildTrayMenu();
    tray.setContextMenu(trayMenu);
  }
}

function createPetWindow(): void {
  const savedPosition = readJson<{ x?: number; y?: number;footX?:number;footY?:number }>(join(userDataPath, "position.json"), {});
  if(typeof savedPosition.footX==='number'&&Number.isFinite(savedPosition.footX)&&typeof savedPosition.footY==='number'&&Number.isFinite(savedPosition.footY))layoutAnchorWorld={x:savedPosition.footX,y:savedPosition.footY};
  const display = screen.getPrimaryDisplay().workArea;
  const startX = typeof savedPosition.x === "number" && Number.isFinite(savedPosition.x)
    ? Math.round(savedPosition.x)
    : display.x + display.width - 440;
  const startY = typeof savedPosition.y === "number" && Number.isFinite(savedPosition.y)
    ? Math.round(savedPosition.y)
    : display.y + display.height - 430;
  mainWindow = new BrowserWindow({
    x: startX,
    y: startY,
    width: 240,
    height: 240,
    transparent: true,
    frame: false,
    thickFrame: false,
    hasShadow: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    icon: APPLICATION_ICON,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.webContents.on('did-start-loading',()=>rendererEvents.reset());
  void mainWindow.loadURL(rendererUrl());
  mainWindow.once("ready-to-show", showPet);
  mainWindow.on("move", () => {
    if(petLayout&&mainWindow){const moved=mainWindow.getBounds();layoutAnchorWorld={x:moved.x+petLayout.anchorX,y:moved.y+petLayout.anchorY};}
    sendViewport();
    clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(savePosition, 150);
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

/** Read-only desktop cursor stream in logical DIPs, including outside the alpha window. */
function startCursorTracking(): void {
  let last='',lastSent=0;
  const timer=setInterval(()=>{
    if(!mainWindow||mainWindow.isDestroyed()||(!mainWindow.isVisible()&&process.env.PET_TEST_MODE!=='1')||preferences.model!=='flat-chibi')return;
    const cursor=screen.getCursorScreenPoint(),b=mainWindow.getBounds();
    const point={x:cursor.x-b.x,y:cursor.y-b.y};const signature=point.x+','+point.y;
    if(signature===last&&Date.now()-lastSent<500)return;
    last=signature;lastSent=Date.now();mainWindow.webContents.send('pet:cursor',point);
  },16);
  timer.unref();app.once('before-quit',()=>clearInterval(timer));
}

function registerIpc(): void {
  const quotaSender=(event:Electron.IpcMainInvokeEvent)=>[mainWindow,settingsWindow,projectsWindow].some(w=>w?.webContents===event.sender);
  ipcMain.handle('pet:get-quota',event=>quotaSender(event)?quotaSnapshot():unknownCodexQuota());
  ipcMain.handle('pet:refresh-quota',async event=>{
    if(!quotaSender(event))return unknownCodexQuota();
    // Claude Code pushes its reading through the status line; only Codex can be polled.
    if(preferences.followAgent==='codex')await quotaMonitor?.refresh().catch(()=>undefined);
    return quotaSnapshot();
  });
  ipcMain.handle('pet:renderer-ready',event=>{
    if(!mainWindow||mainWindow.isDestroyed()||event.sender!==mainWindow.webContents)return {ok:false,delivered:0};
    const delivered=rendererEvents.makeReady(event=>shouldDeliverBufferedEvent(sessionActivities,event));
    sendTool(true);
    return {ok:true,delivered};
  });
  ipcMain.on('pet:layout',(event,layout:PetLayout)=>{
    if(!mainWindow||mainWindow.isDestroyed()||event.sender!==mainWindow.webContents)return;
    if(!layout||!layout.visible)return;
    const values=[layout.width,layout.height,layout.anchorX,layout.anchorY,...Object.values(layout.visible)];
    if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>2000)||layout.width<60||layout.height<60||layout.visible.width<=0||layout.visible.height<=0)return;
    const b=mainWindow.getBounds(),old=petLayout;
    if(JSON.stringify(layout)===JSON.stringify(petLayout)&&Math.abs(b.width-Math.ceil(layout.width))<1&&Math.abs(b.height-Math.ceil(layout.height))<1)return;
    petLayout=layout;
    if(old&&old.width===layout.width&&old.height===layout.height&&old.anchorX===layout.anchorX&&old.anchorY===layout.anchorY&&b.width===Math.ceil(layout.width)&&b.height===Math.ceil(layout.height)){
      const grew=layout.visible.x<old.visible.x-1||layout.visible.y<old.visible.y-1||layout.visible.x+layout.visible.width>old.visible.x+old.visible.width+1||layout.visible.y+layout.visible.height>old.visible.y+old.visible.height+1;
      if(grew||(!old.overlay&&layout.overlay))fitVisiblePosition();
      return;
    }
    // Keep the world-space foot anchor across a round trip of canvas sizes.
    // Windows DPI rounding otherwise loses about one DIP at every resize.
    if(!layoutAnchorWorld && old) layoutAnchorWorld={x:b.x+old.anchorX,y:b.y+old.anchorY};
    const x=layoutAnchorWorld?layoutAnchorWorld.x-layout.anchorX:b.x,y=layoutAnchorWorld?layoutAnchorWorld.y-layout.anchorY:b.y;
    // Frameless alpha hit testing owns pointer input. Keep native resizing enabled:
    // otherwise Windows re-applies its minimum tracking size when an edge goes offscreen.
    mainWindow.setMinimumSize(1,1);
    mainWindow.setBounds({x:Math.round(x),y:Math.round(y),width:Math.ceil(layout.width),height:Math.ceil(layout.height)});
    const safe=clampPosition(x,y);mainWindow.setPosition(safe.x,safe.y);
    if(!layoutAnchorWorld || Math.abs(safe.x-x)>1 || Math.abs(safe.y-y)>1){
      const actual=mainWindow.getBounds();layoutAnchorWorld={x:actual.x+layout.anchorX,y:actual.y+layout.anchorY};
    }
    if(JSON.stringify(layout)!==JSON.stringify(old))dragPosition=null;
    sendViewport();
  });
  ipcMain.handle("pet:get-bootstrap", (): PetBootstrap => ({
    preferences,
    history,
    bridgeReady: Boolean(bridgeServer?.listening),
    lastHookEventAt,
    lastMcpEventAt,
    activity: currentActivity(),
    quota: quotaSnapshot(),
    agents: agentConnections(),
    pendingReminder:history.find(event=>!event.read&&isQuestionReminder(event)&&follows(preferences.followAgent,eventAgent(event.source))&&shouldDeliverBufferedEvent(sessionActivities,event)),
  }));
  ipcMain.handle('pet:get-projects',event=>{
    if(![mainWindow,settingsWindow,projectsWindow].some(w=>w?.webContents===event.sender))throw Error('Unknown window');
    return currentProjects();
  });
  ipcMain.handle("pet:save-preferences", (_event, patch: Partial<PetPreferences>) => {
    const save=preferenceSaveQueue.catch(()=>{}).then(async()=>{
      const next=normalizePreferences(patch);
      if(next.startWithCodex!==preferences.startWithCodex)await syncCodexStartup(next.startWithCodex);
      const followChanged=next.followAgent!==preferences.followAgent;
      preferences = normalizePreferences(patch);
      writeJsonAtomically(preferencesPath, preferences);
      for(const w of [mainWindow,settingsWindow,projectsWindow])w?.webContents.send('pet:preferences',preferences);
      if(followChanged){
        mainWindow?.webContents.send('pet:activity',{...currentActivity(),replayed:true});
        sendTool(true);sendQuota();
      }
      sendProjects();
      return preferences;
    });
    preferenceSaveQueue=save;
    return save;
  });
  ipcMain.handle("pet:mark-read", (_event, id: string) => {
    history = history.map((event) => event.id === id ? { ...event, read: true } : event);
    writeJsonAtomically(historyPath, history);
  });
  ipcMain.handle("pet:send-test", (_event, type: PetEventType) => {
    const event = makeEvent(
      {
        type,
        nativeQuestion: type === 'needs_input',
        project: "桌宠预览",
        stage: type === "stage_complete" ? "视觉样机" : undefined,
        message: type === "needs_input"
          ? "Codex 有一个问题等你回答。"
          : type === "task_complete"
            ? "原型任务已完成，来看看新效果吧。"
            : "玻璃角色的阶段样机已经准备好了。",
      },
      "demo",
    );
    if (event) acceptEvent(event);
  });
  ipcMain.on("pet:open-settings", openSettings);
  ipcMain.handle('pet:open-codex', event => {
    if(![mainWindow,settingsWindow,projectsWindow].some(w=>w?.webContents===event.sender)) return {ok:false};
    const reminder=history.find(item=>!item.read&&isQuestionReminder(item));
    if(reminder?.source==='claude-code')return {ok:false,error:'请回到 Claude Code 窗口处理。'};
    if(reminder?.source==='deepseek-harness')return {ok:false,error:'请回到 DeepSeek Harness 窗口处理。'};
    return activateCodex();
  });
  ipcMain.on("pet:set-mouse-ignored", (event, ignored: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed() || typeof ignored !== "boolean") return;
    if (event.sender !== mainWindow.webContents) return;
    if (ignored) dragPosition = null;
    if (ignored === mouseIgnored) return;
    if (ignored) mainWindow.setIgnoreMouseEvents(true, { forward: true });
    else mainWindow.setIgnoreMouseEvents(false);
    mouseIgnored = ignored;
  });
  ipcMain.on("pet:move-window", (event, dx: number, dy: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (event.sender !== mainWindow.webContents) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    clearTimeout(layoutPositionTimer);layoutPositionTarget=undefined;
    layoutAnchorWorld=null;
    const [x, y] = mainWindow.getPosition();
    const origin = dragPosition ?? { x, y };
    const requested = { x: origin.x + dx, y: origin.y + dy };
    const next = clampPosition(requested.x, requested.y);
    // Accumulate the logical target: getPosition() can round a DIP down during
    // native/physical conversion. Re-reading it each move makes slow drags stick.
    // Discard movement beyond a display edge to allow immediate reversal.
    dragPosition = {
      x: next.x === Math.round(requested.x) ? requested.x : next.x,
      y: next.y === Math.round(requested.y) ? requested.y : next.y,
    };
    if (next.x !== x || next.y !== y) mainWindow.setPosition(next.x, next.y);
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", showPet);
  void app.whenReady().then(async () => {
    mkdirSync(userDataPath, { recursive: true });
    loadPreferences();
    // The Claude Code SessionStart hook reads this to start the installed pet.
    if(app.isPackaged&&!process.env.PET_TEST_MODE)writeJsonAtomically(join(userDataPath,'launch.json'),{exe:process.execPath});
    await syncCodexStartup(preferences.startWithCodex).catch((error:unknown)=>console.warn('Deskfolk could not register Codex startup. The setting can be retried.',(error as NodeJS.ErrnoException)?.code||'STARTUP_ERROR'));
    registerIpc();
    const storedClaudeQuota=readJson<CodexQuotaSnapshot|null>(claudeQuotaPath,null);
    if(storedClaudeQuota?.source==='claude-code-statusline'&&storedClaudeQuota.status==='available')claudeQuota=storedClaudeQuota;
    quotaMonitor=new CodexQuotaMonitor(process.env.CODEX_HOME||join(app.getPath('home'),'.codex'),()=>sendQuota());
    quotaMonitor.start();
    await startBridge();
    deepSeekLeaseTimer=setInterval(()=>{
      for(const input of deepSeekHarness.expire(Date.now())){
        const event=makeEvent({...input},'deepseek-harness');if(event)acceptEvent(event);
      }
      sendTool();
    },5_000);
    deepSeekLeaseTimer.unref();
    createPetWindow();
    if(!process.env.PET_TEST_MODE){
      lifecycle=new CodexLifecycleObserver(join(process.env.CODEX_HOME||join(app.getPath('home'),'.codex'),'sessions'),acceptEvent);
      for(const e of history)lifecycle.track(e.sessionId);
      for(const id of knownSessions)lifecycle.track(id);
      lifecycle.start();
    }
    startCursorTracking();
    await createTray();
    app.on("activate", showPet);
  }).catch((error: unknown) => {
    console.error("Deskfolk failed to start:", error);
    app.quit();
  });
  app.on("before-quit", () => {
    isQuitting = true;
    lifecycle?.stop();
    quotaMonitor?.stop();
    clearInterval(deepSeekLeaseTimer);
    clearTimeout(toolTimer);
    clearTimeout(layoutPositionTimer);
    savePosition();
    if (bridgeServer?.listening) bridgeServer.close();
  });
}
