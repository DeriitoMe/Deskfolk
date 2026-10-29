import test from 'node:test';
import assert from 'node:assert/strict';
import {costMeterBalance, localDayKey} from './deepseek-balance.ts';

const day = '2026-10-29';
const reading = {total: 29.2993781, currency: 'CNY', at: 1761744000000, date: day, ledgerCost: 0.2};

test('a meter reading carries the balance and the spend recorded after it', () => {
  const balance = costMeterBalance({balanceRef: reading, config: {exchangeRate: 6.67}, days: {[day]: {cost: 0.5}}})!;
  assert.equal(balance.total, 29.2993781);
  assert.equal(balance.currency, 'CNY');
  assert.equal(balance.observedAt, new Date(1761744000000).toISOString());
  assert.ok(Math.abs(balance.spentSince! - (0.5 - 0.2) * 6.67) < 1e-9);
});

test('missing or already-newer spend stays null instead of inventing a cost', () => {
  assert.equal(costMeterBalance({balanceRef: reading, config: {exchangeRate: 6.67}, days: {}})!.spentSince, null);
  assert.equal(costMeterBalance({balanceRef: reading, config: {exchangeRate: 6.67},
    days: {[day]: {cost: 0.1}}})!.spentSince, null, 'a smaller day cost belongs to a newer reading');
  assert.equal(costMeterBalance({balanceRef: reading, days: {[day]: {cost: 0.5}}})!.spentSince, null,
    'without an exchange rate the ledger cost cannot become CNY');
  assert.equal(costMeterBalance({balanceRef: {...reading, ledgerCost: undefined},
    config: {exchangeRate: 6.67}, days: {[day]: {cost: 0.5}}})!.spentSince, null);
});

test('unreadable meters report nothing rather than a zero balance', () => {
  assert.equal(costMeterBalance({}), null);
  assert.equal(costMeterBalance({balanceRef: {}}), null);
  assert.equal(costMeterBalance({balanceRef: {...reading, total: Number.NaN}}), null);
  assert.equal(costMeterBalance({balanceRef: {...reading, total: '29' as unknown as number}}), null);
  const noRef = costMeterBalance({balanceRef: {...reading, at: undefined, date: undefined,
    ledgerCost: undefined}, config: {exchangeRate: 6.67}, days: {[day]: {cost: 0.5}}})!;
  assert.equal(noRef.observedAt, null);
  assert.equal(noRef.currency, 'CNY');
});

test('a missing date falls back to the meter day the reading happened on', () => {
  const at = Date.parse('2026-10-29T09:30:00+08:00');
  assert.equal(localDayKey(at), day);
  const balance = costMeterBalance({balanceRef: {...reading, date: undefined, at},
    config: {exchangeRate: 6.67}, days: {[day]: {cost: 0.5}}})!;
  assert.ok(Math.abs(balance.spentSince! - 0.3 * 6.67) < 1e-9);
});
