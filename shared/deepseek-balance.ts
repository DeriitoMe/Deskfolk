import type {DeepSeekBalanceReading} from './quota.ts';

/** The parts of the DSH cost meter ledger this app reads. Everything else is ignored. */
export interface CostMeterLedger {
  config?: {exchangeRate?: unknown};
  balanceRef?: {total?: unknown;currency?: unknown;at?: unknown;date?: unknown;ledgerCost?: unknown};
  days?: Record<string, {cost?: unknown}>;
}

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * The meter stores the balance it last read plus the day's spend at that moment,
 * so the live balance is that reading minus what has been spent since.
 * A reading without a comparable cost stays as-is instead of inventing spend.
 */
export function costMeterBalance(ledger: CostMeterLedger): DeepSeekBalanceReading | null {
  const reference = ledger.balanceRef;
  const total = number(reference?.total);
  if (total === null) return null;
  const currency = typeof reference?.currency === 'string' ? reference.currency : 'CNY';
  const at = number(reference?.at);
  const ledgerCost = number(reference?.ledgerCost);
  const rate = number(ledger.config?.exchangeRate);
  let spentSince: number | null = null;
  if (ledgerCost !== null && rate !== null) {
    const dayKey = typeof reference?.date === 'string' ? reference.date : at === null ? null : localDayKey(at);
    const dayCost = dayKey ? number(ledger.days?.[dayKey]?.cost) : null;
    if (dayCost !== null && dayCost >= ledgerCost) spentSince = (dayCost - ledgerCost) * rate;
  }
  return {total, currency, observedAt: at === null ? null : new Date(at).toISOString(), spentSince};
}

/** The meter keys its days by the local calendar date, like its own reports. */
export function localDayKey(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
