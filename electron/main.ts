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
  EventSource,
  PetLayout,
  PetBootstrap,
  PetActivity,
  PetEvent,
  PetEventType,
  PetPreferences,
  PetModel,
  CompletionOutcome,
} from "../shared/types";
import { dominantActivity, isSuccessfulCompletion, shouldCelebrateCompletion, shouldDeliverBufferedEvent, shouldDeliverPetEvent, shouldIgnoreHookQuestion, shouldPresentLifecycleEvent, successfulCompletionIdentity, updateSessionActivities, type SessionActivities } from "../shared/activity";
import { activateCodex } from './codex-window';
import { isQuestionReminder } from '../shared/reminders';
import { CodexLifecycleObserver } from './codex-lifecycle';
import { presentationPolicy } from '../shared/runtime-policy';
import { syncCodexStartup } from './codex-startup';
import { RendererEventQueue } from './renderer-events';

const APP_NAME = "Deskfolk";
// Keep the existing data directory and bridge identifier during the branding update.
const APP_DIR_NAME = "liquid-glass-pet";
const ICON_DIRECTORY = join(__dirname, '../../assets/icons');
const APPLICATION_ICON = join(ICON_DIRECTORY, 'deskfolk.ico');
const ALLOWED_TYPES = new Set<PetEventType>([
  "work_started",
  "work_progress",
  "approval_needed",
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
};

app.setName(APP_NAME);
app.setPath("userData", process.env.PET_USER_DATA || join(app.getPath("appData"), APP_DIR_NAME));

const userDataPath = app.getPath("userData");
const preferencesPath = join(userDataPath, "preferences.json");
const historyPath = join(userDataPath, "history.json");
const bridgePath = join(userDataPath, "bridge.json");
const activityPath = join(userDataPath, "activity.json");

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
const rendererEvents=new RendererEventQueue(event=>mainWindow?.webContents.send('pet:event',event));
function currentActivity() { return dominantActivity(sessionActivities); }
let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let bridgeServer: Server | null = null;
let accessToken = "";
let preferences = { ...DEFAULT_PREFERENCES };
let preferenceSaveQueue: Promise<PetPreferences | void> = Promise.resolve();
let history: PetEvent[] = [];
let sessionActivities: SessionActivities = {};
const successfulCompletions=new Set<string>();
let lifecycle: CodexLifecycleObserver | undefined;
const knownSessions=new Set<string>();
let isQuitting = false;
let lastHookEventAt: string | null = null;
let lastMcpEventAt: string | null = null;
let lastDedupSignature = "";
let lastDedupAt = 0;
let dragPosition: { x: number; y: number } | null = null;
let mouseIgnored = true;
let petLayout: PetLayout | null = null;
let layoutAnchorWorld: {x:number;y:number} | null = null;
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
  };
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function makeEvent(input: Record<string, unknown>, source: EventSource): PetEvent | null {
  const type = input.type;
  if (typeof type !== "string" || !ALLOWED_TYPES.has(type as PetEventType)) return null;
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
    nativeCallId: sanitizeText(input.nativeCallId??legacyCallId, 120),
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
  lifecycle?.track(event.sessionId);
  if (['needs_input','approval_needed'].includes(event.type) && !isQuestionReminder(event)) return;
  if(shouldIgnoreHookQuestion(sessionActivities,event))return;
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
  const success=shouldCelebrateCompletion(sessionActivities,event);
  const ownPendingCompletion=isSuccessfulCompletion(event)&&!success;
  const before=currentActivity();
  if (!event.questionId) sessionActivities = updateSessionActivities(sessionActivities, event, now);
  const fingerprint=(a:PetActivity)=>JSON.stringify([a.phase,a.sessionId,a.workingProjectCount,a.fullPower]);
  const stateChanged=fingerprint(before)!==fingerprint(currentActivity());
  const completionKey=success?successfulCompletionIdentity(event):undefined;
  const duplicateCompletion=!!completionKey&&successfulCompletions.has(completionKey);
  // Log reconciliation does not replay historical messages or duplicate hooks.
  if(ownPendingCompletion||!shouldPresentLifecycleEvent(event,stateChanged,now)||duplicateCompletion) {
    writeJsonAtomically(activityPath,sessionActivities);
    if(stateChanged)mainWindow?.webContents.send('pet:activity',currentActivity());
    return;
  }
  if(completionKey)successfulCompletions.add(completionKey);
  writeJsonAtomically(activityPath, sessionActivities);
  if (event.type !== "work_progress") {
    history = [event, ...history.filter((item) => item.id !== event.id)].slice(0, 20);
    writeJsonAtomically(historyPath, history);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Send aggregate state first: one session ending must not hide another's question.
    mainWindow.webContents.send("pet:activity", currentActivity());
    if (shouldDeliverPetEvent(event,currentActivity())) rendererEvents.deliver(event);
    mainWindow.showInactive();
  } else if(shouldDeliverPetEvent(event,currentActivity())) {
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
  history = readJson<PetEvent[]>(historyPath, []).slice(0, 20);
  for(const event of history)if(isSuccessfulCompletion(event))successfulCompletions.add(successfulCompletionIdentity(event));
  sessionActivities = updateSessionActivities(readJson<SessionActivities>(activityPath, {}), {
    id: "startup-prune", source: "demo", type: "info", createdAt: new Date().toISOString(), read: true,
  });
  for(const id of Object.keys(sessionActivities))knownSessions.add(id);
  // Keep native pending questions; reconcile working turns from actual logs.
  sessionActivities = Object.fromEntries(Object.entries(sessionActivities).filter(([,s])=>s.phase==='asking'));
  lastHookEventAt = history.find((event) => event.source === "hook")?.createdAt ?? null;
  lastMcpEventAt = history.find((event) => event.source === "mcp")?.createdAt ?? null;
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
    y: Math.round(Math.min(area.y+area.height-v.y-v.height,Math.max(area.y-(petLayout?.overlay?0:v.y),y))),
  };
}

