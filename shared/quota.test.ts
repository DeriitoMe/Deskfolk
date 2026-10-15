import test from 'node:test';
import assert from 'node:assert/strict';
import {currentCodexQuota, parseCodexQuota, unknownCodexQuota} from './quota.ts';

const now = Date.parse('2026-10-14T03:00:00Z');
const observed = new Date(now).toISOString();
const window = {usedPercent: 47, windowDurationMins: 300, resetsAt: (now + 3600000) / 1000};

test('official account rateLimits read selects the codex bucket and excludes account details', () => {
  const parsed = parseCodexQuota({result: {accountId: 'private-test-id', rateLimits: {
    limitId: 'codex_other', primary: {...window, usedPercent: 4},
  }, rateLimitsByLimitId: {codex: {limitId: 'codex', primary: window}}}}, 'codex-app-server', observed, now)!;
  assert.equal(parsed.remainingPercent, 53);
  assert.equal(parsed.label, '5小时剩余额度: 53%');
  assert.equal(parsed.source, 'codex-app-server');
  assert.equal(JSON.stringify(parsed).includes('private-test-id'), false);
});

test('native token_count uses actual percentage and can find the 300 minute secondary window', () => {
  const parsed = parseCodexQuota({type: 'event_msg', payload: {type: 'token_count',
    info: {total_token_usage: {total_tokens: 999999999}}, rate_limits: {
      limit_id: 'codex', primary: {used_percent: 99, window_minutes: 10080, resets_at: window.resetsAt},
      secondary: {used_percent: 42.5, window_minutes: 300, resets_at: window.resetsAt},
    }}}, 'codex-log', observed, now)!;
  assert.equal(parsed.remainingPercent, 57.5);
  assert.equal(parsed.usedPercent, 42.5);
  assert.equal(parsed.source, 'codex-log');
});

test('week-only, model-specific, malformed and unverified records never invent five-hour quota', () => {
  const invalid = [
    {primary: {...window, windowDurationMins: 10080}},
    {limitId: 'codex_other', primary: window},
    {rateLimitsByLimitId: {codex_other: {primary: window}}},
    {primary: {...window, usedPercent: '47'}},
    {primary: {...window, usedPercent: -1}},
    {primary: {...window, usedPercent: 101}},
    {primary: {...window, resetsAt: null}},
    {type: 'response_item', payload: {type: 'token_count', rate_limits: {primary: window}}},
  ];
  for (const value of invalid) assert.equal(parseCodexQuota(value, 'codex-log', observed, now), null);
  assert.equal(parseCodexQuota({primary: window}, 'codex-log', 'bad-time', now), null);
  assert.equal(unknownCodexQuota().remainingPercent, null);
});

test('passing the genuine reset time expires data without falsely assuming a full reset', () => {
  const value = parseCodexQuota({primary: window}, 'codex-app-server', observed, now)!;
  const expired = currentCodexQuota(value, now + 3600000);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.remainingPercent, null);
  assert.equal(expired.usedPercent, null);
  assert.equal(expired.label, '5小时剩余额度: 待刷新');
  assert.equal(currentCodexQuota(value, now + 3000000).remainingPercent, 53);
  assert.equal(value.status, 'available', 'checking freshness does not mutate prior snapshot');
});

