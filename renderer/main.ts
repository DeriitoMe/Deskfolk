import { IdleCadence } from '../shared/idle-cadence';
import hiresSoftUrl from "./assets/mutsumi-hires-soft.png?url";
import "./style.css";
import { MutsumiRig, TURN_SECONDS, type RigAction } from './three-rig';
import { isQuestionReminder, shouldShowBubble } from '../shared/reminders';
import { setupReview } from './v41-review';
import { presentationPolicy } from '../shared/runtime-policy';
import type { PetActivity, PetEvent, PetEventType, PetModel, PetPreferences } from "../shared/types";

const petView = document.querySelector<HTMLElement>("#pet-view")!;
const settingsView = document.querySelector<HTMLElement>("#settings-view")!;
const petRoot = document.querySelector<HTMLElement>("#pet-root")!;
const characterMount = document.querySelector<HTMLElement>("#character-mount")!;
const speechBubble = document.querySelector<HTMLElement>("#speech-bubble")!;
const messageNode = document.querySelector<HTMLElement>("#bubble-message")!;
const metaNode = document.querySelector<HTMLElement>("#bubble-meta")!;
const kickerNode = document.querySelector<HTMLElement>("#bubble-kicker")!;


const SETTINGS_VIEW = new URLSearchParams(location.search).has("settings");
let rig: MutsumiRig | null = null;

let currentPreferences: PetPreferences | null = null;
let currentEvent: PetEvent | null = null;
let bubbleTimer = 0;
let idleTimer = 0;
let danceTimer = 0;
let pixelTimer = 0;
let actionTimer = 0;
let workTransitionTimer = 0;
let sleepTimer = 0;
let flatIdleTimer = 0;
const idleCadence = new IdleCadence();
let flatTouchTimer = 0;
let flatTouchUntil = 0;
let lastDanceAt = 0;
let activityState: "idle" | "working" | "attention" = "idle";
let fullPower=false;
let dragPointer: number | null = null;
let dragDistance = 0;
let cancelledPastime = false;
let dragStartPointer = { x: 0, y: 0 };
let lastPointer = { x: 0, y: 0 };
let lastPointerTime=0;
let dragStartClientPointer = { x: 0, y: 0 };
let lastClientPointer = { x: 0, y: 0 };
let artAlpha: Uint8ClampedArray | null = null;
let artWidth = 0;
let artHeight = 0;

