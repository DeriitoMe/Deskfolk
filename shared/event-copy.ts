import type {PetEvent, PetEventType} from './types';
import {translate, type AppLocale} from './i18n.ts';
import {feedbackKind} from './outcome-feedback.ts';
import {NORMAL_WORK_MESSAGE, SUPER_WORK_MESSAGE, SUPER_WORK_BUBBLE_PREFIX} from './work-bubble.ts';

const TITLES: Record<PetEventType, string> = {
  work_started: '开始处理', work_progress: '正在处理', approval_needed: '需要你确认',
  approval_resolved: '授权等待已解除', turn_ended: '这一轮结束了', interrupted: '已经暂停',
  stage_complete: '阶段完成', task_complete: '任务完成', needs_input: '等你回复',
  input_resolved: '已收到回答', input_sync: '问题状态同步', info: '有一条通知',
};
export const eventTitle = (event: PetEvent, locale: AppLocale) => translate(locale, TITLES[event.type]);

/** A stable audio identity, independent of the language of the visible text. */
export function eventVoiceMessage(event: PetEvent): string {
  if (feedbackKind(event)) return '';
  if (event.type === 'work_started') return event.id.startsWith(SUPER_WORK_BUBBLE_PREFIX) ? SUPER_WORK_MESSAGE : NORMAL_WORK_MESSAGE;
  if (['turn_ended', 'task_complete'].includes(event.type)) return '可以休息了......';
  if (event.type === 'needs_input') return '唔，出现问题了';
  return '';
}

export function eventMessage(event: PetEvent, locale: AppLocale): {title: string; message: string; meta: string} {
  const t = (message: string) => translate(locale, message);
  const negative = feedbackKind(event);
  if (negative) return {
    title: t({failed: '任务失败', paused: '已经暂停', quota: '额度耗尽'}[negative]),
    message: t({failed: '卡住了……这次没能完成。', paused: '暂停了……', quota: '额度用完了……先休息一下。'}[negative]),
    meta: event.project ?? '',
  };
  const fallback: Partial<Record<PetEventType, string>> = {
    work_started: eventVoiceMessage(event), work_progress: '我还在处理。', approval_needed: 'Codex 有一项操作等待确认。',
    turn_ended: '可以休息了......', interrupted: '我先停在这里。', stage_complete: '这一阶段已经收好了。',
    task_complete: '可以休息了......', needs_input: '唔，出现问题了', info: '有一条新消息。',
  };
  const fixed = ['work_started', 'turn_ended', 'task_complete', 'needs_input'].includes(event.type);
  const owned = event.source === 'demo';
  const message = !fixed && event.message ? (owned ? t(event.message) : event.message) : t(fallback[event.type] || '有一条新消息。');
  return {title: eventTitle(event, locale), message,
    meta: [event.project, event.stage].filter(Boolean).map(value => owned ? t(value!) : value).join(' · ')};
}
