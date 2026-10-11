(function installTokenToolbar() {
  'use strict';
  if (!document.documentElement) {
    document.addEventListener('DOMContentLoaded', installTokenToolbar, {once: true});
    return {waitingForDocument: true};
  }
  if (window.__codexTokenToolbar) return window.__codexTokenToolbar.snapshot();
  const selector = '[data-codex-token-toolbar]';
  const rows = new Map();
  const logStats = new Map();
  let queued = false;

  function contextFor(button) {
    const key = Object.keys(button).find(key => key.startsWith('__reactFiber$'));
    let fiber = key && button[key];
    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      const p = fiber.memoizedProps;
      if (p?.turnId && p?.threadId && Object.hasOwn(p, 'copyText')) {
        return {threadId:p.threadId, turnId:p.turnId};
      }
    }
    return null;
  }

  function statsFor(button) {
    const key = Object.keys(button).find(key => key.startsWith('__reactFiber$'));
    let fiber = key && button[key];
    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const stats = props?.stats ?? props?.hookStats;
      if (stats?.runs && Array.isArray(stats.runs)) {
        const messages = stats.runs
          .filter(run => run.eventName === 'stop' && /codex-token-footer/.test(run.id))
          .flatMap(run => run.entries || [])
          .map(entry => entry.text)
          .filter(text => typeof text === 'string' && /^本轮 Token|^Token 用量/.test(text));
        if (messages.length) return messages.at(-1);
      }
    }
    const context = contextFor(button);
    return context ? logStats.get(context.threadId + '/' + context.turnId) : null;
  }

  function compact(message) {
    const total = message.match(/合计\s+([\d,]+)/)?.[1];
    const input = message.match(/输入\s+([\d,]+)/)?.[1];
    const output = message.match(/输出\s+([\d,]+)/)?.[1];
    const cache = message.match(/缓存命中率\s+([\d.]+%|—)/)?.[1];
    const time = message.match(/耗时\s+([\d.]+)\s*秒/)?.[1];
    if (!total) return 'Token · 暂不可用';
    return [
      `Token ${total}`,
      input && output ? `入 ${input} / 出 ${output}` : null,
      cache ? `缓存 ${cache}` : null,
      time ? `${time}s` : null
    ].filter(Boolean).join(' · ');
  }

  function refresh() {
    queued = false;
    for (const [row] of rows) if (!row.isConnected) rows.delete(row);
    for (const button of document.querySelectorAll('button[aria-label]')) {
      if (!/^(?:钩子统计信息|钩子统计|Hook stats|复制|已复制|Copy|Copied)$/i.test(button.getAttribute('aria-label'))) continue;
      const message = statsFor(button);
      if (!message) continue;
      let row = button.parentElement;
      while (row && row !== document.body && !(row.tagName === 'DIV' && row.classList.contains('flex'))) row = row.parentElement;
      if (!row || row === document.body) continue;
      let badge = row.querySelector(selector);
      if (!badge) {
        badge = document.createElement('span');
        badge.setAttribute('data-codex-token-toolbar', '');
        badge.setAttribute('role', 'status');
        badge.className = 'text-secondary';
        Object.assign(badge.style, {
          display: 'inline-flex', alignItems: 'center', flexShrink: '1',
          marginInlineStart: '8px', fontSize: '11px', lineHeight: '20px',
          whiteSpace: 'normal', fontVariantNumeric: 'tabular-nums', userSelect: 'text'
        });
        row.append(badge);
        rows.set(row, {opacity: row.style.opacity});
        row.style.opacity = '1';
      }
      const text = compact(message);
      if (badge.textContent !== text) badge.textContent = text;
      if (badge.title !== message) {
        badge.title = message;
        badge.setAttribute('aria-label', message);
      }
    }
  }

  function schedule() {
    if (!queued) { queued = true; requestAnimationFrame(refresh); }
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {childList: true, subtree: true});
  const timer = setInterval(refresh, 1000);
  function snapshot() {
    return [...document.querySelectorAll(selector)].map(badge => {
      const row = badge.parentElement;
      const copy = [...row.querySelectorAll('button')].find(b => /^(复制|已复制|Copy|Copied)$/i.test(b.getAttribute('aria-label')));
      const rect = badge.getBoundingClientRect();
      const copyRect = copy?.getBoundingClientRect();
      return {text: badge.textContent, source: badge.title, sameActionRow: !!copy,
        y: rect.y, height: rect.height, copyY: copyRect?.y, copyHeight: copyRect?.height};
    });
  }
  window.__codexTokenToolbar = {refresh, snapshot,
    pending() {
      const found = new Map();
      for (const button of document.querySelectorAll('button[aria-label]')) {
        if (!/^(复制|已复制|Copy|Copied)$/i.test(button.getAttribute('aria-label'))) continue;
        const context = contextFor(button);
        if (context) found.set(context.threadId + '/' + context.turnId, context);
      }
      return [...found.values()];
    },
    setLogStats(entries) {
      for (const entry of entries) logStats.set(entry.threadId + '/' + entry.turnId, entry.message);
      refresh();
    },
    remove() {
    observer.disconnect(); clearInterval(timer);
    for (const [row, saved] of rows) row.style.opacity = saved.opacity;
    document.querySelectorAll(selector).forEach(badge => badge.remove());
    delete window.__codexTokenToolbar;
  }};
  refresh();
  return snapshot();
})()
