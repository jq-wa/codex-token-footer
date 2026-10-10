'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const COUNTERS = ['input_tokens', 'cached_input_tokens', 'output_tokens',
  'reasoning_output_tokens', 'total_tokens'];
const REQUIRED = ['input_tokens', 'output_tokens', 'total_tokens'];

function counters(value) {
  if (!value || !REQUIRED.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
  const result = {};
  for (const key of COUNTERS) {
    result[key] = Number.isSafeInteger(value[key]) && value[key] >= 0 ? value[key] : null;
  }
  return result;
}

function turnId(payload) {
  return payload.turn_id || payload.turn_attribution?.turn_id || payload.root_turn_id;
}

function eventTime(entry) {
  const ms = Date.parse(entry.timestamp);
  return Number.isFinite(ms) ? ms : null;
}

// token_count may be repeated when limits change. Count cumulative increases,
// not repeated last_token_usage records. Cache and reasoning are subsets.
async function readTurnUsage(transcriptPath, requestedTurnId, nowMs = Date.now()) {
  const input = fs.createReadStream(transcriptPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let previous = null;
  let current = null;
  let selected = null;

  try {
    for await (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type !== 'event_msg' || !entry.payload) continue;
      const payload = entry.payload;

      if (payload.type === 'task_started') {
        current = {
          turnId: turnId(payload), startMs: eventTime(entry), endMs: null,
          usage: Object.fromEntries(COUNTERS.map(key => [key, 0])), samples: 0,
          missingCounters: new Set(), incomplete: false
        };
        if (!requestedTurnId || current.turnId === requestedTurnId) selected = current;
      } else if (payload.type === 'token_count' && payload.info) {
        const total = counters(payload.info.total_token_usage);
        const last = counters(payload.info.last_token_usage);
        if (!total) {
          if (current) current.incomplete = true;
          continue;
        }
        const duplicate = previous && REQUIRED.every(key => total[key] === previous[key]);
        if (!duplicate && current) {
          const reset = previous && REQUIRED.some(key => total[key] < previous[key]);
          // A resumed/forked transcript may start with inherited cumulative
          // counters. In the absence of a baseline, use the actual last call.
          const useLast = !previous || reset;
          const delta = useLast ? last : Object.fromEntries(COUNTERS.map(key => [key,
            total[key] === null || previous[key] === null ? null : total[key] - previous[key]]));
          if (!delta || REQUIRED.some(key => delta[key] === null || delta[key] < 0)) {
            current.incomplete = true;
          } else {
            for (const key of COUNTERS) {
              if (delta[key] === null || delta[key] < 0) current.missingCounters.add(key);
              else current.usage[key] += delta[key];
            }
            current.samples++;
          }
        }
        previous = total;
      } else if (current && ['task_complete', 'task_completed', 'turn_aborted'].includes(payload.type)) {
        const id = turnId(payload);
        if (!id || id === current.turnId) {
          current.endMs = Number.isFinite(payload.duration_ms) && current.startMs !== null
            ? current.startMs + payload.duration_ms : eventTime(entry);
          current = null;
        }
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }

  if (!selected) return { status: 'unavailable', reason: 'turn_not_found' };
  if (!selected.samples || selected.incomplete) return { status: 'unavailable', reason: 'usage_not_ready' };
  for (const key of selected.missingCounters) selected.usage[key] = null;
  const elapsed = selected.startMs === null ? null : (selected.endMs ?? nowMs) - selected.startMs;
  return {
    status: 'ok', turnId: selected.turnId, usage: selected.usage,
    elapsedMs: elapsed !== null && elapsed >= 0 ? elapsed : null,
    modelCalls: selected.samples,
    scope: 'All recorded model requests in this turn; cache and reasoning are included in input/output.'
  };
}

function formatFooter(result) {
  if (result.status !== 'ok') {
    return result.reason === 'turn_not_found'
      ? 'Token 用量 · 当前日志无法定位这一轮回答，暂不可用'
      : 'Token 用量 · 本轮统计尚不可用（不估算 token）';
  }
  const fmt = value => value.toLocaleString('en-US');
  const usage = result.usage;
  const parts = ['本轮 Token', `输入 ${fmt(usage.input_tokens)}`,
    `输出 ${fmt(usage.output_tokens)}`, `合计 ${fmt(usage.total_tokens)}`];
  if (usage.cached_input_tokens !== null) {
    parts.push(`缓存命中 ${fmt(usage.cached_input_tokens)}`);
    const hitRate = usage.input_tokens > 0
      ? `${(usage.cached_input_tokens / usage.input_tokens * 100).toFixed(1)}%` : '—';
    parts.push(`缓存命中率 ${hitRate}`);
  }
  if (result.elapsedMs !== null) parts.push(`耗时 ${(result.elapsedMs / 1000).toFixed(1)} 秒`);
  return parts.join(' · ');
}

async function runHook() {
  let inputText = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) inputText += chunk;
  let event;
  try { event = JSON.parse(inputText); } catch { return; }
  if (event.hook_event_name !== 'Stop') return;
  let message;
  if (typeof event.transcript_path !== 'string' || !event.transcript_path) {
    message = 'Token 用量 · Codex 未提供本轮日志路径，暂不可用';
  } else {
    try {
      message = formatFooter(await readTurnUsage(event.transcript_path, event.turn_id));
    } catch {
      message = 'Token 用量 · 无法读取本轮会话日志，暂不可用';
    }
  }
  // systemMessage is a host-rendered warning, not a native response footer.
  // No decision:block, no continuation, no added model instructions.
  process.stdout.write(JSON.stringify({ systemMessage: message }) + '\n');
}

module.exports = { readTurnUsage, formatFooter, runHook };

if (require.main === module) {
  if (process.argv[2] === '--inspect' && process.argv[3]) {
    readTurnUsage(process.argv[3], process.argv[4]).then(result => {
      process.stdout.write(JSON.stringify({ ...result, footer: formatFooter(result) }, null, 2) + '\n');
    }).catch(() => { process.stderr.write('无法读取指定日志。\n'); process.exitCode = 1; });
  } else {
    runHook().catch(() => { process.stdout.write('{}\n'); });
  }
}
