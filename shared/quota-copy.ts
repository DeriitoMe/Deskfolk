import {translate, type AppLocale} from './i18n.ts';
import {DEEPSEEK_BALANCE_PREFIX, currentCodexQuota, type CodexQuotaSnapshot} from './quota.ts';

/** Format verified numbers; a language change never invents a quota reading. */
export function quotaLabel(snapshot: CodexQuotaSnapshot, locale: AppLocale, now = Date.now()): string {
  const value = currentCodexQuota(snapshot, now);
  const t = (message: string) => translate(locale, message);
  // DSH publishes a balance (money), not a window percentage: keep that reading.
  if (value.source === 'deepseek-harness' && value.status === 'available' && value.label) {
    const amount = value.label.startsWith(DEEPSEEK_BALANCE_PREFIX) ? value.label.slice(DEEPSEEK_BALANCE_PREFIX.length) : value.label;
    return t(DEEPSEEK_BALANCE_PREFIX) + amount;
  }
  const prefix = value.source === 'claude-code-statusline' ? 'Current session: ' :
    t(value.source === 'deepseek-harness' ? 'DeepSeek 额度: ' : '5小时剩余额度: ');
  if (value.status === 'available') {
    const percent = value.source === 'claude-code-statusline' && value.usedPercent !== null ?
      Math.round(value.usedPercent) : value.remainingPercent;
    if (percent !== null) return prefix + percent + '%';
  }
  return prefix + t(value.status === 'expired' ? '待刷新' : value.status === 'refreshing' ? '读取中' : '暂不可用');
}
