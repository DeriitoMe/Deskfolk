/** Only the genuine Codex five-hour account window is displayed. */
export type CodexQuotaSource = 'codex-app-server' | 'codex-log';
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

export function unknownCodexQuota(refreshing = false): CodexQuotaSnapshot {
  return {status: refreshing ? 'refreshing' : 'unavailable', remainingPercent: null,
    usedPercent: null, observedAt: null, resetsAt: null, source: null,
    label: prefix + (refreshing ? '读取中' : '暂不可用')};
}

/** A reset passing is evidence that the old percentage is stale, never 100%. */
export function currentCodexQuota(value: CodexQuotaSnapshot, now = Date.now()): CodexQuotaSnapshot {
  if (value.resetsAt && Date.parse(value.resetsAt) <= now) {
    return {...value, status: 'expired', remainingPercent: null, usedPercent: null, label: prefix + '待刷新'};
  }
  return {...value};
}

/** Accept native snake_case records and official app-server camelCase snapshots. */
export function parseCodexQuota(
  input: unknown, source: CodexQuotaSource, observedAt: string, now = Date.now(),
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

