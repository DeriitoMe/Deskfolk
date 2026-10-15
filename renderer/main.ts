import { IdleCadence } from '../shared/idle-cadence';
import hiresSoftUrl from "./assets/mutsumi-hires-soft.png?url";
import completeVoiceUrl from './assets/audio/mutsumi-bubble-complete.wav?url';
import workingVoiceUrl from './assets/audio/mutsumi-bubble-working.wav?url';
import questionVoiceUrl from './assets/audio/mutsumi-bubble-question.wav?url';
import superWorkVoiceUrl from './assets/audio/mutsumi-bubble-super-work.wav?url';
import { BubbleVoice } from './bubble-voice';
import { hasSuperWorkload, NORMAL_WORK_MESSAGE, SUPER_WORK_MESSAGE, SUPER_WORK_BUBBLE_PREFIX, SuperWorkBubbleGate } from '../shared/work-bubble';
import headpatVoiceUrl from './assets/audio/mutsumi-headpat.wav?url';
import tearfulFirstVoiceUrl from './assets/audio/mutsumi-tearful-first.wav?url';
import tearfulSecondVoiceUrl from './assets/audio/mutsumi-tearful-second.wav?url';
import { TouchVoice } from './touch-voice';
import {QUOTA_BOARD_SECONDS} from '../shared/quota-board-motion';
import {unknownCodexQuota,type CodexQuotaSnapshot} from '../shared/quota';
import "./style.css";
import "./settings-view.css";
import { MutsumiRig, TURN_SECONDS, type RigAction } from './three-rig';
import { isQuestionReminder, shouldShowBubble } from '../shared/reminders';
import { setupReview } from './v41-review';
import {setupProjectsView} from './projects-view';
import {OrbitGesture} from '../shared/orbit-gesture';
import {RepeatedTouchResponse} from '../shared/touch-response';
import {OutcomeFeedbackQueue,feedbackDuration,feedbackKind,remindersEnabled,type FeedbackKind} from '../shared/outcome-feedback';
import { presentationPolicy } from '../shared/runtime-policy';
import { CelebrationSequence, QuestionReminderWindow, CELEBRATION_SECONDS, QUESTION_REMINDER_MS, TOUCH_SECONDS,DIZZY_SECONDS, isSuccessfulCompletion, type CelebrationVariant } from '../shared/companion-feedback';
import type { PetActivity, PetEvent, PetEventType, PetModel, PetPreferences } from "../shared/types";

const petView = document.querySelector<HTMLElement>("#pet-view")!;
const settingsView = document.querySelector<HTMLElement>("#settings-view")!;
const petRoot = document.querySelector<HTMLElement>("#pet-root")!;
const characterMount = document.querySelector<HTMLElement>("#character-mount")!;
const speechBubble = document.querySelector<HTMLElement>("#speech-bubble")!;
const messageNode = document.querySelector<HTMLElement>("#bubble-message")!;
const metaNode = document.querySelector<HTMLElement>("#bubble-meta")!;
const kickerNode = document.querySelector<HTMLElement>("#bubble-kicker")!;
const bubbleVoice = new BubbleVoice({
  '可以休息了......': completeVoiceUrl,
  '祥，工作': workingVoiceUrl,
  '唔，出现问题了': questionVoiceUrl,
  [SUPER_WORK_MESSAGE]: superWorkVoiceUrl,
});
const superWorkBubbleGate = new SuperWorkBubbleGate();
const touchVoice = new TouchVoice({
  'headpat': headpatVoiceUrl,
  'tearful-first': tearfulFirstVoiceUrl,
  'tearful-second': tearfulSecondVoiceUrl,
});
window.addEventListener('pagehide', () => {
  window.clearTimeout(bubbleTimer);
  window.clearTimeout(bubbleVoiceTimer);
  window.clearTimeout(bubbleFadeTimer);
  bubbleVoice.dispose();
  touchVoice.dispose();
}, { once: true });


const SETTINGS_VIEW = new URLSearchParams(location.search).has("settings");
let rig: MutsumiRig | null = null;