function playFlatAction(action: string): void {
  if (!rig) return;
  rig.reducedMotion=Boolean(currentPreferences?.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  rig.setAction(action as RigAction);
}
function updateLayout(): void {
  if (SETTINGS_VIEW || !currentPreferences) return;
  const k=195/449*currentPreferences.scale/window.devicePixelRatio;
  const flat=currentPreferences.model==='flat-chibi';
  const tall=flat && rig?.canvas.height===1152;
  const canvasWidth=rig?.canvas.width??512,canvasHeight=rig?.canvas.height??512;
  const size=flat?canvasWidth*k:220*currentPreferences.scale/window.devicePixelRatio;
  const artHeight=flat?canvasHeight*k:size;
  const overlay=!speechBubble.hidden;
  const wide=rig?.action==='water'||rig?.action==='power-work'||rig?.action==='drag';
  // Reserve the existing 512 px render surface once; action changes no longer
  // resize the native alpha window. Visible bounds still control edge dragging.
  const width=Math.ceil(Math.max(flat?(tall?752:canvasWidth-6)*k+12:size+12,overlay?370/window.devicePixelRatio:0));
  const top=overlay?167/window.devicePixelRatio:6;
  const height=Math.ceil((flat?(tall?1146:canvasHeight-6)*k:size)+top+6);
  const x=overlay?width-size-20/window.devicePixelRatio:(width-size)/2,y=top;
  petRoot.style.setProperty('--art-size',size+'px');
  petRoot.style.setProperty('--ui-scale',String(1/window.devicePixelRatio));
  petRoot.style.setProperty('--art-height',artHeight+'px');
  petRoot.style.setProperty('--art-x',x+'px');petRoot.style.setProperty('--art-y',y+'px');
  const dragBounds=rig?.getVisibleBounds();
  window.petBridge.setLayout({width,height,anchorX:x+size/2,anchorY:y+(flat?(tall?1124:484+canvasHeight-512)*k:size),
    visible:dragBounds?{x:x+dragBounds.x*k,y:y+dragBounds.y*k,width:dragBounds.width*k,height:dragBounds.height*k}:{x:x+(flat?(tall?8:wide?4:78)*k:0),y:y+(flat?(tall?195:25)*k:0),width:flat?(tall?752:wide?504:362)*k:size,height:flat?(tall?929:459)*k:size},overlay});
}
const TITLES: Record<PetEventType, string> = {
  work_started: "开始处理",
  work_progress: "正在处理",
  approval_needed: "需要你确认",
  turn_ended: "这一轮结束了",
  interrupted: "已经暂停",
  stage_complete: "阶段完成",
  task_complete: "任务完成",
  needs_input: "等你回复",
  input_resolved: '已收到回答',
  info: "有一条通知",
};

function setAction(action: string, duration = 0): void {
  const figure = characterMount.querySelector<HTMLElement>(".figure");
  if (!figure) return;
  figure.dataset.action = action;
  if (currentPreferences?.model === "flat-chibi") playFlatAction(action);
  window.clearTimeout(actionTimer);
  if (duration > 0) {
    actionTimer = window.setTimeout(() => {
      if (figure.dataset.action === action) {
        figure.dataset.action = "idle";
      }
    }, duration);
  }
}

function renderCharacter(model: PetModel): void {
  rig?.dispose(); rig = null;
  const figure = document.createElement("div");
  figure.className = "figure art-figure";
  figure.dataset.action = activityState;
  figure.dataset.model = model;
  if (model === 'flat-chibi') {
    rig = new MutsumiRig();
    rig.onViewportChange=updateLayout;
    rig.onTransientEnd = () => { flatTouchUntil = 0; syncFlatActivity(); };
    figure.append(rig.canvas); characterMount.replaceChildren(figure);
    petRoot.style.setProperty('--rig-size', `${195*512/449/window.devicePixelRatio}px`);
    syncFlatActivity(); return;
  }
  const art = document.createElement("img");
  art.className = "pet-art";
  art.dataset.dragHandle = "";
  art.alt = "若叶睦高清柔光";
  art.draggable = false;
  art.addEventListener("load", () => {
    if (characterMount.querySelector(".pet-art") !== art) return;
    const canvas = document.createElement("canvas");
    canvas.width = art.naturalWidth;
    canvas.height = art.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(art, 0, 0);
    artAlpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
    artWidth = canvas.width;
    artHeight = canvas.height;
  });
  art.src = hiresSoftUrl;
  figure.append(art);
  artAlpha = null;
  characterMount.replaceChildren(figure);

}

function onVisibleArt(x: number, y: number): boolean {
  if (rig) return rig.hit(x, y);
  const art = characterMount.querySelector<HTMLImageElement>(".pet-art");
  if (!art || !artAlpha || !artWidth || !artHeight) return false;
  const bounds = art.getBoundingClientRect();
  const px = Math.floor((x - bounds.left) / bounds.width * artWidth);
  const py = Math.floor((y - bounds.top) / bounds.height * artHeight);
  if (px < 0 || py < 0 || px >= artWidth || py >= artHeight) return false;
  return artAlpha[(py * artWidth + px) * 4 + 3] > 32;
}

function setStatus(text: string): void {
  petRoot.setAttribute("aria-label", text);
}

function eventMessage(event: PetEvent): { title: string; message: string; meta: string } {
  const title = TITLES[event.type] ?? "有一条通知";
  const fallback: Partial<Record<PetEventType, string>> = {
    work_started: "我开始陪你一起处理了。",
    work_progress: "我还在处理。",
    approval_needed: "Codex 有一项操作等待确认。",
    turn_ended: "结束了......",
    interrupted: "我先停在这里。",
    stage_complete: "这一阶段已经收好了。",
    task_complete: "这件任务已经完成。",
    needs_input: "Codex 有一个问题等你回答。",
    info: "有一条新消息。",
  };
  const meta = [event.project, event.stage].filter(Boolean).join(" · ");
  return { title, message: event.type === 'turn_ended' ? '结束了......' : event.message || fallback[event.type] || "有一条新消息。", meta };
}

function showEvent(event: PetEvent): void {
  if (!shouldShowBubble(event)) return;
  document.querySelector<HTMLButtonElement>('#answer-button')!.hidden=!isQuestionReminder(event);
  if (currentPreferences?.model === "flat-chibi" && event.type === "turn_ended" &&
      activityState === "attention") return;
  resetSleepTimer();
  window.clearTimeout(workTransitionTimer);
  currentEvent = event;
  const content = eventMessage(event);
  kickerNode.textContent = content.title;
  messageNode.textContent = content.message;
  metaNode.textContent = content.meta ? "项目：" + content.meta : "";
  speechBubble.hidden = false;
  speechBubble.classList.remove("bubble-in");
  void speechBubble.offsetWidth;
  speechBubble.classList.add("bubble-in");
  window.clearTimeout(bubbleTimer);

  const sticky = event.type === "approval_needed" || event.type === "needs_input";
  if (!sticky) {
    const seconds = currentPreferences?.bubbleSeconds ?? 8;
    bubbleTimer = window.setTimeout(() => {
      speechBubble.hidden = true;
      if (currentEvent?.id === event.id) {
        void window.petBridge.markRead(event.id);
        currentEvent = null;
      }
    }, seconds * 1000);
  }

  if (currentPreferences?.model === "flat-chibi") return;

  switch (event.type) {
    case "work_started":
      activityState = "working";
      setAction("working");
      setStatus("正在认真处理");
      break;
    case "approval_needed":
    case "needs_input":
      activityState = "attention";
      setAction("attention");
      setStatus("等你看一眼");
      break;
    case "interrupted":
      activityState = "idle";
      setAction("attention", 1800);
      setStatus("暂停中");
      break;
    case "stage_complete":
    case "task_complete":
      activityState = "idle";
      setAction("celebrate", 2600);
      setStatus(event.type === "task_complete" ? "任务完成了" : "阶段完成了");
      break;
    case "turn_ended":
      activityState = "idle";
      setAction("idle");
      setStatus("这一轮已结束");
      break;
    default:
      activityState = "idle";
      setAction("attention", 1800);
      setStatus("有一条新通知");
  }
  resetIdleDance();
}

function applyPreferences(preferences: PetPreferences): void {
  const previousModel = currentPreferences?.model;
  const previousReducedMotion = currentPreferences?.reducedMotion;
  currentPreferences = preferences;

  petRoot.dataset.model = preferences.model;
  petRoot.style.setProperty("--pet-scale", String(preferences.scale));
  petRoot.style.setProperty('--rig-size', `${195*512/449/window.devicePixelRatio}px`);
  petRoot.classList.toggle("reduced-motion", preferences.reducedMotion);
  if (!SETTINGS_VIEW && previousModel !== preferences.model) renderCharacter(preferences.model);
  else if (!SETTINGS_VIEW && previousReducedMotion !== preferences.reducedMotion) {
    const action = characterMount.querySelector<HTMLElement>(".figure")?.dataset.action ?? "idle";
    if (preferences.model === "flat-chibi") playFlatAction(action);
  }
  if (SETTINGS_VIEW) syncSettingsControls(preferences);
  resetIdleDance();
  updateLayout();
}

function danceIsAllowed(): boolean {
  return Boolean(
    currentPreferences?.idleDance &&
    currentPreferences.model !== "flat-chibi" &&
    !currentPreferences.reducedMotion &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    activityState === "idle" &&
    characterMount.querySelector<HTMLElement>(".figure")?.dataset.action !== "sleep",
  );
}

function resetSleepTimer(): void {
  window.clearTimeout(sleepTimer);
  if (SETTINGS_VIEW || currentPreferences?.model === "flat-chibi") return;
  sleepTimer = window.setTimeout(() => {
    if (activityState !== "idle") return;
    window.clearTimeout(idleTimer);
    window.clearTimeout(danceTimer);
    setAction("sleep");
    setStatus("睡着了");
  }, 600_000);
}

function syncFlatActivity(): void {
  if (currentPreferences?.model !== 'flat-chibi' || SETTINGS_VIEW) return;
  const interaction=Date.now()<flatTouchUntil || (dragPointer!==null && dragDistance>4);
  const step=idleCadence.tick(performance.now(),activityState!=='idle'?'busy':interaction?'interaction':'idle');
  if(interaction)return;
  const action=activityState==='working'?(fullPower?'power-work':'work'):activityState==='attention'?'ask':step.action;
  setAction(action);
  const labels:Record<string,string>={idle:'安静地待机中',nap:'小憩中',water:'给黄瓜浇水','water-happy':'黄瓜喝饱水了',work:'正在认真处理','power-work':'正在全力处理多个项目',ask:'等你回复'};
  setStatus(labels[action]);
}

function applyActivity(activity: PetActivity): void {
  const previous = activityState;
  const previousPower=fullPower;fullPower=Boolean(activity.fullPower);
  activityState = activity.phase === "asking" ? "attention" : activity.phase;
  if (activity.phase !== 'idle') flatTouchUntil = 0;
  if (activity.phase !== "asking" &&
      (currentEvent?.type === "approval_needed" || currentEvent?.type === "needs_input")) {
    speechBubble.hidden = true;
    void window.petBridge.markRead(currentEvent.id);
    currentEvent = null;
  }
  if(activity.phase!=='asking') document.querySelector<HTMLButtonElement>('#answer-button')!.hidden=true;
  if (previous !== activityState || previousPower!==fullPower || !rig) syncFlatActivity();
}

function resetIdleDance(): void {
  window.clearTimeout(idleTimer);
  window.clearTimeout(danceTimer);
  if (!danceIsAllowed()) return;
  const cooldownRemaining = Math.max(0, 300_000 - (Date.now() - lastDanceAt));
  const delay = Math.max(180_000, cooldownRemaining);
  idleTimer = window.setTimeout(() => {
    if (!danceIsAllowed()) return;
    setAction("dance");
    setStatus("哼……");
    lastDanceAt = Date.now();
    danceTimer = window.setTimeout(() => {
      setAction("idle");
      setStatus("安静地待机中");
      resetIdleDance();
    }, 6000);
  }, delay);
}

function updateMouseMode(event: MouseEvent): void {
  if (SETTINGS_VIEW || dragPointer !== null) return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const interactive = Boolean(target?.closest("[data-hitbox]")) ||
    (Boolean(target?.closest("[data-drag-handle]")) && onVisibleArt(event.clientX, event.clientY));
  window.petBridge.setMouseIgnored(!interactive);
}

function setupPetView(): void {
  document.body.dataset.view = "pet";
  new MutationObserver(updateLayout).observe(speechBubble,{attributes:true,attributeFilter:["hidden"]});
  new MutationObserver(updateLayout).observe(document.querySelector("#answer-button")!,{attributes:true,attributeFilter:["hidden"]});
  window.petBridge.onViewport(v=>{petRoot.style.setProperty("--safe-left",v.left+"px");petRoot.style.setProperty("--safe-width",v.width+"px");});
  window.petBridge.onCursor(point=>{
    if(!rig)return;const b=rig.canvas.getBoundingClientRect();if(b.width<=0)return;
    const ratio=b.width/rig.canvas.width,faceY=b.top+(rig.canvas.height===1152?840:rig.canvas.height===768?517:261)*ratio;
    rig.setLookTarget(Math.tanh((point.x-(b.left+b.width/2))/(b.width*1.5)),Math.tanh((point.y-faceY)/(b.width*1.65)));
  });
  settingsView.hidden = true;
  petView.hidden = false;
  window.addEventListener('resize', updateLayout);

  document.querySelector('#answer-button')?.addEventListener('click', async () => {
    const result=await window.petBridge.openCodex();
    if(!result.ok) messageNode.textContent=result.error || '请从任务栏打开 Codex。';
  });
  window.petBridge.onTransform(() => {
    if (!presentationPolicy.transformation || !rig || activityState === 'attention') return;
    window.clearTimeout(flatIdleTimer); flatTouchUntil=Date.now()+TURN_SECONDS*1000; setAction('transform');
  });
  document.querySelector("#dismiss-bubble")?.addEventListener("click", () => {
    window.clearTimeout(bubbleTimer);
    speechBubble.hidden = true;
    if (currentEvent) void window.petBridge.markRead(currentEvent.id);
    currentEvent = null;
  });

  document.addEventListener("mousemove", (event) => {
    updateMouseMode(event);

  });
  document.addEventListener("pointermove", (event) => {
    if (dragPointer !== event.pointerId) return;
    dragDistance += Math.max(
      Math.abs(event.screenX - lastPointer.x) + Math.abs(event.screenY - lastPointer.y),
      Math.abs(event.clientX - lastClientPointer.x) + Math.abs(event.clientY - lastClientPointer.y),
    );
    if (rig && dragDistance > 4) {
      window.clearTimeout(flatIdleTimer); flatTouchUntil=0;
      setAction('drag');
      const now=performance.now();rig.setDragMotion(event.screenX-lastPointer.x,now-lastPointerTime,event.screenX-dragStartPointer.x);lastPointerTime=now;
    }
    window.petBridge.moveWindow(event.screenX - lastPointer.x, event.screenY - lastPointer.y);
    lastPointer = { x: event.screenX, y: event.screenY };
    lastClientPointer = { x: event.clientX, y: event.clientY };
  });
  characterMount.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!(event.target as Element).closest("[data-drag-handle]") ||
      !onVisibleArt(event.clientX, event.clientY)) return;
    cancelledPastime=!!rig && ['nap','water','water-happy'].includes(rig.action);
    idleCadence.reset(performance.now());
    if(cancelledPastime){flatTouchUntil=0;window.clearTimeout(flatTouchTimer);rig?.cancelToIdle();setAction('idle');}
    dragPointer = event.pointerId;
    rig?.beginDrag();lastPointerTime=performance.now();
    dragDistance = 0;
    dragStartPointer = { x: event.screenX, y: event.screenY };
    lastPointer = { x: event.screenX, y: event.screenY };
    dragStartClientPointer = { x: event.clientX, y: event.clientY };
    lastClientPointer = { x: event.clientX, y: event.clientY };
    window.petBridge.setMouseIgnored(false);
    characterMount.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  const finishDrag = (event: PointerEvent, cancelled = false) => {
    if (dragPointer !== event.pointerId) return;
    const endDistance = Math.abs(event.screenX - dragStartPointer.x) +
      Math.abs(event.screenY - dragStartPointer.y);
    const endClientDistance = Math.abs(event.clientX - dragStartClientPointer.x) +
      Math.abs(event.clientY - dragStartClientPointer.y);
    const clicked = !cancelled && Math.max(dragDistance, endDistance, endClientDistance) <= 4;
    dragPointer = null;
    idleCadence.reset(performance.now());
    if ((!clicked || cancelledPastime) && rig) syncFlatActivity();
    window.petBridge.setMouseIgnored(true);
    if (clicked && !cancelledPastime && currentPreferences?.model === "flat-chibi") {
      flatTouchUntil = Date.now() + 1150;
      window.clearTimeout(flatIdleTimer);
      window.clearTimeout(flatTouchTimer);
      setAction("touch");
      flatTouchTimer = window.setTimeout(() => {
        flatTouchUntil = 0;
        syncFlatActivity();
      }, 1150);
    }
  };
  characterMount.addEventListener("pointerup", finishDrag);
  characterMount.addEventListener("pointercancel", (event) => finishDrag(event, true));
  characterMount.addEventListener('lostpointercapture', () => {
    if (dragPointer !== null) { dragPointer=null;idleCadence.reset(performance.now());syncFlatActivity();window.petBridge.setMouseIgnored(true); }
  });
  characterMount.addEventListener("pointermove", () => {
    if (characterMount.querySelector<HTMLElement>(".figure")?.dataset.action === "sleep") {
      setAction("idle");
      setStatus("安静地待机中");
    }
    resetSleepTimer();
    resetIdleDance();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !speechBubble.hidden) {
      speechBubble.hidden = true;
      if (currentEvent) void window.petBridge.markRead(currentEvent.id);
      currentEvent = null;
    }
  });
}

