/**
 * Available readings use genuine five-hour account windows: Codex's 300-minute
 * window, or Claude Code's `rate_limits.five_hour` (shown in Claude's own
 * /usage as "Current session"). DeepSeek Harness has no verified quota feed.
 */
export type CodexQuotaSource = 'codex-app-server' | 'codex-log' | 'claude-code-statusline' | 'deepseek-harness';
export interface CodexQuotaSnapshot {
  status: 'available' | 'unavailable' | 'expired' | 'refreshing';
  remainingPercent: number | null;
  usedPercent: number | null;
  observedAt: string | null;
  resetsAt: string | null;
  source: CodexQuotaSource | null;
  label: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const prefix = '5小时剩余额度: ';
export const CLAUDE_QUOTA_PREFIX = 'Current session: ';
export const DEEPSEEK_QUOTA_PREFIX = 'DeepSeek 额度: ';
const prefixFor = (source: CodexQuotaSource | null) =>
  source === 'deepseek-harness' ? DEEPSEEK_QUOTA_PREFIX :
    source === 'claude-code-statusline' ? CLAUDE_QUOTA_PREFIX : prefix;

export function unknownCodexQuota(refreshing = false): CodexQuotaSnapshot {
  return {status: refreshing ? 'refreshing' : 'unavailable', remainingPercent: null,
    usedPercent: null, observedAt: null, resetsAt: null, source: null,
    label: prefix + (refreshing ? '读取中' : '暂不可用')};
}

/** Harness lifecycle/tool events do not establish an account quota window. */
export function unknownDeepSeekQuota(): CodexQuotaSnapshot {
  return {status: 'unavailable', remainingPercent: null, usedPercent: null,
    observedAt: null, resetsAt: null, source: 'deepseek-harness',
    label: DEEPSEEK_QUOTA_PREFIX + '暂不可用'};
}

/** Account balance read by the DSH cost meter, plus spend since that read. */
export interface DeepSeekBalanceReading {
  /** Balance in `currency` when the cost meter last read it. */
  total: number;
  /** ISO 4217 code from the cost meter: CNY for the DeepSeek account balance. */
  currency: string;
  /** ISO time of that read, or null when the meter never read one. */
  observedAt: string | null;
  /** Spend in the same currency after that read; null when it is unknown. */
  spentSince: number | null;
}

/**
 * DSH exposes no five-hour window, but it does track the prepaid balance, so
 * the board shows that balance instead of a hard-coded "unavailable".
 */
export const DEEPSEEK_BALANCE_PREFIX = 'DeepSeek 余额: ';
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {CNY: '¥', USD: '$'};

export function deepSeekBalanceQuota(reading: DeepSeekBalanceReading): CodexQuotaSnapshot {
  if (!finite(reading.total)) return unknownDeepSeekQuota();
  const spent = finite(reading.spentSince) ? Math.max(0, reading.spentSince) : 0;
  const remaining = Math.max(0, reading.total - spent);
  const symbol = CURRENCY_SYMBOLS[reading.currency] ?? `${reading.currency} `;
  return {status: 'available', remainingPercent: null, usedPercent: null,
    observedAt: reading.observedAt, resetsAt: null, source: 'deepseek-harness',
    label: `${DEEPSEEK_BALANCE_PREFIX}${symbol}${remaining.toFixed(2)}`};
}

/** A reset passing is evidence that the old percentage is stale, never 100%. */
export function currentCodexQuota(value: CodexQuotaSnapshot, now = Date.now()): CodexQuotaSnapshot {
  if (value.resetsAt && Date.parse(value.resetsAt) <= now) {
    return {...value, status: 'expired', remainingPercent: null, usedPercent: null, label: prefixFor(value.source) + '待刷新'};
  }
  return {...value};
}

/** Accept native snake_case records and official app-server camelCase snapshots. */
export function parseCodexQuota(
  input: unknown, source: 'codex-app-server' | 'codex-log', observedAt: string, now = Date.now(),
): CodexQuotaSnapshot | null {
  if (!record(input) || !Number.isFinite(Date.parse(observedAt))) return null;
  let value: Record<string, unknown> = input;
  if (record(value.result)) value = value.result;
  else if (record(value.params)) value = value.params;
  if (record(value.payload)) {
    if (value.type !== 'event_msg' || value.payload.type !== 'token_count') return null;
    value = value.payload;
  }

  let bucket: unknown;
  if (record(value.rateLimitsByLimitId)) {
    // A model-specific/week-only bucket cannot stand in for the common Codex quota.
    bucket = value.rateLimitsByLimitId.codex;
    if (!record(bucket)) return null;
  } else bucket = value.rateLimits ?? value.rate_limits ?? value;
  if (!record(bucket)) return null;
  const bucketId = bucket.limitId ?? bucket.limit_id;
  if (bucketId !== undefined && bucketId !== null && bucketId !== 'codex') return null;

  for (const key of ['primary', 'secondary']) {
    const window = bucket[key];
    if (!record(window)) continue;
    if ((window.windowDurationMins ?? window.window_minutes) !== 300) continue;
    const used = window.usedPercent ?? window.used_percent;
    const resets = window.resetsAt ?? window.resets_at;
    if (!finite(used) || used < 0 || used > 100 || !finite(resets) || resets <= 0) continue;
    const resetDate = new Date(resets * 1000);
    if (!Number.isFinite(resetDate.getTime())) continue;
    const remaining = Math.round((100 - used) * 10) / 10;
    return currentCodexQuota({status: 'available', remainingPercent: remaining, usedPercent: used,
      observedAt, resetsAt: resetDate.toISOString(), source, label: `${prefix}${remaining}%`}, now);
  }
  return null;
}


export function unknownClaudeQuota(): CodexQuotaSnapshot {
  return {status: 'unavailable', remainingPercent: null, usedPercent: null, observedAt: null,
    resetsAt: null, source: 'claude-code-statusline', label: CLAUDE_QUOTA_PREFIX + '暂不可用'};
}

/**
 * Claude Code status line stdin: `rate_limits.five_hour.used_percentage`
 * (0–100) and `resets_at` (epoch seconds). Like Claude's /usage panel, the
 * board shows the used percentage. The window is absent for API-key users
 * and before the first response; absence is "unavailable", never 0%.
 */
export function parseClaudeQuota(input: unknown, observedAt: string, now = Date.now()): CodexQuotaSnapshot | null {
  if (!record(input) || !Number.isFinite(Date.parse(observedAt))) return null;
  const limits = record(input.rate_limits) ? input.rate_limits : input;
  const window = limits.five_hour;
  if (!record(window)) return null;
  const used = window.used_percentage, resets = window.resets_at;
  if (!finite(used) || used < 0 || used > 100 || !finite(resets) || resets <= 0) return null;
  const resetDate = new Date(resets * 1000);
  if (!Number.isFinite(resetDate.getTime())) return null;
  const shown = Math.round(used);
  return currentCodexQuota({status: 'available', remainingPercent: Math.round((100 - used) * 10) / 10,
    usedPercent: used, observedAt, resetsAt: resetDate.toISOString(), source: 'claude-code-statusline',
    label: `${CLAUDE_QUOTA_PREFIX}${shown}%`}, now);
}

/**
 * One board, two agents: show the agent the user worked with most recently.
 * A live reading beats a stale/unknown one; Claude's "unavailable" label is
 * used once Claude Code has been seen, so the board never shows a Codex
 * window as if it were Claude's.
 */
export function selectQuota(codex: CodexQuotaSnapshot, claude: CodexQuotaSnapshot | null,
  preferClaude: boolean, now = Date.now()): CodexQuotaSnapshot {
  const a = currentCodexQuota(codex, now);
  if (!claude) return a;
  const b = currentCodexQuota(claude, now);
  if (preferClaude) return b;
  if (a.status === 'available') return a;
  return b.status === 'available' ? b : a;
}