let currentPreferences: PetPreferences | null = null;
let currentEvent: PetEvent | null = null;
let bubbleTimer = 0;
let bubbleVoiceTimer = 0;
const BUBBLE_FADE_MS = 220;
let bubbleFadeTimer = 0;
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
let quotaBoardUntil=0;
let latestQuota:CodexQuotaSnapshot=unknownCodexQuota();
let latestActivity: PetActivity = { phase: 'idle', updatedAt: new Date().toISOString() };
const questionReminder = new QuestionReminderWindow();
const celebrationSequence = new CelebrationSequence();
const outcomeFeedback=new OutcomeFeedbackQueue();
const orbit=new OrbitGesture();
const repeatedTouch=new RepeatedTouchResponse();
let feedback:{event:PetEvent;kind:FeedbackKind;until:number}|null=null;
let dizzyUntil=0;
let celebration: { event: PetEvent; variant: CelebrationVariant; startedAt: number; noticeShown: boolean } | null = null;
const deferredCompletionNotices: PetEvent[] = [];
let fullPower=false;
let dragPointer: number | null = null;
let dragDistance = 0;
let cancelledPastime = false;
let dragStartPointer = { x: 0, y: 0 };
let lastPointer = { x: 0, y: 0 };
let lastPointerTime=0;
let dragStartClientPointer = { x: 0, y: 0 };
let lastTouchPoint: { x: number; y: number } | null = null;
let pointerStartedOnArt = false;
let artAlpha: Uint8ClampedArray | null = null;
let artWidth = 0;
let artHeight = 0;