function syncSettingsControls(preferences: PetPreferences): void {
  document.querySelectorAll<HTMLButtonElement>("[data-model-choice]").forEach((button) => {
    const selected = button.dataset.modelChoice === preferences.model;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled=presentationPolicy.qOnly&&button.dataset.modelChoice!=='flat-chibi';
  });
  const scaleRange = document.querySelector<HTMLInputElement>("#scale-range")!;
  const flat = preferences.model === "flat-chibi";
  scaleRange.min = flat ? "70" : "82";
  scaleRange.max = flat ? "160" : "130";
  document.querySelector<HTMLElement>("#scale-hint")!.textContent = flat
    ? "默认主体高约 195 物理像素，可调整到 70%–160%"
    : "默认约 220 像素高";
  scaleRange.value = String(Math.round(preferences.scale * 100));
  document.querySelector<HTMLOutputElement>("#scale-value")!.value =
    Math.round(preferences.scale * 100) + "%";
  document.querySelector<HTMLInputElement>("#dance-toggle")!.checked = preferences.idleDance;
  document.querySelector<HTMLInputElement>("#motion-toggle")!.checked = preferences.reducedMotion;
  document.querySelector<HTMLInputElement>('#codex-start-toggle')!.checked=preferences.startWithCodex;
}

function timeLabel(value: string | null): string {
  if (!value) return "等待首次事件";
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? "等待首次事件"
    : "最近 " + time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderHistory(events: PetEvent[]): void {
  const list = document.querySelector<HTMLOListElement>("#history-list")!;
  list.replaceChildren();
  document.querySelector("#history-count")!.textContent = events.length + " / 20";
  if (events.length === 0) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = "还没有通知。可以用上面的按钮发一条预览。";
    list.append(empty);
    return;
  }
  for (const event of events) {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    const body = document.createElement("span");
    const meta = document.createElement("small");
    heading.textContent = TITLES[event.type];
    body.textContent = event.message || eventMessage(event).message;
    meta.textContent = [
      event.project,
      event.stage,
      new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    ].filter(Boolean).join(" · ");
    item.append(heading, body, meta);
    list.append(item);
  }
}

