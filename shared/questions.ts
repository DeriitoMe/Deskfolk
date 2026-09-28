import { randomUUID } from 'node:crypto';
import type { PetQuestion } from './types';

// A request is live only while its MCP caller keeps polling. No persisted request
// is treated as answerable after an app restart.
export const QUESTION_LEASE_MS = 120_000;
export const QUESTION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const clean = (value: unknown, limit: number): string => typeof value === 'string'
  ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, limit).join('') : '';
export class QuestionStore {
  readonly items = new Map<string, PetQuestion>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  create(input: Record<string, unknown>): PetQuestion {
    this.sweep();
    if (this.live().length >= 12) throw new Error('待回答问题过多，请先处理已有问题。');
    const title = clean(input.title, 1200);
    if (!title) throw new Error('问题内容不能为空。');
    if (input.purpose === 'approval') throw new Error('系统审批请使用 Codex 原界面。');
    const options = Array.isArray(input.options) ? input.options.map(o => clean(o, 240)).filter(Boolean).slice(0, 5) : [];
    const sessionId = clean(input.sessionId, 120) || `pet-${randomUUID()}`;
    const turnId = clean(input.turnId, 120) || undefined;
    const now = this.now();
    const q: PetQuestion = { id: randomUUID(), title, options: [...new Set(options)],
      project: clean(input.project, 80), sessionId, turnId, status: 'pending',
      createdAt: now, lastPollAt: now, expiresAt: now + QUESTION_LIFETIME_MS };
    this.items.set(q.id, q);
    return q;
  }
  live(): PetQuestion[] { return [...this.items.values()].filter(q => q.status === 'pending' || q.status === 'answered'); }
  get(id: string): PetQuestion {
    this.sweep();
    const q = this.items.get(id);
    if (!q) throw new Error('问题不存在或桌宠已重新启动，请重新提问。');
    return q;
  }
  poll(id: string, sessionId?: string, turnId?: string): PetQuestion {
    const q = this.get(id);
    if (sessionId && q.sessionId !== sessionId || turnId && q.turnId !== turnId) throw new Error('问题不属于这个会话或回合。');
    q.lastPollAt = this.now();
    return q;
  }
  answer(id: string, value: unknown): PetQuestion {
    const q = this.get(id);
    if (q.status !== 'pending') throw new Error('这个问题已回答、取消或过期。');
    const answer = clean(value, 4000);
    if (!answer) throw new Error('请选择选项或输入回答。');
    q.answer = answer; q.status = 'answered';
    return q;
  }
  acknowledge(id: string): PetQuestion {
    const q = this.get(id);
    if (q.status !== 'answered' && q.status !== 'consumed') throw new Error('此问题还没有可接收的回答。');
    q.status = 'consumed';
    return q;
  }
  cancel(id: string, reason = '已取消'): PetQuestion {
    const q = this.get(id);
    if (q.status === 'pending' || q.status === 'answered') { q.status = 'cancelled'; q.reason = reason; }
    return q;
  }
  cancelSession(sessionId: string, turnId?: string, replacement = false): void {
    for (const q of this.live()) if (q.sessionId === sessionId &&
      (replacement ? !!q.turnId && !!turnId && q.turnId !== turnId : !turnId || !q.turnId || q.turnId === turnId)) {
      q.status = 'cancelled'; q.reason = replacement ? '新回合已开始' : 'Codex 已中断';
    }
  }
  sweep(): boolean {
    let changed = false;
    for (const q of this.items.values()) {
      if ((q.status === 'pending' || q.status === 'answered') &&
        (this.now() >= q.expiresAt || this.now() - q.lastPollAt > QUESTION_LEASE_MS)) {
        q.status = 'expired'; q.reason = '提问连接已失效，请在 Codex 中重新提问'; changed = true;
      }
      if (this.now() - q.createdAt > QUESTION_LIFETIME_MS * 2) this.items.delete(q.id);
    }
    return changed;
  }
}
