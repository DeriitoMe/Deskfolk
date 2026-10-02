import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from 'node:crypto';

const type = process.argv[2];
const typeMap = new Map([
  ["work_started", "work_started"],
  ["work_progress", "work_progress"],
  ["tool_finished", "work_progress"],
  ["approval_needed", "approval_needed"],
  ["turn_ended", "turn_ended"],
  ["interrupted", "interrupted"],
]);

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
    const mappedType = typeMap.get(type ?? "");
    if (!mappedType) return;
    const hookInput = await readInput().catch(() => ({}));
    if (type === "turn_ended" && hookInput.stop_hook_active === true) return;
    const appData = process.env.APPDATA;
    if (!appData) return;
    const settings = JSON.parse(
      await readFile(join(appData, "liquid-glass-pet", "bridge.json"), "utf8"),
    );
    if (!Number.isInteger(settings.port) || !settings.token || !/^[a-f0-9]{64}$/i.test(settings.token)) {
      return;
    }

    const cwd = typeof hookInput.cwd === "string" ? hookInput.cwd : "";
    const project = cwd ? basename(cwd.replace(/[\\/]+$/, "")) : undefined;
    const session = typeof hookInput.session_id === "string" ? hookInput.session_id : process.env.CODEX_THREAD_ID;
    const turn = typeof hookInput.turn_id === "string" ? hookInput.turn_id : undefined;
    const toolName = typeof hookInput.tool_name === "string" ? hookInput.tool_name : "";
    const asksUser = type === "work_progress" &&
      /(?:^|[._])request_user_input(?:_async)?$/.test(toolName);
    const answered = type === 'tool_finished' && /(?:^|[._])request_user_input$/.test(toolName);
    const eventType = answered ? 'input_resolved' : asksUser ? "needs_input" : mappedType;
    const response = await fetch("http://127.0.0.1:" + settings.port + "/notify", {
      method: "POST",
      headers: {
        authorization: "Bearer " + settings.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: "hook:" + eventType + ":" + session + ":" + turn + ":" +
          (typeof hookInput.tool_use_id === "string" ? hookInput.tool_use_id : randomUUID()),
        source: "hook",
        type: eventType,
        nativeQuestion: asksUser,
        nativeCallId: (asksUser || answered) && typeof hookInput.tool_use_id === 'string' ? hookInput.tool_use_id : undefined,
        sessionId: session,
        turnId: turn,
        project,
        projectPath: cwd || undefined,
        isSubagent: hookInput.is_subagent === true || hookInput.isSubagent === true ||
          (typeof hookInput.source === 'object' && !!hookInput.source?.subagent) || undefined,
        message: asksUser ? 'Codex 有一个问题等你回答。' : '',
      }),
      signal: AbortSignal.timeout(1400),
    });
    if (!response.ok) {
      // Hook failures intentionally stay silent and never affect the Codex turn.
    }
  } catch {
    // The desktop pet is optional. A missing app or bridge must not block Codex.
  } finally {
    outputForHook();
  }
}

void notify();
