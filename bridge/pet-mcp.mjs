import { readFile } from "node:fs/promises";
import { join } from "node:path";

const APP_DIRECTORY = process.env.PET_USER_DATA || join(process.env.APPDATA ?? "", "liquid-glass-pet");
const BRIDGE_FILE = join(APP_DIRECTORY, "bridge.json");
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const NOTIFICATION_KINDS = new Set([
  "stage_complete",
  "task_complete",
  "needs_input",
  "info",
]);

let inputBuffer = "";
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  }) + "\n");
}

function clip(value, limit) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return cleaned ? Array.from(cleaned).slice(0, limit).join("") : undefined;
}

async function sendNotification(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("请提供有效的通知内容。");
  }
  if (!NOTIFICATION_KINDS.has(args.kind)) {
    throw new Error("kind 必须是 stage_complete、task_complete、needs_input 或 info。");
  }
  const message = clip(args.message, 240);
  if (!message) throw new Error("message 不能为空，且最多 240 个字符。");
  if(args.kind==='needs_input' && args.native_question!==true) throw new Error('先使用 Codex 原生询问；桌宠只提醒真实的待回答问题。');
  const project = clip(args.project, 80);
  const stage = clip(args.stage, 80);
  if (args.kind === "stage_complete" && !stage) {
    throw new Error("阶段完成通知需要填写 stage。");
  }

  let bridge;
  try {
    bridge = JSON.parse(await readFile(BRIDGE_FILE, "utf8"));
  } catch {
    throw new Error("找不到桌宠连接信息。请先启动 Liquid Glass Pet。");
  }
  if (
    !Number.isInteger(bridge.port) ||
    bridge.port < 1 ||
    bridge.port > 65535 ||
    typeof bridge.token !== "string" ||
    !/^[a-f0-9]{64}$/i.test(bridge.token)
  ) {
    throw new Error("桌宠连接信息无效。请重新启动 Liquid Glass Pet。");
  }

  let response;
  try {
    response = await fetch("http://127.0.0.1:" + bridge.port + "/notify", {
      method: "POST",
      headers: {
        authorization: "Bearer " + bridge.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: clip(args.event_id, 120),
        source: "mcp",
        type: args.kind,
        nativeQuestion: args.native_question === true,
        project,
        task: clip(args.task_id, 100),
        stage,
        message,
        sessionId: clip(args.session_id || process.env.CODEX_THREAD_ID, 120),
        turnId: clip(args.turn_id, 120),
      }),
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    throw new Error("无法连接桌宠。请确认 Liquid Glass Pet 正在运行。");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("桌宠没有接收通知（HTTP " + response.status + "). " + detail.slice(0, 120));
  }
  const payload = await response.json().catch(() => ({}));
  return {
    content: [{ type: "text", text: "桌宠已收到" + (stage ? "「" + stage + "」" : "") + "通知。" }],
    structuredContent: {
      accepted: true,
      eventId: payload.eventId ?? null,
    },
  };
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    if (message?.id !== undefined) fail(message.id, -32600, "Invalid JSON-RPC request");
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-06-18";
    respond(message.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "liquid-glass-pet", version: "0.2.0" },
      instructions: "Ask questions using the native Codex input tool. The pet only reminds and opens Codex; it never collects or returns answers. Use pet_notify for verified completion messages.",
    });
    return;
  }
  if (message.method === "ping") {
    respond(message.id, {});
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [
        {
          name: "pet_notify",
          description: "Show a short, factual notification in the user's local Liquid Glass Pet. Use after a verified stage/task milestone or when user input is needed. Does not approve Codex actions.",
          inputSchema: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["stage_complete", "task_complete", "needs_input", "info"],
                description: "Notification purpose.",
              },
              project: { type: "string", maxLength: 80, description: "Short project name; do not use a full local path." },
              task_id: { type: "string", maxLength: 100, description: "Optional short task identifier." },
              stage: { type: "string", maxLength: 80, description: "Completed stage name; required for stage_complete." },
              message: { type: "string", minLength: 1, maxLength: 240, description: "Brief factual message in the user's language." },
              event_id: { type: "string", maxLength: 120, description: "Optional stable identifier used to prevent duplicate notifications." },
              native_question: { type:'boolean', description:'True only after a real question has been posted to the native Codex panel.' },
              session_id: { type: 'string', maxLength: 120 },
              turn_id: { type: 'string', maxLength: 120 },
            },
            required: ["kind", "message"],
            additionalProperties: false,
          },
        },

      ],
    });
    return;
  }
  if (message.method === "tools/call") {
    if (message.params?.name !== "pet_notify") {
      fail(message.id, -32602, "Unknown tool");
      return;
    }
    try {
      respond(message.id, await sendNotification(message.params.arguments));
    } catch (error) {
      respond(message.id, {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "通知发送失败。" }],
      });
    }
    return;
  }
  if (message.id !== undefined) fail(message.id, -32601, "Method not found");
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  if (inputBuffer.length > 1_048_576) { inputBuffer = ''; fail(null, -32600, 'Input too large'); return; }
  while (true) {
    const newline = inputBuffer.indexOf("\n");
    if (newline < 0) break;
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      void handle(message).catch((error) => {
        if (message?.id !== undefined) fail(message.id, -32603, error?.message ?? "Internal error");
      });
    } catch {
      fail(null, -32700, "Parse error");
    }
  }
});

process.stdin.on("end", () => {
  if (!inputBuffer.trim()) return;
  try {
    void handle(JSON.parse(inputBuffer));
  } catch {
    fail(null, -32700, "Parse error");
  }
});
