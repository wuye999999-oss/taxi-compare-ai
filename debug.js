import { diagnose } from './matcher.js';
import { itemText, priceOf, yuan } from './unit-price.js';

export function debugRows(items, query) {
  return items.map((item, index) => ({ index: index + 1, item, diagnose: diagnose(item, query) }));
}

export function renderDebug(items, query) {
  const rows = debugRows(items, query);
  const kept = rows.filter(row => row.diagnose.keep).length;
  return `<details class="debug-tools"><summary>调试工具（默认隐藏）</summary><p>接口候选 ${rows.length} 条；保留 ${kept} 条；过滤 ${rows.length - kept} 条。</p>${rows.map(row => `<div class="debug-row ${row.diagnose.keep ? 'keep' : 'drop'}"><b>${row.diagnose.keep ? '保留' : '过滤'} #${row.index}</b> ｜ ${row.item.platform || ''} ｜ ¥${yuan(priceOf(row.item))}<br>${itemText(row.item)}<br><small>${row.diagnose.reasons.join('；')}</small></div>`).join('')}</details>`;
}
