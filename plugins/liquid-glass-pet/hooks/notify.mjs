import { basename, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const type = process.argv[2];
const typeMap = new Map([
  ["work_started", "work_started"],
  ["work_progress", "work_progress"],
  ["tool_finished", "work_progress"],
  ["turn_ended", "turn_ended"],
  ["interrupted", "interrupted"],
]);

/** Build only local reminder telemetry; never return a Codex permission decision. */
export function hookEvents(action, input, threadId) {
  // A PermissionRequest can be resolved automatically. Retired actions are
  // ignored even while Codex still has an older hook definition loaded.
  const mappedType = typeMap.get(action ?? '');
  if (!mappedType || (action === 'turn_ended' && input.stop_hook_active === true)) return [];
  const cwd = typeof input.cwd === 'string' ? input.cwd : '';
  const project = cwd ? basename(cwd.replace(/[\\/]+$/, '')) : undefined;
  const session = typeof input.session_id === 'string' ? input.session_id : threadId;
  const turn = typeof input.turn_id === 'string' ? input.turn_id : undefined;
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
  const callId = typeof input.tool_use_id === 'string' && input.tool_use_id ? input.tool_use_id : undefined;
  // PreToolUse only records an attempted call, including unsupported question
  // calls. The native observer owns reminders for questions actually accepted.
  const answered = action === 'tool_finished' && /(?:^|[._])request_user_input$/.test(toolName) &&
    !!session && !!turn && !!callId;
  const eventType = answered ? 'input_resolved' : mappedType;
  const base = {
    source: 'hook', sessionId: session, turnId: turn, project,
    projectPath: cwd || undefined,
    isSubagent: input.is_subagent === true || input.isSubagent === true ||
      (typeof input.source === 'object' && !!input.source?.subagent) || undefined,
  };
  const event = {
    ...base, type: eventType,
    outcome: action === 'interrupted' ? 'interrupted' : undefined,
    nativeCallId: answered ? callId : undefined,
    message: '',
  };
  return [{...event, id: 'hook:' + event.type + ':' + session + ':' + turn + ':' +
    (callId || randomUUID())}];
}

function outputForHook() {
  if (type === "turn_ended" || type === "interrupted") process.stdout.write("{}\n");
}

async function readInput() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += data.length;
    if (total > 262_144) throw new Error("hook input too large");
    chunks.push(data);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function notify() {
  try {
    if (!typeMap.has(type ?? '')) return;
    const hookInput = await readInput().catch(() => ({}));
    const events = hookEvents(type, hookInput, process.env.CODEX_THREAD_ID);
    if (!events.length) return;
    const appData = process.env.APPDATA;
    if (!appData) return;
    const settings = JSON.parse(
      await readFile(join(appData, "liquid-glass-pet", "bridge.json"), "utf8"),
    );
    if (!Number.isInteger(settings.port) || !settings.token || !/^[a-f0-9]{64}$/i.test(settings.token)) {
      return;
    }

    // One deadline for the entire optional notification, including resolution.
    const signal = AbortSignal.timeout(1400);
    for (const event of events) await fetch("http://127.0.0.1:" + settings.port + "/notify", {
      method: "POST",
      headers: {
        authorization: "Bearer " + settings.token,
        "content-type": "application/json",
      },
      body: JSON.stringify(event), signal,
    });
  } catch {
    // The desktop pet is optional. A missing app or bridge must not block Codex.
  } finally {
    outputForHook();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void notify();
