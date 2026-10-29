import { createHash, randomUUID } from 'node:crypto';
import { createSender } from './bridge-client.mjs';
import { ensurePetRunning } from './launch-pet.mjs';

export const name = 'deskfolk-deepseek-harness';
export const inject = ['agents', 'sessions', 'sessionProjections'];
export const HEARTBEAT_MS = 5_000;
/** 让 Host 先启动完，再去看桌宠是否在跑。 */
export const LAUNCH_DELAY_MS = 1_500;
const pick = (value, limit = 100) => typeof value === 'string' && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit) : undefined;
const safe = fn => { try { return fn(); } catch { return undefined; } };
// Preserve short opaque identities; hash rather than truncate long identifiers.
const opaque = value => typeof value !== 'string' || !value ? undefined
  : value.length<=100 && value.trim()===value && !/[\u0000-\u001f\u007f]/.test(value) ? value
    : 'opaque:' + createHash('sha256').update(value).digest('hex');

/** Only public lifecycle metadata is copied into the Deskfolk wire protocol. */
export class HarnessObserver {
  constructor(ctx, send, { now = Date.now, streamId = randomUUID() } = {}) {
    this.ctx = ctx; this.send = send; this.now = now; this.streamId = streamId;
    this.states = new Map();
  }

  state(session) {
    let state = this.states.get(session.id);
    if (state) return state;
    state = { session, turn: 0, complete: true, sequence: this.sequences?.get(session.id) ?? 0, pending: new Map(), tools: new Map(), reason: undefined };
    // One adoption scan; only turn and approval identity fields are inspected.
    // Fork-inherited events describe the parent, not this live session.
    const inherited = session.inheritedEventCount ?? 0;
    for (const event of session.snapshotEvents(inherited)) this.fold(state, event);
    this.states.set(session.id, state);
    this.publish(state, 'snapshot');
    return state;
  }

  fold(state, event) {
    const data = event.data ?? {};
    if (event.type === 'turn/start' && Number.isSafeInteger(data.turn) && data.turn >= state.turn) {
      state.turn = data.turn; state.complete = false; state.reason = undefined;
      state.errorCode = undefined;
      // Continued timed questions are restored from the native projection.
      state.pending.clear();
      state.tools.clear();
    } else if (event.type === 'turn/end' && data.turn === state.turn) {
      state.complete = true; state.reason = pick(data.reason?.kind, 40);
      state.errorCode = pick(data.reason?.error?.code, 60);
      state.tools.clear();
      if (state.reason !== 'completed') state.pending.clear();
    } else if (event.type === 'approval/asked' && opaque(data.id)) {
      state.pending.set(`approval:${opaque(data.id)}`, 'approval');
    } else if (event.type === 'approval/decided' && opaque(data.id)) {
      state.pending.delete(`approval:${opaque(data.id)}`);
    }
  }

  inputs(state) {
    const pending = new Map(state.pending);
    // Use Harness's own fold for timed questions, PTC asks and late replies.
    // Never parse or forward question text, tool arguments, or answer contents.
    const view = safe(() => this.ctx.sessionProjections.snapshot(state.session, ['userQuestions']).values.userQuestions);
    if (state.reason === undefined || state.reason === 'completed') {
      for (const question of view?.active ?? []) {
        const id = opaque(question.callId);
        if (id) pending.set(id, 'question');
      }
    }
    return [...pending].map(([id, kind]) => ({ id, kind }));
  }

  publish(state, event, extra = {}) {
    const session = state.session, header = session.header ?? {};
    const pendingInputs = this.inputs(state);
    const agent = safe(() => this.ctx.agents.get(session.id));
    const status = pendingInputs.length ? 'asking' : agent?.status === 'running' && !state.complete ? 'running' : 'idle';
    const sequence=++state.sequence;
    (this.sequences ??= new Map()).set(session.id,sequence);
    this.send({ version: 1, streamId: this.streamId, sessionId: opaque(session.id),
      sequence, time: this.now(), turn: state.turn, event,
      cwd: pick(header.cwd, 1024), origin: header.origin === 'subagent' ? 'subagent' : 'main',
      status, turnComplete: state.complete, pendingInputs, reason: state.reason, errorCode: state.errorCode,
      activeTools: [...state.tools].map(([id, name]) => ({ id, name })), ...extra });
  }