function updateConnectionStatus(
  bridgeReady: boolean,
  lastHookAt: string | null,
  lastMcpAt: string | null,
): void {
  document.querySelector("#bridge-dot")!.classList.toggle("online", bridgeReady);
  document.querySelector("#bridge-status")!.textContent = bridgeReady ? "运行中" : "未启动";
  document.querySelector("#mcp-status")!.textContent = timeLabel(lastMcpAt);
  document.querySelector("#hook-status")!.textContent = timeLabel(lastHookAt);
}

async function savePreference(patch: Partial<PetPreferences>): Promise<void> {
  const saved = await window.petBridge.savePreferences(patch);
  applyPreferences(saved);
}

function setupSettingsView(): void {
  document.body.dataset.view = "settings";
  petView.hidden = true;
  settingsView.hidden = false;
  document.querySelectorAll<HTMLButtonElement>("[data-model-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      void savePreference({ model: button.dataset.modelChoice as PetModel });
    });
  });
  document.querySelector<HTMLInputElement>("#scale-range")!.addEventListener("input", (event) => {
    const scale = Number((event.currentTarget as HTMLInputElement).value) / 100;
    document.querySelector<HTMLOutputElement>("#scale-value")!.value =
      Math.round(scale * 100) + "%";
    void savePreference({ scale });
  });
  document.querySelector<HTMLInputElement>("#dance-toggle")!.addEventListener("change", (event) => {
    void savePreference({ idleDance: (event.currentTarget as HTMLInputElement).checked });
  });
  document.querySelector<HTMLInputElement>("#motion-toggle")!.addEventListener("change", (event) => {
    void savePreference({ reducedMotion: (event.currentTarget as HTMLInputElement).checked });
  });
  document.querySelector<HTMLInputElement>('#codex-start-toggle')!.addEventListener('change',async event=>{
    const toggle=event.currentTarget as HTMLInputElement,error=document.querySelector<HTMLElement>('#startup-error')!;
    toggle.disabled=true;error.hidden=true;
    try{await savePreference({startWithCodex:toggle.checked});}
    catch{toggle.checked=currentPreferences?.startWithCodex??true;error.textContent='启动设置未保存，请稍后重试。';error.hidden=false;}
    finally{toggle.disabled=false;}
  });
  document.querySelector("#test-stage")!.addEventListener("click", () => {
    void window.petBridge.sendTest("stage_complete");
  });
  document.querySelector("#test-approval")!.addEventListener("click", () => {
    void window.petBridge.sendTest("approval_needed");
  });
}

