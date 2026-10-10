'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readTurnUsage, formatFooter } = require('../plugins/codex-token-footer/scripts/token-footer.cjs');

const testRoot = process.env.TOKEN_FOOTER_TEST_ROOT || path.join(os.tmpdir(), 'codex-token-footer-tests');
fs.mkdirSync(testRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(testRoot, 'run-'));
let serial = 0;

const totals = (input, output, cached = 0, reasoning = 0) => ({
  input_tokens: input, cached_input_tokens: cached, output_tokens: output,
  reasoning_output_tokens: reasoning, total_tokens: input + output
});
const event = (type, details = {}, at = 0) => ({
  timestamp: new Date(1791670000000 + at).toISOString(), type: 'event_msg',
  payload: { type, ...details }
});
const usage = (total, last, at) => event('token_count', {
  info: { total_token_usage: total, last_token_usage: last }
}, at);
function fixture(entries, tail = '') {
  const file = path.join(scratch, `${serial++}.jsonl`);
  fs.writeFileSync(file, entries.map(value => JSON.stringify(value)).join('\n') + '\n' + tail);
  return file;
}

test('counts the entire turn across model calls; deduplicates limit notifications', async () => {
  const before = totals(1000, 100, 700, 30);
  const first = totals(1500, 140, 1000, 45);
  const second = totals(2100, 200, 1400, 65);
  const file = fixture([
    usage(before, before, 0), event('task_started', { turn_id: 'turn-a' }, 1000),
    usage(first, totals(500, 40, 300, 15), 2000),
    usage(first, totals(500, 40, 300, 15), 2100),
    usage(second, totals(600, 60, 400, 20), 3000),
    event('task_complete', { turn_id: 'turn-a', duration_ms: 10000 }, 11000)
  ]);
  const result = await readTurnUsage(file, 'turn-a');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.usage, totals(1100, 100, 700, 35));
  assert.equal(result.elapsedMs, 10000);
  assert.equal(result.modelCalls, 2);
  assert.equal(formatFooter(result), '本轮 Token · 输入 1,100 · 输出 100 · 合计 1,200 · 缓存命中 700 · 缓存命中率 63.6% · 耗时 10.0 秒');
});

test('uses actual last-call usage when a fork begins with inherited cumulative counters', async () => {
  const file = fixture([
    event('task_started', { turn_attribution: { turn_id: 'fork-a' } }, 0),
    usage(totals(5200, 430, 4400, 100), totals(200, 30, 150, 10), 1000)
  ]);
  const result = await readTurnUsage(file, 'fork-a', 1791670002000);
  assert.deepEqual(result.usage, totals(200, 30, 150, 10));
  assert.equal(result.elapsedMs, 2000);
});

test('handles cumulative-counter reset without subtracting negative token counts', async () => {
  const file = fixture([
    usage(totals(1000, 100, 700, 30), null, 0),
    event('task_started', { turn_id: 'reset-a' }, 1000),
    usage(totals(1300, 150, 900, 40), totals(300, 50, 200, 10), 2000),
    usage(totals(400, 60, 250, 20), totals(400, 60, 250, 20), 3000)
  ]);
  assert.deepEqual((await readTurnUsage(file, 'reset-a')).usage, totals(700, 110, 450, 30));
});

test('selects the requested turn rather than including later chats or model calls', async () => {
  const file = fixture([
    event('task_started', { turn_id: 'a' }),
    usage(totals(100, 10), totals(100, 10), 1000),
    event('task_complete', { turn_id: 'a', duration_ms: 1500 }, 1500),
    event('task_started', { turn_id: 'b' }, 2000),
    usage(totals(350, 40), totals(250, 30), 3000)
  ]);
  assert.deepEqual((await readTurnUsage(file, 'a')).usage, totals(100, 10));
  assert.deepEqual((await readTurnUsage(file, 'b')).usage, totals(250, 30));
  assert.deepEqual(await readTurnUsage(file, 'absent'), { status: 'unavailable', reason: 'turn_not_found' });
});

test('does not invent zero counters when usage is missing or a log write is partial', async () => {
  const empty = fixture([event('task_started', { turn_id: 'a' })]);
  assert.equal((await readTurnUsage(empty, 'a')).status, 'unavailable');
  const partial = fixture([
    event('task_started', { turn_id: 'a' }),
    usage(totals(100, 20), totals(100, 20), 1000)
  ], '{"timestamp":');
  assert.deepEqual((await readTurnUsage(partial, 'a')).usage, totals(100, 20));
});

test('does not report unsupported counters as real zeroes', async () => {
  const known = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
  const file = fixture([event('task_started', { turn_id: 'a' }), usage(known, known, 1000)]);
  const result = await readTurnUsage(file, 'a');
  assert.equal(result.usage.cached_input_tokens, null);
  assert.equal(result.usage.reasoning_output_tokens, null);
  assert.doesNotMatch(formatFooter(result), /缓存命中/);
});

test('distinguishes zero cache hits from an undefined rate when no input was recorded', async () => {
  const noHits = fixture([event('task_started', { turn_id: 'a' }), usage(totals(100, 20), totals(100, 20), 1000)]);
  assert.match(formatFooter(await readTurnUsage(noHits, 'a')), /缓存命中率 0\.0%/);
  const noInput = fixture([event('task_started', { turn_id: 'b' }), usage(totals(0, 0), totals(0, 0), 1000)]);
  assert.match(formatFooter(await readTurnUsage(noInput, 'b')), /缓存命中率 —/);
});

test('real hook command returns only systemMessage, without continuing or blocking Codex', () => {
  const file = fixture([
    event('task_started', { turn_id: 'a' }), usage(totals(100, 20), totals(100, 20), 1000)
  ]);
  const pluginRoot = path.resolve(__dirname, '../plugins/codex-token-footer');
  const config = require('../plugins/codex-token-footer/hooks/hooks.json');
  const expression = config.hooks.Stop[0].hooks[0].command.match(/^node -e "(.*)"$/)[1];
  const result = spawnSync(process.execPath, ['-e', expression], {
    env: { ...process.env, PLUGIN_ROOT: pluginRoot }, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'Stop', turn_id: 'a', transcript_path: file })
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ['systemMessage']);
  assert.match(output.systemMessage, /输入 100 · 输出 20 · 合计 120/);
  const missing = spawnSync(process.execPath, ['-e', expression], {
    env: { ...process.env, PLUGIN_ROOT: pluginRoot }, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: `${file}.missing` })
  });
  assert.equal(missing.status, 0);
  assert.match(JSON.parse(missing.stdout).systemMessage, /暂不可用/);
});
