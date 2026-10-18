// Install or remove Deskfolk's Claude Code hooks and status line in the user's
// Claude Code settings (~/.claude/settings.json). Existing settings are kept;
// a timestamped backup is written before any change.
//
//   node setup.mjs                      install / update
//   node setup.mjs --uninstall          remove only Deskfolk entries
//   node setup.mjs --replace-statusline also replace a non-Deskfolk status line
//   node setup.mjs --settings <path>    use another settings file (tests)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = 'deskfolk-claude-code';
const here = dirname(fileURLToPath(import.meta.url));
// Forward slashes: Claude Code may run commands through Git Bash on Windows.
const slash = path => path.replace(/\\/g, '/');
const hookScript = slash(join(here, 'hook.mjs'));
const statusScript = slash(join(here, 'statusline.mjs'));

/** Keep in sync with CLAUDE_GESTURE_TOOLS in electron/claude-tools.ts. */
export const GESTURE_MATCHER = 'Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit';
/** Event → matcher. Frequent tool events run asynchronously. */
export const HOOK_EVENTS = [
  // A new session may start the pet ("随 Claude Code 启动").
  ['SessionStart', undefined, true],
  ['UserPromptSubmit', undefined, false],
  ['PreToolUse', 'AskUserQuestion', false],
  // Start of a command or file edit, for the typing / writing gestures.
  ['PreToolUse', GESTURE_MATCHER, true],
  ['PostToolUse', undefined, true],
  ['PostToolUseFailure', undefined, true],
  ['PermissionDenied', undefined, true],
  ['ElicitationResult', undefined, true],
  ['Notification', undefined, false],
  ['Stop', undefined, false],
  ['StopFailure', undefined, false],
  ['SessionEnd', undefined, false],
];

const ours = entry => JSON.stringify(entry ?? '').includes(MARKER);

export function applySettings(settings, { uninstall = false, replaceStatusline = false } = {}) {
  const next = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  const notes = [];
  for (const event of new Set(HOOK_EVENTS.map(([name]) => name))) {
    const kept = (next.hooks[event] ?? []).map(group => ({
      ...group, hooks: (group.hooks ?? []).filter(hook => !ours(hook)),
    })).filter(group => group.hooks.length);
    if (kept.length) next.hooks[event] = kept; else delete next.hooks[event];
  }
  if (!uninstall) {
    for (const [event, matcher, async] of HOOK_EVENTS) {
      const hook = { type: 'command', command: 'node', args: [hookScript], timeout: 5 };
      if (async) hook.async = true;
      const group = matcher ? { matcher, hooks: [hook] } : { hooks: [hook] };
      next.hooks[event] = [...(next.hooks[event] ?? []), group];
    }
  }
  if (!Object.keys(next.hooks).length) delete next.hooks;

  const current = settings.statusLine;
  if (uninstall) {
    if (ours(current)) delete next.statusLine;
  } else if (!current || ours(current) || replaceStatusline) {
    next.statusLine = { type: 'command', command: `node "${statusScript}"` };
  } else {
    notes.push('已有其他状态栏，未覆盖。Current session 数据需要 Deskfolk 状态栏；如需替换，加 --replace-statusline 重新运行。');
  }
  return { settings: next, notes };
}

if (process.argv[1] && slash(process.argv[1]) === slash(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--settings');
  const file = index >= 0 ? args[index + 1] : join(homedir(), '.claude', 'settings.json');
  let settings = {};
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    try { settings = text.trim() ? JSON.parse(text) : {}; } catch {
      console.error(`无法解析 ${file}，未做任何修改。请先修正其中的 JSON。`);
      process.exit(1);
    }
    const backup = `${file}.deskfolk-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(file, backup);
    console.log(`已备份：${backup}`);
  } else mkdirSync(dirname(file), { recursive: true });
  const result = applySettings(settings, {
    uninstall: args.includes('--uninstall'), replaceStatusline: args.includes('--replace-statusline'),
  });
  writeFileSync(file, JSON.stringify(result.settings, null, 2) + '\n', 'utf8');
  for (const note of result.notes) console.log(note);
  console.log(args.includes('--uninstall') ? '已移除 Deskfolk 的 Claude Code 接入。' :
    `已写入 ${file}。重新打开 Claude Code 后生效。`);
}