async function start(): Promise<void> {
  if (SETTINGS_VIEW) setupSettingsView();
  else setupPetView();

  let receivedActivity = false;
  window.petBridge.onActivity((activity) => {
    receivedActivity = true;
    applyActivity(activity);
  });
  const bootstrap = await window.petBridge.getBootstrap();
  applyPreferences(bootstrap.preferences);
  if (!SETTINGS_VIEW) {
    if (!receivedActivity) applyActivity(bootstrap.activity);
    else syncFlatActivity();
  }
  if (SETTINGS_VIEW) {
    updateConnectionStatus(bootstrap.bridgeReady, bootstrap.lastHookEventAt, bootstrap.lastMcpEventAt);
    renderHistory(bootstrap.history);
  }

  window.petBridge.onPreferences(applyPreferences);
  window.petBridge.onEvent((event) => {
    if (!SETTINGS_VIEW) showEvent(event);
    if (SETTINGS_VIEW) {
      void window.petBridge.getBootstrap().then((state) => {
        renderHistory(state.history);
        updateConnectionStatus(state.bridgeReady, state.lastHookEventAt, state.lastMcpEventAt);
      });
    }
  });
  if (!SETTINGS_VIEW) resetIdleDance();
  if (!SETTINGS_VIEW) { resetSleepTimer();updateLayout();window.setInterval(syncFlatActivity,100); }
}

if (new URLSearchParams(location.search).has('review')) void setupReview();
else void start();