function savePosition(): void {
  clearTimeout(positionSaveTimer);
  positionSaveTimer = undefined;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  writeJsonAtomically(join(userDataPath, "position.json"), { x, y });
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

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  mainWindow?.setAlwaysOnTop(false);
  settingsWindow = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 400,
    minHeight: 620,
    title: `${APP_NAME} 设置`,
    icon: APPLICATION_ICON,
    backgroundColor: "#f3f7fa",
    autoHideMenuBar: true,
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
      { label: "设置", click: openSettings },
      { label: '打开 Codex', click: openCodex },
      { label: presentationPolicy.transformation ? '转身 · 华丽形态预览' : '旋转变身（暂时停用）', enabled:presentationPolicy.transformation, click: () => {if(presentationPolicy.transformation)mainWindow?.webContents.send('pet:transform');} },
      { type: "separator" },
      {
        label: "启用待机舞蹈",
        type: "checkbox",
        checked: preferences.idleDance,
        click: (item) => {
          preferences = { ...preferences, idleDance: item.checked };
          writeJsonAtomically(preferencesPath, preferences);
          mainWindow?.webContents.send("pet:preferences", preferences);
        },
      },
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
  const savedPosition = readJson<{ x?: number; y?: number }>(join(userDataPath, "position.json"), {});
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
  ipcMain.handle('pet:renderer-ready',event=>{
    if(!mainWindow||mainWindow.isDestroyed()||event.sender!==mainWindow.webContents)return {ok:false,delivered:0};
    return {ok:true,delivered:rendererEvents.makeReady(event=>shouldDeliverBufferedEvent(sessionActivities,event))};
  });
  ipcMain.on('pet:layout',(event,layout:PetLayout)=>{
    if(!mainWindow||mainWindow.isDestroyed()||event.sender!==mainWindow.webContents)return;
    if(!layout||!layout.visible)return;
    const values=[layout.width,layout.height,layout.anchorX,layout.anchorY,...Object.values(layout.visible)];
    if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>2000)||layout.width<60||layout.height<60||layout.visible.width<=0||layout.visible.height<=0)return;
    const b=mainWindow.getBounds(),old=petLayout;
    if(JSON.stringify(layout)===JSON.stringify(petLayout)&&Math.abs(b.width-Math.ceil(layout.width))<1&&Math.abs(b.height-Math.ceil(layout.height))<1)return;
    petLayout=layout;
    if(old&&old.width===layout.width&&old.height===layout.height&&old.anchorX===layout.anchorX&&old.anchorY===layout.anchorY&&b.width===Math.ceil(layout.width)&&b.height===Math.ceil(layout.height))return;
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

  }));
  ipcMain.handle("pet:save-preferences", (_event, patch: Partial<PetPreferences>) => {
    const save=preferenceSaveQueue.catch(()=>{}).then(async()=>{
      const next=normalizePreferences(patch);
      if(next.startWithCodex!==preferences.startWithCodex)await syncCodexStartup(next.startWithCodex);
      preferences = normalizePreferences(patch);
      writeJsonAtomically(preferencesPath, preferences);
      mainWindow?.webContents.send("pet:preferences", preferences);
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
        nativeQuestion: type === 'approval_needed',
        project: "桌宠预览",
        stage: type === "stage_complete" ? "视觉样机" : undefined,
        message: type === "approval_needed"
          ? "这件事需要你确认一下。"
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
    if(event.sender!==mainWindow?.webContents && event.sender!==settingsWindow?.webContents) return {ok:false};
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
    await syncCodexStartup(preferences.startWithCodex).catch((error:unknown)=>console.warn('Deskfolk could not register Codex startup. The setting can be retried.',(error as NodeJS.ErrnoException)?.code||'STARTUP_ERROR'));
    registerIpc();
    await startBridge();
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
    savePosition();
    if (bridgeServer?.listening) bridgeServer.close();
  });
}