function playFlatAction(action: string, restart=false): void {
  if (!rig) return;
  rig.reducedMotion=Boolean(currentPreferences?.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  rig.setAction(action as RigAction,restart);
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
  // Reserve one presentation envelope for the Q-form, including bubble space.
  const width=Math.ceil(Math.max(flat?(tall?752:canvasWidth-6)*k+12:size+12,(flat&&!tall)||overlay?370/window.devicePixelRatio:0));
  // Keep native alpha-window geometry stable when a bubble or board appears.
  const top=flat&&!tall?240/window.devicePixelRatio:overlay?Math.max(167/window.devicePixelRatio,
    speechBubble.offsetHeight+50/window.devicePixelRatio):6;
  const height=Math.ceil((flat?(tall?1146:canvasHeight-6)*k:size)+top+6);
  const x=flat&&!tall?(width-size)/2:overlay?width-size-20/window.devicePixelRatio:(width-size)/2,y=top;
  petRoot.style.setProperty('--art-size',size+'px');
  petRoot.style.setProperty('--ui-scale',String(1/window.devicePixelRatio));
  petRoot.style.setProperty('--art-height',artHeight+'px');
  petRoot.style.setProperty('--art-x',x+'px');petRoot.style.setProperty('--art-y',y+'px');
  if(overlay&&flat&&!tall){
    // Locate the cloud by the rendered head, rather than the padded canvas edge.
    const ui=1/window.devicePixelRatio,bubbleWidth=speechBubble.offsetWidth;
    const headX=x+size/2,headY=y+(canvasHeight-512+36)*k;
    const bubbleX=Math.max(8*ui,Math.min(width-bubbleWidth-8*ui,headX-bubbleWidth*.73-13.4*ui));
    const bubbleY=Math.max(8*ui,headY-speechBubble.offsetHeight-50*ui);
    petRoot.style.setProperty('--bubble-x',bubbleX+'px');
    petRoot.style.setProperty('--bubble-y',bubbleY+'px');
  }else if(!flat||tall){
    petRoot.style.removeProperty('--bubble-x');petRoot.style.removeProperty('--bubble-y');
  }
  const dragBounds=rig?.getVisibleBounds();
  let visible=dragBounds?{x:x+dragBounds.x*k,y:y+dragBounds.y*k,width:dragBounds.width*k,height:dragBounds.height*k}:{x:x+(flat?(tall?8:256+78)*k:0),y:y+(flat?(tall?195:256+25)*k:0),width:flat?(tall?752:362)*k:size,height:flat?(tall?929:459)*k:size};
  if(overlay){
    // Clamp only painted content, including the oval and its thought circles.
    const b=speechBubble.getBoundingClientRect(),margin=3/window.devicePixelRatio;
    const left=Math.min(visible.x,b.x-margin),upper=Math.min(visible.y,b.y-margin);
    const right=Math.max(visible.x+visible.width,b.right+margin),bottom=Math.max(visible.y+visible.height,b.bottom+56/window.devicePixelRatio);
    visible={x:left,y:upper,width:right-left,height:bottom-upper};
  }
  window.petBridge.setLayout({width,height,anchorX:x+size/2,anchorY:y+(flat?(tall?1124:484+canvasHeight-512)*k:size),
    visible,overlay});
}
const TITLES: Record<PetEventType, string> = {
  work_started: "开始处理",
  work_progress: "正在处理",
  approval_needed: "需要你确认",
  approval_resolved: '授权等待已解除',
  turn_ended: "这一轮结束了",
  interrupted: "已经暂停",
  stage_complete: "阶段完成",
  task_complete: "任务完成",
  needs_input: "等你回复",
  input_resolved: '已收到回答',
  input_sync: '问题状态同步',
  info: "有一条通知",
};

function setAction(action: string, duration = 0, restart=false): void {
  const figure = characterMount.querySelector<HTMLElement>(".figure");
  if (!figure) return;
  figure.dataset.action = action;
  if (currentPreferences?.model === "flat-chibi") playFlatAction(action,restart);
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
  touchVoice.stop();
  repeatedTouch.clear();
  lastTouchPoint=null;
  rig?.dispose(); rig = null;
  const figure = document.createElement("div");
  figure.className = "figure art-figure";
  figure.dataset.action = activityState;
  figure.dataset.model = model;
  if (model === 'flat-chibi') {
    rig = new MutsumiRig();
    rig.setQuota(latestQuota);
    rig.onViewportChange=updateLayout;
    rig.onTransientEnd = () => {
      const ended=rig?.action;
      if(ended?.startsWith('celebrate-')){if(celebration&&!celebration.noticeShown)displayBubble(celebration.event);celebration=null;}
      if(ended?.startsWith('feedback-'))feedback=null;
      if(ended==='dizzy'){dizzyUntil=0;idleCadence.reset(performance.now());}
      if(ended==='quota-board'){quotaBoardUntil=0;idleCadence.reset(performance.now());}
      if(ended==='tearful'){repeatedTouch.clear();rig?.setTearful(false);idleCadence.reset(performance.now());}
      if(ended==='touch'||ended==='transform'){flatTouchUntil=0;lastTouchPoint=null;window.clearTimeout(flatTouchTimer);}
      syncFlatActivity();
    };
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

function onTouchTarget(x:number,y:number):boolean {
  // The head moves a few desktop pixels during a press. Keep the last valid
  // tap point eligible until that short press ends, including at its outline.
  return onVisibleArt(x,y)||Boolean(rig?.action==='touch'&&Date.now()<flatTouchUntil&&
    lastTouchPoint&&Math.hypot(x-lastTouchPoint.x,y-lastTouchPoint.y)<=4);
}

function setStatus(text: string): void {
  petRoot.setAttribute("aria-label", text);
}

function clearRepeatedTouch():void {
  touchVoice.stop();
  repeatedTouch.clear();rig?.setTearful(false);
}

function eventMessage(event: PetEvent): { title: string; message: string; meta: string } {
  const negative=feedbackKind(event);
  if(negative)return {title:{failed:'任务失败',paused:'已经暂停',quota:'额度耗尽'}[negative],
    message:{failed:'卡住了……这次没能完成。',paused:'暂停了……',quota:'额度用完了……先休息一下。'}[negative],meta:event.project??''};
  const title = TITLES[event.type] ?? "有一条通知";
  const fallback: Partial<Record<PetEventType, string>> = {
    work_started: event.id.startsWith(SUPER_WORK_BUBBLE_PREFIX) ? SUPER_WORK_MESSAGE : NORMAL_WORK_MESSAGE,
    work_progress: "我还在处理。",
    approval_needed: "Codex 有一项操作等待确认。",
    turn_ended: "可以休息了......",
    interrupted: "我先停在这里。",
    stage_complete: "这一阶段已经收好了。",
    task_complete: "可以休息了......",
    needs_input: "唔，出现问题了",
    info: "有一条新消息。",
  };
  const meta = [event.project, event.stage].filter(Boolean).join(" · ");
  const fixedCopy = ['work_started', 'turn_ended', 'task_complete', 'needs_input'].includes(event.type);
  return { title, message: (fixedCopy ? fallback[event.type] : event.message) || fallback[event.type] || "有一条新消息。", meta };
}

function showEvent(event: PetEvent): void {
  if(event.type==='work_started'){
    outcomeFeedback.clearSession(event.sessionId);
    if(feedback?.event.sessionId===event.sessionId)feedback=null;
    dizzyUntil=0;orbit.reset();
  }
  if(!remindersEnabled(currentPreferences)){
    if(isQuestionReminder(event)){questionReminder.show(event,performance.now());questionReminder.dismiss();void window.petBridge.markRead(event.id);}
    celebrationSequence.enqueue(event);celebrationSequence.clearPending();
    outcomeFeedback.enqueue(event);outcomeFeedback.clear();syncFlatActivity();return;
  }
  // Aggregate activity queues the super notice. Individual starts within that
  // workload must not replace it with an ordinary work bubble or replay it.
  if(event.type==='work_started' && hasSuperWorkload(latestActivity)){
    syncFlatActivity();return;
  }
  if (isQuestionReminder(event)) {
    if (!questionReminder.show(event, performance.now())) return;
    quotaBoardUntil=0;
    clearRepeatedTouch();
    interruptCelebration(true);
    dizzyUntil=0;orbit.reset();
    if(dragPointer===null){flatTouchUntil=0;window.clearTimeout(flatTouchTimer);}
    displayBubble(event);
    syncFlatActivity();
    return;
  }
  if (isSuccessfulCompletion(event)) {
    if (celebrationSequence.enqueue(event)) syncFlatActivity();
    return;
  }
  if(outcomeFeedback.enqueue(event)){
    quotaBoardUntil=0;
    interruptCelebration(true);dizzyUntil=0;orbit.reset();syncFlatActivity();return;
  }
  if (event.replayed && ['turn_ended', 'task_complete'].includes(event.type)) return;
  // An unverified Stop hook is a quiet message. A later native success supplies
  // the celebration and its final notice without hiding another pending input.
  if (questionReminder.active(performance.now()) || celebration || feedback) return;
  displayBubble(event);
}

function interruptCelebration(deferNotice = false): void {
  if (celebration && !celebration.noticeShown) {
    if (deferNotice) deferredCompletionNotices.push(celebration.event);
    else displayBubble(celebration.event);
  }
  celebration = null;
}

function hideBubble(): void {
  window.clearTimeout(bubbleTimer);
  window.clearTimeout(bubbleVoiceTimer);
  bubbleVoice.stop();
  if (currentEvent && !currentEvent.id.startsWith(SUPER_WORK_BUBBLE_PREFIX)) void window.petBridge.markRead(currentEvent.id);
  currentEvent = null;
  if (speechBubble.hidden) return;
  const reducedMotion = Boolean(currentPreferences?.reducedMotion ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reducedMotion) {
    window.clearTimeout(bubbleFadeTimer);
    bubbleFadeTimer = 0;
    speechBubble.hidden = true;
    speechBubble.classList.remove('bubble-out');
    return;
  }
  // Keep the existing entrance of each part intact; fade their shared parent.
  // Dismiss the notice immediately, while retaining its painted content briefly.
  if (speechBubble.classList.contains('bubble-out')) return;
  speechBubble.style.setProperty('--bubble-fade-duration', BUBBLE_FADE_MS + 'ms');
  speechBubble.classList.add('bubble-out');
  bubbleFadeTimer = window.setTimeout(() => {
    bubbleFadeTimer = 0;
    speechBubble.hidden = true;
    speechBubble.classList.remove('bubble-out');
  }, BUBBLE_FADE_MS);
}

function displayBubble(event: PetEvent): void {
  if (!shouldShowBubble(event)||!remindersEnabled(currentPreferences)) return;
  // A replacement notice owns the same element and must outlive the old fade.
  window.clearTimeout(bubbleFadeTimer);
  bubbleFadeTimer = 0;
  speechBubble.classList.remove('bubble-out');
  document.querySelector<HTMLButtonElement>('#answer-button')!.hidden=!isQuestionReminder(event);
  resetSleepTimer();
  window.clearTimeout(workTransitionTimer);
  currentEvent = event;
  const content = eventMessage(event);
  const question = isQuestionReminder(event);
  speechBubble.dataset.kind = question ? 'question' : event.id.startsWith(SUPER_WORK_BUBBLE_PREFIX) ? 'super-work' : 'completion';
  kickerNode.textContent = content.title;
  kickerNode.hidden = !question;
  messageNode.textContent = content.message;
  metaNode.textContent = content.meta ? "项目：" + content.meta : "";
  speechBubble.hidden = false;
  speechBubble.classList.toggle('bubble-reduced', Boolean(currentPreferences?.reducedMotion ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  speechBubble.classList.remove("bubble-in");
  void speechBubble.offsetWidth;
  speechBubble.classList.add("bubble-in");
  window.clearTimeout(bubbleVoiceTimer);
  bubbleVoice.stop();
  const voiceDelay = Math.max(0, Number.parseFloat(getComputedStyle(messageNode).animationDelay) || 0) * 1000;
  bubbleVoiceTimer = window.setTimeout(() => {
    if (currentEvent?.id === event.id && !speechBubble.hidden) {
      touchVoice.stop();
      bubbleVoice.play(event.id, content.message);
    }
  }, voiceDelay);
  window.clearTimeout(bubbleTimer);

  const milliseconds = question ? QUESTION_REMINDER_MS : (currentPreferences?.bubbleSeconds ?? 8) * 1000;
  bubbleTimer = window.setTimeout(() => {
    if (currentEvent?.id !== event.id) return;
    hideBubble();
    if (question) { questionReminder.dismiss(); syncFlatActivity(); }
  }, milliseconds);

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
  if (preferences.reducedMotion && speechBubble.classList.contains('bubble-out')) hideBubble();
  if (preferences.doNotDisturb) touchVoice.stop();
  if(!remindersEnabled(preferences)){
    hideBubble();questionReminder.dismiss();celebration=null;celebrationSequence.clearPending();
    deferredCompletionNotices.length=0;feedback=null;outcomeFeedback.clear();
    superWorkBubbleGate.discard();
  }

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
  if(!SETTINGS_VIEW)syncFlatActivity();
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
  const now = performance.now();
  const tearful=repeatedTouch.active(now);
  rig?.setTearful(tearful);
  if(feedback&&now>=feedback.until)feedback=null;
  if(dizzyUntil&&now>=dizzyUntil){dizzyUntil=0;idleCadence.reset(now);}
  if(celebration&&now-celebration.startedAt>=CELEBRATION_SECONDS[celebration.variant]*1000){
    if(!celebration.noticeShown)displayBubble(celebration.event);celebration=null;
  }
  if (currentEvent && isQuestionReminder(currentEvent) && !questionReminder.active(now)) {
    hideBubble(); questionReminder.dismiss();
  }
  const questioning = questionReminder.active(now);
  const workingCount = latestActivity.workingProjectCount ?? (latestActivity.phase === 'working' ? 1 : 0);
  activityState = questioning ? 'attention' : latestActivity.phase === 'working' || workingCount > 0 ? 'working' : 'idle';
  fullPower = activityState === 'working' && (latestActivity.fullPower === true || workingCount >= 2);
  const interaction=Date.now()<flatTouchUntil || (dragPointer!==null && dragDistance>4);
  const step=idleCadence.tick(now,activityState!=='idle'||latestActivity.phase==='asking'||celebration||feedback?'busy':interaction||dizzyUntil>now||tearful?'interaction':'idle');
  if(interaction)return;
  if(quotaBoardUntil>now){setAction('quota-board');setStatus('查看五小时剩余额度');return;}
  if(questioning){clearRepeatedTouch();setAction('ask');setStatus('等你回复');return;}
  if(latestActivity.phase!=='idle'||workingCount>0){dizzyUntil=0;orbit.reset();}
  if(!feedback&&rig?.canvas.dataset.ready==='true'&&remindersEnabled(currentPreferences)){
    const next=outcomeFeedback.takeNext();if(next){feedback={...next,until:now+feedbackDuration(next.kind)};rig.setAction(('feedback-'+next.kind) as RigAction,true);displayBubble(next.event);}
  }
  if(feedback){clearRepeatedTouch();setAction('feedback-'+feedback.kind);setStatus('任务状态提醒');return;}
  if (!questioning && deferredCompletionNotices.length) displayBubble(deferredCompletionNotices.shift()!);
  if (!celebration && !questioning && rig?.canvas.dataset.ready === 'true') {
    const next = celebrationSequence.takeNext();
    if (next) {
      if (currentEvent && !isQuestionReminder(currentEvent)) hideBubble();
      celebration = { ...next, startedAt: now, noticeShown: false };
      setAction(next.variant === 'A' ? 'celebrate-poppers' : 'celebrate-clap');
      setStatus('任务完成了');
    }
  }
  if (celebration) {
    clearRepeatedTouch();
    if (!celebration.noticeShown && now - celebration.startedAt >= (CELEBRATION_SECONDS[celebration.variant] - .55) * 1000) {
      celebration.noticeShown = true;
      displayBubble(celebration.event);
    }
    return;
  }
  if(tearful){setAction('tearful');setStatus('被按得有点委屈……');return;}
  if(dizzyUntil>now){setAction('dizzy');setStatus('被绕晕了……');return;}
  const action=activityState==='working'?(fullPower?'power-work':'work'):activityState==='attention'?'ask':step.action;
  setAction(action);
  const labels:Record<string,string>={idle:'安静地待机中',nap:'小憩中',water:'给黄瓜浇水','water-happy':'黄瓜喝饱水了',work:'正在认真处理','power-work':'正在全力处理多个项目',ask:'等你回复'};
  setStatus(labels[action]);
  if(action==='power-work' && superWorkBubbleGate.pending && remindersEnabled(currentPreferences) &&
    (!currentEvent || currentEvent.type==='work_started')){
    const id=superWorkBubbleGate.take()!;
    // Renderer-owned presentation of verified aggregate state; no synthetic
    // Codex task is sent to the bridge or persisted in notification history.
    displayBubble({id,source:'demo',type:'work_started',createdAt:latestActivity.updatedAt,read:true});
  }
}

function applyActivity(activity: PetActivity, announceSuperWork = false): void {
  latestActivity = activity;
  superWorkBubbleGate.observe(activity, announceSuperWork);
  if(!remindersEnabled(currentPreferences))superWorkBubbleGate.discard();
  if(!hasSuperWorkload(activity) && currentEvent?.id.startsWith(SUPER_WORK_BUBBLE_PREFIX))hideBubble();
  if (activity.phase !== "asking" &&
      currentEvent && isQuestionReminder(currentEvent)) {
    hideBubble(); questionReminder.dismiss();
  }
  if (activity.phase !== 'asking') questionReminder.dismiss();
  if(activity.phase!=='asking'&&!speechBubble.classList.contains('bubble-out')) document.querySelector<HTMLButtonElement>('#answer-button')!.hidden=true;
  syncFlatActivity();
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
    (Boolean(target?.closest("[data-drag-handle]")) && onTouchTarget(event.clientX, event.clientY));
  window.petBridge.setMouseIgnored(!interactive);
}

function setupPetView(): void {
  document.body.dataset.view = "pet";
  touchVoice.prepare();
  window.petBridge.onQuota(quota=>{latestQuota=quota;rig?.setQuota(quota);});
  new MutationObserver(updateLayout).observe(speechBubble,{attributes:true,attributeFilter:["hidden"]});
  new MutationObserver(updateLayout).observe(document.querySelector("#answer-button")!,{attributes:true,attributeFilter:["hidden"]});
  new ResizeObserver(updateLayout).observe(speechBubble);
  window.petBridge.onViewport(v=>{petRoot.style.setProperty("--safe-left",v.left+"px");petRoot.style.setProperty("--safe-width",v.width+"px");});
  window.petBridge.onCursor(point=>{
    if(!rig)return;const b=rig.canvas.getBoundingClientRect();if(b.width<=0)return;
    const ratio=b.width/rig.canvas.width,faceY=b.top+(rig.canvas.height===1152?840:rig.canvas.height-512+261)*ratio,petWidth=512*ratio;
    rig.setLookTarget(Math.tanh((point.x-(b.left+b.width/2))/(petWidth*1.5)),Math.tanh((point.y-faceY)/(petWidth*1.65)));
    const now=performance.now(),pureIdle=rig.action==='idle'&&latestActivity.phase==='idle'&&(latestActivity.workingProjectCount??0)===0&&dragPointer===null&&Date.now()>=flatTouchUntil&&!celebration&&!feedback&&dizzyUntil<=now&&!repeatedTouch.active(now);
    if(orbit.sample(point.x-(b.left+b.width/2),point.y-(b.top+(rig.canvas.height-256)*ratio),petWidth,now,pureIdle)){
      dizzyUntil=now+DIZZY_SECONDS*1000;idleCadence.reset(now);syncFlatActivity();
    }
  });
  settingsView.hidden = true;
  petView.hidden = false;
  window.addEventListener('resize', updateLayout);
  characterMount.addEventListener('contextmenu',event=>{
    if(!(event.target as Element).closest('[data-drag-handle]')||!onVisibleArt(event.clientX,event.clientY)||!rig)return;
    event.preventDefault();
    if(quotaBoardUntil>performance.now()){
      void window.petBridge.refreshQuota().then(quota=>{latestQuota=quota;rig?.setQuota(quota);}).catch(()=>{});return;
    }
    if(currentEvent&&!isQuestionReminder(currentEvent))hideBubble();
    clearRepeatedTouch();touchVoice.stop();interruptCelebration(questionReminder.active(performance.now()));
    flatTouchUntil=0;window.clearTimeout(flatTouchTimer);dizzyUntil=0;feedback=null;orbit.reset();
    idleCadence.reset(performance.now());quotaBoardUntil=performance.now()+QUOTA_BOARD_SECONDS*1000;
    rig.setQuota(latestQuota);syncFlatActivity();
    void window.petBridge.refreshQuota().then(quota=>{latestQuota=quota;rig?.setQuota(quota);}).catch(()=>{});
  });

  document.querySelector('#answer-button')?.addEventListener('click', async () => {
    const result=await window.petBridge.openCodex();
    if(!result.ok) messageNode.textContent=result.error || '请从任务栏打开 Codex。';
  });
  window.petBridge.onTransform(() => {
    if (!presentationPolicy.transformation || !rig || activityState === 'attention') return;
    window.clearTimeout(flatIdleTimer); flatTouchUntil=Date.now()+TURN_SECONDS*1000; setAction('transform');
  });
  document.addEventListener("mousemove", (event) => {
    updateMouseMode(event);

  });
  document.addEventListener("pointermove", (event) => {
    if (dragPointer !== event.pointerId) return;
    // Screen movement measures the user's gesture; client coordinates can move
    // merely because the native window has been repositioned under the cursor.
    dragDistance += Math.abs(event.screenX-lastPointer.x)+Math.abs(event.screenY-lastPointer.y);
    if (rig && dragDistance > 4) {
      quotaBoardUntil=0;
      clearRepeatedTouch();
      lastTouchPoint=null;
      interruptCelebration(questionReminder.active(performance.now()));
      dizzyUntil=0;feedback=null;orbit.reset();
      window.clearTimeout(flatIdleTimer); flatTouchUntil=0;
      setAction('drag');
      const now=performance.now();rig.setDragMotion(event.screenX-lastPointer.x,now-lastPointerTime,event.screenX-dragStartPointer.x);lastPointerTime=now;
    }
    window.petBridge.moveWindow(event.screenX - lastPointer.x, event.screenY - lastPointer.y);
    lastPointer = { x: event.screenX, y: event.screenY };
  });
  characterMount.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const actualHit=onVisibleArt(event.clientX,event.clientY);
    if (!(event.target as Element).closest("[data-drag-handle]") ||
      (!actualHit&&!onTouchTarget(event.clientX, event.clientY))) return;
    pointerStartedOnArt=actualHit;
    quotaBoardUntil=0;
    cancelledPastime=!!rig && ['nap','water','water-happy'].includes(rig.action);
    dizzyUntil=0;feedback=null;orbit.reset();
    idleCadence.reset(performance.now());
    if(cancelledPastime){flatTouchUntil=0;window.clearTimeout(flatTouchTimer);rig?.cancelToIdle();setAction('idle');}
    dragPointer = event.pointerId;
    rig?.beginDrag();lastPointerTime=performance.now();
    dragDistance = 0;
    dragStartPointer = { x: event.screenX, y: event.screenY };
    lastPointer = { x: event.screenX, y: event.screenY };
    dragStartClientPointer = { x: event.clientX, y: event.clientY };
    window.petBridge.setMouseIgnored(false);
    characterMount.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  const finishDrag = (event: PointerEvent, cancelled = false) => {
    if (dragPointer !== event.pointerId) return;
    const endDistance = Math.abs(event.screenX - dragStartPointer.x) +
      Math.abs(event.screenY - dragStartPointer.y);
    const clicked = !cancelled && Math.max(dragDistance, endDistance) <= 4;
    dragPointer = null;
    idleCadence.reset(performance.now());
    if(!clicked)clearRepeatedTouch();
    if ((!clicked || cancelledPastime) && rig) syncFlatActivity();
    // Preserve the native drag-position reset, then re-enable valid tap input.
    window.petBridge.setMouseIgnored(true);
    if (clicked && !cancelledPastime && currentPreferences?.model === "flat-chibi") {
      interruptCelebration(questionReminder.active(performance.now()));
      if(pointerStartedOnArt)lastTouchPoint={x:dragStartClientPointer.x,y:dragStartClientPointer.y};
      flatTouchUntil = Date.now() + TOUCH_SECONDS * 1000;
      const now = performance.now();
      const triggered = repeatedTouch.tap(now);
      const tearful = repeatedTouch.active(now);
      if (triggered || !tearful) {
        window.clearTimeout(bubbleVoiceTimer);
        bubbleVoice.stop();
      }
      touchVoice.tap(triggered, tearful, !currentPreferences?.doNotDisturb);
      rig?.setTearful(tearful);
      window.clearTimeout(flatIdleTimer);
      window.clearTimeout(flatTouchTimer);
      setAction("touch",0,true);
      flatTouchTimer = window.setTimeout(() => {
        flatTouchUntil = 0;
        lastTouchPoint=null;
        syncFlatActivity();
      }, TOUCH_SECONDS * 1000);
      // A stationary pointer can click repeatedly without needing a mousemove
      // event to turn native hit testing back on after every mouse release.
      window.petBridge.setMouseIgnored(false);
    } else {
      lastTouchPoint=null;
      window.petBridge.setMouseIgnored(true);
    }
  };
  characterMount.addEventListener("pointerup", finishDrag);
  characterMount.addEventListener("pointercancel", (event) => finishDrag(event, true));
  characterMount.addEventListener('lostpointercapture', () => {
    if (dragPointer !== null) { dragPointer=null;lastTouchPoint=null;clearRepeatedTouch();idleCadence.reset(performance.now());syncFlatActivity();window.petBridge.setMouseIgnored(true); }
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
      hideBubble(); questionReminder.dismiss(); syncFlatActivity();
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
  document.querySelector<HTMLInputElement>('#dnd-toggle')!.checked=preferences.doNotDisturb;
  document.querySelector<HTMLInputElement>('#notifications-toggle')!.checked=preferences.notificationsEnabled;
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
  for(const [id,key] of [['dnd-toggle','doNotDisturb'],['notifications-toggle','notificationsEnabled']] as const){
    document.querySelector<HTMLInputElement>('#'+id)!.addEventListener('change',async event=>{
      const control=event.currentTarget as HTMLInputElement;control.disabled=true;
      try{await savePreference({[key]:control.checked});}catch{control.checked=currentPreferences?.[key]??false;}finally{control.disabled=false;}
    });
  }
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
    void window.petBridge.sendTest("needs_input");
  });
}

async function start(): Promise<void> {
  if (SETTINGS_VIEW) setupSettingsView();
  else setupPetView();

  let receivedActivity = false;
  let initialized = false;
  const earlyEvents: PetEvent[] = [];
  window.petBridge.onEvent((event) => {
    if (!SETTINGS_VIEW) {
      if (initialized) showEvent(event);
      else earlyEvents.push(event);
    } else {
      void window.petBridge.getBootstrap().then((state) => {
        renderHistory(state.history);
        updateConnectionStatus(state.bridgeReady, state.lastHookEventAt, state.lastMcpEventAt);
      });
    }
  });
  window.petBridge.onActivity((activity) => {
    receivedActivity = true;
    applyActivity(activity, initialized && !SETTINGS_VIEW);
  });
  const bootstrap = await window.petBridge.getBootstrap();
  latestQuota=bootstrap.quota??unknownCodexQuota();
  applyPreferences(bootstrap.preferences);
  if (!SETTINGS_VIEW) {
    if (!receivedActivity) applyActivity(bootstrap.activity);
    else syncFlatActivity();
    if (!receivedActivity && latestActivity.phase === 'asking' && bootstrap.pendingReminder) showEvent(bootstrap.pendingReminder);
  }
  if (SETTINGS_VIEW) {
    updateConnectionStatus(bootstrap.bridgeReady, bootstrap.lastHookEventAt, bootstrap.lastMcpEventAt);
    renderHistory(bootstrap.history);
  }

  window.petBridge.onPreferences(applyPreferences);
  initialized = true;
  for (const event of earlyEvents) showEvent(event);
  if (!SETTINGS_VIEW) await window.petBridge.rendererReady();
  if (!SETTINGS_VIEW) resetIdleDance();
  if (!SETTINGS_VIEW) { resetSleepTimer();updateLayout();window.setInterval(syncFlatActivity,100); }
}

if (new URLSearchParams(location.search).has('review')) void setupReview();
else if(new URLSearchParams(location.search).has('projects'))void setupProjectsView();
else void start();