  observe(session, event) {
    const current=this.states.get(session.id);
    if(current && ['turn/start','turn/end'].includes(event.type) && event.data?.turn<current.turn)return;
    const existed = this.states.has(session.id);
    const state = this.state(session);
    // Adoption already folded the event currently being dispatched.
    if (existed) this.fold(state, event);
    const data = event.data ?? {};
    switch (event.type) {
      case 'turn/start':
        this.publish(state, 'turn/start'); break;
      case 'turn/end':
        this.publish(state, 'turn/end', { reason: pick(data.reason?.kind, 40),
          errorCode: pick(data.reason?.error?.code, 60) }); break;
      case 'approval/asked':
        if(opaque(data.id))this.publish(state, 'input/required', { callId: `approval:${opaque(data.id)}`, kind: 'approval' }); break;
      case 'approval/decided':
        if(opaque(data.id))this.publish(state, 'input/resolved', { callId: `approval:${opaque(data.id)}`, kind: 'approval' }); break;
      case 'tool/result':
      case 'tool/ptc-dispatch':
      case 'user/message':
        // A projection can settle a continued question on any of these.
        this.publish(state, 'snapshot'); break;
    }
  }

  question(request, next) {
    const session = request.agent?.session;
    if (!session) return next();
    const state = safe(() => this.state(session));
    if (!state) return next();
    const turn = state.turn;
    const callId = opaque(request.wait?.callId) ?? `question:${randomUUID()}`;
    state.pending.set(callId, 'question');
    safe(() => this.publish(state, 'input/required', { callId, kind: 'question' }));
    return (async () => {
      try { return await next(); }
      finally {
        // Keep an old request's finally from clearing a newer turn's requests.
        if (state.turn === turn) {
          state.pending.delete(callId);
          safe(() => {
            const continued = this.inputs(state).some(input => input.id === callId);
            this.publish(state, continued ? 'snapshot' : 'input/resolved', { callId, kind: 'question' });
          });
        }
      }
    })();
  }

  async tool(exec, next) {
    const session = exec.agent?.session;
    if (!session) return next();
    const state = safe(() => this.state(session));
    if (!state) return next();
    const turn = state.turn;
    const callId = opaque(exec.callId), toolName = pick(exec.name, 80);
    if (!callId || !toolName) return next();
    state.tools.set(callId, toolName);
    safe(() => this.publish(state, 'tool/call', { callId, toolName }));
    try { return await next(); }
    finally {
      if (state.turn === turn) {
        state.tools.delete(callId);
        safe(() => this.publish(state, 'tool/result', { callId, toolName }));
      }
    }
  }

  heartbeat() {
    for (const agent of this.ctx.agents.list()) this.publish(this.state(agent.session), 'snapshot');
  }

  disposed(agent) {
    const state = this.states.get(agent.session.id);
    if (!state) return;
    state.pending.clear(); state.tools.clear(); state.complete = true; state.reason = 'aborted';
    this.publish(state, 'agent/disposed', { status: 'idle', pendingInputs: [] });
    this.states.delete(agent.session.id);
  }
}

/** Passive observers preserve every native tool result, answer and error. */
export function apply(ctx) {
  const sender = createSender();
  const observer = new HarnessObserver(ctx, body => sender.send(body));
  const watch = (event, fn, options = {}) => ctx.on(event, (...args) => safe(() => fn(...args)), { global: true, ...options });
  watch('session/event', (session, event) => observer.observe(session, event));
  watch('agent/created', ({ agent }) => { observer.state(agent.session); });
  watch('agent/status', ({ agent }) => observer.publish(observer.state(agent.session), 'agent/status'));
  watch('agent/disposed', ({ agent }) => observer.disposed(agent));
  ctx.on('user-questions/request', (request, next) => observer.question(request, next), { global: true, prepend: true });
  ctx.on('tools/execute', (exec, next) => observer.tool(exec, next), { global: true, prepend: true });
  observer.heartbeat();
  const timer = setInterval(() => safe(() => observer.heartbeat()), HEARTBEAT_MS);
  timer.unref();
  // 「随 DeepSeek Harness 启动」：桌宠没在跑才拉起，用户关掉开关就什么都不做。
  const launchTimer = setTimeout(() => {
    void ensurePetRunning().then(result => {
      if (result !== 'launched' && result !== 'recent') return;
      safe(() => ctx.logger?.info?.(`deskfolk-deepseek-harness: pet ${result}`));
    }).catch(() => {});
  }, LAUNCH_DELAY_MS);
  launchTimer.unref();
  ctx.effect(() => () => { clearInterval(timer); clearTimeout(launchTimer); sender.close(); }, 'deskfolk-deepseek-harness');
}
